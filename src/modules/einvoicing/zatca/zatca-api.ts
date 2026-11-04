import type { ZatcaEnvironment } from './zatca.types.js';

export const ZATCA_BASE_URL: Readonly<Record<ZatcaEnvironment, string>> = {
  SANDBOX: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/developer-portal',
  SIMULATION: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/simulation',
  PRODUCTION: 'https://gw-fatoora.zatca.gov.sa/e-invoicing/core',
};

export interface ZatcaCredentials {
  /** binarySecurityToken as returned by ZATCA. */
  token: string;
  secret: string;
}

export interface CsidResponse extends ZatcaCredentials {
  requestId: string;
  /** Base64 DER certificate (decoded from the security token). */
  certificate: string;
  dispositionMessage?: string;
}

export interface ValidationMessage {
  type?: string;
  code?: string;
  category?: string;
  message?: string;
  status?: string;
}

export interface SubmissionResult {
  httpStatus: number;
  /** ZATCA said the document is valid (200 OK or 202 with warnings). */
  accepted: boolean;
  /** CLEARED / NOT_CLEARED / REPORTED / NOT_REPORTED / PASS ... */
  status: string | null;
  warnings: ValidationMessage[];
  errors: ValidationMessage[];
  /** Clearance: the invoice as stamped by ZATCA (XML). */
  clearedXml: string | null;
  raw: unknown;
}

export class ZatcaApiError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number | null,
    readonly body: unknown,
  ) {
    super(message);
    this.name = 'ZatcaApiError';
  }
}

export interface DocumentPayload {
  invoiceHash: string;
  uuid: string;
  /** Signed XML (UTF-8). */
  xml: string;
}

/**
 * Thin client for the FATOORA gateway (API version V2). Network or 5xx
 * failures throw ZatcaApiError (retryable); validation rejections (400)
 * resolve with `accepted: false` and the error list.
 */
export class ZatcaApiClient {
  constructor(
    private readonly environment: ZatcaEnvironment,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly timeoutMs = 20_000,
  ) {}

  /** Step 1: CSR + OTP from the FATOORA portal -> compliance CSID. */
  async complianceCsid(csrPem: string, otp: string): Promise<CsidResponse> {
    const body = await this.call('/compliance', {
      headers: { OTP: otp },
      body: { csr: Buffer.from(csrPem, 'utf8').toString('base64') },
    });
    return toCsid(body.json);
  }

  /** Step 2: compliance checks with the compliance CSID (one per document type). */
  async complianceCheck(credentials: ZatcaCredentials, doc: DocumentPayload): Promise<SubmissionResult> {
    return this.submit('/compliance/invoices', credentials, doc, {});
  }

  /** Step 3: production CSID once the compliance checks passed. */
  async productionCsid(credentials: ZatcaCredentials, complianceRequestId: string): Promise<CsidResponse> {
    const body = await this.call('/production/csids', {
      credentials,
      body: { compliance_request_id: complianceRequestId },
    });
    return toCsid(body.json);
  }

  /** Simplified (B2C) invoices and their notes: report within 24 hours. */
  report(credentials: ZatcaCredentials, doc: DocumentPayload): Promise<SubmissionResult> {
    return this.submit('/invoices/reporting/single', credentials, doc, { 'Clearance-Status': '0' });
  }

  /** Standard (B2B) invoices and their notes: must be cleared before sharing. */
  clear(credentials: ZatcaCredentials, doc: DocumentPayload): Promise<SubmissionResult> {
    return this.submit('/invoices/clearance/single', credentials, doc, { 'Clearance-Status': '1' });
  }

  private async submit(
    path: string,
    credentials: ZatcaCredentials,
    doc: DocumentPayload,
    headers: Record<string, string>,
  ): Promise<SubmissionResult> {
    const { status, json } = await this.call(path, {
      credentials,
      headers,
      body: { invoiceHash: doc.invoiceHash, uuid: doc.uuid, invoice: Buffer.from(doc.xml, 'utf8').toString('base64') },
      acceptStatuses: [200, 202, 400],
    });
    const results = (json as { validationResults?: Record<string, unknown> }).validationResults ?? {};
    const list = (key: string) => (Array.isArray(results[key]) ? (results[key] as ValidationMessage[]) : []);
    const record = json as Record<string, unknown>;
    const cleared = typeof record.clearedInvoice === 'string' ? Buffer.from(record.clearedInvoice, 'base64').toString('utf8') : null;
    return {
      httpStatus: status,
      accepted: status === 200 || status === 202,
      status: (record.clearanceStatus ?? record.reportingStatus ?? results.status ?? null) as string | null,
      warnings: list('warningMessages'),
      errors: list('errorMessages'),
      clearedXml: cleared,
      raw: json,
    };
  }

  private async call(
    path: string,
    options: {
      credentials?: ZatcaCredentials;
      headers?: Record<string, string>;
      body: unknown;
      acceptStatuses?: number[];
    },
  ): Promise<{ status: number; json: unknown }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'Accept-Language': 'en',
      'Accept-Version': 'V2',
      ...options.headers,
    };
    if (options.credentials) {
      headers.Authorization = `Basic ${Buffer.from(`${options.credentials.token}:${options.credentials.secret}`).toString('base64')}`;
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${ZATCA_BASE_URL[this.environment]}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(options.body),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new ZatcaApiError(`ZATCA unreachable: ${(error as Error).message}`, null, null);
    }

    const textBody = await response.text();
    let json: unknown = null;
    try {
      json = textBody ? JSON.parse(textBody) : null;
    } catch {
      json = { message: textBody.slice(0, 2000) };
    }
    const accepted = options.acceptStatuses ?? [200, 202];
    if (!accepted.includes(response.status)) {
      throw new ZatcaApiError(`ZATCA ${path} responded ${response.status}`, response.status, json);
    }
    return { status: response.status, json: json ?? {} };
  }
}

function toCsid(json: unknown): CsidResponse {
  const body = json as Record<string, unknown>;
  const token = body.binarySecurityToken;
  const secret = body.secret;
  if (typeof token !== 'string' || typeof secret !== 'string') {
    throw new ZatcaApiError('ZATCA did not return a security token', 200, json);
  }
  return {
    token,
    secret,
    requestId: String(body.requestID ?? ''),
    certificate: Buffer.from(token, 'base64').toString('utf8'),
    dispositionMessage: typeof body.dispositionMessage === 'string' ? body.dispositionMessage : undefined,
  };
}

/** HTTP status codes worth retrying later (gateway / outage), as opposed to a rejection. */
export const isRetryableZatcaError = (error: unknown): boolean =>
  error instanceof ZatcaApiError && (error.httpStatus === null || error.httpStatus >= 500 || error.httpStatus === 429);
