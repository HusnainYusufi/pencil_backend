-- AlterEnum


ALTER TYPE "AccountSubtype" ADD VALUE 'ALLOWANCE_FOR_CREDIT_LOSSES';
ALTER TYPE "AccountSubtype" ADD VALUE 'CURRENT_BORROWINGS';
ALTER TYPE "AccountSubtype" ADD VALUE 'FINANCE_COST';
ALTER TYPE "AccountSubtype" ADD VALUE 'ZAKAT_AND_INCOME_TAX';

-- AlterEnum
ALTER TYPE "JournalSource" ADD VALUE 'CLOSING';

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "allow_manual_posting" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "fiscal_years" ADD COLUMN     "closed_by_id" UUID,
ADD COLUMN     "closing_entry_id" UUID;

-- AlterTable
ALTER TABLE "ledger_entries" ALTER COLUMN "journal_line_id" SET NOT NULL;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "lock_date" DATE,
ADD COLUMN     "opening_balance_date" DATE,
ADD COLUMN     "tax_lock_date" DATE;

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_years_closing_entry_id_key" ON "fiscal_years"("closing_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_journal_line_id_key" ON "ledger_entries"("journal_line_id");

-- AddForeignKey
ALTER TABLE "fiscal_years" ADD CONSTRAINT "fiscal_years_closing_entry_id_fkey" FOREIGN KEY ("closing_entry_id") REFERENCES "journal_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_journal_line_id_fkey" FOREIGN KEY ("journal_line_id") REFERENCES "journal_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ===========================================================================
-- Ledger hardening (auditor review, 2026-10-28)
--
-- Custom SQLSTATEs, mapped to API error codes in core/database/prisma-errors.ts:
--   PNB01 books locked (lock date / tax lock date / before opening balances)
--   PNB02 fiscal period or year closed
--   PNB03 posted entry is immutable
--   PNB04 account not postable (group, inactive, control account)
--   PNB05 ledger integrity violation (should never reach users)
-- ===========================================================================

-- Control accounts are fed only by documents (and opening balances).
UPDATE accounts SET allow_manual_posting = false
WHERE system_key IN ('accounts_receivable', 'accounts_payable', 'vat_input', 'vat_output');

-- Posted vouchers are permanent: corrections are reversing entries only
-- (Jordan Commercial Law art. 17; ZATCA prohibited functions).
CREATE OR REPLACE FUNCTION journal_entries_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF OLD.status = 'POSTED' THEN
    RAISE EXCEPTION 'Journal entry % is posted and cannot be changed; post a reversing entry instead', OLD.number
      USING ERRCODE = 'PNB03';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER journal_entries_immutable_when_posted
  BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION journal_entries_guard();

CREATE OR REPLACE FUNCTION journal_lines_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  entry_ids uuid[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    entry_ids := ARRAY[NEW.journal_entry_id];
  ELSIF TG_OP = 'UPDATE' THEN
    entry_ids := ARRAY[OLD.journal_entry_id, NEW.journal_entry_id];
  ELSE
    entry_ids := ARRAY[OLD.journal_entry_id];
  END IF;
  IF EXISTS (SELECT 1 FROM journal_entries WHERE id = ANY (entry_ids) AND status = 'POSTED') THEN
    RAISE EXCEPTION 'Lines of a posted journal entry cannot be changed; post a reversing entry instead'
      USING ERRCODE = 'PNB03';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER journal_lines_immutable_when_posted
  BEFORE INSERT OR UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION journal_lines_guard();

-- Every ledger row must match its posted voucher, land in an open period of
-- an open year, respect the company's lock dates and hit a postable account.
-- The FOR SHARE locks make a concurrent period close, year close or lock-date
-- change wait until this posting commits (no race into a closed month).
CREATE OR REPLACE FUNCTION ledger_entries_check_account() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
DECLARE
  je record;
  jl record;
  acc record;
  per record;
  yr record;
  locked_through date;
  opening_date date;
  system_entry boolean;
BEGIN
  SELECT tenant_id, status, source, date INTO je FROM journal_entries WHERE id = NEW.journal_entry_id;
  IF je.status IS DISTINCT FROM 'POSTED' OR je.tenant_id IS DISTINCT FROM NEW.tenant_id OR je.date IS DISTINCT FROM NEW.date THEN
    RAISE EXCEPTION 'Ledger rows must belong to a posted journal entry of the same company and date'
      USING ERRCODE = 'PNB05';
  END IF;

  SELECT journal_entry_id, account_id INTO jl FROM journal_lines WHERE id = NEW.journal_line_id;
  IF jl.journal_entry_id IS DISTINCT FROM NEW.journal_entry_id OR jl.account_id IS DISTINCT FROM NEW.account_id THEN
    RAISE EXCEPTION 'Ledger row does not match its journal line' USING ERRCODE = 'PNB05';
  END IF;

  -- Reversals and year-end closing entries must always be able to undo history.
  system_entry := je.source IN ('REVERSAL', 'CLOSING');

  SELECT is_group, is_active, tenant_id, allow_manual_posting, code INTO acc FROM accounts WHERE id = NEW.account_id;
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

-- A month of a closed year can only reopen after the year itself is reopened.
CREATE OR REPLACE FUNCTION fiscal_periods_guard() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.status = 'OPEN' AND OLD.status = 'CLOSED'
     AND EXISTS (SELECT 1 FROM fiscal_years WHERE id = NEW.fiscal_year_id AND status = 'CLOSED') THEN
    RAISE EXCEPTION 'Reopen the fiscal year before reopening one of its periods' USING ERRCODE = 'PNB02';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER fiscal_periods_reopen_requires_open_year
  BEFORE UPDATE OF status ON fiscal_periods
  FOR EACH ROW EXECUTE FUNCTION fiscal_periods_guard();
