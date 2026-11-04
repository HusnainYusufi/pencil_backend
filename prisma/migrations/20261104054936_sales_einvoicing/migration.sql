-- CreateEnum
CREATE TYPE "EInvoicingProvider" AS ENUM ('ZATCA', 'JOFOTARA');

-- CreateEnum
CREATE TYPE "EInvoicingEnvironment" AS ENUM ('SANDBOX', 'SIMULATION', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "EInvoicingUnitStatus" AS ENUM ('PENDING', 'ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "EInvoiceStatus" AS ENUM ('PENDING', 'CLEARED', 'REPORTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ContactType" AS ENUM ('BUSINESS', 'INDIVIDUAL');

-- CreateEnum
CREATE TYPE "TaxCategory" AS ENUM ('STANDARD', 'ZERO_RATED', 'EXEMPT', 'OUT_OF_SCOPE');

-- CreateEnum
CREATE TYPE "SalesDocumentType" AS ENUM ('INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE');

-- CreateEnum
CREATE TYPE "InvoiceKind" AS ENUM ('STANDARD', 'SIMPLIFIED');

-- CreateEnum
CREATE TYPE "SalesInvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'VOID');

-- CreateEnum
CREATE TYPE "PaymentMeans" AS ENUM ('CASH', 'CREDIT', 'BANK_TRANSFER', 'CARD', 'OTHER');

-- CreateEnum
CREATE TYPE "CustomerPaymentStatus" AS ENUM ('POSTED', 'VOID');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "JournalSource" ADD VALUE 'SALES_INVOICE';
ALTER TYPE "JournalSource" ADD VALUE 'CUSTOMER_PAYMENT';

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "address_additional_number" VARCHAR(20),
ADD COLUMN     "address_building_number" VARCHAR(20),
ADD COLUMN     "address_city" VARCHAR(100),
ADD COLUMN     "address_district" VARCHAR(100),
ADD COLUMN     "address_postal_code" VARCHAR(20),
ADD COLUMN     "address_region" VARCHAR(100),
ADD COLUMN     "address_street" VARCHAR(200);

-- CreateTable
CREATE TABLE "einvoicing_units" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "provider" "EInvoicingProvider" NOT NULL,
    "environment" "EInvoicingEnvironment" NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "status" "EInvoicingUnitStatus" NOT NULL DEFAULT 'PENDING',
    "common_name" VARCHAR(100) NOT NULL,
    "serial_number" VARCHAR(200) NOT NULL,
    "invoice_types" CHAR(4) NOT NULL DEFAULT '1100',
    "private_key" TEXT,
    "csr" TEXT,
    "compliance_request_id" VARCHAR(100),
    "compliance_token" TEXT,
    "compliance_secret" TEXT,
    "production_token" TEXT,
    "production_secret" TEXT,
    "certificate" TEXT,
    "certificate_expires_at" TIMESTAMPTZ(3),
    "last_icv" INTEGER NOT NULL DEFAULT 0,
    "last_invoice_hash" VARCHAR(100),
    "last_error" VARCHAR(4000),
    "onboarded_at" TIMESTAMPTZ(3),
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "einvoicing_units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "einvoice_documents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "provider" "EInvoicingProvider" NOT NULL,
    "submission_type" VARCHAR(20) NOT NULL,
    "uuid" UUID NOT NULL,
    "icv" INTEGER NOT NULL,
    "previous_hash" VARCHAR(100) NOT NULL,
    "invoice_hash" VARCHAR(100) NOT NULL,
    "status" "EInvoiceStatus" NOT NULL DEFAULT 'PENDING',
    "xml" TEXT NOT NULL,
    "cleared_xml" TEXT,
    "qr" TEXT NOT NULL,
    "warnings" JSONB,
    "errors" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMPTZ(3),
    "next_attempt_at" TIMESTAMPTZ(3),
    "accepted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "einvoice_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" "ContactType" NOT NULL DEFAULT 'BUSINESS',
    "is_customer" BOOLEAN NOT NULL DEFAULT true,
    "is_supplier" BOOLEAN NOT NULL DEFAULT false,
    "code" VARCHAR(30),
    "name" VARCHAR(200) NOT NULL,
    "name_ar" VARCHAR(200),
    "email" VARCHAR(254),
    "phone" VARCHAR(32),
    "tax_number" VARCHAR(32),
    "id_scheme" VARCHAR(10),
    "id_number" VARCHAR(50),
    "address_street" VARCHAR(200),
    "address_building_number" VARCHAR(20),
    "address_additional_number" VARCHAR(20),
    "address_district" VARCHAR(100),
    "address_city" VARCHAR(100),
    "address_postal_code" VARCHAR(20),
    "address_region" VARCHAR(100),
    "address_country" CHAR(2),
    "payment_terms_days" INTEGER,
    "notes" VARCHAR(2000),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_rates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "name_ar" VARCHAR(150),
    "rate" DECIMAL(7,4) NOT NULL,
    "category" "TaxCategory" NOT NULL,
    "exemption_code" VARCHAR(30),
    "exemption_reason" VARCHAR(300),
    "account_id" UUID NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tax_rates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_invoices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" "SalesDocumentType" NOT NULL DEFAULT 'INVOICE',
    "kind" "InvoiceKind" NOT NULL DEFAULT 'STANDARD',
    "status" "SalesInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "number" VARCHAR(30),
    "uuid" UUID NOT NULL,
    "contact_id" UUID,
    "issue_date" DATE NOT NULL,
    "due_date" DATE,
    "supply_date" DATE,
    "currency" CHAR(3) NOT NULL,
    "exchange_rate" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "prices_include_tax" BOOLEAN NOT NULL DEFAULT false,
    "payment_means" "PaymentMeans" NOT NULL DEFAULT 'CREDIT',
    "original_invoice_id" UUID,
    "reason" VARCHAR(500),
    "reference" VARCHAR(100),
    "notes" VARCHAR(2000),
    "terms" VARCHAR(2000),
    "branch_id" UUID,
    "subtotal" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "discount_total" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "taxable_amount" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "tax_total" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "amount_paid" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "amount_credited" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "seller" JSONB,
    "buyer" JSONB,
    "qr_code" TEXT,
    "journal_entry_id" UUID,
    "created_by_id" UUID,
    "issued_by_id" UUID,
    "issued_at" TIMESTAMPTZ(3),
    "voided_by_id" UUID,
    "voided_at" TIMESTAMPTZ(3),
    "void_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sales_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_invoice_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "description" VARCHAR(1000) NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "unit_code" VARCHAR(10) NOT NULL DEFAULT 'PCE',
    "unit_price" DECIMAL(20,6) NOT NULL,
    "discount" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "tax_rate_id" UUID NOT NULL,
    "tax_category" "TaxCategory" NOT NULL,
    "tax_percent" DECIMAL(7,4) NOT NULL,
    "exemption_code" VARCHAR(30),
    "exemption_reason" VARCHAR(300),
    "account_id" UUID NOT NULL,
    "cost_center_id" UUID,
    "net_amount" DECIMAL(20,4) NOT NULL,
    "tax_amount" DECIMAL(20,4) NOT NULL,
    "total_amount" DECIMAL(20,4) NOT NULL,

    CONSTRAINT "sales_invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" VARCHAR(30) NOT NULL,
    "contact_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "method" "PaymentMeans" NOT NULL DEFAULT 'CASH',
    "account_id" UUID NOT NULL,
    "reference" VARCHAR(100),
    "notes" VARCHAR(1000),
    "status" "CustomerPaymentStatus" NOT NULL DEFAULT 'POSTED',
    "journal_entry_id" UUID,
    "created_by_id" UUID,
    "voided_by_id" UUID,
    "voided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customer_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "einvoicing_units_tenant_id_provider_status_idx" ON "einvoicing_units"("tenant_id", "provider", "status");

-- CreateIndex
CREATE UNIQUE INDEX "einvoice_documents_invoice_id_key" ON "einvoice_documents"("invoice_id");

-- CreateIndex
CREATE INDEX "einvoice_documents_status_next_attempt_at_idx" ON "einvoice_documents"("status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "einvoice_documents_unit_id_icv_key" ON "einvoice_documents"("unit_id", "icv");

-- CreateIndex
CREATE INDEX "contacts_tenant_id_name_idx" ON "contacts"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_tenant_id_code_key" ON "contacts"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "tax_rates_tenant_id_code_key" ON "tax_rates"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoices_uuid_key" ON "sales_invoices"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoices_journal_entry_id_key" ON "sales_invoices"("journal_entry_id");

-- CreateIndex
CREATE INDEX "sales_invoices_tenant_id_status_issue_date_idx" ON "sales_invoices"("tenant_id", "status", "issue_date");

-- CreateIndex
CREATE INDEX "sales_invoices_tenant_id_contact_id_idx" ON "sales_invoices"("tenant_id", "contact_id");

-- CreateIndex
CREATE INDEX "sales_invoices_original_invoice_id_idx" ON "sales_invoices"("original_invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoices_tenant_id_number_key" ON "sales_invoices"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "sales_invoice_lines_tenant_id_account_id_idx" ON "sales_invoice_lines"("tenant_id", "account_id");

-- CreateIndex
CREATE UNIQUE INDEX "sales_invoice_lines_invoice_id_line_no_key" ON "sales_invoice_lines"("invoice_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "customer_payments_journal_entry_id_key" ON "customer_payments"("journal_entry_id");

-- CreateIndex
CREATE INDEX "customer_payments_tenant_id_contact_id_date_idx" ON "customer_payments"("tenant_id", "contact_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "customer_payments_tenant_id_number_key" ON "customer_payments"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "payment_allocations_invoice_id_idx" ON "payment_allocations"("invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_allocations_payment_id_invoice_id_key" ON "payment_allocations"("payment_id", "invoice_id");

-- AddForeignKey
ALTER TABLE "einvoicing_units" ADD CONSTRAINT "einvoicing_units_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "einvoice_documents" ADD CONSTRAINT "einvoice_documents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "einvoice_documents" ADD CONSTRAINT "einvoice_documents_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "einvoicing_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "einvoice_documents" ADD CONSTRAINT "einvoice_documents_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "sales_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_original_invoice_id_fkey" FOREIGN KEY ("original_invoice_id") REFERENCES "sales_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoices" ADD CONSTRAINT "sales_invoices_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "sales_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_tax_rate_id_fkey" FOREIGN KEY ("tax_rate_id") REFERENCES "tax_rates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_invoice_lines" ADD CONSTRAINT "sales_invoice_lines_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_payments" ADD CONSTRAINT "customer_payments_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "customer_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "sales_invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================
-- Hand-written: tenant isolation and sales / e-invoicing invariants enforced
-- by the database itself (services validate first; these are the last word).
-- ===========================================================================
SELECT enable_tenant_rls('contacts');
SELECT enable_tenant_rls('tax_rates');
SELECT enable_tenant_rls('sales_invoices');
SELECT enable_tenant_rls('sales_invoice_lines');
SELECT enable_tenant_rls('customer_payments');
SELECT enable_tenant_rls('payment_allocations');
SELECT enable_tenant_rls('einvoicing_units');
SELECT enable_tenant_rls('einvoice_documents');

-- Tax rates: a sane percentage that agrees with its category; one default per company.
ALTER TABLE tax_rates
  ADD CONSTRAINT tax_rates_rate_range_chk CHECK (rate >= 0 AND rate <= 100),
  ADD CONSTRAINT tax_rates_category_rate_chk
    CHECK ((category = 'STANDARD' AND rate > 0) OR (category <> 'STANDARD' AND rate = 0));
CREATE UNIQUE INDEX tax_rates_one_default_per_tenant ON tax_rates (tenant_id) WHERE is_default;

-- Sales documents.
ALTER TABLE sales_invoices
  ADD CONSTRAINT sales_invoices_rate_positive_chk CHECK (exchange_rate > 0),
  ADD CONSTRAINT sales_invoices_amounts_chk CHECK (
    subtotal >= 0 AND discount_total >= 0 AND taxable_amount >= 0 AND tax_total >= 0 AND total >= 0
    AND amount_paid >= 0 AND amount_credited >= 0 AND amount_paid + amount_credited <= total),
  ADD CONSTRAINT sales_invoices_issued_chk
    CHECK (status = 'DRAFT' OR (number IS NOT NULL AND issued_at IS NOT NULL AND journal_entry_id IS NOT NULL)),
  ADD CONSTRAINT sales_invoices_note_reference_chk CHECK (type = 'INVOICE' OR original_invoice_id IS NOT NULL);

ALTER TABLE sales_invoice_lines
  ADD CONSTRAINT sales_invoice_lines_amounts_chk CHECK (
    quantity > 0 AND unit_price >= 0 AND discount >= 0 AND net_amount >= 0 AND tax_amount >= 0
    AND total_amount = net_amount + tax_amount);

-- Lines of an issued (or void) document are frozen.
CREATE OR REPLACE FUNCTION sales_invoice_lines_block_issued() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  doc_status "SalesInvoiceStatus";
BEGIN
  SELECT status INTO doc_status FROM sales_invoices WHERE id = NEW.invoice_id;
  IF doc_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'Lines of issued sales document % cannot change', NEW.invoice_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER sales_invoice_lines_frozen
  BEFORE INSERT OR UPDATE ON sales_invoice_lines
  FOR EACH ROW EXECUTE FUNCTION sales_invoice_lines_block_issued();

-- Payments.
ALTER TABLE customer_payments
  ADD CONSTRAINT customer_payments_amount_chk CHECK (amount > 0);
ALTER TABLE payment_allocations
  ADD CONSTRAINT payment_allocations_amount_chk CHECK (amount > 0);

-- E-invoicing: one active device per company and provider; the counter only grows.
CREATE UNIQUE INDEX einvoicing_units_one_active ON einvoicing_units (tenant_id, provider) WHERE status = 'ACTIVE';
ALTER TABLE einvoicing_units
  ADD CONSTRAINT einvoicing_units_icv_chk CHECK (last_icv >= 0);
ALTER TABLE einvoice_documents
  ADD CONSTRAINT einvoice_documents_icv_chk CHECK (icv > 0),
  ADD CONSTRAINT einvoice_documents_submission_type_chk CHECK (submission_type IN ('CLEARANCE', 'REPORTING'));
