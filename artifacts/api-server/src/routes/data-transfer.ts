import { createHash, randomUUID } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, erpRecordsTable, teamAuditLogsTable } from "@workspace/db";
import { isLocationAllowed } from "../lib/location-scope";
import { lockAndValidateDataGeneration, lockedWriteRejection, refreshAuthAfterOrganizationLock, requireAuth, requireCurrentDataGeneration, requireSubscriptionAccess, type AuthContext } from "../middleware/team-auth";

const router: IRouter = Router();
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 2_000;
const TTL = 10 * 60_000;
const allowed = new Set(["accounts", "customers", "suppliers", "products", "employees", "projects", "expenses", "journalEntries"]);
const exportable = new Set([...allowed, "invoices", "purchaseOrders"]);
const moduleFor: Record<string, string | string[]> = { accounts: "accounting", customers: "sales", suppliers: "inventory", products: ["inventory", "sales"], employees: "hr", projects: "operations", expenses: "accounting", journalEntries: "accounting" };
const fields: Record<string, Set<string>> = {
  accounts: new Set(["code", "name", "type", "parent", "openingBalance", "balance", "status", "clientOperationId"]),
  customers: new Set(["name", "companyName", "fullName", "phone", "email", "address", "vatNumber", "status", "clientOperationId"]),
  suppliers: new Set(["name", "companyName", "fullName", "phone", "email", "address", "vatNumber", "status", "clientOperationId"]),
  products: new Set(["name", "sku", "barcode", "category", "description", "sellPrice", "purchasePrice", "cost", "price", "stock", "unit", "warehouseId", "status", "clientOperationId"]),
  employees: new Set(["name", "fullName", "phone", "email", "position", "department", "salary", "status", "clientOperationId"]),
  projects: new Set(["name", "description", "status", "startDate", "endDate", "warehouseId", "clientOperationId"]),
  expenses: new Set(["description", "amount", "date", "category", "vendor", "paymentMethod", "paid", "warehouseId", "clientOperationId"]),
  journalEntries: new Set(["date", "description", "status", "lines", "reference", "warehouseId", "clientOperationId"]),
};
type Preview = { organizationId: number; userId: number; tableName: string; rows: Array<Record<string, unknown>>; expiresAt: number; digest: string };
type DatabaseTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const previews = new Map<string, Preview>();
function permitted(auth: AuthContext, tableName: string): boolean {
  const item = moduleFor[tableName]; const modules = Array.isArray(item) ? item : [item];
  return allowed.has(tableName) && (auth.roleId === "owner" || modules.some((module) => auth.permissions[module] === true));
}
function permittedForExport(auth: AuthContext, tableName: string): boolean {
  if (!exportable.has(tableName)) return false;
  if (tableName === "invoices") return auth.roleId === "owner" || auth.permissions.sales === true;
  if (tableName === "purchaseOrders") return auth.roleId === "owner" || auth.permissions.inventory === true;
  return permitted(auth, tableName);
}
function plain(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function date(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
function number(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function parseCell(value: string): unknown {
  const trimmed = value.trim(); if (!trimmed) return "";
  if (trimmed === "true" || trimmed === "false") return trimmed === "true";
  if (/^-?(?:\d+|\d*\.\d+)$/.test(trimmed)) return Number(trimmed);
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) try { return JSON.parse(trimmed); } catch { return trimmed; }
  return trimmed;
}
function parseCsv(content: string): Array<Record<string, unknown>> {
  const values: string[][] = [[]]; let current = ""; let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (character === "\"") { if (quoted && content[index + 1] === "\"") { current += "\""; index += 1; } else quoted = !quoted; }
    else if (character === "," && !quoted) { values.at(-1)!.push(current); current = ""; }
    else if ((character === "\n" || character === "\r") && !quoted) { if (character === "\r" && content[index + 1] === "\n") index += 1; values.at(-1)!.push(current); values.push([]); current = ""; }
    else current += character;
  }
  if (quoted) throw new Error("ملف CSV يحتوي على اقتباس غير مكتمل.");
  if (current || values.at(-1)!.length) values.at(-1)!.push(current); else values.pop();
  const headers = values.shift()?.map((header) => header.trim()) ?? [];
  if (!headers.length || headers.some((header) => !/^[A-Za-z][A-Za-z0-9_]*$/.test(header)) || new Set(headers).size !== headers.length) throw new Error("عناوين أعمدة CSV غير صالحة.");
  return values.filter((row) => row.some((cell) => cell.trim())).map((row) => Object.fromEntries(headers.map((header, index) => [header, parseCell(row[index] ?? "")])));
}
async function readMultipart(request: Request): Promise<{ tableName: string; format: string; content: Buffer }> {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(request.get("content-type") ?? ""); const boundary = match?.[1] ?? match?.[2];
  if (!boundary) throw new Error("يلزم رفع ملف بصيغة multipart/form-data.");
  const chunks: Buffer[] = []; let size = 0;
  for await (const item of request) { const chunk = Buffer.isBuffer(item) ? item : Buffer.from(item); size += chunk.length; if (size > MAX_BYTES) throw new Error("حجم ملف الاستيراد أكبر من 5 م.ب."); chunks.push(chunk); }
  const raw = Buffer.concat(chunks); const marker = Buffer.from(`--${boundary}`); let offset = 0; const fields = new Map<string, Buffer>();
  while (offset < raw.length && raw.subarray(offset, offset + marker.length).equals(marker)) {
    offset += marker.length; if (raw.subarray(offset, offset + 2).equals(Buffer.from("--"))) break;
    if (!raw.subarray(offset, offset + 2).equals(Buffer.from("\r\n"))) throw new Error("بيانات الرفع غير صحيحة."); offset += 2;
    const endHeader = raw.indexOf(Buffer.from("\r\n\r\n"), offset); const end = raw.indexOf(Buffer.from(`\r\n--${boundary}`), endHeader + 4);
    if (endHeader < 0 || end < 0) throw new Error("بيانات الرفع غير صحيحة.");
    const header = raw.subarray(offset, endHeader).toString("utf8"); const name = /name="([^"]+)"/i.exec(header)?.[1]; if (name) fields.set(name, raw.subarray(endHeader + 4, end));
    offset = end + 2;
  }
  const tableName = fields.get("tableName")?.toString("utf8").trim() ?? ""; const format = fields.get("format")?.toString("utf8").trim().toLowerCase() ?? ""; const content = fields.get("file");
  if (!content || !tableName || !["csv", "json"].includes(format)) throw new Error("يلزم تحديد الجدول والتنسيق والملف.");
  return { tableName, format, content };
}
function validateRows(tableName: string, rows: Array<Record<string, unknown>>): string[] {
  const errors: string[] = []; const codes = new Set<string>();
  rows.forEach((row, index) => {
    const fail = (message: string) => errors.push(`السطر ${index + 1}: ${message}`);
    if (!plain(row) || Object.keys(row).length === 0 || Object.keys(row).length > 60) { fail("بيانات السجل غير صالحة."); return; }
    if (Object.keys(row).some((key) => !fields[tableName].has(key))) { fail("يحتوي السجل على حقل غير مسموح للاستيراد."); return; }
    if (row.clientOperationId !== undefined && (typeof row.clientOperationId !== "string" || row.clientOperationId.length > 200)) { fail("معرّف العملية في السجل غير صالح."); return; }
    if (tableName === "accounts") { if (typeof row.code !== "string" || !row.code.trim() || !["asset", "liability", "equity", "revenue", "expense"].includes(String(row.type)) || typeof row.name !== "string" || !row.name.trim()) fail("الحساب يحتاج رمزاً واسماً ونوعاً صحيحاً."); else if (codes.has(row.code)) fail("رمز الحساب مكرر في الملف."); else codes.add(row.code); }
    if (["customers", "suppliers", "employees", "projects", "products"].includes(tableName) && typeof row.name !== "string" && typeof row.companyName !== "string" && typeof row.fullName !== "string") fail("يلزم إدخال اسم للسجل.");
    if (tableName === "expenses" && (!date(row.date) || typeof row.description !== "string" || !row.description.trim() || !number(row.amount) || Number(row.amount) < 0)) fail("المصروف يحتاج تاريخاً ووصفاً ومبلغاً صحيحاً.");
    if (tableName === "journalEntries") {
      const lines = row.lines;
      if (!date(row.date) || typeof row.description !== "string" || !row.description.trim() || row.status !== "draft" || !Array.isArray(lines) || lines.length < 2) {
        fail("القيد المستورد يجب أن يكون مسودة متوازنة ذات سطرين على الأقل.");
      } else {
        const invalidLine = lines.some((line) => {
          if (!plain(line) || !Number.isInteger(Number(line.accountId))) return true;
          const debit = line.debit === undefined || line.debit === "" ? 0 : line.debit;
          const credit = line.credit === undefined || line.credit === "" ? 0 : line.credit;
          if (!number(debit) || !number(credit) || debit < 0 || credit < 0) return true;
          return (debit > 0) === (credit > 0);
        });
        if (invalidLine) fail("كل سطر قيد يحتاج حساباً ومبلغاً موجباً في طرف واحد فقط.");
        const debit = lines.reduce((sum, line) => sum + (plain(line) && number(line.debit) ? line.debit : 0), 0);
        const credit = lines.reduce((sum, line) => sum + (plain(line) && number(line.credit) ? line.credit : 0), 0);
        if (debit <= 0 || Math.abs(debit - credit) > .005) fail("إجمالي القيد غير متوازن.");
      }
    }
  });
  return errors;
}
async function closed(auth: AuthContext, value: unknown, tx: DatabaseTransaction): Promise<boolean> {
  if (!date(value)) return false; const rows = await tx.select().from(erpRecordsTable).where(and(eq(erpRecordsTable.organizationId, auth.organizationId), eq(erpRecordsTable.tableName, "financialClosures")));
  return rows.some((row) => row.data.status === "closed" && String(value) >= String(row.data.from) && String(value) <= String(row.data.to));
}
function failure(response: Response) { const rejection = lockedWriteRejection(response); response.status(rejection.status).json({ error: rejection.error, code: rejection.code }); }

