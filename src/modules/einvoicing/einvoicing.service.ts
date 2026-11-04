import { Inject, Injectable, Logger } from '@nestjs/common';
import type { CountryCode } from '../../generated/prisma/enums.js';
import { Db } from '../../core/database/db.service.js';
import { AppException } from '../../core/errors/app.exception.js';
import { ErrorCode } from '../../core/errors/error-codes.js';
import { SecretBox } from '../../core/security/secret-box.js';
import type { EInvoiceDocument, EInvoicingUnit, Prisma } from '../../generated/prisma/client.js';
import type { EInvoicingProvider } from '../../generated/prisma/enums.js';
import { AccountingContext } from '../accounting/accounting-context.service.js';
import { AuditService } from '../audit/audit.service.js';
import { EInvoiceDocumentsRepository, EInvoicingUnitsRepository } from './einvoicing.repositories.js';
import type { EInvoicePreparation, EInvoiceRequest } from './einvoicing.types.js';
import { phaseOneQr, signInvoice } from './zatca/signing.js';
import { isRetryableZatcaError, ZatcaApiError, type SubmissionResult, type ZatcaCredentials } from './zatca/zatca-api.js';
import { ZATCA_GATEWAY_FACTORY, type ZatcaGatewayFactory } from './zatca/zatca-gateway.js';
import { extractQr, toZatcaInvoice, validateForZatca } from './zatca/zatca-mapper.js';
import { FIRST_PREVIOUS_HASH } from './zatca/zatca.types.js';

/** Which authority a company reports to, by country. */
const PROVIDER_BY_COUNTRY: Partial<Record<CountryCode, EInvoicingProvider>> = { SA: 'ZATCA' };

/** Retry delay after the n-th failed attempt: 1, 2, 4, ... minutes, capped at 1 hour. */
const backoffMs = (attempt: number) => Math.min(60_000 * 2 ** Math.max(0, attempt - 1), 3_600_000);

/**
 * E-invoicing orchestration, provider by provider.
 *
 *  prepare()  inside the issuing transaction: validate, take the next
 *             counter, sign, store the submission record (PENDING).
 *  submit()   after commit: send to the authority (clearance or reporting)
 *             and record the outcome. Network failures stay PENDING and are
 *             retried by the worker; rejections become REJECTED.
 */
@Injectable()
export class EInvoicingService {
  private readonly logger = new Logger(EInvoicingService.name);

  constructor(
    private readonly db: Db,
    private readonly accounting: AccountingContext,
    private readonly units: EInvoicingUnitsRepository,
    private readonly documents: EInvoiceDocumentsRepository,
    private readonly secrets: SecretBox,
    private readonly audit: AuditService,
    @Inject(ZATCA_GATEWAY_FACTORY) private readonly gateways: ZatcaGatewayFactory,
  ) {}

  providerFor(country: CountryCode): EInvoicingProvider | null {
    return PROVIDER_BY_COUNTRY[country] ?? null;
  }

  async prepare(req: EInvoiceRequest): Promise<EInvoicePreparation> {
    const profile = await this.accounting.profile();
    if (this.providerFor(profile.country) !== 'ZATCA') return { qr: null, documentId: null };

    const unit = await this.units.findActive('ZATCA');
    const zatcaShape = (chain: { icv: number; previousHash: string }) => toZatcaInvoice(req, chain, profile.timezone);
    if (!unit) {
      // Not onboarded to Phase 2 yet: print the Phase 1 QR (seller, VAT, time, totals).
      return { qr: req.seller.vatNumber ? phaseOneQr(zatcaShape({ icv: 0, previousHash: FIRST_PREVIOUS_HASH })) : null, documentId: null };
    }

    const errors = validateForZatca(req);
    if (errors.length > 0) {
      throw new AppException(ErrorCode.EINVOICING_NOT_READY, 'This document does not meet ZATCA e-invoicing requirements', errors);
    }

    const chain = await this.units.takeNextCounter(unit.id);
    const invoice = zatcaShape({ icv: chain.icv, previousHash: chain.previousHash ?? FIRST_PREVIOUS_HASH });
    const signed = signInvoice(invoice, {
      privateKeyPem: this.secrets.decrypt(unit.privateKey!),
      certificate: unit.certificate!,
    });
    await this.units.setLastHash(unit.id, signed.invoiceHash);
    const doc = await this.documents.create({
      unitId: unit.id,
      invoiceId: req.invoiceId,
      provider: 'ZATCA',
      submissionType: req.kind === 'STANDARD' ? 'CLEARANCE' : 'REPORTING',
      uuid: req.uuid,
      icv: chain.icv,
      previousHash: invoice.previousHash,
      invoiceHash: signed.invoiceHash,
      xml: signed.xml,
      qr: signed.qr,
    });
    return { qr: signed.qr, documentId: doc.id };
  }

