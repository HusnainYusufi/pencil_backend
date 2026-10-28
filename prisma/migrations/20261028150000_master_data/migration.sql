-- CreateEnum
CREATE TYPE "TaxRole" AS ENUM ('BASE', 'TAX');

-- CreateEnum
CREATE TYPE "TaxRegistration" AS ENUM ('NOT_REGISTERED', 'REGISTERED', 'SPECIAL_SALES_TAX');

-- CreateEnum
CREATE TYPE "TaxFilingFrequency" AS ENUM ('MONTHLY', 'QUARTERLY', 'BIMONTHLY');

-- CreateEnum
CREATE TYPE "ContactType" AS ENUM ('BUSINESS', 'INDIVIDUAL');

-- CreateEnum
CREATE TYPE "PartyIdScheme" AS ENUM ('TIN', 'CRN', 'MOM', 'MLS', 'UNIFIED_700', 'SAG', 'NAT', 'GCC', 'IQA', 'PAS', 'OTH');

-- CreateEnum
CREATE TYPE "ItemType" AS ENUM ('GOODS', 'SERVICE');

-- CreateEnum
CREATE TYPE "TaxCodeKind" AS ENUM ('SALES', 'PURCHASE', 'WITHHOLDING');

-- CreateEnum
CREATE TYPE "TaxTreatment" AS ENUM ('STANDARD', 'ZERO_RATED', 'EXEMPT', 'OUT_OF_SCOPE', 'REVERSE_CHARGE', 'IMPORT', 'WITHHOLDING');

-- AlterTable
ALTER TABLE "journal_entries" ADD COLUMN     "source_type" VARCHAR(30);

-- AlterTable
ALTER TABLE "journal_lines" ADD COLUMN     "contact_id" UUID,
ADD COLUMN     "source_line_id" UUID,
ADD COLUMN     "tax_base" DECIMAL(20,4),
ADD COLUMN     "tax_code_id" UUID,
ADD COLUMN     "tax_role" "TaxRole";

-- AlterTable
ALTER TABLE "ledger_entries" ADD COLUMN     "contact_id" UUID,
ADD COLUMN     "tax_base" DECIMAL(20,4),
ADD COLUMN     "tax_code_id" UUID,
ADD COLUMN     "tax_role" "TaxRole";

