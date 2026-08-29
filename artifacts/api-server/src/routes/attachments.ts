import { Router, type IRouter, type Request, type Response } from "express";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, erpRecordsTable, teamAuditLogsTable } from "@workspace/db";
import { deletePrivateObject, isPrivateAttachmentPathForOrganization, readPrivateObject, savePrivateAttachment } from "../lib/private-object-store";
import { isLocationAllowed } from "../lib/location-scope";
import { lockAndValidateDataGeneration, lockedWriteRejection, refreshAuthAfterOrganizationLock, requireAuth, requireCurrentDataGeneration, requireSubscriptionAccess, type AuthContext } from "../middleware/team-auth";

const router: IRouter = Router();
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MODULES: Record<string, string | string[]> = {
  products: ["inventory", "sales"], invoices: "sales", expenses: "accounting", customers: "sales", sales: "sales",
  returns_: "sales", suppliers: "inventory", purchaseOrders: "inventory", warehouses: ["inventory", "sales"],
  employees: "hr", projects: "operations", inventoryBalances: ["inventory", "sales"], stockTransfers: "inventory",
  stockAdjustments: "inventory", accounts: "accounting", journalEntries: "accounting", receivables: "accounting",
  financialClosures: "accounting", bankReconciliationSessions: "accounting", bankStatementLines: "accounting",
};
const SAFE_TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "text/plain", "text/csv", "application/json", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"]);

function contentMatchesType(content: Buffer, type: string): boolean {
  if (type === "application/pdf") return content.subarray(0, 5).toString("ascii") === "%PDF-";
  if (type === "image/png") return content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (type === "image/jpeg") return content.length > 3 && content[0] === 0xff && content[1] === 0xd8 && content.at(-2) === 0xff && content.at(-1) === 0xd9;
  if (type === "image/webp") return content.subarray(0, 4).toString("ascii") === "RIFF" && content.subarray(8, 12).toString("ascii") === "WEBP";
  if (type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return content.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  if (content.includes(0)) return false;
  if (type === "application/json") {
    try { JSON.parse(content.toString("utf8")); return true; } catch { return false; }
  }
  return true;
}

function hasAccess(auth: AuthContext, tableName: string): boolean {
  const modules = MODULES[tableName];
  return Boolean(modules) && (auth.roleId === "owner" || (Array.isArray(modules) ? modules : [modules]).some((module) => auth.permissions[module] === true));
}
function filename(value: string): string | null {
  const result = value.normalize("NFKC").replace(/[\/\\\0-\x1f\x7f]/g, "_").trim().replace(/\s+/g, " ");
  return result && result.length <= 180 && !result.startsWith(".") ? result : null;
}
function operationId(request: Request): string {
  const value = request.get("Idempotency-Key")?.trim() || (typeof request.body?.clientOperationId === "string" ? request.body.clientOperationId.trim() : "");
  return value.length <= 200 ? value : "";
}
async function parentFor(auth: AuthContext, tableName: string, id: number) {
  const [parent] = await db.select().from(erpRecordsTable).where(and(
    eq(erpRecordsTable.id, id), eq(erpRecordsTable.organizationId, auth.organizationId), eq(erpRecordsTable.tableName, tableName),
  ));
  return parent && isLocationAllowed(auth, tableName, parent.data, parent.id) ? parent : undefined;
}
async function multipart(request: Request): Promise<{ name: string; type: string; content: Buffer; clientOperationId: string }> {
  const contentType = request.get("content-type") ?? "";
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)?.[1] ?? /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)?.[2];
  if (!boundary) throw new Error("يلزم إرسال الملف بصيغة multipart/form-data.");
  const declared = Number(request.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_ATTACHMENT_BYTES + 32_768) throw new Error("حجم الملف أكبر من الحد المسموح (10 م.ب).");
  const chunks: Buffer[] = []; let size = 0;
  for await (const part of request) {
    const chunk = Buffer.isBuffer(part) ? part : Buffer.from(part);
    size += chunk.length;
    if (size > MAX_ATTACHMENT_BYTES + 32_768) throw new Error("حجم الملف أكبر من الحد المسموح (10 م.ب).");
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks);
  const marker = Buffer.from(`--${boundary}`);
  if (raw.indexOf(marker) !== 0) throw new Error("بيانات الملف المرفوعة غير صحيحة.");
  let offset = 0; let result: { name: string; type: string; content: Buffer } | undefined; let clientOperationId = "";
  while (offset < raw.length) {
    if (!raw.subarray(offset, offset + marker.length).equals(marker)) break;
    offset += marker.length;
    if (raw.subarray(offset, offset + 2).equals(Buffer.from("--"))) break;
    if (!raw.subarray(offset, offset + 2).equals(Buffer.from("\r\n"))) throw new Error("بيانات الملف المرفوعة غير صحيحة.");
    offset += 2;
    const headerEnd = raw.indexOf(Buffer.from("\r\n\r\n"), offset);
    if (headerEnd < 0) throw new Error("بيانات الملف المرفوعة غير صحيحة.");
    const headers = raw.subarray(offset, headerEnd).toString("utf8"); offset = headerEnd + 4;
    const next = raw.indexOf(Buffer.from(`\r\n--${boundary}`), offset);
    if (next < 0) throw new Error("بيانات الملف المرفوعة غير صحيحة.");
    const content = raw.subarray(offset, next); offset = next + 2;
    const disposition = /content-disposition:\s*form-data;[^\r\n]*name="([^"]+)"(?:;[^\r\n]*filename="([^"]*)")?/i.exec(headers);
    const field = disposition?.[1] ?? "";
    if (field === "clientOperationId" && !disposition?.[2]) clientOperationId = content.toString("utf8").trim();
    if (disposition?.[2]) {
      const rawName = filename(disposition[2]);
      const type = (/content-type:\s*([^\r\n;]+)/i.exec(headers)?.[1] ?? "").toLowerCase().trim();
      if (!rawName || !SAFE_TYPES.has(type) || !content.length || content.length > MAX_ATTACHMENT_BYTES || result) throw new Error("اسم الملف أو نوعه أو حجمه غير مسموح.");
      result = { name: rawName, type, content };
    }
  }
  if (!result || clientOperationId.length > 200) throw new Error("اسم الملف أو نوعه أو حجمه غير مسموح.");
  return { ...result, clientOperationId };
}
function sendLockFailure(response: Response): void {
  const rejection = lockedWriteRejection(response);
  response.status(rejection.status).json({ error: rejection.error, code: rejection.code });
}

