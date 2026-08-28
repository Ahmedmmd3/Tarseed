import React from 'react';
import { Bot, LoaderCircle, Send, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { useStore, type Account, type Journal, type Receivable } from '@/context/store';

type AssistantMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

type PeriodTotals = {
  revenue: number;
  expenses: number;
  netProfit: number;
};

const suggestions = [
  'كم الإيرادات والمصروفات هذا الشهر؟',
  'قارن الربح بين هذا الشهر والشهر الماضي',
  'ما الذمم المتأخرة؟',
];

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function calculatePeriodTotals(journals: Journal[], accounts: Account[], from?: string, to?: string): PeriodTotals {
  const accountTypes = new Map(accounts.map((account) => [account.id, account.type]));
  const totals = journals
    .filter((journal) => journal.status === 'posted')
    .filter((journal) => (!from || journal.date >= from) && (!to || journal.date <= to))
    .reduce(
      (current, journal) => {
        journal.lines.forEach((line) => {
          const type = accountTypes.get(line.accountId);
          if (type === 'revenue') current.revenue += line.credit - line.debit;
          if (type === 'expense') current.expenses += line.debit - line.credit;
        });
        return current;
      },
      { revenue: 0, expenses: 0 },
    );

  return { ...totals, netProfit: totals.revenue - totals.expenses };
}

function buildFinancialContext(accounts: Account[], journals: Journal[], receivables: Receivable[]) {
  const now = new Date();
  const currentMonthFrom = dateKey(new Date(now.getFullYear(), now.getMonth(), 1));
  const currentMonthTo = dateKey(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  const previousMonthFrom = dateKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const previousMonthTo = dateKey(new Date(now.getFullYear(), now.getMonth(), 0));
  const allTime = calculatePeriodTotals(journals, accounts);
  const currentMonth = calculatePeriodTotals(journals, accounts, currentMonthFrom, currentMonthTo);
  const previousMonth = calculatePeriodTotals(journals, accounts, previousMonthFrom, previousMonthTo);
  const outstandingReceivables = receivables
    .filter((record) => record.type === 'receivable')
    .reduce((total, record) => total + Math.max(0, record.amount - record.paid), 0);
  const outstandingPayables = receivables
    .filter((record) => record.type === 'payable')
    .reduce((total, record) => total + Math.max(0, record.amount - record.paid), 0);
  const overdueReceivables = receivables
    .filter((record) => record.type === 'receivable' && record.dueDate < dateKey(now))
    .reduce((total, record) => total + Math.max(0, record.amount - record.paid), 0);
  const accountBreakdown = accounts
    .filter((account) => account.status === 'active')
    .slice(0, 40)
    .map((account) => `${account.code} ${account.name}: ${account.balance.toFixed(2)} ريال`)
    .join('؛ ');

  return [
    `الفترة الحالية: ${currentMonthFrom} إلى ${currentMonthTo}`,
    `إجمالي الإيرادات: ${allTime.revenue.toFixed(2)} ريال`,
    `إجمالي المصروفات: ${allTime.expenses.toFixed(2)} ريال`,
    `صافي الربح: ${allTime.netProfit.toFixed(2)} ريال`,
    `إيرادات هذا الشهر: ${currentMonth.revenue.toFixed(2)} ريال`,
    `مصروفات هذا الشهر: ${currentMonth.expenses.toFixed(2)} ريال`,
    `صافي ربح هذا الشهر: ${currentMonth.netProfit.toFixed(2)} ريال`,
    `إيرادات الشهر الماضي: ${previousMonth.revenue.toFixed(2)} ريال`,
    `مصروفات الشهر الماضي: ${previousMonth.expenses.toFixed(2)} ريال`,
    `صافي ربح الشهر الماضي: ${previousMonth.netProfit.toFixed(2)} ريال`,
    `الذمم المدينة القائمة: ${outstandingReceivables.toFixed(2)} ريال`,
    `الذمم الدائنة القائمة: ${outstandingPayables.toFixed(2)} ريال`,
    `الذمم المدينة المتأخرة: ${overdueReceivables.toFixed(2)} ريال`,
    `عدد القيود المرحلة: ${journals.filter((journal) => journal.status === 'posted').length}`,
    `تفاصيل الحسابات: ${accountBreakdown || 'لا توجد حسابات متاحة'}`,
  ].join('\n');
}

function formatMessage(content: string) {
  return content.split('\n').map((line, index) => (
    <React.Fragment key={`${line}-${index}`}>
      {line}
      {index < content.split('\n').length - 1 && <br />}
    </React.Fragment>
  ));
}

export function FinancialAssistant() {
  const { accounts, journals, receivables } = useStore();
  const [open, setOpen] = React.useState(false);
  const [question, setQuestion] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [messages, setMessages] = React.useState<AssistantMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: 'مرحباً! أنا مساعدك المالي. اسألني عن الإيرادات، المصروفات، الأرباح أو الذمم.',
    },
  ]);
  const messagesEndRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const sendQuestion = async (event?: React.FormEvent, suggestedQuestion?: string) => {
    event?.preventDefault();
    const trimmedQuestion = (suggestedQuestion ?? question).trim();
    if (!trimmedQuestion || isLoading) return;

    const userMessage: AssistantMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmedQuestion,
    };
    setMessages((current) => [...current, userMessage]);
    setQuestion('');
    setError('');
    setIsLoading(true);

    try {
      const response = await fetch('/api/assistant/financial', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: trimmedQuestion,
          context: buildFinancialContext(accounts, journals, receivables),
        }),
      });
      const payload = await response.json().catch(() => ({})) as { answer?: string; error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'تعذر الحصول على إجابة.');
      setMessages((current) => [
        ...current,
        {
          id: `assistant-${Date.now()}`,
          role: 'assistant',
          content: payload.answer ?? 'لم أتمكن من إعداد إجابة حالياً.',
        },
      ]);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'تعذر الوصول إلى المساعد المالي.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <Button
        type="button"
        size="icon"
        onClick={() => setOpen(true)}
        className="fixed bottom-6 left-6 z-40 h-14 w-14 rounded-full bg-teal-500 text-[#062344] shadow-xl shadow-teal-950/30 transition hover:bg-teal-300 focus-visible:ring-2 focus-visible:ring-teal-200"
        aria-label="فتح المساعد المالي"
        data-testid="button-financial-assistant"
      >
        <Bot className="h-7 w-7" aria-hidden="true" />
      </Button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="left"
          dir="rtl"
          className="flex w-[380px] max-w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden border-slate-200 bg-slate-50 p-0 sm:max-w-[380px]"
          data-testid="financial-assistant-drawer"
        >
          <SheetHeader className="border-b border-slate-200 bg-white px-5 pb-4 pt-6 text-right sm:text-right">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-teal-100 text-teal-700">
                <Sparkles className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <SheetTitle className="text-base font-black text-slate-900">المساعد المالي</SheetTitle>
                <SheetDescription className="mt-1 text-xs text-slate-500">تحليل سريع لبيانات منشأتك</SheetDescription>
              </div>
            </div>
          </SheetHeader>

          <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5" aria-live="polite">
            <div className="rounded-2xl border border-teal-100 bg-teal-50 px-4 py-3 text-xs leading-6 text-teal-900">
              يعتمد المساعد على القيود المرحلة والذمم المسجلة في منشأتك.
            </div>
            {messages.map((message) => (
              <div key={message.id} className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-7 shadow-sm ${
                    message.role === 'user'
                      ? 'rounded-br-md bg-[#062344] text-white'
                      : 'rounded-bl-md border border-slate-200 bg-white text-slate-700'
                  }`}
                  data-testid={`assistant-message-${message.role}`}
                >
                  {formatMessage(message.content)}
                </div>
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">
                  <LoaderCircle className="h-4 w-4 animate-spin text-teal-600" aria-hidden="true" />
                  جارٍ تحليل بياناتك...
                </div>
              </div>
            )}
            {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs leading-6 text-red-700">{error}</div>}
            <div ref={messagesEndRef} />
          </div>

          {messages.length === 1 && (
            <div className="border-t border-slate-200 bg-white px-4 py-3">
              <p className="mb-2 text-[11px] font-bold text-slate-400">أسئلة مقترحة</p>
              <div className="flex flex-wrap gap-2">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => void sendQuestion(undefined, suggestion)}
                    className="rounded-full border border-teal-200 bg-teal-50 px-3 py-1.5 text-[11px] font-semibold text-teal-800 transition hover:bg-teal-100 disabled:opacity-50"
                    disabled={isLoading}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          )}

          <form onSubmit={(event) => void sendQuestion(event)} className="border-t border-slate-200 bg-white p-4">
            <div className="flex items-end gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2 focus-within:border-teal-400 focus-within:ring-2 focus-within:ring-teal-100">
              <Textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                placeholder="اكتب سؤالك المالي..."
                className="min-h-10 resize-none border-0 bg-transparent px-2 py-2 text-sm shadow-none focus-visible:ring-0"
                rows={1}
                maxLength={2000}
                aria-label="سؤالك المالي"
                data-testid="input-financial-question"
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void sendQuestion();
                  }
                }}
              />
              <Button
                type="submit"
                size="icon"
                disabled={!question.trim() || isLoading}
                className="h-10 w-10 shrink-0 rounded-xl bg-teal-500 text-[#062344] hover:bg-teal-300"
                aria-label="إرسال السؤال"
                data-testid="button-send-financial-question"
              >
                {isLoading ? <LoaderCircle className="animate-spin" /> : <Send className="rotate-180" />}
              </Button>
            </div>
            <p className="mt-2 text-center text-[10px] text-slate-400">المساعد يقدم تحليلاً إرشادياً وليس بديلاً عن المراجعة المحاسبية.</p>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}