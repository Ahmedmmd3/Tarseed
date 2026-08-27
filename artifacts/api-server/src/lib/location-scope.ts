export type LocationScopedAuth = {
  roleId: string;
  locationScope: string;
  warehouseIds: number[];
};

export function locationIds(tableName: string, data: Record<string, unknown>, recordId?: number): number[] {
  if (tableName === "warehouses") return recordId ? [recordId] : [];
  return ["warehouseId", "fromWarehouseId", "toWarehouseId"]
    .map((key) => Number(data[key]))
    .filter((id) => Number.isInteger(id) && id > 0);
}

/**
 * Keep location authorization consistent for all routes that expose ERP data.
 * Records without a location remain organization-wide, matching the ERP data
 * route's existing behavior.
 */
export function isLocationAllowed(
  auth: LocationScopedAuth,
  tableName: string,
  data: Record<string, unknown>,
  recordId?: number,
): boolean {
  if (auth.roleId === "owner" || auth.locationScope === "all") return true;
  if (tableName === "financialClosures") return false;
  const ids = locationIds(tableName, data, recordId);
  if (auth.locationScope === "none") return ids.length === 0;
  if (!ids.length) return true;
  const allowed = new Set(auth.warehouseIds.map(Number));
  return ids.every((id) => allowed.has(id));
}