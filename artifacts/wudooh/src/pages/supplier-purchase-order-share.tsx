import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertCircle, CheckCircle2, Clock3, FileCheck2, LoaderCircle, XCircle } from 'lucide-react';
import { useParams } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { trackEvent } from '@/lib/analytics';

type PublicItem = {
  productName: string;
  quantity: number;
  unitCost: number;
  vatRate: number;
  lineNet: number;
  vatAmount: number;
  total: number;
};

type PublicDocument = {
  orderNumber: string;
  supplierName: string;
  warehouseName: string;
  issueDate: string;
  expectedDate?: string;
  status: string;
  items: PublicItem[];
  subtotal: number;
  vat: number;
  total: number;
  notes: string;
};

type SharePayload = {
  status: 'pending' | 'confirmed' | 'rejected';
  expiresAt: string;
  decidedAt: string | null;
  decisionNote: string;
};

const statusLabels: Record<string, string> = {
  draft: 'مسودة',
  sent: 'مرسل',
  partial: 'مستلم جزئياً',
  received: 'مكتمل',
  cancelled: 'ملغي',
};

const decisionLabels: Record<SharePayload['status'], string> = {
  pending: 'بانتظار قرارك',
  confirmed: 'تم تأكيد الأمر',
  rejected: 'تم رفض الأمر',
};

const formatCurrency = (value: number) => new Intl.NumberFormat('ar-SA', {
  style: 'currency',
  currency: 'SAR',
}).format(Number(value) || 0);

const formatDate = (value?: string) => {
  if (!value) return '-';
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('ar-SA-u-ca-gregory', { dateStyle: 'medium' }).format(date);
};

