import React, { useEffect, useMemo, useState } from 'react';
import type { Journal, Account, JournalLine } from '@/context/store';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertCircle, ArrowLeftRight, Calendar, CheckCircle2, FileText, Info, LoaderCircle, Plus, Trash2 } from 'lucide-react';
import { todayLocalDate } from '@/lib/date';

export type JournalAdjustmentInput = {
  date: string;
  reason: string;
  description?: string;
  lines?: Array<Omit<JournalLine, 'id'>>;
};

type JournalAdjustmentDialogProps = {
  open: boolean;
  mode: 'reverse' | 'correct';
  journal: Journal | null;
  accounts: Account[];
  isSubmitting: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: JournalAdjustmentInput) => void;
};

const today = todayLocalDate;
const money = (amount: number) => new Intl.NumberFormat('ar-SA', { minimumFractionDigits: 2 }).format(amount);

export function JournalAdjustmentDialog({
  open,
  mode,
  journal,
  accounts,
  isSubmitting,
  onOpenChange,
  onSubmit,
}: JournalAdjustmentDialogProps) {
  const [date, setDate] = useState(today);
  const [reason, setReason] = useState('');
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<Array<Omit<JournalLine, 'id'>>>([]);

  const activeAccounts = useMemo(
    () => accounts.filter((account) => account.status === 'active').sort((left, right) => left.code.localeCompare(right.code, 'en')),
    [accounts]
  );

  useEffect(() => {
    if (open && journal) {
      setDate(today());
      setReason('');
      if (mode === 'correct') {
        setDescription(journal.description);
        setLines(journal.lines.map((line) => ({ accountId: line.accountId, debit: line.debit, credit: line.credit })));
      } else {
        setDescription('');
        setLines(journal.lines.map((line) => ({ accountId: line.accountId, debit: line.credit, credit: line.debit })));
      }
    }
  }, [open, journal, mode]);

  const addLine = () => setLines((current) => [...current, { accountId: '', debit: 0, credit: 0 }]);
  
  const removeLine = (index: number) => setLines((current) => current.length > 2 ? current.filter((_, lineIndex) => lineIndex !== index) : current);
  
  const updateLine = (index: number, field: keyof Omit<JournalLine, 'id'>, value: string | number) => {
    setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, [field]: value } : line));
  };

  const totalDebit = lines.reduce((sum, line) => sum + (Number(line.debit) || 0), 0);
  const totalCredit = lines.reduce((sum, line) => sum + (Number(line.credit) || 0), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) <= 0.005 && totalDebit > 0;
  const linesAreValid = lines.length >= 2 && lines.every((line) => Boolean(line.accountId) && Number(line.debit) >= 0 && Number(line.credit) >= 0 && ((Number(line.debit) > 0) !== (Number(line.credit) > 0)));

  const canSubmit = useMemo(() => {
    if (!date || !reason.trim()) return false;
    if (mode === 'correct') {
      return Boolean(description.trim() && linesAreValid && isBalanced);
    }
    return true;
  }, [date, reason, description, linesAreValid, isBalanced, mode]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit || isSubmitting) return;

    if (mode === 'reverse') {
      onSubmit({ date, reason: reason.trim() });
    } else {
      onSubmit({ date, reason: reason.trim(), description: description.trim(), lines });
    }
  };

  if (!journal) return null;

  const isReverse = mode === 'reverse';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" data-testid="dialog-journal-adjustment">
        <DialogHeader>
          <DialogTitle className="text-xl flex items-center gap-2 text-slate-900">
            {isReverse ? <ArrowLeftRight className="h-5 w-5 text-amber-600" /> : <FileText className="h-5 w-5 text-blue-600" />}
            {isReverse ? `عكس القيد ${journal.number}` : `تصحيح القيد ${journal.number}`}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-6 mt-4" noValidate>
          <div className="rounded-md bg-slate-50 border border-slate-200 p-4 flex gap-3 items-start text-sm text-slate-700 leading-relaxed shadow-sm">
            <Info className="h-5 w-5 text-slate-500 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-slate-900 block mb-1">تنبيه متعلق بالشفافية المالية</span>
              وفقاً للمعايير المحاسبية، لن يتم تعديل أو حذف القيد الأصلي. سيتم إنشاء قيد جديد مرتبط به لتحقيق أثر {isReverse ? 'العكس' : 'التصحيح'} مع الاحتفاظ بسجل التدقيق الكامل.
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="adj-date" className="text-sm font-semibold">تاريخ سريان {isReverse ? 'العكس' : 'التصحيح'}</Label>
              <div className="relative">
                <Input type="date" id="adj-date" value={date} onChange={(e) => setDate(e.target.value)} className="pl-10" required data-testid="input-adjustment-date" />
                <Calendar className="absolute left-3 top-2.5 h-4 w-4 text-slate-400 pointer-events-none" />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="adj-reason" className="text-sm font-semibold">سبب {isReverse ? 'العكس' : 'التصحيح'} (داخلي)</Label>
              <Input id="adj-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="مثال: إدخال خاطئ للمبلغ" required data-testid="input-adjustment-reason" />
            </div>

            {!isReverse && (
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="adj-desc" className="text-sm font-semibold">البيان الجديد للقيد (يظهر في السجلات)</Label>
                <div className="relative">
                  <Input id="adj-desc" value={description} onChange={(e) => setDescription(e.target.value)} className="pl-10" placeholder="وصف تفصيلي للعملية المصححة" required data-testid="input-adjustment-desc" />
                  <FileText className="absolute left-3 top-2.5 h-4 w-4 text-slate-400 pointer-events-none" />
                </div>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50/50 p-4 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <Label className="text-base font-bold text-slate-900">{isReverse ? 'أطراف القيد المعكوسة (للمعاينة فقط)' : 'أطراف القيد (قابلة للتعديل)'}</Label>
            </div>
            
            <div className="overflow-x-auto rounded-md border border-slate-200 bg-white shadow-sm">
              <Table>
                <TableHeader className="bg-slate-100/50">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-12 text-center text-xs">#</TableHead>
                    <TableHead className="font-semibold">الحساب</TableHead>
                    <TableHead className="w-40 font-semibold text-center">مدين (له)</TableHead>
                    <TableHead className="w-40 font-semibold text-center">دائن (منه)</TableHead>
                    {!isReverse && <TableHead className="w-12 text-center" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line, index) => {
                    const account = accounts.find((a) => a.id === line.accountId);
                    return (
                      <TableRow key={index} className="group hover:bg-slate-50/50">
                        <TableCell className="p-2 text-center text-xs font-mono text-slate-400">{index + 1}</TableCell>
                        <TableCell className="p-2">
                          {isReverse ? (
                            <div className="flex h-9 w-full items-center rounded-md border border-slate-200 bg-slate-50 px-3 py-1 text-sm text-slate-600 font-medium">
                              {account ? `${account.code} - ${account.name}` : '—'}
                            </div>
                          ) : (
                            <select value={line.accountId} onChange={(event) => updateLine(index, 'accountId', event.target.value)} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring font-medium" required data-testid={`select-adj-account-${index}`}>
                              <option value="" disabled>اختر الحساب...</option>
                              {activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.code} - {account.name}</option>)}
                            </select>
                          )}
                        </TableCell>
                        <TableCell className="p-2">
                          {isReverse ? (
                            <div className="flex h-9 w-full items-center justify-center rounded-md border border-slate-200 bg-emerald-50/50 px-3 py-1 font-mono text-sm text-emerald-700">
                              {line.debit > 0 ? money(line.debit) : '—'}
                            </div>
                          ) : (
                            <Input type="number" min="0" step="0.01" value={line.debit || ''} onChange={(event) => updateLine(index, 'debit', Math.max(0, Number(event.target.value) || 0))} disabled={line.credit > 0} className="font-mono text-center placeholder:text-slate-300 focus:bg-emerald-50 focus:border-emerald-200 disabled:opacity-30 disabled:bg-slate-50" placeholder="0.00" data-testid={`input-adj-debit-${index}`} />
                          )}
                        </TableCell>
                        <TableCell className="p-2">
                          {isReverse ? (
                            <div className="flex h-9 w-full items-center justify-center rounded-md border border-slate-200 bg-amber-50/50 px-3 py-1 font-mono text-sm text-amber-700">
                              {line.credit > 0 ? money(line.credit) : '—'}
                            </div>
                          ) : (
                            <Input type="number" min="0" step="0.01" value={line.credit || ''} onChange={(event) => updateLine(index, 'credit', Math.max(0, Number(event.target.value) || 0))} disabled={line.debit > 0} className="font-mono text-center placeholder:text-slate-300 focus:bg-amber-50 focus:border-amber-200 disabled:opacity-30 disabled:bg-slate-50" placeholder="0.00" data-testid={`input-adj-credit-${index}`} />
                          )}
                        </TableCell>
                        {!isReverse && (
                          <TableCell className="p-2 text-center">
                            <Button type="button" variant="ghost" size="icon" onClick={() => removeLine(index)} disabled={lines.length <= 2} className="h-8 w-8 text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50" aria-label="حذف السطر">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        )}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="mt-4 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
              {!isReverse ? (
                <Button type="button" variant="outline" size="sm" onClick={addLine} className="border-dashed border-slate-300 text-slate-600 hover:text-primary hover:border-primary/50" data-testid="button-adj-add-line">
                  <Plus className="ml-1 h-3.5 w-3.5" />
                  إضافة طرف جديد
                </Button>
              ) : <div />}
              
              <div className="flex flex-col gap-2 rounded-md bg-white p-3 border border-slate-200 shadow-sm sm:flex-row sm:items-center sm:gap-6 min-w-[300px]" aria-live="polite">
                <div className="flex justify-between items-center gap-4 sm:flex-col sm:items-start sm:gap-1">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">إجمالي المدين</span>
                  <span className="font-mono text-lg font-bold text-emerald-600">{money(totalDebit)}</span>
                </div>
                <div className="hidden sm:block w-px h-10 bg-slate-200"></div>
                <div className="flex justify-between items-center gap-4 sm:flex-col sm:items-start sm:gap-1">
                  <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">إجمالي الدائن</span>
                  <span className="font-mono text-lg font-bold text-amber-600">{money(totalCredit)}</span>
                </div>
              </div>
            </div>

            {!isReverse && !isBalanced && totalDebit > 0 && totalCredit > 0 && (
              <div className="mt-4 flex items-start gap-2 rounded-md bg-red-50 p-3 text-red-700 text-sm border border-red-100" role="alert">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <p className="font-medium">القيد غير متزن. الفرق: <span className="font-mono font-bold" dir="ltr">{money(Math.abs(totalDebit - totalCredit))}</span>. لن يمكنك حفظ القيد حتى يتساوى الطرفان.</p>
              </div>
            )}
          </div>

          <DialogFooter className="mt-8 pt-4 border-t">
            <DialogClose asChild><Button type="button" variant="ghost" disabled={isSubmitting}>إلغاء</Button></DialogClose>
            <Button type="submit" disabled={!canSubmit || isSubmitting} className="min-w-[140px]" data-testid="button-submit-adjustment">
              {isSubmitting ? <LoaderCircle className="ml-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="ml-2 h-4 w-4" />}
              {isSubmitting ? 'جارٍ الحفظ...' : (isReverse ? 'اعتماد قيد العكس' : 'اعتماد قيد التصحيح')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