router.get("/attachments/:table/:parentId", requireAuth, requireSubscriptionAccess, async (request, response) => {
  const auth = response.locals.auth as AuthContext; const parentId = Number(request.params.parentId); const table = String(request.params.table);
  if (!Number.isInteger(parentId) || !hasAccess(auth, table) || !await parentFor(auth, table, parentId)) { response.status(404).json({ error: "السجل غير متاح." }); return; }
  const rows = await db.select().from(erpRecordsTable).where(and(eq(erpRecordsTable.organizationId, auth.organizationId), eq(erpRecordsTable.tableName, "attachmentRecords")));
  response.json({ attachments: rows.filter((row) => row.data.parentTable === table && Number(row.data.parentRecordId) === parentId).map((row) => ({ id: row.id, ...row.data })) });
});

router.post("/attachments/:table/:parentId", requireAuth, requireSubscriptionAccess, requireCurrentDataGeneration, async (request, response) => {
  const auth = response.locals.auth as AuthContext; const parentId = Number(request.params.parentId); const table = String(request.params.table); let key = operationId(request);
  if (!Number.isInteger(parentId) || !hasAccess(auth, table)) { response.status(404).json({ error: "السجل غير متاح." }); return; }
  if (!key && request.get("Idempotency-Key")) { response.status(400).json({ error: "معرّف العملية طويل جداً." }); return; }
  const parent = await parentFor(auth, table, parentId);
  if (!parent) { response.status(404).json({ error: "السجل غير متاح." }); return; }
  let upload: { name: string; type: string; content: Buffer; clientOperationId: string };
  try { upload = await multipart(request); } catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : "بيانات الملف غير صحيحة." }); return; }
  if (!contentMatchesType(upload.content, upload.type)) { response.status(400).json({ error: "محتوى الملف لا يطابق نوعه المعلن." }); return; }
  if (!key) key = upload.clientOperationId;
  if (key && upload.clientOperationId && key !== upload.clientOperationId) { response.status(409).json({ error: "معرّف العملية مستخدم لطلب مختلف." }); return; }
  const digest = createHash("sha256").update(upload.content).digest("hex");
  if (key) {
    const [existing] = await db.select().from(erpRecordsTable).where(and(eq(erpRecordsTable.organizationId, auth.organizationId), eq(erpRecordsTable.tableName, "attachmentRecords"), eq(erpRecordsTable.clientOperationId, key))).limit(1);
    if (existing) {
      const sameRequest = existing.data.parentTable === table
        && Number(existing.data.parentRecordId) === parentId
        && existing.data.fileName === upload.name
        && existing.data.contentType === upload.type
        && Number(existing.data.size) === upload.content.length
        && existing.data.digest === digest
        && isPrivateAttachmentPathForOrganization(String(existing.data.objectPath), auth.organizationId)
        && Boolean(await parentFor(auth, String(existing.data.parentTable), Number(existing.data.parentRecordId)));
      if (!sameRequest) { response.status(409).json({ error: "معرّف العملية مستخدم لطلب مرفق مختلف." }); return; }
      response.json({ attachment: { id: existing.id, ...existing.data }, replayed: true });
      return;
    }
  }
  let objectPath: string | undefined;
  try {
    objectPath = await savePrivateAttachment(auth.organizationId, upload.content, upload.type);
    const result = await db.transaction(async (tx) => {
      if (!await lockAndValidateDataGeneration(tx, response)) return null;
      const current = await refreshAuthAfterOrganizationLock(tx, response);
      if (!current || !hasAccess(current, table)) { response.locals.writeAccessFailure = "authorization_changed"; return null; }
      const [lockedParent] = await tx.select().from(erpRecordsTable).where(and(eq(erpRecordsTable.id, parentId), eq(erpRecordsTable.organizationId, current.organizationId), eq(erpRecordsTable.tableName, table))).for("update");
      if (!lockedParent || !isLocationAllowed(current, table, lockedParent.data, lockedParent.id)) throw new Error("PARENT_UNAVAILABLE");
      const data = { parentTable: table, parentRecordId: parentId, fileName: upload.name, contentType: upload.type, size: upload.content.length, digest, objectPath, uploadedBy: current.id, uploadedAt: new Date().toISOString() };
      const [inserted] = await tx.insert(erpRecordsTable).values({ organizationId: current.organizationId, tableName: "attachmentRecords", clientOperationId: key || null, data }).onConflictDoNothing({ target: [erpRecordsTable.organizationId, erpRecordsTable.tableName, erpRecordsTable.clientOperationId] }).returning();
      const record = inserted ?? (key ? (await tx.select().from(erpRecordsTable).where(and(eq(erpRecordsTable.organizationId, current.organizationId), eq(erpRecordsTable.tableName, "attachmentRecords"), eq(erpRecordsTable.clientOperationId, key))).limit(1))[0] : undefined);
      if (!record) throw new Error("ATTACHMENT_UNSAVED");
      if (!inserted) {
        const sameRequest = record.data.parentTable === table
          && Number(record.data.parentRecordId) === parentId
          && record.data.fileName === upload.name
          && record.data.contentType === upload.type
          && Number(record.data.size) === upload.content.length
          && record.data.digest === digest
          && isPrivateAttachmentPathForOrganization(String(record.data.objectPath), current.organizationId);
        const replayParent = sameRequest
          ? await tx.select().from(erpRecordsTable).where(and(
            eq(erpRecordsTable.id, Number(record.data.parentRecordId)),
            eq(erpRecordsTable.organizationId, current.organizationId),
            eq(erpRecordsTable.tableName, String(record.data.parentTable)),
          )).limit(1)
          : [];
        if (!sameRequest || !replayParent[0] || !isLocationAllowed(current, replayParent[0].tableName, replayParent[0].data, replayParent[0].id)) {
          throw new Error("IDEMPOTENCY_MISMATCH");
        }
      }
      if (inserted) await tx.insert(teamAuditLogsTable).values({ organizationId: current.organizationId, actorId: current.id, actorName: current.name || current.email, action: "attachment_uploaded", entity: String(inserted.id), details: `${table}:${parentId}` });
      return { record, created: Boolean(inserted) };
    });
    if (!result) { await deletePrivateObject(objectPath); sendLockFailure(response); return; }
    if (!result.created) await deletePrivateObject(objectPath);
    response.status(result.created ? 201 : 200).json({ attachment: { id: result.record.id, ...result.record.data }, replayed: !result.created });
  } catch (error) {
    if (objectPath) await deletePrivateObject(objectPath).catch(() => undefined);
    const mismatch = error instanceof Error && error.message === "IDEMPOTENCY_MISMATCH";
    const parentUnavailable = error instanceof Error && error.message === "PARENT_UNAVAILABLE";
    response.status(mismatch ? 409 : parentUnavailable ? 404 : 500).json({
      error: mismatch ? "معرّف العملية مستخدم لطلب مرفق مختلف." : parentUnavailable ? "السجل غير متاح." : "تعذر حفظ المرفق.",
    });
  }
});

