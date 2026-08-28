import { Router, type IRouter, type Request, type Response } from "express";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { requireAuth, requireSubscriptionAccess } from "../middleware/team-auth";

const router: IRouter = Router();
const MAX_QUESTION_LENGTH = 2_000;
const MAX_CONTEXT_LENGTH = 12_000;

const assistantSystemPrompt = `أنت مساعد مالي ذكي داخل نظام ترصيد للمحاسبة.
حلّل الأسئلة المالية والمحاسبية فقط اعتماداً على السياق المرسل.
أجب بالعربية الفصحى المبسطة وباختصار ووضوح، واستخدم الأرقام كما وردت في السياق.
إذا لم تتوفر بيانات كافية، اذكر ذلك بوضوح ولا تخترع أرقاماً.
إذا كان السؤال خارج نطاق التحليل المالي والمحاسبي، أجب حرفياً: هذا خارج اختصاصي`;

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

export default router;