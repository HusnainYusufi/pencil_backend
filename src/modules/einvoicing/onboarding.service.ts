import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Db } from '../../core/database/db.service.js';
import { RequestContext } from '../../core/context/request-context.service.js';
import { AppException } from '../../core/errors/app.exception.js';
import { ErrorCode } from '../../core/errors/error-codes.js';
import { SecretBox } from '../../core/security/secret-box.js';
import type { EInvoicingUnit } from '../../generated/prisma/client.js';
import type { EInvoicingEnvironment } from '../../generated/prisma/enums.js';
import { AccountingContext } from '../accounting/accounting-context.service.js';
import { AuditService } from '../audit/audit.service.js';
import { TenantsRepository } from '../tenancy/repositories/tenants.repository.js';
import { EInvoicingUnitsRepository } from './einvoicing.repositories.js';
import { sellerFromTenant } from './party.js';
import { inspectCertificate } from './zatca/certificate.js';
import { buildComplianceSamples } from './zatca/compliance-samples.js';
import { generateCsr } from './zatca/csr.js';
import { ZatcaApiError } from './zatca/zatca-api.js';
import { ZATCA_GATEWAY_FACTORY, type ZatcaGatewayFactory } from './zatca/zatca-gateway.js';
import { localTime, validateSellerForZatca } from './zatca/zatca-mapper.js';

export interface OnboardZatcaInput {
  environment: EInvoicingEnvironment;
  /** One-time password from the FATOORA portal. */
  otp: string;
  name?: string;
  /** Branch / unit (must be the 10-digit TIN for VAT groups). */
  organizationUnit?: string;
  /** Short national address, e.g. RRRD2929. */
  location?: string;
  industry?: string;
}

const SOLUTION = 'Pencil';
const MODEL = '1.0';

/**
 * ZATCA device (EGS unit) onboarding:
 *   CSR + OTP -> compliance CSID -> compliance checks (one document per type)
 *   -> production CSID -> ACTIVE (replacing the previous active unit).
 * Progress is persisted at each step; a failure leaves the unit PENDING with
 * the reason, and the user restarts with a fresh OTP.
 */
@Injectable()
export class EInvoicingOnboardingService {
  constructor(
    private readonly db: Db,
    private readonly ctx: RequestContext,
    private readonly accounting: AccountingContext,
    private readonly tenants: TenantsRepository,
    private readonly units: EInvoicingUnitsRepository,
    private readonly secrets: SecretBox,
    private readonly audit: AuditService,
    @Inject(ZATCA_GATEWAY_FACTORY) private readonly gateways: ZatcaGatewayFactory,
  ) {}

  list(): Promise<EInvoicingUnit[]> {
    return this.units.list();
  }

