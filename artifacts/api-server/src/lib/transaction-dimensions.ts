import { and, eq } from "drizzle-orm";
import { db, erpRecordsTable } from "@workspace/db";
import type { AuthContext } from "../middleware/team-auth";

type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type DatabaseExecutor = typeof db | DatabaseTransaction;

export class TransactionDimensionError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export type TransactionDimensions = { branchId: number | null; projectId: number | null };

function optionalId(value: unknown, label: string): number | null {
  if (value == null || value === "") return null;
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new TransactionDimensionError(`${label} غير صالح.`);
  return id;
}

async function activeRecord(
  executor: DatabaseExecutor,
  organizationId: number,
  tableName: "branches" | "projects",
  id: number,
): Promise<void> {
  const [record] = await executor.select({ data: erpRecordsTable.data }).from(erpRecordsTable).where(and(
    eq(erpRecordsTable.id, id),
    eq(erpRecordsTable.organizationId, organizationId),
    eq(erpRecordsTable.tableName, tableName),
  )).limit(1);
  if (!record) throw new TransactionDimensionError(`${tableName === "branches" ? "الفرع" : "المشروع"} غير موجود في هذه المنشأة.`, 404);
  const status = String(record.data.status ?? "");
  const allowed = tableName === "branches" ? status === "active" : status === "active" || status === "completed";
  if (!allowed) throw new TransactionDimensionError(`${tableName === "branches" ? "الفرع" : "المشروع"} غير نشط.`);
}

/** Resolves and validates branch/project dimensions for a tenant transaction. */
export async function resolveTransactionDimensions(
  executor: DatabaseExecutor,
  auth: AuthContext,
  input: Record<string, unknown>,
  requireBranchWhenConfigured = false,
): Promise<TransactionDimensions> {
  const hasBranchOverride = Object.hasOwn(input, "branchId");
  const requestedBranchId = optionalId(input.branchId, "الفرع");
  const projectId = optionalId(input.projectId, "المشروع");
  const mayOverride = auth.roleId === "owner" || auth.roleId === "accountant" || auth.permissions.accounting === true;
  if (hasBranchOverride && requestedBranchId !== auth.defaultBranchId && !mayOverride) {
    throw new TransactionDimensionError("لا تملك صلاحية تغيير الفرع الافتراضي.", 403);
  }
  const branchId = hasBranchOverride ? requestedBranchId : auth.defaultBranchId;
  if (branchId !== null) await activeRecord(executor, auth.organizationId, "branches", branchId);
  if (projectId !== null) await activeRecord(executor, auth.organizationId, "projects", projectId);
  if (requireBranchWhenConfigured && branchId === null) {
    const branches = await executor.select({ id: erpRecordsTable.id, data: erpRecordsTable.data }).from(erpRecordsTable).where(and(
      eq(erpRecordsTable.organizationId, auth.organizationId),
      eq(erpRecordsTable.tableName, "branches"),
    ));
    if (branches.some((record) => record.data.status === "active")) {
      throw new TransactionDimensionError("يجب تحديد فرع لهذه العملية.");
    }
  }
  return { branchId, projectId };
}