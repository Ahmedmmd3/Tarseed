import { Router, type IRouter, type Request, type Response } from "express";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { and, eq, sql } from "drizzle-orm";
import { db, erpRecordsTable } from "@workspace/db";
import { requireAuth, requireSubscriptionAccess, type AuthContext } from "../middleware/team-auth";
import { isLocationAllowed } from "../lib/location-scope";

const router: IRouter = Router();
const MAX_QUESTION_LENGTH = 2_000;
const MAX_CONTEXT_LENGTH = 12_000;
const MAX_ACCOUNT_LIST_LENGTH = 200;
const MAX_RECEIPT_IMAGE_LENGTH = 12_000_000;
const supportedReceiptMediaTypes = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);
const weeklySummarySystemPrompt = `أنت محاسب يكتب ملخصاً أسبوعياً لصاحب مشروع عربي.
اكتب ملخصاً واضحاً وودياً بـ 4-5 جمل قصيرة.
ابدأ بالإيجابيات، ثم التنبيهات، ثم توصية واحدة.
لا تستخدم رموز أو جداول — نص عادي فقط.`;
const anomalySystemPrompt = `أنت مراقب مالي. حلل هذه البيانات واكتب تنبيهاً قصيراً (جملتان فقط)
يشرح الشذوذ وسببه المحتمل. كن واضحاً ومباشراً.`;
const anomalyCooldownMs = 6 * 60 * 60 * 1000;

type ErpRecord = Record<string, unknown> & { id: number };
type AnomalyReservation =
  | { recordId: number }
  | { cachedResult: Record<string, unknown> }
  | { throttledAt: string };

const asNumber = (value: unknown): number => {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
};

const recordDate = (record: Record<string, unknown>): string => {
  const value = record.issueDate ?? record.date ?? record.createdAt;
  return typeof value === "string" ? value.slice(0, 10) : "";
};

function riyadhDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function daysBetween(later: string, earlier: string): number {
  const laterTime = new Date(`${later}T00:00:00.000Z`).getTime();
  const earlierTime = new Date(`${earlier}T00:00:00.000Z`).getTime();
  return Math.floor((laterTime - earlierTime) / 86_400_000);
}

async function weeklyRecords(auth: AuthContext, tableName: string): Promise<ErpRecord[]> {
  const records = await db.select().from(erpRecordsTable).where(and(
    eq(erpRecordsTable.organizationId, auth.organizationId),
    eq(erpRecordsTable.tableName, tableName),
  ));
  return records
    .filter((record) => isLocationAllowed(auth, tableName, record.data, record.id))
    .map((record) => ({ ...(record.data as Record<string, unknown>), id: record.id }));
}

const assistantSystemPrompt = `أنت مساعد مالي ذكي داخل نظام ترصيد للمحاسبة.
حلّل الأسئلة المالية والمحاسبية فقط اعتماداً على السياق المرسل.
أجب بالعربية الفصحى المبسطة وباختصار ووضوح، واستخدم الأرقام كما وردت في السياق.
إذا لم تتوفر بيانات كافية، اذكر ذلك بوضوح ولا تخترع أرقاماً.
إذا كان السؤال خارج نطاق التحليل المالي والمحاسبي، أجب حرفياً: هذا خارج اختصاصي`;

const journalSuggestionSystemPrompt = (accountList: string) => `أنت محاسب قانوني عربي. عندك دليل الحسابات التالي:
${accountList}
المستخدم يصف عملية مالية. أعد JSON فقط بهذا الشكل:
{"description":"string","lines":[{"accountId":"string","debit":0,"credit":0}]}
تأكد أن مجموع المدين = مجموع الدائن. لا تضف أي نص خارج الـ JSON.`;

