import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { useStore } from '@/context/store';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { todayLocalDate } from '@/lib/date';

type SourceAction = 'cancel' | 'correct';
type SourceField = {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'select';
  options?: { label: string; value: string | number }[];
  required?: boolean;
};

type SourceDocumentAdjustmentDialogProps = {
  open: boolean;
  action: SourceAction;
  table: 'invoices' | 'purchaseOrders' | 'expenses';
  item: Record<string, unknown> | null;
  fields: SourceField[];
  onOpenChange: (open: boolean) => void;
  onCompleted: () => Promise<void> | void;
};

const today = todayLocalDate;

export function SourceDocumentAdjustmentDialog({
  open,
  action,
  table,
  item,
  fields,
  onOpenChange,
  onCompleted,
}: SourceDocumentAdjustmentDialogProps) {
  const { currentUser } = useStore();
  const { toast } = useToast();
  const [reason, setReason] = useState('');
  const [effectiveDate, setEffectiveDate] = useState(today);
  const [replacement, setReplacement] = useState<Record<string, unknown>>({});
  const [operationId, setOperationId] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const correctionFields = fields.filter((field) => field.key !== 'status');

  useEffect(() => {
    if (!open || !item) return;
    setReason('');
    setEffectiveDate(String(item.issueDate ?? item.date ?? today()).slice(0, 10));
    setReplacement(Object.fromEntries(correctionFields.map((field) => [field.key, item[field.key] ?? ''])));
    setOperationId(crypto.randomUUID());
  }, [open, item]);

  const title = action === 'cancel' ? 'إلغاء المستند من المصدر' : 'تصحيح المستند من المصدر';
  const canSubmit = Boolean(currentUser && item && operationId && reason.trim().length >= 3 && effectiveDate);

  const submit = async () => {
    if (!canSubmit || !currentUser || !item || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/accounting/sources/${table}/${String(item.id)}/${action}`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': operationId,
          'X-Wudooh-Data-Generation': String(currentUser.dataGeneration),
        },
        body: JSON.stringify({
          reason: reason.trim(),
          effectiveDate,
          ...(action === 'correct' ? { replacement } : {}),
        }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        if (response.status === 409 && payload.error?.includes('تغيّرت بيانات المنشأة')) {
          window.dispatchEvent(new Event('wudooh:stale-data-generation'));
        }
        throw new Error(payload.error ?? 'تعذر إتمام العملية.');
      }
      await onCompleted();
      toast({
        title: action === 'cancel' ? 'تم إلغاء المستند' : 'تم تصحيح المستند',
        description: action === 'cancel'
          ? 'عُكست آثاره المحاسبية والمخزنية وحُفظ سجل التدقيق.'
          : 'أُنشئ قيد العكس والقيد المصحح وحُدّثت الآثار التابعة.',
      });
      onOpenChange(false);
    } catch (error) {
      toast({
        title: action === 'cancel' ? 'تعذر إلغاء المستند' : 'تعذر تصحيح المستند',
        description: error instanceof Error ? error.message : 'تعذر إتمام العملية. أعد المحاولة.',
        variant: 'destructive',
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!isSubmitting) onOpenChange(nextOpen); }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl" data-testid="dialog-source-adjustment">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            لن يتغير القيد المرحّل الأصلي. ستُنشأ قيود مترابطة ويُحدّث المخزون والذمم في عملية واحدة.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="source-adjustment-date">تاريخ الإلغاء أو التصحيح</Label>
            <Input id="source-adjustment-date" type="date" value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} required data-testid="input-source-adjustment-date" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="source-adjustment-reason">السبب</Label>
            <Textarea id="source-adjustment-reason" value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={1000} required placeholder="اكتب سبباً واضحاً يحفظ في سجل التدقيق" data-testid="input-source-adjustment-reason" />
          </div>
          {action === 'correct' && (
            <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-bold text-slate-800">بيانات المستند المصححة</p>
              {correctionFields.map((field) => (
                <div key={field.key} className="space-y-2">
                  <Label htmlFor={`source-correction-${field.key}`}>{field.label}</Label>
                  {field.type === 'select' ? (
                    <select
                      id={`source-correction-${field.key}`}
                      className="flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
                      value={String(replacement[field.key] ?? '')}
                      onChange={(event) => setReplacement((current) => ({ ...current, [field.key]: event.target.value }))}
                      required={field.required}
                      data-testid={`input-source-correction-${field.key}`}
                    >
                      <option value="">اختر {field.label}</option>
                      {field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    </select>
                  ) : (
                    <Input
                      id={`source-correction-${field.key}`}
                      type={field.type ?? 'text'}
                      value={String(replacement[field.key] ?? '')}
                      onChange={(event) => setReplacement((current) => ({
                        ...current,
                        [field.key]: field.type === 'number' ? Number(event.target.value) : event.target.value,
                      }))}
                      required={field.required}
                      data-testid={`input-source-correction-${field.key}`}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>رجوع</Button>
          <Button
            type="button"
            variant={action === 'cancel' ? 'destructive' : 'default'}
            onClick={() => void submit()}
            disabled={!canSubmit || isSubmitting}
            data-testid="button-submit-source-adjustment"
          >
            {isSubmitting && <LoaderCircle className="h-4 w-4 animate-spin" />}
            {action === 'cancel' ? 'تأكيد الإلغاء' : 'حفظ التصحيح'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}