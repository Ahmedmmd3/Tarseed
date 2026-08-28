import React, { useMemo, useState } from 'react';
import { useStore, JournalLine } from '@/context/store';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Search, Trash2, Calendar, FileText, CheckCircle2, AlertCircle } from 'lucide-react';

type JournalStatusFilter = 'all' | 'draft' | 'posted';

const today = () => new Date().toISOString().split('T')[0];
const money = (amount: number) => new Intl.NumberFormat('ar-SA', { minimumFractionDigits: 2 }).format(amount);

export default function Journals() {
  const { journals, accounts, addJournal, postJournal } = useStore();
  const { toast } = useToast();
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [statusFilter, setStatusFilter] = useState<JournalStatusFilter>('all');
  const [search, setSearch] = useState('');
  const [date, setDate] = useState(today);
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<Omit<JournalLine, 'id'>[]>([
    { accountId: '', debit: 0, credit: 0 },
    { accountId: '', debit: 0, credit: 0 },
  ]);

  const activeAccounts = useMemo(() => accounts.filter((account) => account.status === 'active').sort((left, right) => left.code.localeCompare(right.code, 'en')), [accounts]);
  const filteredJournals = useMemo(() => journals
    .filter((journal) => (!fromDate || journal.date >= fromDate) && (!toDate || journal.date <= toDate))
    .filter((journal) => statusFilter === 'all' || journal.status === statusFilter)
    .filter((journal) => !search.trim() || journal.number.toLocaleLowerCase('ar').includes(search.trim().toLocaleLowerCase('ar')) || journal.description.toLocaleLowerCase('ar').includes(search.trim().toLocaleLowerCase('ar')))
    .sort((left, right) => right.date.localeCompare(left.date) || right.number.localeCompare(left.number, 'en')), [fromDate, journals, search, statusFilter, toDate]);

  const addLine = () => setLines((current) => [...current, { accountId: '', debit: 0, credit: 0 }]);
  const removeLine = (index: number) => setLines((current) => current.length > 2 ? current.filter((_, lineIndex) => lineIndex !== index) : current);
  const updateLine = (index: number, field: keyof Omit<JournalLine, 'id'>, value: string | number) => {
    setLines((current) => current.map((line, lineIndex) => lineIndex === index ? { ...line, [field]: value } : line));
  };

  const totalDebit = lines.reduce((sum, line) => sum + (Number(line.debit) || 0), 0);
  const totalCredit = lines.reduce((sum, line) => sum + (Number(line.credit) || 0), 0);
  const isBalanced = Math.abs(totalDebit - totalCredit) <= 0.005 && totalDebit > 0;
  const linesAreValid = lines.length >= 2 && lines.every((line) => Boolean(line.accountId) && Number(line.debit) >= 0 && Number(line.credit) >= 0 && ((Number(line.debit) > 0) !== (Number(line.credit) > 0)));
  const canSubmit = Boolean(description.trim() && date && linesAreValid && isBalanced);

  const resetForm = () => {
    setDate(today());
    setDescription('');
    setLines([{ accountId: '', debit: 0, credit: 0 }, { accountId: '', debit: 0, credit: 0 }]);
  };

  const handleAddSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) {
      toast({ title: 'القيد غير مكتمل', description: 'تأكد من اختيار الحسابات وإدخال مبلغ في أحد الطرفين لكل سطر، ثم ساوِ إجمالي المدين بالدائن.', variant: 'destructive' });
      return;
    }
    try {
      await addJournal({ date, description: description.trim(), status: 'draft', lines: lines.map((line, index) => ({ ...line, id: `temp-${index}` })) });
      toast({ title: 'تم حفظ القيد', description: 'حُفظ القيد كمسودة ويمكن ترحيله بعد المراجعة.' });
      setIsAddOpen(false);
      resetForm();
    } catch (error) {
      toast({ title: 'تعذر حفظ القيد', description: error instanceof Error ? error.message : 'تعذر حفظ القيد. أعد المحاولة.', variant: 'destructive' });
    }
  };

  const handlePostJournal = async (id: string) => {
    try {
      await postJournal(id);
      toast({ title: 'تم ترحيل القيد', description: 'أصبح القيد معتمداً ضمن السجل المحاسبي.' });
    } catch (error) {
      toast({ title: 'تعذر ترحيل القيد', description: error instanceof Error ? error.message : 'تعذر ترحيل القيد. أعد المحاولة.', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-6" data-testid="page-journals">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">القيود اليومية</h2>
          <p className="mt-1 text-sm text-slate-500">تسجيل وتوثيق الحركات المالية بنظام القيد المزدوج.</p>
        </div>
        <Dialog open={isAddOpen} onOpenChange={(open) => { setIsAddOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button onClick={() => { resetForm(); setIsAddOpen(true); }} className="shadow-sm" data-testid="button-add-journal">
              <Plus className="ml-2 h-4 w-4" />
              قيد يومية جديد
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="text-xl">إضافة قيد يومية</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleAddSubmit} className="space-y-5 py-4" noValidate>
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="date" className="text-sm font-semibold">التاريخ</Label>
                  <div className="relative">
                    <Input type="date" id="date" value={date} onChange={(event) => setDate(event.target.value)} className="pl-10" required data-testid="input-journal-date" />
                    <Calendar className="absolute left-3 top-2.5 h-4 w-4 text-slate-400 pointer-events-none" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="desc" className="text-sm font-semibold">البيان / الشرح</Label>
                  <div className="relative">
                    <Input id="desc" value={description} onChange={(event) => setDescription(event.target.value)} className="pl-10" placeholder="وصف تفصيلي للعملية" required data-testid="input-journal-desc" />
                    <FileText className="absolute left-3 top-2.5 h-4 w-4 text-slate-400 pointer-events-none" />
                  </div>
                </div>
              </div>
              
              <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50/50 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <Label className="text-base font-bold text-slate-900">أطراف القيد</Label>
                  <span className="text-xs font-medium text-slate-500">اختر حساباً لكل سطر مع تحديد قيمته مدينة أو دائنة</span>
                </div>
                <div className="overflow-x-auto rounded-md border border-slate-200 bg-white shadow-sm">
                  <Table>
                    <TableHeader className="bg-slate-100/50">
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="w-12 text-center text-xs">#</TableHead>
                        <TableHead className="font-semibold">الحساب</TableHead>
                        <TableHead className="w-40 font-semibold text-center">مدين (له)</TableHead>
                        <TableHead className="w-40 font-semibold text-center">دائن (منه)</TableHead>
                        <TableHead className="w-12 text-center" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lines.map((line, index) => (
                        <TableRow key={index} className="group hover:bg-slate-50/50">
                          <TableCell className="p-2 text-center text-xs font-mono text-slate-400">{index + 1}</TableCell>
                          <TableCell className="p-2">
                            <select value={line.accountId} onChange={(event) => updateLine(index, 'accountId', event.target.value)} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring font-medium" required data-testid={`select-journal-account-${index}`}>
                              <option value="" disabled>اختر الحساب...</option>
                              {activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.code} - {account.name}</option>)}
                            </select>
                          </TableCell>
                          <TableCell className="p-2">
                            <Input type="number" min="0" step="0.01" value={line.debit || ''} onChange={(event) => updateLine(index, 'debit', Math.max(0, Number(event.target.value) || 0))} disabled={line.credit > 0} className="font-mono text-center placeholder:text-slate-300 focus:bg-emerald-50 focus:border-emerald-200 disabled:opacity-30 disabled:bg-slate-50" placeholder="0.00" data-testid={`input-journal-debit-${index}`} />
                          </TableCell>
                          <TableCell className="p-2">
                            <Input type="number" min="0" step="0.01" value={line.credit || ''} onChange={(event) => updateLine(index, 'credit', Math.max(0, Number(event.target.value) || 0))} disabled={line.debit > 0} className="font-mono text-center placeholder:text-slate-300 focus:bg-amber-50 focus:border-amber-200 disabled:opacity-30 disabled:bg-slate-50" placeholder="0.00" data-testid={`input-journal-credit-${index}`} />
                          </TableCell>
                          <TableCell className="p-2 text-center">
                            <Button type="button" variant="ghost" size="icon" onClick={() => removeLine(index)} disabled={lines.length <= 2} className="h-8 w-8 text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50" aria-label="حذف السطر">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                
                <div className="mt-4 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                  <Button type="button" variant="outline" size="sm" onClick={addLine} className="border-dashed border-slate-300 text-slate-600 hover:text-primary hover:border-primary/50" data-testid="button-add-line">
                    <Plus className="ml-1 h-3.5 w-3.5" />
                    إضافة طرف جديد
                  </Button>
                  
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
                
                {!isBalanced && totalDebit > 0 && totalCredit > 0 && (
                  <div className="mt-4 flex items-start gap-2 rounded-md bg-red-50 p-3 text-red-700 text-sm border border-red-100" role="alert">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    <p className="font-medium">القيد غير متزن. الفرق: <span className="font-mono font-bold" dir="ltr">{money(Math.abs(totalDebit - totalCredit))}</span>. لن يمكنك حفظ القيد حتى يتساوى الطرفان.</p>
                  </div>
                )}
              </div>
              
              <DialogFooter className="mt-8 pt-4 border-t">
                <DialogClose asChild><Button type="button" variant="ghost">إلغاء</Button></DialogClose>
                <Button type="submit" disabled={!canSubmit} className="min-w-[120px]" data-testid="button-submit-journal">
                  {canSubmit ? <CheckCircle2 className="ml-2 h-4 w-4" /> : null}
                  حفظ القيد
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="border-slate-200 shadow-sm overflow-hidden">
        <div className="border-b border-slate-100 bg-slate-50/50 p-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div className="relative md:col-span-2">
              <Search className="absolute right-3 top-2.5 h-4 w-4 text-slate-400" />
              <Input className="pr-9 bg-white shadow-sm" placeholder="ابحث برقم القيد أو البيان..." value={search} onChange={(event) => setSearch(event.target.value)} data-testid="input-search-journal" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-500">من تاريخ</Label>
              <Input type="date" value={fromDate} max={toDate || undefined} onChange={(event) => setFromDate(event.target.value)} className="bg-white shadow-sm" data-testid="input-journal-from" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-bold text-slate-500">إلى تاريخ</Label>
              <Input type="date" value={toDate} min={fromDate || undefined} onChange={(event) => setToDate(event.target.value)} className="bg-white shadow-sm" data-testid="input-journal-to" />
            </div>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-slate-600 mr-1">الحالة:</span>
            {(['all', 'draft', 'posted'] as JournalStatusFilter[]).map((status) => (
              <Button 
                key={status} 
                type="button" 
                size="sm" 
                variant={statusFilter === status ? 'default' : 'outline'} 
                className={statusFilter === status ? 'shadow-sm' : 'bg-white'}
                onClick={() => setStatusFilter(status)} 
                data-testid={`filter-journal-${status}`}
              >
                {status === 'all' ? 'الكل' : status === 'draft' ? 'مسودة (قيد المراجعة)' : 'مرحّل (معتمد)'}
              </Button>
            ))}
            <Badge variant="secondary" className="mr-auto font-mono">{filteredJournals.length} قيد</Badge>
          </div>
        </div>
      </Card>

      <div className="space-y-4">
        {filteredJournals.map((journal) => (
          <Card key={journal.id} className="border-slate-200 shadow-sm transition-shadow hover:shadow-md overflow-hidden" data-testid={`card-journal-${journal.id}`}>
            <div className="flex flex-col items-start justify-between gap-4 border-b border-slate-100 bg-slate-50/80 p-5 sm:flex-row sm:items-center">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="rounded-md bg-slate-900 px-2 py-1 font-mono text-sm font-bold text-white shadow-sm">{journal.number}</span>
                <div className="flex items-center text-sm font-medium text-slate-500">
                  <Calendar className="ml-1.5 h-3.5 w-3.5" />
                  {journal.date}
                </div>
                <div className="h-4 w-px bg-slate-300 hidden sm:block"></div>
                <span className="font-semibold text-slate-900 text-base">{journal.description}</span>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant={journal.status === 'posted' ? 'success' : 'secondary'} className={journal.status === 'posted' ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200' : 'bg-amber-100 text-amber-800 hover:bg-amber-200'}>
                  {journal.status === 'posted' ? 'مرحّل ومعتمد' : 'مسودة غير معتمدة'}
                </Badge>
                {journal.status === 'draft' && (
                  <Button size="sm" onClick={() => { void handlePostJournal(journal.id); }} className="shadow-sm bg-primary/10 text-primary hover:bg-primary hover:text-white" data-testid={`button-post-${journal.id}`}>
                    اعتماد وترحيل
                  </Button>
                )}
              </div>
            </div>
            
            <div className="overflow-x-auto p-0">
              <Table>
                <TableHeader className="bg-transparent">
                  <TableRow className="border-slate-100">
                    <TableHead className="w-32 pl-4">رقم الحساب</TableHead>
                    <TableHead>اسم الحساب</TableHead>
                    <TableHead className="w-40 text-left font-semibold text-emerald-700">مدين</TableHead>
                    <TableHead className="w-40 text-left font-semibold text-amber-700">دائن</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {journal.lines.map((line) => {
                    const account = accounts.find((item) => item.id === line.accountId);
                    return (
                      <TableRow key={line.id} className="border-slate-100 hover:bg-slate-50/50">
                        <TableCell className="pl-4 font-mono text-sm text-slate-500">{account?.code ?? '—'}</TableCell>
                        <TableCell className="font-medium">{account?.name ?? 'حساب غير معروف'}</TableCell>
                        <TableCell className="text-left font-mono font-medium text-slate-700">
                          {line.debit > 0 ? <span className="bg-emerald-50 px-2 py-0.5 rounded text-emerald-700">{money(line.debit)}</span> : <span className="text-slate-300">—</span>}
                        </TableCell>
                        <TableCell className="text-left font-mono font-medium text-slate-700">
                          {line.credit > 0 ? <span className="bg-amber-50 px-2 py-0.5 rounded text-amber-700">{money(line.credit)}</span> : <span className="text-slate-300">—</span>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow className="bg-slate-50 font-bold border-t border-slate-200">
                    <TableCell colSpan={2} className="text-left text-slate-600 pl-4">الإجمالي المتزن</TableCell>
                    <TableCell className="text-left font-mono text-emerald-700">{money(journal.lines.reduce((sum, line) => sum + line.debit, 0))}</TableCell>
                    <TableCell className="text-left font-mono text-amber-700">{money(journal.lines.reduce((sum, line) => sum + line.credit, 0))}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </Card>
        ))}
        {filteredJournals.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-slate-200 border-dashed bg-white p-16 text-center shadow-sm">
            <div className="rounded-full bg-slate-100 p-4 mb-4">
              <FileText className="h-8 w-8 text-slate-400" />
            </div>
            <p className="text-xl font-semibold text-slate-900">لا توجد قيود مطابقة</p>
            <p className="mt-2 text-sm text-slate-500 max-w-sm">لم يتم العثور على قيود توافق الفلاتر المحددة. جرب تغيير التاريخ أو الحالة، أو قم بإنشاء قيد يومية جديد.</p>
            <Button onClick={() => { resetForm(); setIsAddOpen(true); }} variant="outline" className="mt-6">
              <Plus className="ml-2 h-4 w-4" />
              قيد يومية جديد
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}