router.post(
  "/assistant/financial",
  requireAuth,
  requireSubscriptionAccess,
  async (request: Request, response: Response): Promise<void> => {
    const question = typeof request.body?.question === "string" ? request.body.question.trim() : "";
    const context = typeof request.body?.context === "string" ? request.body.context.trim() : "";

    if (!question || question.length > MAX_QUESTION_LENGTH) {
      response.status(400).json({ error: "يرجى إدخال سؤال مالي صالح." });
      return;
    }
    if (context.length > MAX_CONTEXT_LENGTH) {
      response.status(400).json({ error: "تعذر إرسال السياق المالي. حاول مرة أخرى." });
      return;
    }

    try {
      const completion = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        system: assistantSystemPrompt,
        messages: [
          {
            role: "user",
            content: `السياق المالي الحالي:
${context || "لا توجد بيانات مالية متاحة حالياً."}

سؤال المستخدم:
${question}`,
          },
        ],
      });
      const answer = completion.content
        .map((block) => block.type === "text" ? block.text : "")
        .filter(Boolean)
        .join("\n")
        .trim();

      response.json({ answer: answer || "لم أتمكن من استخراج إجابة من البيانات المتاحة." });
    } catch (error) {
      request.log?.error?.({ err: error }, "Financial assistant request failed");
      response.status(502).json({ error: "تعذر الوصول إلى المساعد المالي حالياً. حاول مرة أخرى." });
    }
  },
);

router.post(
  "/assistant/journal-suggestion",
  requireAuth,
  requireSubscriptionAccess,
  async (request: Request, response: Response): Promise<void> => {
    const operation = typeof request.body?.operation === "string" ? request.body.operation.trim() : "";
    const accounts: unknown[] = Array.isArray(request.body?.accounts) ? request.body.accounts : [];

    if (!operation || operation.length > MAX_QUESTION_LENGTH || accounts.length === 0 || accounts.length > MAX_ACCOUNT_LIST_LENGTH) {
      response.status(400).json({ error: "يرجى إدخال وصف للعملية ودليل حسابات صالح." });
      return;
    }

    const accountList = accounts
      .filter((account): account is { id: string; code: string; name: string } => {
        if (!account || typeof account !== "object") return false;
        const candidate = account as Record<string, unknown>;
        return typeof candidate.id === "string"
          && typeof candidate.code === "string"
          && typeof candidate.name === "string";
      })
      .map((account) => `${account.id} | ${account.code} - ${account.name}`)
      .join("\n");

    if (!accountList) {
      response.status(400).json({ error: "تعذر قراءة دليل الحسابات." });
      return;
    }

    try {
      const completion = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        system: journalSuggestionSystemPrompt(accountList),
        messages: [{ role: "user", content: operation }],
      });
      const suggestion = completion.content
        .map((block) => block.type === "text" ? block.text : "")
        .filter(Boolean)
        .join("\n")
        .trim();

      response.json({ suggestion });
    } catch (error) {
      request.log?.error?.({ err: error }, "Journal suggestion request failed");
      response.status(502).json({ error: "تعذر اقتراح القيد حالياً. حاول مرة أخرى." });
    }
  },
);

router.post(
  "/assistant/receipt-expense",
  requireAuth,
  requireSubscriptionAccess,
  async (request: Request, response: Response): Promise<void> => {
    const image = typeof request.body?.image === "string" ? request.body.image.trim() : "";
    const mediaType = typeof request.body?.mediaType === "string" ? request.body.mediaType.trim().toLowerCase() : "";

    if (!image || image.length > MAX_RECEIPT_IMAGE_LENGTH || !supportedReceiptMediaTypes.has(mediaType)) {
      response.status(400).json({ error: "يرجى رفع صورة إيصال بصيغة مدعومة." });
      return;
    }

    try {
      const completion = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        system: `استخرج من هذه الصورة بيانات الإيصال. أعد JSON فقط:
{description: string, amount: number, date: string (YYYY-MM-DD), category: string (اختر من: إيجار|رواتب|مشتريات|مرافق|تسويق|نقل|صيانة|أخرى),
vendor: string}
إذا لم تجد قيمة اكتب null. لا تضف أي نص خارج الـ JSON.`,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: { type: "base64", media_type: mediaType, data: image },
              },
              {
                type: "text",
                text: "استخرج بيانات هذا الإيصال لتهيئة نموذج مصروف جديد.",
              },
            ],
          },
        ],
      });
      const extracted = completion.content
        .map((block) => block.type === "text" ? block.text : "")
        .filter(Boolean)
        .join("\n")
        .trim();

      response.json({ extracted });
    } catch (error) {
      request.log?.error?.({ err: error }, "Receipt expense extraction failed");
      response.status(502).json({ error: "تعذر استخراج بيانات الإيصال حالياً. حاول مرة أخرى." });
    }
  },
);

