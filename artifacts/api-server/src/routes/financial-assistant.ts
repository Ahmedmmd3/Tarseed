import { Router, type IRouter, type Request, type Response } from "express";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { and, eq } from "drizzle-orm";
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

type ErpRecord = Record<string, unknown> & { id: number };

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
              dueDate: invoice.dueDate ?? invoice.date ?? invoice.issueDate,
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

export default router;