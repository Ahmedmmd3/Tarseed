import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Archive, BookOpen, CalendarDays, CheckCircle2, ChevronLeft, CircleDollarSign, FileDown, FileSpreadsheet, FileText, Landmark, Loader2, ReceiptText, RefreshCw, Scale, WalletCards, type LucideIcon } from 'lucide-react';
import { utils, write, writeFile } from 'xlsx';
import jsPDF from 'jspdf';
import JSZip from 'jszip';
import { useStore, type Account, type Journal } from '@/context/store';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';

type ExportReportId = 'journals' | 'trial' | 'ledger' | 'invoices' | 'expenses' | 'income' | 'balance' | 'zip';
type ExportStatus = 'idle' | 'loading' | 'success' | 'error';

type JournalLine = {
  id?: string | number;
  accountId: string | number;
  debit: number;
  credit: number;
};

type ExportJournal = {
  id: string | number;
  number: string;
  date: string;
  description: string;
  status?: string;
  lines: JournalLine[];
};

type ExportInvoice = {
  id: string | number;
  number: string;
  date: string;
  customer: string;
  subtotal: number;
  tax: number;
  total: number;
  status: string;
};

type ExportExpense = {
  id: string | number;
  date: string;
  description: string;
  category: string;
  vendor: string;
  amount: number;
  paymentMethod: string;
};

type Summary = {
  totals: { revenue: number; expense: number; netIncome: number };
  trialBalance: Array<{ id: string | number; code: string; name: string; type: Account['type']; debit: number; credit: number }>;
  incomeStatement: {
    revenue: Array<{ id: string | number; name: string; amount: number }>;
    expense: Array<{ id: string | number; name: string; amount: number }>;
    netIncome: number;
  };
  balanceSheet: {
    assets: Array<{ id: string | number; name: string; amount: number }>;
    liabilities: Array<{ id: string | number; name: string; amount: number }>;
    equity: Array<{ id: string | number; name: string; amount: number }>;
    baseEquity: number;
    unclosedEarnings: number;
    totalAssets: number;
    totalLiabilitiesAndEquity: number;
  };
};

type Dataset = {
  accounts: Account[];
  journals: ExportJournal[];
  invoices: ExportInvoice[];
  expenses: ExportExpense[];
  summary: Summary | null;
};

type ReportDefinition = {
  id: ExportReportId;
  title: string;
  description: string;
  icon: LucideIcon;
  tone: string;
  fileName: string;
};

const reportDefinitions: ReportDefinition[] = [
  { id: 'journals', title: 'القيود اليومية', description: 'كل القيود المحاسبية المسجلة في الفترة', icon: FileText, tone: 'blue', fileName: 'القيود_اليومية' },
  { id: 'trial', title: 'ميزان المراجعة', description: 'أرصدة جميع الحسابات مدين ودائن', icon: Scale, tone: 'slate', fileName: 'ميزان_المراجعة' },
  { id: 'ledger', title: 'دفتر الأستاذ', description: 'حركات كل حساب بالتفصيل', icon: BookOpen, tone: 'cyan', fileName: 'دفتر_الأستاذ' },
  { id: 'invoices', title: 'الفواتير', description: 'قائمة الفواتير مع التفاصيل الكاملة', icon: ReceiptText, tone: 'indigo', fileName: 'الفواتير' },
  { id: 'expenses', title: 'المصاريف', description: 'سجل المصاريف مصنفة بالفئات', icon: WalletCards, tone: 'rose', fileName: 'المصاريف' },
  { id: 'income', title: 'قائمة الدخل', description: 'الإيرادات والمصاريف وصافي الربح', icon: CircleDollarSign, tone: 'emerald', fileName: 'قائمة_الدخل' },
  { id: 'balance', title: 'الميزانية العمومية', description: 'الأصول والخصوم وحقوق الملكية', icon: Landmark, tone: 'amber', fileName: 'الميزانية_العمومية' },
  { id: 'zip', title: 'تصدير شامل ZIP', description: 'صدّر كل التقارير دفعة واحدة في ملف ZIP', icon: Archive, tone: 'navy', fileName: 'ترصيد_تصدير' },
];