-- CreateTable
CREATE TABLE "company_tax_profiles" (
    "tenant_id" UUID NOT NULL,
    "registration" "TaxRegistration" NOT NULL DEFAULT 'REGISTERED',
    "filing_frequency" "TaxFilingFrequency" NOT NULL,
    "building_number" VARCHAR(10),
    "street" VARCHAR(150),
    "district" VARCHAR(100),
    "city" VARCHAR(100),
    "postal_code" VARCHAR(10),
    "additional_number" VARCHAR(10),
    "activity_number" VARCHAR(30),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "company_tax_profiles_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(30),
    "type" "ContactType" NOT NULL DEFAULT 'BUSINESS',
    "is_customer" BOOLEAN NOT NULL DEFAULT false,
    "is_supplier" BOOLEAN NOT NULL DEFAULT false,
    "name" VARCHAR(200) NOT NULL,
    "name_ar" VARCHAR(200),
    "tax_number" VARCHAR(32),
    "id_scheme" "PartyIdScheme",
    "id_number" VARCHAR(50),
    "country" CHAR(2) NOT NULL,
    "building_number" VARCHAR(10),
    "street" VARCHAR(150),
    "district" VARCHAR(100),
    "city" VARCHAR(100),
    "postal_code" VARCHAR(10),
    "additional_number" VARCHAR(10),
    "email" VARCHAR(254),
    "phone" VARCHAR(20),
    "currency" CHAR(3) NOT NULL,
    "payment_terms_days" INTEGER NOT NULL DEFAULT 0,
    "withholding_tax_code_id" UUID,
    "notes" VARCHAR(1000),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "type" "ItemType" NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "name_ar" VARCHAR(200),
    "description" VARCHAR(1000),
    "unit_code" VARCHAR(3) NOT NULL DEFAULT 'PCE',
    "sale_price" DECIMAL(20,4),
    "purchase_price" DECIMAL(20,4),
    "sales_account_id" UUID,
    "purchase_account_id" UUID,
    "sales_tax_code_id" UUID,
    "purchase_tax_code_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_codes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "name_ar" VARCHAR(150) NOT NULL,
    "kind" "TaxCodeKind" NOT NULL,
    "treatment" "TaxTreatment" NOT NULL,
    "einvoice_category" VARCHAR(2),
    "reason_code" VARCHAR(30),
    "reason_text" VARCHAR(300),
    "tax_account_id" UUID,
    "reverse_charge_account_id" UUID,
    "recoverable" BOOLEAN NOT NULL DEFAULT true,
    "return_box" VARCHAR(30),
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tax_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tax_rates" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "tax_code_id" UUID NOT NULL,
    "rate_percent" DECIMAL(7,4) NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contacts_tenant_id_name_idx" ON "contacts"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_tenant_id_code_key" ON "contacts"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "items_tenant_id_name_idx" ON "items"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "items_tenant_id_code_key" ON "items"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "tax_codes_tenant_id_code_key" ON "tax_codes"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "tax_rates_tax_code_id_effective_from_key" ON "tax_rates"("tax_code_id", "effective_from");

-- CreateIndex
CREATE INDEX "ledger_entries_tenant_id_contact_id_date_idx" ON "ledger_entries"("tenant_id", "contact_id", "date");

-- CreateIndex
CREATE INDEX "ledger_entries_tenant_id_tax_code_id_date_idx" ON "ledger_entries"("tenant_id", "tax_code_id", "date");

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_tax_code_id_fkey" FOREIGN KEY ("tax_code_id") REFERENCES "tax_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_tax_code_id_fkey" FOREIGN KEY ("tax_code_id") REFERENCES "tax_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_tax_profiles" ADD CONSTRAINT "company_tax_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_withholding_tax_code_id_fkey" FOREIGN KEY ("withholding_tax_code_id") REFERENCES "tax_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_sales_account_id_fkey" FOREIGN KEY ("sales_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_purchase_account_id_fkey" FOREIGN KEY ("purchase_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_sales_tax_code_id_fkey" FOREIGN KEY ("sales_tax_code_id") REFERENCES "tax_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_purchase_tax_code_id_fkey" FOREIGN KEY ("purchase_tax_code_id") REFERENCES "tax_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_codes" ADD CONSTRAINT "tax_codes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_codes" ADD CONSTRAINT "tax_codes_tax_account_id_fkey" FOREIGN KEY ("tax_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_codes" ADD CONSTRAINT "tax_codes_reverse_charge_account_id_fkey" FOREIGN KEY ("reverse_charge_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tax_rates" ADD CONSTRAINT "tax_rates_tax_code_id_fkey" FOREIGN KEY ("tax_code_id") REFERENCES "tax_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ===========================================================================
-- Master data: tenant isolation, integrity, and sub-ledger rules
-- ===========================================================================

SELECT enable_tenant_rls('company_tax_profiles');
SELECT enable_tenant_rls('contacts');
SELECT enable_tenant_rls('items');
SELECT enable_tenant_rls('tax_codes');
SELECT enable_tenant_rls('tax_rates');

ALTER TABLE contacts
  ADD CONSTRAINT contacts_has_role_chk CHECK (is_customer OR is_supplier),
  ADD CONSTRAINT contacts_country_chk CHECK (country ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT contacts_currency_chk CHECK (currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT contacts_terms_chk CHECK (payment_terms_days BETWEEN 0 AND 365),
  ADD CONSTRAINT contacts_id_pair_chk CHECK ((id_scheme IS NULL) = (id_number IS NULL));

ALTER TABLE items
  ADD CONSTRAINT items_unit_code_chk CHECK (unit_code ~ '^[A-Z0-9]{2,3}$'),
  ADD CONSTRAINT items_prices_chk CHECK ((sale_price IS NULL OR sale_price >= 0) AND (purchase_price IS NULL OR purchase_price >= 0));

-- Rates: 0..100 %, and the validity periods of one code never overlap.
ALTER TABLE tax_rates
  ADD CONSTRAINT tax_rates_percent_chk CHECK (rate_percent >= 0 AND rate_percent <= 100),
  ADD CONSTRAINT tax_rates_range_chk CHECK (effective_to IS NULL OR effective_to >= effective_from),
  ADD CONSTRAINT tax_rates_no_overlap EXCLUDE USING gist (
    tax_code_id WITH =,
    daterange(effective_from, effective_to, '[]') WITH &&
  );

-- A tax role always names its tax code; a taxable base is never negative.
ALTER TABLE journal_lines
  ADD CONSTRAINT journal_lines_tax_role_chk CHECK (tax_role IS NULL OR tax_code_id IS NOT NULL),
  ADD CONSTRAINT journal_lines_tax_base_chk CHECK (tax_base IS NULL OR (tax_base >= 0 AND tax_role = 'TAX'));
ALTER TABLE ledger_entries
  ADD CONSTRAINT ledger_entries_tax_role_chk CHECK (tax_role IS NULL OR tax_code_id IS NOT NULL),
  ADD CONSTRAINT ledger_entries_tax_base_chk CHECK (tax_base IS NULL OR (tax_base >= 0 AND tax_role = 'TAX'));

-- Ledger guard (supersedes ledger_hardening's version): adds the sub-ledger
-- rule. Receivable lines name a customer and payable lines a supplier of the
-- same company, so control accounts always reconcile to their contacts.
CREATE OR REPLACE FUNCTION ledger_entries_check_account() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  je record;
  jl record;
  acc record;
  per record;
  yr record;
  -- Scalars, not a record: a record that was never assigned cannot be read,
  -- and SQL does not short-circuit AND.
  party_tenant uuid;
  party_customer boolean := false;
  party_supplier boolean := false;
  locked_through date;
  opening_date date;
  system_entry boolean;
BEGIN
  SELECT tenant_id, status, source, date INTO je FROM journal_entries WHERE id = NEW.journal_entry_id;
  IF je.status IS DISTINCT FROM 'POSTED' OR je.tenant_id IS DISTINCT FROM NEW.tenant_id OR je.date IS DISTINCT FROM NEW.date THEN
    RAISE EXCEPTION 'Ledger rows must belong to a posted journal entry of the same company and date'
      USING ERRCODE = 'PNB05';
  END IF;

  SELECT journal_entry_id, account_id, contact_id, tax_code_id INTO jl FROM journal_lines WHERE id = NEW.journal_line_id;
  IF jl.journal_entry_id IS DISTINCT FROM NEW.journal_entry_id OR jl.account_id IS DISTINCT FROM NEW.account_id
     OR jl.contact_id IS DISTINCT FROM NEW.contact_id OR jl.tax_code_id IS DISTINCT FROM NEW.tax_code_id THEN
    RAISE EXCEPTION 'Ledger row does not match its journal line' USING ERRCODE = 'PNB05';
  END IF;

  system_entry := je.source IN ('REVERSAL', 'CLOSING');

  SELECT is_group, is_active, tenant_id, allow_manual_posting, code, system_key INTO acc FROM accounts WHERE id = NEW.account_id;
  IF acc.tenant_id IS DISTINCT FROM NEW.tenant_id THEN
    RAISE EXCEPTION 'Account % does not belong to tenant %', NEW.account_id, NEW.tenant_id
      USING ERRCODE = 'check_violation';
  END IF;
  IF acc.is_group OR (NOT acc.is_active AND NOT system_entry) THEN
    RAISE EXCEPTION 'Account % is not postable', acc.code USING ERRCODE = 'PNB04';
  END IF;
  IF NOT acc.allow_manual_posting AND je.source = 'MANUAL' THEN
    RAISE EXCEPTION 'Account % is a control account and only accepts postings from documents', acc.code
      USING ERRCODE = 'PNB04';
  END IF;

  -- Sub-ledgers: receivables name a customer, payables a supplier.
  IF NEW.contact_id IS NOT NULL THEN
    SELECT tenant_id, is_customer, is_supplier INTO party_tenant, party_customer, party_supplier
    FROM contacts WHERE id = NEW.contact_id;
    IF party_tenant IS DISTINCT FROM NEW.tenant_id THEN
      RAISE EXCEPTION 'Contact does not belong to this company' USING ERRCODE = 'PNB05';
    END IF;
  END IF;
  IF acc.system_key = 'accounts_receivable' AND NOT party_customer THEN
    RAISE EXCEPTION 'Receivable postings on % must name a customer', acc.code USING ERRCODE = 'PNB04';
  END IF;
  IF acc.system_key = 'accounts_payable' AND NOT party_supplier THEN
    RAISE EXCEPTION 'Payable postings on % must name a supplier', acc.code USING ERRCODE = 'PNB04';
  END IF;
  IF NEW.tax_code_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM tax_codes WHERE id = NEW.tax_code_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'Tax code does not belong to this company' USING ERRCODE = 'PNB05';
  END IF;

  SELECT tenant_id, fiscal_year_id, start_date, end_date, status INTO per
  FROM fiscal_periods WHERE id = NEW.fiscal_period_id FOR SHARE;
  IF per.tenant_id IS DISTINCT FROM NEW.tenant_id OR NEW.date < per.start_date OR NEW.date > per.end_date THEN
    RAISE EXCEPTION 'Ledger row date % is outside its fiscal period', NEW.date USING ERRCODE = 'PNB05';
  END IF;
  SELECT status INTO yr FROM fiscal_years WHERE id = per.fiscal_year_id FOR SHARE;
  IF yr.status = 'CLOSED' THEN
    RAISE EXCEPTION 'The fiscal year containing % is closed', NEW.date USING ERRCODE = 'PNB02';
  END IF;
  IF per.status = 'CLOSED' AND je.source <> 'CLOSING' THEN
    RAISE EXCEPTION 'The fiscal period containing % is closed', NEW.date USING ERRCODE = 'PNB02';
  END IF;

  SELECT GREATEST(lock_date, tax_lock_date), opening_balance_date INTO locked_through, opening_date
  FROM tenants WHERE id = NEW.tenant_id FOR SHARE;
  IF je.source <> 'CLOSING' AND locked_through IS NOT NULL AND NEW.date <= locked_through THEN
    RAISE EXCEPTION 'The books are locked through %', locked_through USING ERRCODE = 'PNB01';
  END IF;
  IF opening_date IS NOT NULL AND NEW.date < opening_date THEN
    RAISE EXCEPTION 'Nothing can be posted before the opening balance date %', opening_date USING ERRCODE = 'PNB01';
  END IF;
  IF je.source = 'OPENING_BALANCE' AND NEW.date IS DISTINCT FROM opening_date THEN
    RAISE EXCEPTION 'Opening balances must be dated on the opening balance date' USING ERRCODE = 'PNB01';
  END IF;

  RETURN NEW;
END;
$$;