router.post("/data-transfer/preview", requireAuth, requireSubscriptionAccess, async (request, response) => {
  const auth = response.locals.auth as AuthContext;
  try {
    const input = await readMultipart(request); if (!permitted(auth, input.tableName)) { response.status(403).json({ error: "الجدول المطلوب غير متاح للاستيراد." }); return; }
    const text = input.content.toString("utf8"); const parsed: unknown = input.format === "csv" ? parseCsv(text) : JSON.parse(text);
    const rows = Array.isArray(parsed) ? parsed : plain(parsed) && Array.isArray(parsed.records) ? parsed.records : null;
    if (!rows || rows.length === 0 || rows.length > MAX_ROWS || !rows.every(plain)) { response.status(400).json({ error: "ملف الاستيراد يجب أن يحتوي بين 1 و2000 سجل." }); return; }
    const errors = validateRows(input.tableName, rows); const previewId = randomUUID(); const digest = createHash("sha256").update(JSON.stringify(rows)).digest("hex");
    if (previews.size > 100) for (const [id, preview] of previews) if (preview.expiresAt < Date.now() || previews.size > 100) previews.delete(id);
    previews.set(previewId, { organizationId: auth.organizationId, userId: auth.id, tableName: input.tableName, rows, expiresAt: Date.now() + TTL, digest });
    response.json({ previewId, expiresAt: new Date(Date.now() + TTL).toISOString(), tableName: input.tableName, rowCount: rows.length, valid: errors.length === 0, errors: errors.slice(0, 100), errorCount: errors.length });
  } catch (error) { response.status(400).json({ error: error instanceof Error ? error.message : "تعذر قراءة ملف الاستيراد." }); }
});

