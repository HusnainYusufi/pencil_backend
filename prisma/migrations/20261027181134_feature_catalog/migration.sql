-- CreateEnum
CREATE TYPE "FeatureModule" AS ENUM ('ACCOUNTING', 'SALES', 'PURCHASES', 'BANKING', 'TAX', 'INVENTORY', 'REPORTS', 'PLATFORM');

-- CreateEnum
CREATE TYPE "FeatureStatus" AS ENUM ('AVAILABLE', 'BETA', 'COMING_SOON');

-- AlterTable
ALTER TABLE "features" ADD COLUMN     "module" "FeatureModule" NOT NULL DEFAULT 'PLATFORM',
ADD COLUMN     "sort_order" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "status" "FeatureStatus" NOT NULL DEFAULT 'AVAILABLE';

-- ===========================================================================
-- Hand-written: move the legacy flat keys into the module-namespaced catalog.
-- plan_features / tenant_feature_overrides follow via ON UPDATE CASCADE, so
-- every plan grant and per-company override is preserved. Module, status and
-- display order are filled in by the catalog seed (prisma/seed-catalog.ts).
-- ===========================================================================
UPDATE features SET key = 'limits.users'             WHERE key = 'users.max';
UPDATE features SET key = 'limits.branches'          WHERE key = 'branches.max';
UPDATE features SET key = 'platform.custom_roles'    WHERE key = 'roles.custom';
UPDATE features SET key = 'platform.audit_log'       WHERE key = 'audit.log';
UPDATE features SET key = 'platform.api_access'      WHERE key = 'api.access';
UPDATE features SET key = 'tax.einvoicing'           WHERE key = 'einvoicing';
UPDATE features SET key = 'inventory.items'          WHERE key = 'inventory';
UPDATE features SET key = 'accounting.multi_currency' WHERE key = 'multi_currency';