router.get("/attachments/:id/download", requireAuth, requireSubscriptionAccess, async (request, response) => {
  const auth = response.locals.auth as AuthContext; const id = Number(request.params.id);
  const [attachment] = Number.isInteger(id) ? await db.select().from(erpRecordsTable).where(and(eq(erpRecordsTable.id, id), eq(erpRecordsTable.organizationId, auth.organizationId), eq(erpRecordsTable.tableName, "attachmentRecords"))) : [];
  if (!attachment || !isPrivateAttachmentPathForOrganization(String(attachment.data.objectPath), auth.organizationId) || !hasAccess(auth, String(attachment.data.parentTable)) || !await parentFor(auth, String(attachment.data.parentTable), Number(attachment.data.parentRecordId))) { response.status(404).json({ error: "المرفق غير متاح." }); return; }
  try {
    const object = await readPrivateObject(String(attachment.data.objectPath));
    response.setHeader("Content-Type", String(attachment.data.contentType || object.contentType || "application/octet-stream"));
    response.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(String(attachment.data.fileName))}`);
    response.setHeader("X-Content-Type-Options", "nosniff"); response.send(object.content);
  } catch { response.status(404).json({ error: "ملف المرفق غير متاح." }); }
});

router.delete("/attachments/:id", requireAuth, requireSubscriptionAccess, requireCurrentDataGeneration, async (request, response) => {
  const auth = response.locals.auth as AuthContext; const id = Number(request.params.id);
  if (!Number.isInteger(id)) { response.status(404).json({ error: "المرفق غير متاح." }); return; }
  const result = await db.transaction(async (tx) => {
    if (!await lockAndValidateDataGeneration(tx, response)) return null;
    const current = await refreshAuthAfterOrganizationLock(tx, response);
    if (!current) { response.locals.writeAccessFailure = "authorization_changed"; return null; }
    const [attachment] = await tx.select().from(erpRecordsTable).where(and(eq(erpRecordsTable.id, id), eq(erpRecordsTable.organizationId, current.organizationId), eq(erpRecordsTable.tableName, "attachmentRecords"))).for("update");
    if (!attachment || !isPrivateAttachmentPathForOrganization(String(attachment.data.objectPath), current.organizationId) || !hasAccess(current, String(attachment.data.parentTable))) return { missing: true as const };
    const [parent] = await tx.select().from(erpRecordsTable).where(and(eq(erpRecordsTable.id, Number(attachment.data.parentRecordId)), eq(erpRecordsTable.organizationId, current.organizationId), eq(erpRecordsTable.tableName, String(attachment.data.parentTable)))).for("update");
    if (!parent || !isLocationAllowed(current, parent.tableName, parent.data, parent.id)) return { missing: true as const };
    await tx.delete(erpRecordsTable).where(eq(erpRecordsTable.id, attachment.id));
    await tx.insert(teamAuditLogsTable).values({ organizationId: current.organizationId, actorId: current.id, actorName: current.name || current.email, action: "attachment_deleted", entity: String(id), details: `${attachment.data.parentTable}:${attachment.data.parentRecordId}` });
    return { objectPath: String(attachment.data.objectPath) };
  });
  if (!result) { sendLockFailure(response); return; }
  if ("missing" in result) { response.status(404).json({ error: "المرفق غير متاح." }); return; }
  try { await deletePrivateObject(result.objectPath); } catch { request.log.warn({ attachmentId: id }, "Attachment object deletion failed after metadata deletion"); }
  response.status(204).end();
});

export default router;