router.post("/data-transfer/commit", requireAuth, requireSubscriptionAccess, requireCurrentDataGeneration, async (request, response) => {
  const auth = response.locals.auth as AuthContext; const previewId = typeof request.body?.previewId === "string" ? request.body.previewId : ""; const clientOperationId = typeof request.body?.clientOperationId === "string" ? request.body.clientOperationId.trim() : "";
  const preview = previews.get(previewId); if (!preview || preview.expiresAt < Date.now() || preview.organizationId !== auth.organizationId || preview.userId !== auth.id || !permitted(auth, preview.tableName)) { response.status(400).json({ error: "معاينة الاستيراد غير صالحة أو انتهت. أعد رفع الملف." }); return; }
  if (!clientOperationId || clientOperationId.length > 200) { response.status(400).json({ error: "يلزم معرّف عملية صالح للاستيراد." }); return; }
  try {
    const outcome = await db.transaction(async (tx) => {
      if (!await lockAndValidateDataGeneration(tx, response)) return null;
      const current = await refreshAuthAfterOrganizationLock(tx, response); if (!current || !permitted(current, preview.tableName)) { response.locals.writeAccessFailure = "authorization_changed"; return null; }
      const [old] = await tx.select().from(erpRecordsTable).where(and(eq(erpRecordsTable.organizationId, current.organizationId), eq(erpRecordsTable.tableName, "dataTransferOperations"), eq(erpRecordsTable.clientOperationId, clientOperationId))).limit(1);
      if (old) { if (old.data.digest !== preview.digest || old.data.tableName !== preview.tableName) throw new Error("IDEMPOTENCY"); return { count: Number(old.data.count), replayed: true }; }
      const errors = validateRows(preview.tableName, preview.rows); if (errors.length) throw new Error(errors[0]);
      const dates = preview.rows.map((row) => row.date ?? row.issueDate); if ((preview.tableName === "expenses" || preview.tableName === "journalEntries") && (await Promise.all(dates.map((value) => closed(current, value, tx)))).some(Boolean)) throw new Error("لا يمكن استيراد سجلات داخل فترة مالية مقفلة.");
      if (preview.tableName === "journalEntries") {
        const accounts = await tx.select({ id: erpRecordsTable.id }).from(erpRecordsTable).where(and(eq(erpRecordsTable.organizationId, current.organizationId), eq(erpRecordsTable.tableName, "accounts")));
        const ids = new Set(accounts.map((account) => account.id));
        if (preview.rows.some((row) => !Array.isArray(row.lines) || row.lines.some((line) => !plain(line) || !Number.isInteger(Number(line.accountId)) || !ids.has(Number(line.accountId))))) throw new Error("أحد أسطر القيد يشير إلى حساب غير موجود في المنشأة.");
      }
      const localOps = preview.rows.map((row) => typeof row.clientOperationId === "string" ? row.clientOperationId.trim() : "").filter(Boolean);
      if (new Set(localOps).size !== localOps.length || localOps.some((value) => value.length > 200)) throw new Error("توجد معرّفات عمليات مكررة أو غير صالحة في الملف.");
      if (localOps.length) { const used = await tx.select({ clientOperationId: erpRecordsTable.clientOperationId }).from(erpRecordsTable).where(and(eq(erpRecordsTable.organizationId, current.organizationId), eq(erpRecordsTable.tableName, preview.tableName), inArray(erpRecordsTable.clientOperationId, localOps))); if (used.length) throw new Error("يوجد معرّف عملية مستخدم مسبقاً في الملف أو المنشأة."); }
      if (preview.tableName === "accounts") { const codes = preview.rows.map((row) => String(row.code)); const existing = await tx.select().from(erpRecordsTable).where(and(eq(erpRecordsTable.organizationId, current.organizationId), eq(erpRecordsTable.tableName, "accounts"))); if (existing.some((row) => codes.includes(String(row.data.code)))) throw new Error("أحد رموز الحسابات مستخدم مسبقاً."); }
      for (const row of preview.rows) if (!isLocationAllowed(current, preview.tableName, row)) throw new Error("ليس لديك صلاحية للمواقع المحددة في الملف.");
      await tx.insert(erpRecordsTable).values(preview.rows.map((row) => { const { clientOperationId: rowOperation, ...data } = row; return { organizationId: current.organizationId, tableName: preview.tableName, clientOperationId: typeof rowOperation === "string" && rowOperation ? rowOperation : null, data }; }));
      await tx.insert(erpRecordsTable).values({ organizationId: current.organizationId, tableName: "dataTransferOperations", clientOperationId, data: { digest: preview.digest, tableName: preview.tableName, count: preview.rows.length } });
      await tx.insert(teamAuditLogsTable).values({ organizationId: current.organizationId, actorId: current.id, actorName: current.name || current.email, action: "data_imported", entity: preview.tableName, details: `${preview.rows.length} rows` });
      return { count: preview.rows.length, replayed: false };
    });
    if (!outcome) { failure(response); return; } previews.delete(previewId); response.status(outcome.replayed ? 200 : 201).json({ tableName: preview.tableName, imported: outcome.count, replayed: outcome.replayed });
  } catch (error) { response.status(error instanceof Error && error.message === "IDEMPOTENCY" ? 409 : 400).json({ error: error instanceof Error && error.message === "IDEMPOTENCY" ? "معرّف العملية مستخدم لاستيراد مختلف." : error instanceof Error ? error.message : "تعذر استيراد البيانات." }); }
});