const numberFormatter = new Intl.NumberFormat('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateFormatter = new Intl.DateTimeFormat('ar-SA', { year: 'numeric', month: 'long', day: 'numeric' });

export default function Export() {
  const { currentUser, accounts, journals, connectionMode } = useStore();
  const { toast } = useToast();
  const year = new Date().getFullYear();
  const [fromDate, setFromDate] = useState(`${year}-01-01`);
  const [toDate, setToDate] = useState(new Date().toISOString().slice(0, 10));
  const [selectedAccountId, setSelectedAccountId] = useState('all');
  const [dataset, setDataset] = useState<Dataset>({ accounts: [], journals: [], invoices: [], expenses: [], summary: null });
  const [status, setStatus] = useState<ExportStatus>('idle');
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState<string | null>(null);
  const [zipProgress, setZipProgress] = useState(0);
  const [lastExport, setLastExport] = useState('');

  const localJournals = useMemo(() => journals
    .filter((journal) => journal.date >= fromDate && journal.date <= toDate)
    .map(normalizeJournal), [fromDate, journals, toDate]);
  const activeAccounts = useMemo(() => (connectionMode === 'remote' ? dataset.accounts : accounts).filter((account) => account.status === 'active'), [accounts, connectionMode, dataset.accounts]);
  const filteredJournals = connectionMode === 'remote' ? dataset.journals : localJournals;
  const selectedAccount = selectedAccountId === 'all' ? undefined : activeAccounts.find((account) => account.id === selectedAccountId);

  useEffect(() => {
    if (!currentUser) {
      setStatus('idle');
      return;
    }
    if (connectionMode !== 'remote') {
      setDataset((current) => ({ ...current, accounts, journals: localJournals }));
      setStatus('success');
      return;
    }
    let active = true;
    setStatus('loading');
    setError('');
    void loadExportDataset(fromDate, toDate, currentUser.dataGeneration)
      .then((next) => {
        if (!active) return;
        setDataset(next);
        setStatus('success');
      })
      .catch((requestError: unknown) => {
        if (!active) return;
        setStatus('error');
        setError(requestError instanceof Error ? requestError.message : 'تعذر تحميل بيانات التصدير.');
      });
    return () => { active = false; };
  }, [accounts, connectionMode, currentUser?.dataGeneration, fromDate, localJournals, toDate]);

  const reportRows = useMemo(() => buildReportRows(dataset, filteredJournals, activeAccounts, selectedAccount?.id), [activeAccounts, dataset, filteredJournals, selectedAccount?.id]);

  const exportReport = async (reportId: ExportReportId, format: 'excel' | 'pdf' | 'zip') => {
    if (status === 'loading' || exporting) return;
    const jobId = `${reportId}-${format}`;
    setExporting(jobId);
    setZipProgress(format === 'zip' ? 5 : 0);
    setLastExport('');
    setError('');
    try {
      if (format === 'zip') {
        await exportZip(reportRows, fromDate, toDate, currentUser?.projectName ?? 'ترصيد', setZipProgress);
      } else if (reportId !== 'zip') {
        await exportSingle(reportId, format, reportRows, fromDate, toDate, currentUser?.projectName ?? 'ترصيد');
      }
      setLastExport(jobId);
      toast({ title: 'تم تصدير الملف بنجاح ✅', description: 'تم تنزيل الملف على جهازك.' });
    } catch (exportError: unknown) {
      const message = exportError instanceof Error ? exportError.message : 'تعذر إنشاء ملف التصدير.';
      setError(message);
      toast({ title: 'تعذر التصدير', description: message, variant: 'destructive' });
    } finally {
      setExporting(null);
      setZipProgress(0);
    }
  };

  if (!currentUser) {
    return (
      <div className="flex min-h-[55vh] items-center justify-center" data-testid="export-auth-required">
        <Card className="w-full max-w-xl border-slate-200 bg-white shadow-sm">
          <CardContent className="p-8 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-500"><FileDown className="h-7 w-7" /></div>
            <h1 className="mt-5 text-xl font-black text-slate-900">تسجيل الدخول مطلوب للتصدير</h1>
            <p className="mt-2 text-sm leading-7 text-slate-500">يرتبط التصدير بسجل منشأتك الحالي، لذلك نحتاج إلى جلسة دخول مؤكدة قبل إنشاء الملفات.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6" data-testid="page-export">
      <header className="relative overflow-hidden rounded-[1.75rem] bg-[#0A1328] px-5 py-6 text-white shadow-xl shadow-slate-950/10 sm:px-8 sm:py-8">
        <div className="absolute -left-12 -top-20 h-56 w-56 rounded-full bg-[#1976F3]/20 blur-3xl" aria-hidden="true" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Badge className="border-0 bg-teal-300/15 px-3 py-1 text-teal-100 hover:bg-teal-300/15"><CheckCircle2 className="ml-1.5 h-3.5 w-3.5" />جاهز للمراجعة والمشاركة</Badge>
              {connectionMode === 'remote' && <span className="text-xs text-slate-400">متصل بسجل {currentUser.projectName}</span>}
            </div>
            <h1 className="text-2xl font-black tracking-tight sm:text-3xl">تصدير بيانات المنشأة</h1>
            <p className="mt-2 max-w-xl text-sm leading-7 text-slate-300">اختر الفترة، ثم حمّل التقرير الذي تحتاجه بصيغة عملية. الملفات تحمل آخر بيانات سجل منشأتك دون خطوات إضافية.</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200 backdrop-blur-sm">
            <p className="text-xs text-slate-400">الفترة المحددة</p>
            <p className="mt-1 font-bold" data-testid="text-export-period">{fromDate} <span className="mx-1 text-teal-300">←</span> {toDate}</p>
          </div>
        </div>
      </header>

      <Card className="border-slate-200 bg-white shadow-sm" data-testid="card-export-filters">
        <CardContent className="p-5 sm:p-6">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="text-xs font-black uppercase tracking-[0.14em] text-[#1976F3]">01 / الفترة المالية</p>
              <h2 className="mt-1 text-lg font-black text-slate-900">حدد نطاق البيانات</h2>
              <p className="mt-1 text-sm text-slate-500">تُطبق التواريخ على جميع التقارير الثمانية.</p>
            </div>
            <div className="grid w-full gap-4 sm:grid-cols-2 xl:max-w-2xl">
              <div className="space-y-2">
                <Label htmlFor="export-from" className="text-xs font-bold text-slate-600">من تاريخ</Label>
                <div className="relative">
                  <CalendarDays className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input id="export-from" type="date" value={fromDate} max={toDate} onChange={(event) => setFromDate(event.target.value)} className="h-11 bg-slate-50 pr-10" data-testid="input-export-from" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="export-to" className="text-xs font-bold text-slate-600">إلى تاريخ</Label>
                <div className="relative">
                  <CalendarDays className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input id="export-to" type="date" value={toDate} min={fromDate} onChange={(event) => setToDate(event.target.value)} className="h-11 bg-slate-50 pr-10" data-testid="input-export-to" />
                </div>
              </div>
            </div>
            <Button type="button" variant="outline" onClick={() => void reloadDataset()} disabled={status === 'loading'} className="h-11 shrink-0 border-slate-200 text-slate-700" data-testid="button-refresh-export">
              <RefreshCw className={status === 'loading' ? 'animate-spin' : ''} /> تحديث البيانات
            </Button>
          </div>
        </CardContent>
      </Card>

      <section className="grid gap-3 sm:grid-cols-3" aria-label="ملخص البيانات">
        <SummaryStat label="القيود اليومية" value={filteredJournals.length} icon={FileText} testId="text-export-journals-count" />
        <SummaryStat label="الفواتير" value={dataset.invoices.length} icon={ReceiptText} testId="text-export-invoices-count" />
        <SummaryStat label="المصاريف" value={dataset.expenses.length} icon={WalletCards} testId="text-export-expenses-count" />
      </section>

      {status === 'loading' && <LoadingState />}
      {status === 'error' && (
        <div className="flex flex-col gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800 sm:flex-row sm:items-center sm:justify-between" role="alert" data-testid="status-export-error">
          <p>{error}</p>
          <Button type="button" variant="outline" onClick={() => void reloadDataset()} className="border-rose-200 bg-white text-rose-800 hover:bg-rose-100" data-testid="button-retry-export">إعادة المحاولة</Button>
        </div>
      )}
      {lastExport && <div className="flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800" role="status" data-testid="status-export-success"><CheckCircle2 className="h-4 w-4" />تم تنزيل التقرير بنجاح.</div>}
      {exporting === 'zip-zip' && (
        <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4" role="status" data-testid="progress-export-zip">
          <div className="mb-2 flex items-center justify-between text-xs font-bold text-blue-900"><span>جارٍ تجهيز حزمة التقارير...</span><span>{zipProgress}%</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-blue-100"><div className="h-full rounded-full bg-[#0D47D9] transition-[width]" style={{ width: `${zipProgress}%` }} /></div>
        </div>
      )}

      <section data-testid="section-export-reports">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.14em] text-[#1976F3]">02 / اختر ملفاً</p>
            <h2 className="mt-1 text-xl font-black text-slate-900">التقارير المتاحة</h2>
          </div>
          <p className="hidden text-xs text-slate-500 sm:block">صيغة Excel للبيانات · PDF للمشاركة · ZIP للحزمة الكاملة</p>
        </div>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {reportDefinitions.map((report, index) => (
            <ReportCard
              key={report.id}
              report={report}
              index={index}
               exporting={exporting}
              disabled={status === 'loading' || Boolean(exporting)}
               onExport={(format) => void exportReport(report.id, format)}
              selectedAccount={report.id === 'ledger' ? (
                <div className="mt-4" onClick={(event) => event.stopPropagation()}>
                  <Label htmlFor="ledger-account" className="mb-2 block text-[11px] font-bold text-slate-500">الحساب</Label>
                   <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                    <SelectTrigger id="ledger-account" className="h-9 border-slate-200 bg-white text-xs" data-testid="select-export-ledger-account"><SelectValue placeholder="اختر الحساب" /></SelectTrigger>
                    <SelectContent dir="rtl">
                       <SelectItem value="all">كل الحسابات</SelectItem>
                      {activeAccounts.map((account) => <SelectItem key={account.id} value={account.id}>{account.code} · {account.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ) : undefined}
            />
          ))}
        </div>
      </section>

      {status === 'success' && filteredJournals.length === 0 && dataset.invoices.length === 0 && dataset.expenses.length === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center" data-testid="export-empty-state">
          <FileSpreadsheet className="mx-auto h-8 w-8 text-slate-400" />
          <h3 className="mt-3 font-black text-slate-800">لا توجد حركات في هذه الفترة</h3>
          <p className="mt-1 text-sm text-slate-500">جرّب توسيع نطاق التاريخ أو راجع أن السجل يحتوي على بيانات معتمدة.</p>
        </div>
      )}
    </div>
  );

  async function reloadDataset() {
    if (!currentUser || connectionMode !== 'remote') {
      setDataset((current) => ({ ...current, accounts, journals: localJournals }));
      setStatus('success');
      return;
    }
    setStatus('loading');
    setError('');
    try {
      const next = await loadExportDataset(fromDate, toDate, currentUser.dataGeneration);
      setDataset(next);
      setStatus('success');
    } catch (requestError: unknown) {
      setStatus('error');
      setError(requestError instanceof Error ? requestError.message : 'تعذر تحميل بيانات التصدير.');
    }
  }
}

function ReportCard({ report, index, exporting, disabled, onExport, selectedAccount }: {
  report: ReportDefinition;
  index: number;
  exporting: string | null;
  disabled: boolean;
  onExport: (format: 'excel' | 'pdf' | 'zip') => void;
  selectedAccount?: ReactNode;
}) {
  const Icon = report.icon;
  const isZip = report.id === 'zip';
  return (
    <Card className={`group relative overflow-hidden border-slate-200 bg-white transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-lg ${isZip ? 'md:col-span-2 xl:col-span-2' : ''}`} data-testid={`card-export-${report.id}`}>
      <CardContent className={`flex h-full flex-col p-5 ${isZip ? 'sm:flex-row sm:items-center sm:justify-between sm:gap-8' : ''}`}>
        <div className="min-w-0">
          <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${toneClasses(report.tone)}`}><Icon className="h-5 w-5" /></div>
          <div className="mt-5 flex items-start justify-between gap-3">
            <div>
              <p className="text-base font-black text-slate-900">{report.title}</p>
              <p className="mt-1 text-xs leading-6 text-slate-500">{report.description}</p>
            </div>
            <span className="text-[10px] font-black tabular-nums text-slate-300">0{index + 1}</span>
          </div>
          {selectedAccount}
        </div>
        {isZip ? (
          <Button type="button" onClick={() => onExport('zip')} disabled={disabled} className="mt-5 h-10 w-full justify-between bg-[#0A1328] px-3 text-white hover:bg-[#0D47D9] sm:mt-0 sm:w-auto sm:min-w-40" data-testid={`button-export-${report.id}`}>
            <span>{exporting === 'zip-zip' ? 'جارٍ التجهيز...' : 'تصدير الكل (ZIP)'}</span>
            {exporting === 'zip-zip' ? <Loader2 className="animate-spin" /> : <Archive className="h-4 w-4" />}
          </Button>
        ) : (
          <div className="mt-5 grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" onClick={() => onExport('excel')} disabled={disabled} className="h-10 gap-1.5 border-slate-200 px-2 text-xs font-bold text-slate-700 hover:bg-slate-50" data-testid={`button-export-${report.id}-excel`}>
              {exporting === `${report.id}-excel` ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSpreadsheet className="h-4 w-4" />} Excel
            </Button>
            <Button type="button" onClick={() => onExport('pdf')} disabled={disabled} className="h-10 gap-1.5 bg-slate-900 px-2 text-xs font-bold text-white hover:bg-[#0D47D9]" data-testid={`button-export-${report.id}-pdf`}>
              {exporting === `${report.id}-pdf` ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />} PDF
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SummaryStat({ label, value, icon: Icon, testId }: { label: string; value: number; icon: LucideIcon; testId: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm" data-testid={testId}>
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#1976F3]/10 text-[#0D47D9]"><Icon className="h-4 w-4" /></div>
      <div><p className="text-xs text-slate-500">{label}</p><p className="mt-0.5 text-lg font-black tabular-nums text-slate-900">{numberFormatter.format(value).replace('.00', '')}</p></div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="grid gap-3 sm:grid-cols-3" role="status" data-testid="status-export-loading">
      {[1, 2, 3].map((item) => <div key={item} className="h-16 animate-pulse rounded-2xl bg-slate-100" />)}
    </div>
  );
}

async function loadExportDataset(from: string, to: string, dataGeneration: number): Promise<Dataset> {
  const headers = { 'X-Wudooh-Data-Generation': String(dataGeneration) };
  const [journalsResponse, accountsResponse, invoicesResponse, expensesResponse, summaryResponse] = await Promise.all([
    fetch('/api/data/journalEntries', { credentials: 'include', headers }),
    fetch('/api/data/accounts', { credentials: 'include', headers }),
    fetch('/api/data/invoices', { credentials: 'include', headers }),
    fetch('/api/data/expenses', { credentials: 'include', headers }),
    fetch(`/api/accounting/summary?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, { credentials: 'include', headers }),
  ]);
  const responses = [journalsResponse, accountsResponse, invoicesResponse, expensesResponse, summaryResponse];
  const failed = responses.find((response) => !response.ok);
  if (failed) throw new Error('تعذر تحميل سجل المنشأة. تحقق من الاتصال ثم أعد المحاولة.');
  const [journalsPayload, accountsPayload, invoicesPayload, expensesPayload, summaryPayload] = await Promise.all(responses.map((response) => response.json()));
  return {
    accounts: extractArray(accountsPayload).map(normalizeAccount),
    journals: extractArray(journalsPayload).map(normalizeJournal).filter((journal) => journal.date >= from && journal.date <= to),
    invoices: extractArray(invoicesPayload).map(normalizeInvoice).filter((invoice) => invoice.date >= from && invoice.date <= to),
    expenses: extractArray(expensesPayload).map(normalizeExpense).filter((expense) => expense.date >= from && expense.date <= to),
    summary: normalizeSummary(summaryPayload),
  };
}

function normalizeAccount(input: unknown): Account {
  const item = (input ?? {}) as Record<string, unknown>;
  const type = item.type;
  return {
    id: String(item.id ?? ''),
    code: String(item.code ?? ''),
    name: String(item.name ?? item.title ?? ''),
    type: type === 'asset' || type === 'liability' || type === 'equity' || type === 'revenue' || type === 'expense' ? type : 'asset',
    parent: item.parent === null || item.parent === undefined ? null : String(item.parent),
    openingBalance: toNumber(item.openingBalance),
    balance: toNumber(item.balance),
    status: item.status === 'inactive' ? 'inactive' : 'active',
  };
}

function extractArray(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  const value = payload as Record<string, unknown>;
  for (const key of ['data', 'records', 'items', 'journalEntries', 'accounts', 'invoices', 'expenses']) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [];
}

function normalizeJournal(input: unknown): ExportJournal {
  const item = (input ?? {}) as Record<string, unknown>;
  return {
    id: String(item.id ?? item._id ?? ''),
    number: String(item.number ?? item.entryNumber ?? item.reference ?? ''),
    date: String(item.date ?? item.entryDate ?? ''),
    description: String(item.description ?? item.memo ?? item.notes ?? ''),
    status: typeof item.status === 'string' ? item.status : undefined,
    lines: Array.isArray(item.lines) ? item.lines.map((line) => {
      const value = (line ?? {}) as Record<string, unknown>;
      return { id: value.id as string | number | undefined, accountId: String(value.accountId ?? value.account_id ?? ''), debit: toNumber(value.debit), credit: toNumber(value.credit) };
    }) : [],
  };
}

function normalizeInvoice(input: unknown): ExportInvoice {
  const item = (input ?? {}) as Record<string, unknown>;
  return {
    id: String(item.id ?? ''),
    number: String(item.number ?? item.invoiceNumber ?? item.reference ?? ''),
    date: String(item.date ?? item.issueDate ?? ''),
    customer: String(item.customerName ?? item.customer ?? item.clientName ?? ''),
    subtotal: toNumber(item.subtotal ?? item.netAmount),
    tax: toNumber(item.tax ?? item.vatAmount ?? item.taxAmount),
    total: toNumber(item.total ?? item.amount ?? item.grandTotal),
    status: String(item.status ?? ''),
  };
}

function normalizeExpense(input: unknown): ExportExpense {
  const item = (input ?? {}) as Record<string, unknown>;
  return {
    id: String(item.id ?? ''),
    date: String(item.date ?? ''),
    description: String(item.description ?? item.notes ?? ''),
    category: String(item.category ?? ''),
    vendor: String(item.vendor ?? item.vendorName ?? ''),
    amount: toNumber(item.amount ?? item.total),
    paymentMethod: String(item.paymentMethod ?? ''),
  };
}

function normalizeSummary(input: unknown): Summary | null {
  if (!input || typeof input !== 'object') return null;
  const value = input as Record<string, unknown>;
  const totals = value.totals as Record<string, unknown> | undefined;
  const incomeStatement = value.incomeStatement as Record<string, unknown> | undefined;
  const balanceSheet = value.balanceSheet as Record<string, unknown> | undefined;
  if (!totals || !incomeStatement || !balanceSheet || !Array.isArray(value.trialBalance)) return null;
  const normalizeLines = (rows: unknown) => Array.isArray(rows)
    ? rows.map((row) => {
      const item = (row ?? {}) as Record<string, unknown>;
      return { id: String(item.id ?? ''), name: String(item.name ?? ''), amount: toNumber(item.amount) };
    })
    : [];
  const trialBalance = value.trialBalance.map((row) => {
    const item = (row ?? {}) as Record<string, unknown>;
    const type = item.type;
    return {
      id: String(item.id ?? ''),
      code: String(item.code ?? ''),
      name: String(item.name ?? ''),
      type: normalizeAccountType(type),
      debit: toNumber(item.debit),
      credit: toNumber(item.credit),
    };
  });
  const normalizeBalance = (rows: unknown) => normalizeLines(rows);
  return {
    totals: { revenue: toNumber(totals.revenue), expense: toNumber(totals.expense), netIncome: toNumber(totals.netIncome) },
    trialBalance,
    incomeStatement: {
      revenue: normalizeLines(incomeStatement.revenue),
      expense: normalizeLines(incomeStatement.expense),
      netIncome: toNumber(incomeStatement.netIncome),
    },
    balanceSheet: {
      assets: normalizeBalance(balanceSheet.assets),
      liabilities: normalizeBalance(balanceSheet.liabilities),
      equity: normalizeBalance(balanceSheet.equity),
      baseEquity: toNumber(balanceSheet.baseEquity),
      unclosedEarnings: toNumber(balanceSheet.unclosedEarnings),
      totalAssets: toNumber(balanceSheet.totalAssets),
      totalLiabilitiesAndEquity: toNumber(balanceSheet.totalLiabilitiesAndEquity),
    },
  };
}

function toNumber(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function accountTypeLabel(type: Account['type']): string {
  return {
    asset: 'أصل',
    liability: 'التزام',
    equity: 'حقوق ملكية',
    revenue: 'إيراد',
    expense: 'مصروف',
  }[type];
}

function normalizeAccountType(type: unknown): Account['type'] {
  return type === 'asset' || type === 'liability' || type === 'equity' || type === 'revenue' || type === 'expense' ? type : 'asset';
}

function accountBalance(row: { type: Account['type']; debit: number; credit: number }): number {
  return row.type === 'asset' || row.type === 'expense' ? row.debit - row.credit : row.credit - row.debit;
}

function percentageOf(value: number, total: number): number {
  return total === 0 ? 0 : Math.round((value / total) * 10000) / 100;
}

function paymentMethodLabel(method: string): string {
  return ({ cash: 'نقداً', card: 'بطاقة', transfer: 'تحويل بنكي', bank: 'تحويل بنكي', credit: 'آجل' }[method] ?? method) || 'غير محدد';
}

function buildReportRows(dataset: Dataset, journals: ExportJournal[], accounts: Account[], selectedAccountId?: string) {
  const accountMap = new Map(accounts.map((account) => [String(account.id), account]));
  const summary = dataset.summary;
  const journalRows = journals.flatMap((journal) => journal.lines.map((line) => {
    const account = accountMap.get(String(line.accountId));
    return {
      'رقم القيد': journal.number,
      التاريخ: journal.date,
      الوصف: journal.description,
      الحساب: account ? `${account.code} · ${account.name}` : String(line.accountId),
      مدين: line.debit,
      دائن: line.credit,
      الحالة: journal.status === 'posted' ? 'مرحل' : 'مسودة',
    };
  }));
  const trialRows = summary?.trialBalance
    .filter((row) => row.debit > 0 || row.credit > 0)
    .map((row) => ({
      'كود الحساب': row.code,
      'اسم الحساب': row.name,
      النوع: accountTypeLabel(row.type),
      مدين: row.debit,
      دائن: row.credit,
      الرصيد: accountBalance(row),
    }))
    ?? buildTrialRows(journals, accounts);
  const ledgerEntries = journals
    .flatMap((journal) => journal.lines
      .filter((line) => !selectedAccountId || String(line.accountId) === selectedAccountId)
      .map((line) => ({ journal, line, account: accountMap.get(String(line.accountId)) })))
    .sort((left, right) => String(left.journal.date).localeCompare(String(right.journal.date)) || String(left.journal.id).localeCompare(String(right.journal.id), undefined, { numeric: true }));
  const runningByAccount = new Map<string, number>();
  const ledgerRows = ledgerEntries.map(({ journal, line, account }) => {
    const accountId = String(line.accountId);
    const change = account && (account.type === 'asset' || account.type === 'expense')
      ? line.debit - line.credit
      : line.credit - line.debit;
    const running = (runningByAccount.get(accountId) ?? 0) + change;
    runningByAccount.set(accountId, running);
    return {
      التاريخ: journal.date,
      البيان: journal.description,
      'مرجع القيد': journal.number,
      مدين: line.debit,
      دائن: line.credit,
      'الرصيد التراكمي': running,
    };
  });
  const incomeRows = summary ? [
    ...summary.incomeStatement.revenue.filter((row) => row.amount !== 0).map((row) => ({ البند: `إيرادات · ${row.name}`, المبلغ: row.amount, 'النسبة من الإيرادات': percentageOf(row.amount, summary.totals.revenue) })),
    ...summary.incomeStatement.expense.filter((row) => row.amount !== 0).map((row) => ({ البند: `مصروفات · ${row.name}`, المبلغ: row.amount, 'النسبة من الإيرادات': percentageOf(row.amount, summary.totals.revenue) })),
    ...(summary.incomeStatement.netIncome !== 0 ? [{ البند: 'صافي الربح', المبلغ: summary.incomeStatement.netIncome, 'النسبة من الإيرادات': percentageOf(summary.incomeStatement.netIncome, summary.totals.revenue) }] : []),
  ] : [];
  const balanceRows = summary ? [
    ...summary.balanceSheet.assets.filter((row) => row.amount !== 0).map((row) => ({ 'كود الحساب': '', 'اسم الحساب': `أصل · ${row.name}`, الرصيد: row.amount })),
    ...summary.balanceSheet.liabilities.filter((row) => row.amount !== 0).map((row) => ({ 'كود الحساب': '', 'اسم الحساب': `التزام · ${row.name}`, الرصيد: row.amount })),
    ...summary.balanceSheet.equity.filter((row) => row.amount !== 0).map((row) => ({ 'كود الحساب': '', 'اسم الحساب': `حقوق ملكية · ${row.name}`, الرصيد: row.amount })),
    { 'كود الحساب': '', 'اسم الحساب': 'إجمالي الأصول', الرصيد: summary.balanceSheet.totalAssets },
    { 'كود الحساب': '', 'اسم الحساب': 'حقوق الملكية الأساسية', الرصيد: summary.balanceSheet.baseEquity },
    { 'كود الحساب': '', 'اسم الحساب': 'الأرباح غير المقفلة', الرصيد: summary.balanceSheet.unclosedEarnings },
    { 'كود الحساب': '', 'اسم الحساب': 'إجمالي الالتزامات وحقوق الملكية', الرصيد: summary.balanceSheet.totalLiabilitiesAndEquity },
  ] : [];
  return {
    journalRows,
    trialRows,
    ledgerRows,
    invoiceRows: dataset.invoices.map((row) => ({ 'رقم الفاتورة': row.number, التاريخ: row.date, العميل: row.customer, 'المجموع الفرعي': row.subtotal, الضريبة: row.tax, الإجمالي: row.total, الحالة: row.status })),
    expenseRows: dataset.expenses.map((row) => ({ التاريخ: row.date, الوصف: row.description, الفئة: row.category, المبلغ: row.amount, 'طريقة الدفع': paymentMethodLabel(row.paymentMethod) })),
    incomeRows,
    balanceRows,
  };
}

function buildTrialRows(journals: ExportJournal[], accounts: Account[]) {
  const totals = new Map(accounts.map((account) => [String(account.id), { debit: 0, credit: 0 }]));
  journals.forEach((journal) => journal.lines.forEach((line) => {
    const total = totals.get(String(line.accountId));
    if (total) { total.debit += line.debit; total.credit += line.credit; }
  }));
  return accounts
    .map((account) => {
      const total = totals.get(String(account.id)) ?? { debit: 0, credit: 0 };
      return { 'كود الحساب': account.code, 'اسم الحساب': account.name, النوع: accountTypeLabel(account.type), مدين: total.debit, دائن: total.credit, الرصيد: account.type === 'asset' || account.type === 'expense' ? total.debit - total.credit : total.credit - total.debit };
    })
    .filter((row) => row.مدين > 0 || row.دائن > 0);
}

type ExportFormat = 'excel' | 'pdf';
type ReportRows = ReturnType<typeof buildReportRows>;
type ExportableReportId = Exclude<ExportReportId, 'zip'>;

function rowsForReport(reportId: ExportableReportId, rows: ReportRows): Record<string, unknown>[] {
  return {
    journals: rows.journalRows,
    trial: rows.trialRows,
    ledger: rows.ledgerRows,
    invoices: rows.invoiceRows,
    expenses: rows.expenseRows,
    income: rows.incomeRows,
    balance: rows.balanceRows,
  }[reportId];
}

function reportDefinition(reportId: ExportableReportId): ReportDefinition {
  return reportDefinitions.find((report) => report.id === reportId) as ReportDefinition;
}

async function exportSingle(reportId: ExportableReportId, format: ExportFormat, rows: ReportRows, from: string, to: string, projectName: string) {
  const definition = reportDefinition(reportId);
  const reportRows = rowsForReport(reportId, rows);
  if (!reportRows.length) throw new Error('لا توجد بيانات في هذه الفترة.');
  const filename = `${definition.fileName}_${from}_${to}`;
  if (format === 'excel') {
    exportToExcel(reportRows, filename, definition.title);
    return;
  }
  const pdf = await createPdf(definition.title, reportRows, from, to, projectName);
  pdf.save(`${filename}.pdf`);
}

async function exportZip(rows: ReportRows, from: string, to: string, projectName: string, onProgress: (progress: number) => void) {
  const zip = new JSZip();
  const excelFolder = zip.folder('Excel');
  const pdfFolder = zip.folder('PDF');
  if (!excelFolder || !pdfFolder) throw new Error('تعذر إنشاء مجلدات الحزمة.');
  const exportableReports = reportDefinitions.filter((report): report is ReportDefinition & { id: ExportableReportId } => report.id !== 'zip');
  const reportRows = exportableReports.map((definition) => ({ definition, rows: rowsForReport(definition.id, rows) }));
  if (!reportRows.some((report) => report.rows.length)) throw new Error('لا توجد بيانات في هذه الفترة.');

  for (const [index, { definition, rows: currentRows }] of reportRows.entries()) {
    const workbook = buildWorkbook(currentRows.length ? currentRows : [{ البيان: 'لا توجد بيانات في هذه الفترة' }], definition.title);
    const content = write(workbook, { bookType: 'xlsx', type: 'array', compression: true }) as ArrayBuffer;
    excelFolder.file(`${definition.fileName}.xlsx`, content);
    const pdf = await createPdf(definition.title, currentRows, from, to, projectName);
    pdfFolder.file(`${definition.fileName}.pdf`, pdf.output('arraybuffer'));
    onProgress(Math.round(((index + 1) / reportRows.length) * 85));
  }
  zip.file('README.txt', [
    `ترصيد — ${projectName}`,
    `الفترة: من ${from} إلى ${to}`,
    `تاريخ الإنشاء: ${dateFormatter.format(new Date())}`,
    '',
    'يحتوي مجلد Excel على نسخ قابلة للتحرير من التقارير السبعة.',
    'يحتوي مجلد PDF على نسخ جاهزة للمراجعة والمشاركة.',
    'الملفات التي لم تحتوي على حركات في الفترة تتضمن رسالة توضيحية بدلاً من بيانات فارغة.',
  ].join('\n'));
  onProgress(92);
  const blob = await zip.generateAsync({ type: 'blob' }, (metadata) => onProgress(92 + Math.round(metadata.percent * 0.08)));
  downloadBlob(blob, `ترصيد_تصدير_${from}_${to}.zip`);
  onProgress(100);
}

function buildWorkbook(rows: Record<string, unknown>[], sheetName: string) {
  const worksheet = utils.json_to_sheet(rows);
  const range = utils.decode_range(worksheet['!ref'] ?? 'A1:A1');
  const widths = Array.from({ length: range.e.c + 1 }, (_, columnIndex) => {
    const values = [];
    for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
      const cell = worksheet[utils.encode_cell({ r: rowIndex, c: columnIndex })];
      if (cell?.v !== undefined) values.push(String(cell.v));
    }
    return { wch: Math.min(42, Math.max(12, ...values.map((value) => value.length + 2))) };
  });
  worksheet['!cols'] = widths;
  worksheet['!autofilter'] = { ref: worksheet['!ref'] ?? 'A1:A1' };
  for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex += 1) {
    const headerCell = worksheet[utils.encode_cell({ r: 0, c: columnIndex })];
    if (headerCell) headerCell.s = { fill: { fgColor: { rgb: '0D47D9' } }, font: { bold: true, color: { rgb: 'FFFFFF' } } };
    for (let rowIndex = 1; rowIndex <= range.e.r; rowIndex += 1) {
      const cell = worksheet[utils.encode_cell({ r: rowIndex, c: columnIndex })];
      if (cell && typeof cell.v === 'number') cell.z = '#,##0.00';
    }
  }
  const workbook = utils.book_new();
  utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31));
  return workbook;
}