  async onboardZatca(input: OnboardZatcaInput): Promise<EInvoicingUnit> {
    const profile = await this.accounting.profile();
    if (profile.country !== 'SA') {
      throw new AppException(ErrorCode.EINVOICING_NOT_READY, 'ZATCA e-invoicing applies to companies registered in Saudi Arabia');
    }
    const tenant = await this.tenants.findById(profile.tenantId);
    if (!tenant) throw AppException.notFound('Tenant');
    const seller = sellerFromTenant(tenant);
    const sellerErrors = validateSellerForZatca(seller);
    if (sellerErrors.length > 0) {
      throw new AppException(ErrorCode.EINVOICING_NOT_READY, 'Complete the company profile before onboarding to ZATCA', sellerErrors);
    }
    if (!this.secrets.available) {
      throw new AppException(ErrorCode.EINVOICING_NOT_READY, 'Secret storage is not configured on this server (DATA_ENCRYPTION_KEY)');
    }

    const serial = randomUUID();
    const commonName = `${SOLUTION}-EGS-${serial.slice(0, 8)}`;
    const egsSerial = `1-${SOLUTION}|2-${MODEL}|3-${serial}`;
    const { privateKeyPem, csrPem } = generateCsr(
      {
        commonName,
        organizationUnit: input.organizationUnit ?? tenant.tradeName ?? 'Main Branch',
        organizationName: tenant.legalName,
        vatNumber: tenant.taxNumber!,
        egsSerial,
        invoiceTypes: '1100',
        location: input.location ?? `${tenant.addressBuildingNumber} ${tenant.addressStreet}`.slice(0, 100),
        industry: input.industry ?? 'General',
      },
      input.environment,
    );

    let unit = await this.db.transaction(async () => {
      const created = await this.units.create({
        provider: 'ZATCA',
        environment: input.environment,
        name: input.name ?? `ZATCA ${input.environment.toLowerCase()}`,
        commonName,
        serialNumber: egsSerial,
        invoiceTypes: '1100',
        privateKey: this.secrets.encrypt(privateKeyPem),
        csr: csrPem,
        createdById: this.ctx.actor?.type === 'user' ? this.ctx.actor.userId : null,
      });
      await this.audit.record({ action: 'einvoicing.onboarding_started', entityType: 'einvoicing_unit', entityId: created.id, metadata: { environment: input.environment } });
      return created;
    });

    const gateway = this.gateways(input.environment);
    try {
      // 1. Compliance CSID.
      const compliance = await gateway.complianceCsid(csrPem, input.otp);
      unit = await this.units.update(unit.id, {
        complianceRequestId: compliance.requestId,
        complianceToken: this.secrets.encrypt(compliance.token),
        complianceSecret: this.secrets.encrypt(compliance.secret),
      });

      // 2. Compliance checks: every document type the unit will issue.
      const now = new Date();
      const samples = buildComplianceSamples({
        seller: { name: seller.name, vatNumber: seller.vatNumber, idScheme: seller.idScheme, idValue: seller.idNumber, address: seller.address },
        kinds: ['STANDARD', 'SIMPLIFIED'],
        identity: { privateKeyPem, certificate: compliance.certificate },
        issueDate: now.toISOString().slice(0, 10),
        issueTime: localTime(now, profile.timezone),
      });
      const failures: Array<{ document: string; errors: unknown[] }> = [];
      for (const sample of samples) {
        const result = await gateway.complianceCheck(compliance, {
          invoiceHash: sample.signed.invoiceHash,
          uuid: sample.invoice.uuid,
          xml: sample.signed.xml,
        });
        if (!result.accepted) failures.push({ document: sample.label, errors: result.errors });
      }
      if (failures.length > 0) {
        await this.units.update(unit.id, { lastError: JSON.stringify(failures).slice(0, 4000) });
        throw new AppException(ErrorCode.EINVOICING_ONBOARDING_FAILED, 'ZATCA compliance checks failed', failures);
      }

      // 3. Production CSID, then activate (replacing the previous unit).
      const production = await gateway.productionCsid(compliance, compliance.requestId);
      const cert = inspectCertificate(production.certificate);
      unit = await this.db.transaction(async () => {
        await this.units.revokeActive('ZATCA');
        const activated = await this.units.update(unit.id, {
          status: 'ACTIVE',
          productionToken: this.secrets.encrypt(production.token),
          productionSecret: this.secrets.encrypt(production.secret),
          certificate: production.certificate,
          certificateExpiresAt: cert.validTo,
          lastError: null,
          onboardedAt: new Date(),
        });
        await this.audit.record({ action: 'einvoicing.onboarded', entityType: 'einvoicing_unit', entityId: unit.id, metadata: { environment: input.environment } });
        return activated;
      });
      return unit;
    } catch (error) {
      if (error instanceof AppException) throw error;
      const message = error instanceof Error ? error.message : 'ZATCA onboarding failed';
      await this.units.update(unit.id, { lastError: message.slice(0, 4000) });
      throw new AppException(
        ErrorCode.EINVOICING_ONBOARDING_FAILED,
        error instanceof ZatcaApiError && error.httpStatus === 400 ? 'ZATCA rejected the request (check the OTP; it is single-use and expires quickly)' : message,
        error instanceof ZatcaApiError ? { httpStatus: error.httpStatus, response: error.body } : undefined,
      );
    }
  }
}