const formatDateTime = (value?: string | null) => {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('ar-SA-u-ca-gregory', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
};

export default function SupplierPurchaseOrderShare() {
  const params = useParams<{ token: string }>();
  const token = useMemo(() => params.token?.trim() ?? '', [params.token]);
  const [document, setDocument] = useState<PublicDocument | null>(null);
  const [share, setShare] = useState<SharePayload | null>(null);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!token) {
        setError('رابط أمر الشراء غير مكتمل أو غير صالح.');
        setLoading(false);
        return;
      }
      try {
        const response = await fetch(`/api/purchase-order-shares/${encodeURIComponent(token)}`, {
          credentials: 'omit',
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'رابط أمر الشراء غير صالح أو منتهي.');
        if (!active) return;
        setDocument(payload.document as PublicDocument);
        setShare(payload.share as SharePayload);
        setNote(payload.share?.decisionNote || '');
        trackEvent('supplier_share_opened', { source: 'supplier_share_link' });
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'تعذر تحميل أمر الشراء.');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [token]);

  const submitDecision = async (decision: 'confirmed' | 'rejected') => {
    if (!token || !share || share.status !== 'pending') return;
    setSubmitting(true);
    setError('');
    try {
      const response = await fetch(`/api/purchase-order-shares/${encodeURIComponent(token)}/decision`, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, note: note.trim() }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'تعذر تسجيل قرارك.');
      setShare((current) => current
        ? {
            ...current,
            status: payload.decision.status,
            decisionNote: payload.decision.note || '',
            decidedAt: payload.decision.decidedAt || null,
          }
        : current);
      if (payload.document) setDocument(payload.document as PublicDocument);
       trackEvent('supplier_share_decision', {
         decision,
         source: 'supplier_share_link',
       });
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'تعذر تسجيل قرارك.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4" dir="rtl">
        <LoaderCircle className="h-8 w-8 animate-spin text-indigo-600" aria-label="جارٍ التحميل" />
      </main>
    );
  }

  if (error || !document || !share) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10" dir="rtl">
        <Card className="w-full max-w-lg border-rose-200 shadow-lg">
          <CardContent className="flex flex-col items-center gap-4 p-8 text-center">
            <AlertCircle className="h-12 w-12 text-rose-600" aria-hidden="true" />
            <h1 className="text-xl font-black text-slate-900">تعذر فتح أمر الشراء</h1>
            <p className="text-sm leading-7 text-slate-600">{error || 'رابط أمر الشراء غير صالح أو منتهي.'}</p>
          </CardContent>
        </Card>
      </main>
    );
  }

  const hasDecision = share.status !== 'pending';
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,#eef2ff,transparent_42%),#f8fafc] px-4 py-8 sm:py-12" dir="rtl">
      <div className="mx-auto max-w-4xl space-y-5">
        <header className="flex items-center gap-3 px-1">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-600/20">
            <FileCheck2 className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <p className="text-sm font-bold text-indigo-600">ترصيد</p>
            <p className="text-xs text-slate-500">رابط اعتماد آمن للمورد</p>
          </div>
        </header>

        <Card className="overflow-hidden border-slate-200 shadow-xl shadow-slate-900/5">
          <CardHeader className="border-b border-slate-100 bg-white p-6 sm:p-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardDescription className="mb-2 font-semibold text-slate-500">أمر شراء</CardDescription>
                <CardTitle className="text-2xl font-black text-slate-950 sm:text-3xl">{document.orderNumber}</CardTitle>
                <p className="mt-2 text-sm text-slate-600">مرحباً {document.supplierName}، راجع تفاصيل الأمر ثم سجّل قرارك.</p>
              </div>
              <div className={`inline-flex items-center gap-2 self-start rounded-full px-3 py-2 text-sm font-bold ${hasDecision ? share.status === 'confirmed' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>
                {hasDecision ? share.status === 'confirmed' ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
                {decisionLabels[share.status]}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-7 p-6 sm:p-8">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-xs font-semibold text-slate-500">تاريخ الإصدار</p>
                <p className="mt-1 font-bold text-slate-900">{formatDate(document.issueDate)}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-xs font-semibold text-slate-500">التسليم المتوقع</p>
                <p className="mt-1 font-bold text-slate-900">{formatDate(document.expectedDate)}</p>
              </div>
              <div className="rounded-xl bg-slate-50 p-4">
                <p className="text-xs font-semibold text-slate-500">حالة الأمر</p>
                <p className="mt-1 font-bold text-slate-900">{statusLabels[document.status] || document.status}</p>
              </div>
            </div>

            <div>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-black text-slate-900">الأصناف والكميات</h2>
                <span className="text-sm text-slate-500">{document.warehouseName || 'موقع التسليم غير محدد'}</span>
              </div>
              <div className="overflow-x-auto rounded-2xl border border-slate-200">
                <table className="w-full min-w-[620px] text-right text-sm">
                  <thead className="bg-slate-900 text-white">
                    <tr>
                      <th className="px-4 py-3 font-bold">الصنف</th>
                      <th className="px-4 py-3 font-bold">الكمية</th>
                      <th className="px-4 py-3 font-bold">سعر الوحدة</th>
                      <th className="px-4 py-3 font-bold">الضريبة</th>
                      <th className="px-4 py-3 font-bold">الإجمالي</th>
                    </tr>
                  </thead>
                  <tbody>
                    {document.items.map((item, index) => (
                      <tr key={`${item.productName}-${index}`} className="border-t border-slate-100">
                        <td className="px-4 py-3 font-semibold text-slate-900">{item.productName}</td>
                        <td className="px-4 py-3 text-slate-700">{item.quantity}</td>
                        <td className="px-4 py-3 text-slate-700">{formatCurrency(item.unitCost)}</td>
                        <td className="px-4 py-3 text-slate-700">{item.vatRate}%</td>
                        <td className="px-4 py-3 font-bold text-slate-900">{formatCurrency(item.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex justify-end">
              <div className="w-full max-w-sm space-y-3 rounded-2xl bg-slate-950 p-5 text-white">
                <div className="flex justify-between text-sm text-slate-300"><span>المجموع الفرعي</span><span>{formatCurrency(document.subtotal)}</span></div>
                <div className="flex justify-between text-sm text-slate-300"><span>ضريبة القيمة المضافة</span><span>{formatCurrency(document.vat)}</span></div>
                <div className="flex justify-between border-t border-slate-700 pt-3 text-lg font-black"><span>الإجمالي الكلي</span><span>{formatCurrency(document.total)}</span></div>
              </div>
            </div>

            {document.notes && (
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-4 text-sm leading-7 text-slate-700">
                <span className="font-bold text-slate-900">ملاحظات:</span> {document.notes}
              </div>
            )}

            {hasDecision ? (
              <div className={`rounded-2xl border p-5 ${share.status === 'confirmed' ? 'border-emerald-200 bg-emerald-50' : 'border-rose-200 bg-rose-50'}`}>
                <p className="font-black text-slate-900">{decisionLabels[share.status]}</p>
                <p className="mt-1 text-sm text-slate-600">تم تسجيل القرار في {formatDateTime(share.decidedAt)}.</p>
                {share.decisionNote && <p className="mt-3 rounded-xl bg-white/70 p-3 text-sm text-slate-700"><span className="font-bold">ملاحظتك:</span> {share.decisionNote}</p>}
              </div>
            ) : (
              <form
                className="space-y-4 rounded-2xl border border-indigo-100 bg-indigo-50/50 p-5 sm:p-6"
                onSubmit={(event: FormEvent<HTMLFormElement>) => {
                  event.preventDefault();
                  void submitDecision('confirmed');
                }}
              >
                <div>
                  <h2 className="text-lg font-black text-slate-900">تسجيل قرار المورد</h2>
                  <p className="mt-1 text-sm text-slate-600">يمكنك إضافة ملاحظة اختيارية قبل التأكيد أو الرفض.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="supplier-decision-note">ملاحظة (اختيارية)</Label>
                  <Textarea id="supplier-decision-note" value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)} placeholder="أضف ملاحظة أو شرطاً متعلقاً بالأمر..." rows={4} />
                </div>
                {error && <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700" role="alert">{error}</p>}
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button type="submit" disabled={submitting} className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700" data-testid="supplier-share-confirm">
                    {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    تأكيد أمر الشراء
                  </Button>
                  <Button type="button" disabled={submitting} variant="outline" className="gap-2 border-rose-200 text-rose-700 hover:bg-rose-50" onClick={() => void submitDecision('rejected')} data-testid="supplier-share-reject">
                    <XCircle className="h-4 w-4" /> رفض الأمر
                  </Button>
                </div>
              </form>
            )}

            <p className="flex items-center gap-2 text-xs text-slate-500">
              <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
              ينتهي هذا الرابط في {formatDateTime(share.expiresAt)}. لا تشارك الرابط مع أي طرف غير مخوّل.
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
