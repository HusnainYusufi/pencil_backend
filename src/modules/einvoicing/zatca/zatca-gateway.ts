import { ZatcaApiClient, type CsidResponse, type DocumentPayload, type SubmissionResult, type ZatcaCredentials } from './zatca-api.js';
import type { ZatcaEnvironment } from './zatca.types.js';

/** What the application needs from FATOORA (swappable in tests). */
export interface ZatcaGateway {
  complianceCsid(csrPem: string, otp: string): Promise<CsidResponse>;
  complianceCheck(credentials: ZatcaCredentials, doc: DocumentPayload): Promise<SubmissionResult>;
  productionCsid(credentials: ZatcaCredentials, complianceRequestId: string): Promise<CsidResponse>;
  report(credentials: ZatcaCredentials, doc: DocumentPayload): Promise<SubmissionResult>;
  clear(credentials: ZatcaCredentials, doc: DocumentPayload): Promise<SubmissionResult>;
}

export type ZatcaGatewayFactory = (environment: ZatcaEnvironment) => ZatcaGateway;

export const ZATCA_GATEWAY_FACTORY = Symbol('ZATCA_GATEWAY_FACTORY');

export const defaultZatcaGatewayFactory: ZatcaGatewayFactory = (environment) => new ZatcaApiClient(environment);
