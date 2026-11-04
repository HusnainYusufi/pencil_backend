-- CreateEnum
CREATE TYPE "PurchaseDocumentType" AS ENUM ('BILL', 'CREDIT_NOTE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "PurchaseStatus" AS ENUM ('DRAFT', 'POSTED', 'VOID');

-- CreateEnum
CREATE TYPE "SupplierPaymentStatus" AS ENUM ('POSTED', 'VOID');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "JournalSource" ADD VALUE 'PURCHASE_BILL';
ALTER TYPE "JournalSource" ADD VALUE 'SUPPLIER_PAYMENT';

-- CreateTable
CREATE TABLE "purchase_bills" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" "PurchaseDocumentType" NOT NULL DEFAULT 'BILL',
    "status" "PurchaseStatus" NOT NULL DEFAULT 'DRAFT',
    "number" VARCHAR(30),
    "supplier_reference" VARCHAR(100),
    "contact_id" UUID,
    "bill_date" DATE NOT NULL,
    "due_date" DATE,
    "currency" CHAR(3) NOT NULL,
    "exchange_rate" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "prices_include_tax" BOOLEAN NOT NULL DEFAULT false,
    "original_bill_id" UUID,
    "paid_from_account_id" UUID,
    "reason" VARCHAR(500),
    "notes" VARCHAR(2000),
    "branch_id" UUID,
    "subtotal" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "discount_total" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "taxable_amount" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "tax_total" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "total" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "amount_paid" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "amount_credited" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "supplier" JSONB,
    "journal_entry_id" UUID,
    "created_by_id" UUID,
    "posted_by_id" UUID,
    "posted_at" TIMESTAMPTZ(3),
    "voided_by_id" UUID,
    "voided_at" TIMESTAMPTZ(3),
    "void_reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "purchase_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_bill_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "description" VARCHAR(1000) NOT NULL,
    "quantity" DECIMAL(18,6) NOT NULL,
    "unit_price" DECIMAL(20,6) NOT NULL,
    "discount" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "tax_rate_id" UUID NOT NULL,
    "tax_category" "TaxCategory" NOT NULL,
    "tax_percent" DECIMAL(7,4) NOT NULL,
    "exemption_code" VARCHAR(30),
    "account_id" UUID NOT NULL,
    "cost_center_id" UUID,
    "net_amount" DECIMAL(20,4) NOT NULL,
    "tax_amount" DECIMAL(20,4) NOT NULL,
    "total_amount" DECIMAL(20,4) NOT NULL,

    CONSTRAINT "purchase_bill_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" VARCHAR(30) NOT NULL,
    "contact_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,
    "method" "PaymentMeans" NOT NULL DEFAULT 'BANK_TRANSFER',
    "account_id" UUID NOT NULL,
    "reference" VARCHAR(100),
    "notes" VARCHAR(1000),
    "status" "SupplierPaymentStatus" NOT NULL DEFAULT 'POSTED',
    "journal_entry_id" UUID,
    "created_by_id" UUID,
    "voided_by_id" UUID,
    "voided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "supplier_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_payment_allocations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "bill_id" UUID NOT NULL,
    "amount" DECIMAL(20,4) NOT NULL,

    CONSTRAINT "supplier_payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchase_bills_journal_entry_id_key" ON "purchase_bills"("journal_entry_id");

-- CreateIndex
CREATE INDEX "purchase_bills_tenant_id_status_bill_date_idx" ON "purchase_bills"("tenant_id", "status", "bill_date");

-- CreateIndex
CREATE INDEX "purchase_bills_tenant_id_contact_id_idx" ON "purchase_bills"("tenant_id", "contact_id");

-- CreateIndex
CREATE INDEX "purchase_bills_original_bill_id_idx" ON "purchase_bills"("original_bill_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_bills_tenant_id_number_key" ON "purchase_bills"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "purchase_bill_lines_tenant_id_account_id_idx" ON "purchase_bill_lines"("tenant_id", "account_id");

-- CreateIndex
CREATE UNIQUE INDEX "purchase_bill_lines_bill_id_line_no_key" ON "purchase_bill_lines"("bill_id", "line_no");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payments_journal_entry_id_key" ON "supplier_payments"("journal_entry_id");

-- CreateIndex
CREATE INDEX "supplier_payments_tenant_id_contact_id_date_idx" ON "supplier_payments"("tenant_id", "contact_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payments_tenant_id_number_key" ON "supplier_payments"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "supplier_payment_allocations_bill_id_idx" ON "supplier_payment_allocations"("bill_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_payment_allocations_payment_id_bill_id_key" ON "supplier_payment_allocations"("payment_id", "bill_id");

-- AddForeignKey
ALTER TABLE "purchase_bills" ADD CONSTRAINT "purchase_bills_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_bills" ADD CONSTRAINT "purchase_bills_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_bills" ADD CONSTRAINT "purchase_bills_original_bill_id_fkey" FOREIGN KEY ("original_bill_id") REFERENCES "purchase_bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_bills" ADD CONSTRAINT "purchase_bills_paid_from_account_id_fkey" FOREIGN KEY ("paid_from_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_bills" ADD CONSTRAINT "purchase_bills_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_bills" ADD CONSTRAINT "purchase_bills_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_bill_lines" ADD CONSTRAINT "purchase_bill_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_bill_lines" ADD CONSTRAINT "purchase_bill_lines_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "purchase_bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_bill_lines" ADD CONSTRAINT "purchase_bill_lines_tax_rate_id_fkey" FOREIGN KEY ("tax_rate_id") REFERENCES "tax_rates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_bill_lines" ADD CONSTRAINT "purchase_bill_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchase_bill_lines" ADD CONSTRAINT "purchase_bill_lines_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payments" ADD CONSTRAINT "supplier_payments_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payment_allocations" ADD CONSTRAINT "supplier_payment_allocations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payment_allocations" ADD CONSTRAINT "supplier_payment_allocations_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "supplier_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_payment_allocations" ADD CONSTRAINT "supplier_payment_allocations_bill_id_fkey" FOREIGN KEY ("bill_id") REFERENCES "purchase_bills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================
-- Hand-written: tenant isolation and purchase invariants.
-- ===========================================================================
SELECT enable_tenant_rls('purchase_bills');
SELECT enable_tenant_rls('purchase_bill_lines');
SELECT enable_tenant_rls('supplier_payments');
SELECT enable_tenant_rls('supplier_payment_allocations');

ALTER TABLE purchase_bills
  ADD CONSTRAINT purchase_bills_rate_positive_chk CHECK (exchange_rate > 0),
  ADD CONSTRAINT purchase_bills_amounts_chk CHECK (
    subtotal >= 0 AND discount_total >= 0 AND taxable_amount >= 0 AND tax_total >= 0 AND total >= 0
    AND amount_paid >= 0 AND amount_credited >= 0 AND amount_paid + amount_credited <= total),
  ADD CONSTRAINT purchase_bills_posted_chk
    CHECK (status = 'DRAFT' OR (number IS NOT NULL AND posted_at IS NOT NULL AND journal_entry_id IS NOT NULL)),
  ADD CONSTRAINT purchase_bills_credit_reference_chk CHECK (type <> 'CREDIT_NOTE' OR original_bill_id IS NOT NULL),
  ADD CONSTRAINT purchase_bills_expense_account_chk CHECK (type <> 'EXPENSE' OR paid_from_account_id IS NOT NULL),
  ADD CONSTRAINT purchase_bills_supplier_chk CHECK (type = 'EXPENSE' OR contact_id IS NOT NULL);

ALTER TABLE purchase_bill_lines
  ADD CONSTRAINT purchase_bill_lines_amounts_chk CHECK (
    quantity > 0 AND unit_price >= 0 AND discount >= 0 AND net_amount >= 0 AND tax_amount >= 0
    AND total_amount = net_amount + tax_amount);

CREATE OR REPLACE FUNCTION purchase_bill_lines_block_posted() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  doc_status "PurchaseStatus";
BEGIN
  SELECT status INTO doc_status FROM purchase_bills WHERE id = NEW.bill_id;
  IF doc_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'Lines of posted purchase document % cannot change', NEW.bill_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER purchase_bill_lines_frozen
  BEFORE INSERT OR UPDATE ON purchase_bill_lines
  FOR EACH ROW EXECUTE FUNCTION purchase_bill_lines_block_posted();

ALTER TABLE supplier_payments ADD CONSTRAINT supplier_payments_amount_chk CHECK (amount > 0);
ALTER TABLE supplier_payment_allocations ADD CONSTRAINT supplier_payment_allocations_amount_chk CHECK (amount > 0);