  findForInvoice(invoiceId: string): Promise<EInvoiceDocument | null> {
    return this.documents.findByInvoice(invoiceId);
  }

  /** User-triggered retry of a pending submission. */
  async retryForInvoice(invoiceId: string): Promise<EInvoiceDocument> {
    const doc = await this.documents.findByInvoice(invoiceId);
    if (!doc) throw AppException.notFound('E-invoice for document', invoiceId);
    if (doc.status !== 'PENDING') return doc;
    return this.submit(doc.id);
  }

  /** Sends one document to the authority. Never throws for authority/network outcomes. */
  async submit(documentId: string): Promise<EInvoiceDocument> {
    const doc = await this.documents.findById(documentId);
    if (!doc) throw AppException.notFound('E-invoice', documentId);
    if (doc.status !== 'PENDING') return doc;
    const unit = await this.units.findById(doc.unitId);
    if (!unit) throw AppException.notFound('E-invoicing unit', doc.unitId);

    const attempts = doc.attempts + 1;
    const now = new Date();
    let update: Prisma.EInvoiceDocumentUncheckedUpdateInput;
    try {
      const gateway = this.gateways(unit.environment);
      const credentials = this.productionCredentials(unit);
      const payload = { invoiceHash: doc.invoiceHash, uuid: doc.uuid, xml: doc.xml };
      const result: SubmissionResult =
        doc.submissionType === 'CLEARANCE' ? await gateway.clear(credentials, payload) : await gateway.report(credentials, payload);
      update = this.outcome(doc, result, attempts, now);
    } catch (error) {
      const message = error instanceof ZatcaApiError || error instanceof Error ? error.message : 'Submission failed';
      if (!isRetryableZatcaError(error)) this.logger.warn(`e-invoice ${doc.id} submission error: ${message}`);
      update = {
        attempts,
        lastAttemptAt: now,
        nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)),
        errors: [{ message, ...(error instanceof ZatcaApiError && { httpStatus: error.httpStatus, body: error.body as Prisma.InputJsonValue }) }],
      };
    }

    const saved = await this.db.transaction(async () => {
      const updated = await this.documents.update(doc.id, update);
      if (updated.status !== 'PENDING') {
        await this.audit.record({
          action: `einvoice.${updated.status.toLowerCase()}`,
          entityType: 'sales_invoice',
          entityId: updated.invoiceId,
          metadata: { icv: updated.icv, attempts },
        });
      }
      return updated;
    });
    return saved;
  }

  async statusSummary() {
    const profile = await this.accounting.profile();
    const provider = this.providerFor(profile.country);
    const [unit, counts] = await Promise.all([provider ? this.units.findActive(provider) : null, this.documents.countByStatus()]);
    return {
      provider,
      required: provider !== null,
      activeUnit: unit ? toUnitView(unit) : null,
      documents: { PENDING: 0, CLEARED: 0, REPORTED: 0, REJECTED: 0, ...counts },
    };
  }

  private outcome(doc: EInvoiceDocument, result: SubmissionResult, attempts: number, now: Date): Prisma.EInvoiceDocumentUncheckedUpdateInput {
    const base = {
      attempts,
      lastAttemptAt: now,
      nextAttemptAt: null,
      warnings: result.warnings as unknown as Prisma.InputJsonValue,
      errors: result.errors as unknown as Prisma.InputJsonValue,
    };
    if (!result.accepted) return { ...base, status: 'REJECTED' };
    const clearedQr = result.clearedXml ? extractQr(result.clearedXml) : null;
    return {
      ...base,
      status: doc.submissionType === 'CLEARANCE' ? 'CLEARED' : 'REPORTED',
      acceptedAt: now,
      clearedXml: result.clearedXml,
      ...(clearedQr && { qr: clearedQr }),
    };
  }

  private productionCredentials(unit: EInvoicingUnit): ZatcaCredentials {
    if (!unit.productionToken || !unit.productionSecret) {
      throw new ZatcaApiError('E-invoicing unit has no production credentials', null, null);
    }
    return { token: this.secrets.decrypt(unit.productionToken), secret: this.secrets.decrypt(unit.productionSecret) };
  }
}

/** Public view of a unit: never exposes keys or credentials. */
export function toUnitView(unit: EInvoicingUnit) {
  return {
    id: unit.id,
    provider: unit.provider,
    environment: unit.environment,
    name: unit.name,
    status: unit.status,
    commonName: unit.commonName,
    serialNumber: unit.serialNumber,
    invoiceTypes: unit.invoiceTypes,
    certificateExpiresAt: unit.certificateExpiresAt,
    lastIcv: unit.lastIcv,
    lastError: unit.lastError,
    onboardedAt: unit.onboardedAt,
    createdAt: unit.createdAt,
  };
}
