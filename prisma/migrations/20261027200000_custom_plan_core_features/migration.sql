-- ===========================================================================
-- Data-only, hand-written. The feature catalog (20261027181134) introduced
-- the core features, which the API enforces, but the catalog seed granted them
-- to the seeded plans only, so companies on a custom plan lost accounting.
-- Give every custom plan the core features the catalog introduced.
--
-- Runs once. On a fresh database the features do not exist yet and this is a
-- no-op; the catalog seed then grants them to custom plans as they appear
-- (prisma/seed-catalog.ts). Existing grants are left untouched, and
-- tax.einvoicing is excluded: it existed before the catalog (as 'einvoicing'),
-- so its absence from a custom plan is a deliberate choice.
-- ===========================================================================
INSERT INTO plan_features (plan_id, feature_key, enabled, limit_value)
SELECT p.id, f.key, true, NULL
FROM plans p
CROSS JOIN features f
WHERE p.code NOT IN ('starter', 'professional', 'business')
  AND f.key IN (
    'accounting.chart_of_accounts',
    'accounting.journals',
    'accounting.fiscal_periods',
    'reports.ledger',
    'reports.financial_statements',
    'sales.invoices',
    'purchases.bills',
    'purchases.expenses',
    'banking.accounts',
    'tax.vat_returns'
  )
ON CONFLICT (plan_id, feature_key) DO NOTHING;