router.post(
  "/assistant/weekly-summary",
  requireAuth,
  requireSubscriptionAccess,
  async (request: Request, response: Response): Promise<void> => {
    const auth = response.locals.auth as AuthContext;
    const canReadWeeklyFinancials = auth.roleId === "owner"
      || (auth.permissions.sales === true && auth.permissions.accounting === true);
    if (!canReadWeeklyFinancials) {
      response.status(403).json({ error: "ليس لديك صلاحية لعرض الملخص المالي الأسبوعي." });
      return;
    }

    try {
      const today = riyadhDate();
      const weekStart = addDays(today, -6);
      const [invoices, expenses, sales, products, receivables] = await Promise.all([
        weeklyRecords(auth, "invoices"),
        weeklyRecords(auth, "expenses"),
        weeklyRecords(auth, "sales"),
        weeklyRecords(auth, "products"),
        weeklyRecords(auth, "receivables"),
      ]);
      const inWeek = (record: Record<string, unknown>) => {
        const date = recordDate(record);
        return date >= weekStart && date <= today;
      };
      const weeklyInvoices = invoices.filter(inWeek);
      const weeklyExpenses = expenses.filter(inWeek);
      const weeklySales = sales.filter(inWeek);
      const totalSales = weeklyInvoices.reduce((sum, invoice) => sum + asNumber(invoice.total ?? invoice.amount ?? invoice.totalAmount), 0);
      const totalExpenses = weeklyExpenses.reduce((sum, expense) => sum + asNumber(expense.amount ?? expense.total ?? expense.totalAmount), 0);

      const productTotals = new Map<number, { quantity: number; salesAmount: number }>();
      for (const sale of weeklySales) {
        const productId = Number(sale.productId);
        if (!Number.isInteger(productId) || productId <= 0) continue;
        const current = productTotals.get(productId) ?? { quantity: 0, salesAmount: 0 };
        current.quantity += asNumber(sale.quantity);
        current.salesAmount += asNumber(sale.total ?? sale.amount);
        productTotals.set(productId, current);
      }
      const [topProductEntry] = [...productTotals.entries()].sort((left, right) => {
        const quantityDifference = right[1].quantity - left[1].quantity;
        return quantityDifference || right[1].salesAmount - left[1].salesAmount;
      });
      const productsById = new Map(products.map((product) => [product.id, product]));
      const topProduct = topProductEntry
        ? {
            name: String(productsById.get(topProductEntry[0])?.name ?? `منتج #${topProductEntry[0]}`),
            quantity: topProductEntry[1].quantity,
            salesAmount: topProductEntry[1].salesAmount,
          }
        : null;

      const explicitReceivables = receivables.filter((record) => record.type === "receivable");
      const receivableSources: ErpRecord[] = explicitReceivables.length
        ? explicitReceivables
        : invoices
            .filter((invoice) => asNumber(invoice.total ?? invoice.amount ?? invoice.totalAmount) > asNumber(invoice.paid ?? invoice.paidAmount))
            .map((invoice): ErpRecord => ({
              ...invoice,
              type: "receivable",
              amount: asNumber(invoice.total ?? invoice.amount ?? invoice.totalAmount),
              status: asNumber(invoice.total ?? invoice.amount ?? invoice.totalAmount) <= asNumber(invoice.paid ?? invoice.paidAmount)
                ? "paid"
                : "unpaid",
              dueDate: invoice.dueDate ?? invoice.issueDate ?? invoice.date,
            }));
      const overdueItems = receivableSources.filter((record) => {
        const dueDate = typeof record.dueDate === "string" ? record.dueDate.slice(0, 10) : "";
        const remaining = Math.max(0, asNumber(record.amount) - asNumber(record.paid ?? record.paidAmount));
        return record.type === "receivable"
          && record.status !== "paid"
          && dueDate !== ""
          && dueDate < today
          && remaining > 0;
      });
      const overdueReceivables = {
        count: overdueItems.length,
        total: overdueItems.reduce(
          (sum, record) => sum + Math.max(0, asNumber(record.amount) - asNumber(record.paid ?? record.paidAmount)),
          0,
        ),
      };
      const metrics = {
        period: { from: weekStart, to: today },
        totalSales,
        totalExpenses,
        netProfit: totalSales - totalExpenses,
        invoiceCount: weeklyInvoices.length,
        topProduct,
        overdueReceivables,
      };

      const completion = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 8192,
        system: weeklySummarySystemPrompt,
        messages: [{ role: "user", content: JSON.stringify(metrics) }],
      });
      const summary = completion.content
        .map((block) => block.type === "text" ? block.text : "")
        .filter(Boolean)
        .join("\n")
        .trim();
      if (!summary) {
        response.status(502).json({ error: "لم يتمكن المساعد من إنشاء الملخص الأسبوعي." });
        return;
      }

      response.json({ summary, generatedAt: new Date().toISOString() });
    } catch (error) {
      request.log?.error?.({ err: error }, "Weekly financial summary request failed");
      response.status(502).json({ error: "تعذر توليد الملخص الأسبوعي حالياً. حاول مرة أخرى." });
    }
  },
);

