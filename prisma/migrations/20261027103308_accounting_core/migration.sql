-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "AccountSubtype" AS ENUM ('CASH', 'BANK', 'ACCOUNTS_RECEIVABLE', 'INVENTORY', 'TAX_RECEIVABLE', 'OTHER_CURRENT_ASSET', 'FIXED_ASSET', 'ACCUMULATED_DEPRECIATION', 'OTHER_NON_CURRENT_ASSET', 'ACCOUNTS_PAYABLE', 'TAX_PAYABLE', 'OTHER_CURRENT_LIABILITY', 'NON_CURRENT_LIABILITY', 'EQUITY', 'RETAINED_EARNINGS', 'OPERATING_REVENUE', 'OTHER_REVENUE', 'COST_OF_SALES', 'OPERATING_EXPENSE', 'OTHER_EXPENSE');

-- CreateEnum
CREATE TYPE "FiscalStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "JournalStatus" AS ENUM ('DRAFT', 'POSTED');

-- CreateEnum
CREATE TYPE "JournalSource" AS ENUM ('MANUAL', 'OPENING_BALANCE', 'REVERSAL');

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "fiscal_year_start_month" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "parent_id" UUID,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "name_ar" VARCHAR(150),
    "description" VARCHAR(500),
    "type" "AccountType" NOT NULL,
    "subtype" "AccountSubtype" NOT NULL,
    "is_group" BOOLEAN NOT NULL DEFAULT false,
    "system_key" VARCHAR(50),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_years" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "FiscalStatus" NOT NULL DEFAULT 'OPEN',
    "closed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fiscal_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fiscal_periods" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "fiscal_year_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "status" "FiscalStatus" NOT NULL DEFAULT 'OPEN',
    "closed_at" TIMESTAMPTZ(3),
    "closed_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "fiscal_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branches" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "name_ar" VARCHAR(150),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "branches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_centers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "name_ar" VARCHAR(150),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cost_centers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" VARCHAR(30),
    "date" DATE NOT NULL,
    "status" "JournalStatus" NOT NULL DEFAULT 'DRAFT',
    "source" "JournalSource" NOT NULL DEFAULT 'MANUAL',
    "source_id" UUID,
    "reference" VARCHAR(100),
    "memo" VARCHAR(1000),
    "currency" CHAR(3) NOT NULL,
    "exchange_rate" DECIMAL(18,8) NOT NULL DEFAULT 1,
    "total_amount" DECIMAL(20,4) NOT NULL,
    "fiscal_period_id" UUID,
    "reversal_of_id" UUID,
    "created_by_id" UUID,
    "posted_by_id" UUID,
    "posted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "journal_entry_id" UUID NOT NULL,
    "line_no" INTEGER NOT NULL,
    "account_id" UUID NOT NULL,
    "description" VARCHAR(500),
    "debit" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "credit" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "branch_id" UUID,
    "cost_center_id" UUID,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "journal_entry_id" UUID NOT NULL,
    "journal_line_id" UUID,
    "account_id" UUID NOT NULL,
    "fiscal_period_id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "debit" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "credit" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "txn_debit" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "txn_credit" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "branch_id" UUID,
    "cost_center_id" UUID,
    "description" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "number_series" (
    "tenant_id" UUID NOT NULL,
    "doc_type" VARCHAR(30) NOT NULL,
    "year" INTEGER NOT NULL,
    "next_value" INTEGER NOT NULL,

    CONSTRAINT "number_series_pkey" PRIMARY KEY ("tenant_id","doc_type","year")
);

