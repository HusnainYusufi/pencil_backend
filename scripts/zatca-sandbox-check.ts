/* oxlint-disable no-console -- CLI script */
/**
 * End-to-end check of the ZATCA library against ZATCA's public developer
 * portal (sandbox): CSR -> compliance CSID -> the six compliance documents ->
 * production CSID -> one cleared and one reported invoice.
 * Uses ZATCA's published test VAT number and OTP; sends no customer data.
 *
 *   npx tsx scripts/zatca-sandbox-check.ts
 */
import { randomUUID } from 'node:crypto';
import { buildComplianceSamples } from '../src/modules/einvoicing/zatca/compliance-samples.js';
import { generateCsr } from '../src/modules/einvoicing/zatca/csr.js';
import { ZatcaApiClient } from '../src/modules/einvoicing/zatca/zatca-api.js';

const VAT = '399999999900003';
const SANDBOX_OTP = '123345';

async function main(): Promise<void> {
  const client = new ZatcaApiClient('SANDBOX');
  const { privateKeyPem, csrPem } = generateCsr(
    {
      commonName: `Pencil-EGS-${randomUUID().slice(0, 8)}`,
      organizationUnit: 'Riyadh Branch',
      organizationName: 'Pencil Sandbox Co',
      vatNumber: VAT,
      egsSerial: `1-Pencil|2-1.0|3-${randomUUID()}`,
      invoiceTypes: '1100',
      location: 'RRRD2929',
      industry: 'Retail',
    },
    'SANDBOX',
  );

  const csid = await client.complianceCsid(csrPem, SANDBOX_OTP);
  console.log(`✔ compliance CSID issued (request ${csid.requestId})`);

  const now = new Date();
  const samples = buildComplianceSamples({
    seller: {
      name: 'Pencil Sandbox Co',
      vatNumber: VAT,
      idScheme: 'CRN',
      idValue: '1010010000',
      address: {
        street: 'King Fahd Road',
        buildingNumber: '1234',
        district: 'Al Olaya',
        city: 'Riyadh',
        postalCode: '12345',
        country: 'SA',
      },
    },
    kinds: ['STANDARD', 'SIMPLIFIED'],
    identity: { privateKeyPem, certificate: csid.certificate },
    issueDate: now.toISOString().slice(0, 10),
    issueTime: now.toISOString().slice(11, 19),
  });

  let failures = 0;
  for (const sample of samples) {
    const result = await client.complianceCheck(csid, {
      invoiceHash: sample.signed.invoiceHash,
      uuid: sample.invoice.uuid,
      xml: sample.signed.xml,
    });
    const mark = result.accepted ? '✔' : '✘';
    if (!result.accepted) failures++;
    console.log(`${mark} ${sample.label}: HTTP ${result.httpStatus} ${result.status ?? ''}`);
    for (const m of [...result.errors, ...result.warnings]) console.log(`    ${m.type ?? ''} ${m.code ?? ''}: ${m.message ?? ''}`);
  }

  if (failures === 0) {
    const production = await client.productionCsid(csid, csid.requestId);
    console.log(`✔ production CSID issued (request ${production.requestId})`);

    // Real submissions with the production certificate: clearance (B2B) and reporting (B2C).
    const live = buildComplianceSamples({
      seller: samples[0]!.invoice.seller,
      kinds: ['STANDARD', 'SIMPLIFIED'],
      identity: { privateKeyPem, certificate: production.certificate },
      issueDate: now.toISOString().slice(0, 10),
      issueTime: now.toISOString().slice(11, 19),
    }).filter((s) => s.invoice.documentType === 'INVOICE');
    for (const sample of live) {
      const doc = { invoiceHash: sample.signed.invoiceHash, uuid: sample.invoice.uuid, xml: sample.signed.xml };
      const result = sample.invoice.kind === 'STANDARD' ? await client.clear(production, doc) : await client.report(production, doc);
      if (!result.accepted) failures++;
      console.log(`${result.accepted ? '✔' : '✘'} ${sample.invoice.kind === 'STANDARD' ? 'clearance' : 'reporting'}: HTTP ${result.httpStatus} ${result.status ?? ''}`);
      for (const m of [...result.errors, ...result.warnings]) console.log(`    ${m.type ?? ''} ${m.code ?? ''}: ${m.message ?? ''}`);
    }
  }
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