router.post(
  "/assistant/anomalies",
  requireAuth,
  requireSubscriptionAccess,
  async (_request: Request, response: Response): Promise<void> => {
    const auth = response.locals.auth as AuthContext;
    const canReadFinancials = auth.roleId === "owner"
      || (auth.permissions.sales === true && auth.permissions.accounting === true);
    if (!canReadFinancials) {
      response.status(403).json({ error: "ليس لديك صلاحية لعرض التنبيهات المالية." });
      return;
    }

    try {
      const today = riyadhDate();
      const currentWeekStart = addDays(today, -6);
      const previousPeriodStart = addDays(today, -34);
      const scopeFingerprint = JSON.stringify({
        dataGeneration: auth.dataGeneration,
        roleId: auth.roleId,
        locationScope: auth.locationScope,
        warehouseIds: [...auth.warehouseIds].map(Number).sort((left, right) => left - right),
        permissions: {
          accounting: auth.permissions.accounting === true,
          sales: auth.permissions.sales === true,
        },
      });
      const reservation = await db.transaction(async (tx): Promise<AnomalyReservation> => {
        await tx.execute(sql`select pg_advisory_xact_lock(${auth.organizationId}, ${auth.id})`);
        const records = await tx.select().from(erpRecordsTable).where(and(
          eq(erpRecordsTable.organizationId, auth.organizationId),
          eq(erpRecordsTable.tableName, "financialAnomalyAnalyses"),
        ));
        const existing = records.find((record) => Number(record.data.userId) === auth.id);
        const existingData = existing?.data as Record<string, unknown> | undefined;
        const checkedAt = typeof existingData?.checkedAt === "string" ? existingData.checkedAt : "";
        const checkedAtTime = checkedAt ? Date.parse(checkedAt) : 0;
        if (checkedAtTime > 0 && Date.now() - checkedAtTime < anomalyCooldownMs) {
          if (existingData?.scopeFingerprint === scopeFingerprint
            && existingData.result
            && typeof existingData.result === "object"
            && !Array.isArray(existingData.result)) {
            return { cachedResult: existingData.result as Record<string, unknown> };
          }
          return { throttledAt: checkedAt };
        }

        const pendingData = {
          userId: auth.id,
          scopeFingerprint,
          checkedAt: new Date().toISOString(),
          status: "pending",
        };
        if (existing) {
          await tx.update(erpRecordsTable)
            .set({ data: pendingData, updatedAt: new Date() })
            .where(eq(erpRecordsTable.id, existing.id));
          return { recordId: existing.id };
        }
        const [created] = await tx.insert(erpRecordsTable).values({
          organizationId: auth.organizationId,
          tableName: "financialAnomalyAnalyses",
          data: pendingData,
        }).returning({ id: erpRecordsTable.id });
        return { recordId: created.id };
      });
      if ("cachedResult" in reservation) {
        response.json({ ...reservation.cachedResult, cached: true });
        return;
      }
      if ("throttledAt" in reservation) {
        response.json({
          hasAnomalies: false,
          anomalies: [],
          analysis: null,
          analyzedAt: reservation.throttledAt,
          throttled: true,
          metrics: {
            period: { from: currentWeekStart, to: today },
            averagePreviousWeeklyExpenses: 0,
            currentWeekExpenses: 0,
            expenseChangePercent: 0,
            averagePreviousWeeklySales: 0,
            currentWeekSales: 0,
            salesChangePercent: 0,
            overdueReceivablesOverThirtyDays: 0,
            unpaidInvoices: 0,
          },
        });
        return;
      }
      const [invoices, expenses, receivables] = await Promise.all([
        weeklyRecords(auth, "invoices"),
        weeklyRecords(auth, "expenses"),
        weeklyRecords(auth, "receivables"),
      ]);
      const dateInRange = (record: Record<string, unknown>, from: string, to: string) => {
        const date = recordDate(record);
        return date >= from && date <= to;
      };
      const valueOfInvoice = (record: Record<string, unknown>) => asNumber(record.total ?? record.amount ?? record.totalAmount);
      const valueOfExpense = (record: Record<string, unknown>) => asNumber(record.amount ?? record.total ?? record.totalAmount);
      const currentInvoices = invoices.filter((record) => dateInRange(record, currentWeekStart, today));
      const previousInvoices = invoices.filter((record) => dateInRange(record, previousPeriodStart, addDays(currentWeekStart, -1)));
      const currentExpenses = expenses.filter((record) => dateInRange(record, currentWeekStart, today));
      const previousExpenses = expenses.filter((record) => dateInRange(record, previousPeriodStart, addDays(currentWeekStart, -1)));
      const currentSales = currentInvoices.reduce((sum, record) => sum + valueOfInvoice(record), 0);
      const previousSales = previousInvoices.reduce((sum, record) => sum + valueOfInvoice(record), 0);
      const currentExpensesTotal = currentExpenses.reduce((sum, record) => sum + valueOfExpense(record), 0);
      const previousExpensesTotal = previousExpenses.reduce((sum, record) => sum + valueOfExpense(record), 0);
      const averageWeeklyExpenses = previousExpensesTotal / 4;
      const averageWeeklySales = previousSales / 4;
      const expenseChangePercent = averageWeeklyExpenses > 0
        ? ((currentExpensesTotal - averageWeeklyExpenses) / averageWeeklyExpenses) * 100
        : currentExpensesTotal > 0 ? 100 : 0;
      const salesChangePercent = averageWeeklySales > 0
        ? ((currentSales - averageWeeklySales) / averageWeeklySales) * 100
        : 0;

      const explicitReceivables = receivables.filter((record) => record.type === "receivable");
      const explicitInvoiceIds = new Set(explicitReceivables
        .map((record) => Number(record.invoiceId))
        .filter((invoiceId) => Number.isInteger(invoiceId) && invoiceId > 0));
      const explicitReferences = new Set(explicitReceivables.map((record) => String(record.reference ?? "")).filter(Boolean));
      const outstandingInvoices = invoices
        .filter((invoice) => valueOfInvoice(invoice) > asNumber(invoice.paid ?? invoice.paidAmount)
          && !explicitInvoiceIds.has(invoice.id)
          && !explicitReferences.has(String(invoice.number ?? invoice.reference ?? "")))
        .map((invoice): ErpRecord => ({
          ...invoice,
          type: "receivable",
          amount: valueOfInvoice(invoice),
          paid: asNumber(invoice.paid ?? invoice.paidAmount),
          status: "unpaid",
          dueDate: invoice.dueDate ?? invoice.issueDate ?? invoice.date,
        }));
      const receivableSources = [...explicitReceivables, ...outstandingInvoices];
      const overdueThirtyDays = receivableSources.filter((record) => {
        const dueDate = typeof record.dueDate === "string" ? record.dueDate.slice(0, 10) : "";
        const remaining = Math.max(0, asNumber(record.amount) - asNumber(record.paid ?? record.paidAmount));
        return dueDate !== "" && daysBetween(today, dueDate) > 30 && remaining > 0 && record.status !== "paid";
      });
      const unpaidInvoices = invoices.filter((invoice) => {
        const total = valueOfInvoice(invoice);
        const paid = asNumber(invoice.paid ?? invoice.paidAmount);
        return total > paid;
      });

      const anomalies: Array<Record<string, unknown>> = [];
      if (expenseChangePercent > 25) {
        anomalies.push({
          type: "expense_spike",
          title: "ارتفاع المصاريف",
          details: `المصاريف الحالية ${currentExpensesTotal} مقابل متوسط ${averageWeeklyExpenses} أسبوعياً.`,
          currentValue: currentExpensesTotal,
          baselineValue: averageWeeklyExpenses,
          changePercent: expenseChangePercent,
        });
      }
      if (averageWeeklySales > 0 && salesChangePercent <= -30) {
        anomalies.push({
          type: "sales_drop",
          title: "انخفاض المبيعات",
          details: `المبيعات الحالية ${currentSales} مقابل متوسط ${averageWeeklySales} أسبوعياً.`,
          currentValue: currentSales,
          baselineValue: averageWeeklySales,
          changePercent: salesChangePercent,
        });
      }
      if (overdueThirtyDays.length > 0) {
        anomalies.push({
          type: "overdue_receivables",
          title: "ذمم متأخرة",
          details: `${overdueThirtyDays.length} ذمة تجاوزت 30 يوماً بإجمالي ${overdueThirtyDays.reduce((sum, record) => sum + Math.max(0, asNumber(record.amount) - asNumber(record.paid ?? record.paidAmount)), 0)}.`,
          count: overdueThirtyDays.length,
          total: overdueThirtyDays.reduce((sum, record) => sum + Math.max(0, asNumber(record.amount) - asNumber(record.paid ?? record.paidAmount)), 0),
        });
      }
      if (unpaidInvoices.length > 5) {
        anomalies.push({
          type: "unpaid_invoices",
          title: "فواتير غير مدفوعة",
          details: `يوجد ${unpaidInvoices.length} فاتورة غير مدفوعة.`,
          count: unpaidInvoices.length,
        });
      }

      let analysis: string | null = null;
      if (anomalies.length > 0) {
        const completion = await anthropic.messages.create({
          model: "claude-sonnet-4-6",
          max_tokens: 8192,
          system: anomalySystemPrompt,
          messages: [{
            role: "user",
            content: JSON.stringify({
              averagePreviousWeeklyExpenses: averageWeeklyExpenses,
              currentWeekExpenses: currentExpensesTotal,
              averagePreviousWeeklySales: averageWeeklySales,
              currentWeekSales: currentSales,
              details: anomalies,
            }),
          }],
        });
        analysis = completion.content
          .map((block) => block.type === "text" ? block.text : "")
          .filter(Boolean)
          .join("\n")
          .trim() || null;
      }

      const result = {
        hasAnomalies: anomalies.length > 0,
        anomalies,
        analysis,
        analyzedAt: new Date().toISOString(),
        metrics: {
          period: { from: currentWeekStart, to: today },
          averagePreviousWeeklyExpenses: averageWeeklyExpenses,
          currentWeekExpenses: currentExpensesTotal,
          expenseChangePercent,
          averagePreviousWeeklySales: averageWeeklySales,
          currentWeekSales: currentSales,
          salesChangePercent,
          overdueReceivablesOverThirtyDays: overdueThirtyDays.length,
          unpaidInvoices: unpaidInvoices.length,
        },
      };
      await db.update(erpRecordsTable).set({
        data: {
          userId: auth.id,
          scopeFingerprint,
          checkedAt: new Date().toISOString(),
          status: "complete",
          result,
        },
        updatedAt: new Date(),
      }).where(and(
        eq(erpRecordsTable.id, reservation.recordId),
        eq(erpRecordsTable.organizationId, auth.organizationId),
        eq(erpRecordsTable.tableName, "financialAnomalyAnalyses"),
      ));
      if (anomalies.length > 0) {
        await db.insert(erpRecordsTable).values(anomalies.map((anomaly) => ({
          organizationId: auth.organizationId,
          tableName: "financialAnomalyAlerts",
          data: {
            userId: auth.id,
            scopeFingerprint,
            detectedAt: result.analyzedAt,
            status: "open",
            anomaly,
            analysis,
            metrics: result.metrics,
          },
        })));
      }
      response.json(result);
    } catch (error) {
      _request.log?.error?.({ err: error }, "Financial anomaly analysis failed");
      response.status(502).json({ error: "تعذر تحليل التنبيهات المالية حالياً. حاول مرة أخرى." });
    }
  },
);

router.get("/assistant/anomalies/history", requireAuth, requireSubscriptionAccess, async (_request: Request, response: Response): Promise<void> => {
  const auth = response.locals.auth as AuthContext;
  const canReadFinancials = auth.roleId === "owner"
    || (auth.permissions.sales === true && auth.permissions.accounting === true);
  if (!canReadFinancials) {
    response.status(403).json({ error: "ليس لديك صلاحية لعرض سجل التنبيهات المالية." });
    return;
  }
  const records = await db.select().from(erpRecordsTable).where(and(
    eq(erpRecordsTable.organizationId, auth.organizationId),
    eq(erpRecordsTable.tableName, "financialAnomalyAlerts"),
  ));
  response.json({
    alerts: records
      .filter((record) => Number(record.data.userId) === auth.id)
      .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
      .slice(0, 100)
      .map((record) => ({ ...record.data, id: record.id, createdAt: record.createdAt.toISOString() })),
  });
});

export default router;