router.post("/data-transfer/export", requireAuth, requireSubscriptionAccess, async (request, response) => {
  const auth = response.locals.auth as AuthContext; const tableName = typeof request.body?.tableName === "string" ? request.body.tableName : ""; const format = request.body?.format === "csv" ? "csv" : request.body?.format === "json" ? "json" : "";
  if (!format || !permittedForExport(auth, tableName)) { response.status(400).json({ error: "الجدول أو تنسيق التصدير غير صالح." }); return; }
  const records: Array<Record<string, unknown>> = (await db.select().from(erpRecordsTable).where(and(eq(erpRecordsTable.organizationId, auth.organizationId), eq(erpRecordsTable.tableName, tableName)))).filter((row) => isLocationAllowed(auth, tableName, row.data, row.id)).map((row) => ({ ...row.data }));
  response.setHeader("Content-Disposition", `attachment; filename="${tableName}-export.${format}"`);
  if (format === "json") { response.type("application/json").send(JSON.stringify({ tableName, records })); return; }
  const keys = [...new Set(records.flatMap(Object.keys))]; const csv = [keys.join(","), ...records.map((record) => keys.map((key) => { const value = record[key]; const text = typeof value === "object" ? JSON.stringify(value) : String(value ?? ""); return `"${text.replace(/"/g, "\"\"")}"`; }).join(","))].join("\r\n");
  response.type("text/csv; charset=utf-8").send(`\uFEFF${csv}`);
});
export default router;