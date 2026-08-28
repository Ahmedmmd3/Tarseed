import { Router, type IRouter, type Request, type Response } from "express";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { requireAuth, requireSubscriptionAccess } from "../middleware/team-auth";

const router: IRouter = Router();
const MAX_QUESTION_LENGTH = 2_000;
const MAX_CONTEXT_LENGTH = 12_000;
const MAX_ACCOUNT_LIST_LENGTH = 200;
const MAX_RECEIPT_IMAGE_LENGTH = 12_000_000;
const supportedReceiptMediaTypes = new Set(["image/jpeg", "image/png", "image/gif", "image/webp"]);

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

export default router;