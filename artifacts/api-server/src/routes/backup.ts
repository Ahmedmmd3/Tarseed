import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, erpRecordsTable, teamAuditLogsTable } from "@workspace/db";
import { requireAuth, requireOwner, type AuthContext } from "../middleware/team-auth";

const router: IRouter = Router();
const BACKUP_VERSION = 1;
const MAX_RECORDS = 25_000;
const TABLE_NAMES = new Set([
  "products", "invoices", "expenses", "customers", "sales", "returns_", "suppliers",
  "purchaseOrders", "warehouses", "employees", "projects", "inventoryBalances",
  "stockTransfers", "stockAdjustments", "accounts", "journalEntries", "receivables",
  "financialClosures",
]);

type BackupRecord = {
  id: number;
  tableName: string;
  data: Record<string, unknown>;
};

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseBackup(value: unknown): { records?: BackupRecord[]; organizationId?: number; error?: string } {
  if (!isPlainRecord(value) || value.version !== BACKUP_VERSION || !Array.isArray(value.records)) {
    return { error: "ملف النسخة الاحتياطية غير مدعوم أو تالف." };
  }
  if (value.records.length > MAX_RECORDS) {
    return { error: "حجم النسخة الاحتياطية أكبر من الحد المسموح." };
  }

  const ids = new Set<number>();
  const records: BackupRecord[] = [];
  for (const rawRecord of value.records) {
    if (!isPlainRecord(rawRecord)) return { error: "يحتوي الملف على سجل غير صحيح." };
    const id = rawRecord.id;
    const tableName = rawRecord.tableName;
    if (!Number.isInteger(id) || Number(id) <= 0 || typeof tableName !== "string" || !TABLE_NAMES.has(tableName) || !isPlainRecord(rawRecord.data)) {
      return { error: "يحتوي الملف على بيانات غير صحيحة." };
    }
    if (ids.has(Number(id))) return { error: "يحتوي الملف على معرّفات سجلات مكررة." };
    ids.add(Number(id));
    records.push({ id: Number(id), tableName, data: rawRecord.data });
  }

  const organizationId = value.organizationId;
  if (organizationId !== undefined && (!Number.isInteger(organizationId) || Number(organizationId) <= 0)) {
    return { error: "معرّف المنشأة في الملف غير صحيح." };
  }
  return { records, organizationId: organizationId as number | undefined };
}

router.get("/backup/export", requireAuth, requireOwner, async (_request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  const records = await db.select({
    id: erpRecordsTable.id,
    tableName: erpRecordsTable.tableName,
    data: erpRecordsTable.data,
  }).from(erpRecordsTable).where(eq(erpRecordsTable.organizationId, auth.organizationId));

  response.setHeader("Cache-Control", "no-store");
  response.setHeader(
    "Content-Disposition",
    `attachment; filename="tarseed-backup-${new Date().toISOString().slice(0, 10)}.json"`,
  );
  response.json({
    version: BACKUP_VERSION,
    organizationId: auth.organizationId,
    projectName: auth.projectName,
    exportedAt: new Date().toISOString(),
    records,
  });
});

router.post("/backup/restore", requireAuth, requireOwner, async (request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  const parsed = parseBackup(request.body);
  if (parsed.error || !parsed.records) {
    response.status(400).json({ error: parsed.error ?? "ملف النسخة الاحتياطية غير صالح." });
    return;
  }
  if (parsed.organizationId !== undefined && parsed.organizationId !== auth.organizationId) {
    response.status(409).json({ error: "هذه النسخة الاحتياطية تخص منشأة أخرى." });
    return;
  }

  const result = await db.transaction(async (tx) => {
    const ids = parsed.records!.map((record) => record.id);
    if (ids.length > 0) {
      const [foreignRecord] = await tx.select({ id: erpRecordsTable.id })
        .from(erpRecordsTable)
        .where(and(inArray(erpRecordsTable.id, ids), sql`${erpRecordsTable.organizationId} <> ${auth.organizationId}`))
        .limit(1);
      if (foreignRecord) return { kind: "conflict" as const };
    }

    await tx.delete(erpRecordsTable).where(eq(erpRecordsTable.organizationId, auth.organizationId));
    if (parsed.records!.length > 0) {
      await tx.insert(erpRecordsTable).values(parsed.records!.map((record) => ({
        id: record.id,
        organizationId: auth.organizationId,
        tableName: record.tableName,
        data: record.data,
      })));
    }
    await tx.execute(sql`
      SELECT setval(
        pg_get_serial_sequence('erp_records', 'id'),
        COALESCE((SELECT MAX(id) FROM erp_records), 1),
        true
      )
    `);
    return { kind: "restored" as const };
  });

  if (result.kind === "conflict") {
    response.status(409).json({ error: "لا يمكن استعادة ملف يتعارض مع سجلات منشأة أخرى." });
    return;
  }

  await db.insert(teamAuditLogsTable).values({
    organizationId: auth.organizationId,
    actorId: auth.id,
    actorName: auth.name || auth.email,
    action: "erp_backup_restored",
    entity: "erp_records",
    details: `${parsed.records.length} records`,
  });
  response.json({ message: "تمت استعادة النسخة الاحتياطية بنجاح.", recordCount: parsed.records.length });
});

export default router;