function exportToExcel(rows: Record<string, unknown>[], filename: string, sheetName: string) {
  writeFile(buildWorkbook(rows, sheetName), `${filename}.xlsx`, { compression: true });
}

async function createPdf(title: string, rows: Record<string, unknown>[], from: string, to: string, projectName: string): Promise<jsPDF> {
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
  const container = document.createElement('div');
  container.id = 'wudooh-pdf-renderer';
  container.dir = 'rtl';
  container.style.cssText = 'position:fixed;left:0;top:0;transform:translateX(-200%);width:1000px;padding:32px;background:#ffffff;color:#0a1328;font-family:Arial,Tahoma,sans-serif;direction:rtl;pointer-events:none;';
  const safeProjectName = escapeHtml(projectName);
  const safeTitle = escapeHtml(title);
  const headers = rows.length ? Object.keys(rows[0]) : ['البيان'];
  const tableRows = rows.length
    ? rows.map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(formatPdfValue(row[header]))}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${headers.length}">لا توجد بيانات في هذه الفترة</td></tr>`;
  container.innerHTML = `
    <div style="border-bottom:3px solid #0d47d9;padding-bottom:16px;margin-bottom:18px;">
      <div style="font-size:28px;font-weight:800;color:#0d47d9;">ترصيد</div>
      <div style="font-size:20px;font-weight:700;margin-top:6px;">${safeProjectName}</div>
      <div style="font-size:18px;font-weight:700;margin-top:8px;">${safeTitle}</div>
      <div style="font-size:13px;color:#5a677d;margin-top:8px;">الفترة: من ${escapeHtml(from)} إلى ${escapeHtml(to)} · تاريخ الطباعة: ${escapeHtml(dateFormatter.format(new Date()))}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;table-layout:fixed;font-size:12px;">
      <thead><tr>${headers.map((header) => `<th style="background:#0d47d9;color:#fff;padding:9px 7px;border:1px solid #0d47d9;text-align:right;word-break:break-word;">${escapeHtml(header)}</th>`).join('')}</tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
    <style>tbody tr:nth-child(even){background:#f1f3f6}td{padding:8px 7px;border:1px solid #dce2ea;text-align:right;vertical-align:top;word-break:break-word}</style>
  `;
  document.body.appendChild(container);
  try {
    await new Promise<void>((resolve, reject) => {
      pdf.html(container, {
        x: 10,
        y: 10,
        width: 277,
        windowWidth: 1000,
        autoPaging: 'text',
        html2canvas: {
          scale: 1.2,
          backgroundColor: '#ffffff',
          useCORS: true,
          onclone: (clonedDocument) => {
            const clonedRenderer = clonedDocument.getElementById('wudooh-pdf-renderer');
            if (clonedRenderer) {
              clonedRenderer.style.left = '0';
              clonedRenderer.style.top = '0';
              clonedRenderer.style.transform = 'none';
            }
          },
        },
        callback: () => resolve(),
      }).catch(reject);
    });
  } finally {
    container.remove();
  }
  return pdf;
}

function formatPdfValue(value: unknown): string {
  return typeof value === 'number' ? numberFormatter.format(value) : String(value ?? '');
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[character] ?? character));
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function toneClasses(tone: string) {
  const tones: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-700',
    slate: 'bg-slate-100 text-slate-700',
    cyan: 'bg-cyan-50 text-cyan-700',
    indigo: 'bg-indigo-50 text-indigo-700',
    rose: 'bg-rose-50 text-rose-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    navy: 'bg-[#0A1328] text-teal-200',
  };
  return tones[tone] ?? tones.slate;
}