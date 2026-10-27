/**
 * Permission strings are `<resource>.<action>` (e.g. `invoices.issue`).
 * Grants may be exact, a resource wildcard (`invoices.*`) or `*`.
 */
export function hasPermission(granted: ReadonlySet<string>, required: string): boolean {
  if (granted.has('*') || granted.has(required)) return true;
  const dot = required.indexOf('.');
  if (dot > 0 && granted.has(`${required.slice(0, dot)}.*`)) return true;
  // Namespaced grants, e.g. `platform.tenants.*` covers `platform.tenants.manage`.
  const lastDot = required.lastIndexOf('.');
  return lastDot > dot && granted.has(`${required.slice(0, lastDot)}.*`);
}

export function missingPermissions(granted: ReadonlySet<string>, required: readonly string[]): string[] {
  return required.filter((p) => !hasPermission(granted, p));
}