-- CreateIndex
CREATE INDEX "accounts_tenant_id_parent_id_idx" ON "accounts"("tenant_id", "parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_tenant_id_code_key" ON "accounts"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_tenant_id_system_key_key" ON "accounts"("tenant_id", "system_key");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_years_tenant_id_start_date_key" ON "fiscal_years"("tenant_id", "start_date");

-- CreateIndex
CREATE INDEX "fiscal_periods_tenant_id_start_date_idx" ON "fiscal_periods"("tenant_id", "start_date");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_periods_fiscal_year_id_number_key" ON "fiscal_periods"("fiscal_year_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "branches_tenant_id_code_key" ON "branches"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "cost_centers_tenant_id_code_key" ON "cost_centers"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_reversal_of_id_key" ON "journal_entries"("reversal_of_id");

-- CreateIndex
CREATE INDEX "journal_entries_tenant_id_status_date_idx" ON "journal_entries"("tenant_id", "status", "date");

-- CreateIndex
CREATE INDEX "journal_entries_tenant_id_source_source_id_idx" ON "journal_entries"("tenant_id", "source", "source_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_tenant_id_number_key" ON "journal_entries"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "journal_lines_tenant_id_account_id_idx" ON "journal_lines"("tenant_id", "account_id");

-- CreateIndex
CREATE UNIQUE INDEX "journal_lines_journal_entry_id_line_no_key" ON "journal_lines"("journal_entry_id", "line_no");

-- CreateIndex
CREATE INDEX "ledger_entries_tenant_id_account_id_date_idx" ON "ledger_entries"("tenant_id", "account_id", "date");

-- CreateIndex
CREATE INDEX "ledger_entries_tenant_id_date_idx" ON "ledger_entries"("tenant_id", "date");

-- CreateIndex
CREATE INDEX "ledger_entries_journal_entry_id_idx" ON "ledger_entries"("journal_entry_id");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_years" ADD CONSTRAINT "fiscal_years_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_periods" ADD CONSTRAINT "fiscal_periods_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_periods" ADD CONSTRAINT "fiscal_periods_fiscal_year_id_fkey" FOREIGN KEY ("fiscal_year_id") REFERENCES "fiscal_years"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branches" ADD CONSTRAINT "branches_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_centers" ADD CONSTRAINT "cost_centers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversal_of_id_fkey" FOREIGN KEY ("reversal_of_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_journal_entry_id_fkey" FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_fiscal_period_id_fkey" FOREIGN KEY ("fiscal_period_id") REFERENCES "fiscal_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_cost_center_id_fkey" FOREIGN KEY ("cost_center_id") REFERENCES "cost_centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "number_series" ADD CONSTRAINT "number_series_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================================================================
-- Hand-written: tenant isolation and accounting invariants enforced by the
-- database itself (the service layer validates first; these are the last word).
-- ===========================================================================

SELECT enable_tenant_rls('accounts');
SELECT enable_tenant_rls('fiscal_years');
SELECT enable_tenant_rls('fiscal_periods');
SELECT enable_tenant_rls('branches');
SELECT enable_tenant_rls('cost_centers');
SELECT enable_tenant_rls('journal_entries');
SELECT enable_tenant_rls('journal_lines');
SELECT enable_tenant_rls('ledger_entries');
SELECT enable_tenant_rls('number_series');

ALTER TABLE tenants
  ADD CONSTRAINT tenants_fiscal_year_start_month_chk CHECK (fiscal_year_start_month BETWEEN 1 AND 12);

-- Fiscal calendar: sane ranges, and fiscal years of a tenant never overlap.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE fiscal_years
  ADD CONSTRAINT fiscal_years_range_chk CHECK (end_date >= start_date),
  ADD CONSTRAINT fiscal_years_no_overlap EXCLUDE USING gist (
    tenant_id WITH =,
    daterange(start_date, end_date, '[]') WITH &&
  );

ALTER TABLE fiscal_periods
  ADD CONSTRAINT fiscal_periods_range_chk CHECK (end_date >= start_date),
  ADD CONSTRAINT fiscal_periods_number_chk CHECK (number BETWEEN 1 AND 13);

-- One default branch per tenant.
CREATE UNIQUE INDEX branches_one_default_per_tenant ON branches (tenant_id) WHERE is_default;

-- Amount sanity: each line is either a debit or a credit, never both / neither.
ALTER TABLE journal_lines
  ADD CONSTRAINT journal_lines_one_sided_chk
    CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0));

ALTER TABLE ledger_entries
  ADD CONSTRAINT ledger_entries_one_sided_chk
    CHECK ((debit > 0 AND credit = 0) OR (credit > 0 AND debit = 0)),
  ADD CONSTRAINT ledger_entries_txn_non_negative_chk CHECK (txn_debit >= 0 AND txn_credit >= 0);

ALTER TABLE journal_entries
  ADD CONSTRAINT journal_entries_rate_positive_chk CHECK (exchange_rate > 0),
  ADD CONSTRAINT journal_entries_posted_has_number_chk
    CHECK (status = 'DRAFT' OR (number IS NOT NULL AND fiscal_period_id IS NOT NULL AND posted_at IS NOT NULL));

ALTER TABLE number_series
  ADD CONSTRAINT number_series_next_value_chk CHECK (next_value >= 1);

-- The general ledger is append-only: corrections are new (reversing) entries.
CREATE OR REPLACE FUNCTION ledger_entries_block_mutation() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only; post a reversing entry instead'
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER ledger_entries_append_only
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_block_mutation();

-- Only active, postable (non-group) accounts can receive ledger postings.
CREATE OR REPLACE FUNCTION ledger_entries_check_account() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  acc record;
BEGIN
  SELECT is_group, is_active, tenant_id INTO acc FROM accounts WHERE id = NEW.account_id;
  IF acc.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'Account % does not belong to tenant %', NEW.account_id, NEW.tenant_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF acc.is_group OR NOT acc.is_active THEN
    RAISE EXCEPTION 'Account % is not postable', NEW.account_id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ledger_entries_postable_account
  BEFORE INSERT ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_check_account();

-- Double-entry: at COMMIT, every journal entry touched must balance to zero
-- in base currency. Deferred, so multi-row inserts are checked as a whole.
CREATE OR REPLACE FUNCTION ledger_entries_assert_balanced() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  difference numeric;
BEGIN
  SELECT COALESCE(SUM(debit - credit), 0) INTO difference
  FROM ledger_entries WHERE journal_entry_id = NEW.journal_entry_id;
  IF difference <> 0 THEN
    RAISE EXCEPTION 'Journal entry % is unbalanced by %', NEW.journal_entry_id, difference
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER ledger_entries_balanced
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION ledger_entries_assert_balanced();
