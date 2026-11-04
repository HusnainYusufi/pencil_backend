import { createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { bitString, contextTag, integer, oid, sequence, set, tlv, utf8 } from '../src/modules/einvoicing/zatca/der.js';
import { ZatcaApiError, type DocumentPayload, type SubmissionResult } from '../src/modules/einvoicing/zatca/zatca-api.js';
import type { ZatcaGateway, ZatcaGatewayFactory } from '../src/modules/einvoicing/zatca/zatca-gateway.js';

/** Self-signed secp256k1 certificate standing in for a ZATCA CSID. */
function fakeCertificate(): string {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'secp256k1' });
  const name = sequence(set(sequence(oid('2.5.4.3'), utf8('Fake-ZATCA-CA'))));
  const algorithm = sequence(oid('1.2.840.10045.4.3.2'));
  const time = (s: string) => tlv(0x17, Buffer.from(s, 'ascii'));
  const tbs = sequence(
    contextTag(0, integer(2)),
    tlv(0x02, Buffer.from([0x07])),
    algorithm,
    name,
    sequence(time('260101000000Z'), time('310101000000Z')),
    name,
    createPublicKey(privateKey).export({ type: 'spki', format: 'der' }),
  );
  return sequence(tbs, algorithm, bitString(sign('sha256', tbs, privateKey))).toString('base64');
}

export type FakeMode = 'accept' | 'reject' | 'outage';

/**
 * In-memory FATOORA: issues fake CSIDs and accepts, rejects or "times out"
 * submissions depending on `mode`. Records everything it receives.
 */
export class FakeZatca implements ZatcaGateway {
  mode: FakeMode = 'accept';
  complianceMode: 'accept' | 'reject' = 'accept';
  readonly submissions: Array<{ kind: 'clear' | 'report' | 'compliance'; payload: DocumentPayload }> = [];
  private readonly certificate = fakeCertificate();

  readonly factory: ZatcaGatewayFactory = () => this;

  async complianceCsid(_csrPem: string, otp: string) {
    if (otp !== '123456') throw new ZatcaApiError('ZATCA /compliance responded 400', 400, { errors: ['Invalid OTP'] });
    return this.csid('compliance-request-1');
  }

  async complianceCheck(_credentials: unknown, payload: DocumentPayload): Promise<SubmissionResult> {
    this.submissions.push({ kind: 'compliance', payload });
    return this.result(this.complianceMode === 'accept', 'PASS', null);
  }

  async productionCsid() {
    return this.csid('production-request-1');
  }

  async clear(_credentials: unknown, payload: DocumentPayload): Promise<SubmissionResult> {
    return this.submit('clear', payload);
  }

  async report(_credentials: unknown, payload: DocumentPayload): Promise<SubmissionResult> {
    return this.submit('report', payload);
  }

  private async submit(kind: 'clear' | 'report', payload: DocumentPayload): Promise<SubmissionResult> {
    this.submissions.push({ kind, payload });
    if (this.mode === 'outage') throw new ZatcaApiError('ZATCA unreachable: timeout', null, null);
    const accepted = this.mode === 'accept';
    // Clearance returns ZATCA's stamped copy; here the same XML.
    return this.result(accepted, kind === 'clear' ? (accepted ? 'CLEARED' : 'NOT_CLEARED') : accepted ? 'REPORTED' : 'NOT_REPORTED', kind === 'clear' && accepted ? payload.xml : null);
  }

  private result(accepted: boolean, status: string, clearedXml: string | null): SubmissionResult {
    return {
      httpStatus: accepted ? 200 : 400,
      accepted,
      status,
      warnings: [],
      errors: accepted ? [] : [{ type: 'ERROR', code: 'BR-KSA-TEST', message: 'Rejected by fake ZATCA' }],
      clearedXml,
      raw: {},
    };
  }

  private csid(requestId: string) {
    const token = Buffer.from(this.certificate).toString('base64');
    return { token, secret: 'fake-secret', requestId, certificate: this.certificate };
  }
}
