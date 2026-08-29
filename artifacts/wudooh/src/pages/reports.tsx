import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@/context/store';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LockKeyhole, FileSpreadsheet, TrendingUp, Landmark, Calculator, AlertTriangle, ShieldCheck, BookOpen } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { LedgerReport } from '@/components/accounting/ledger-report';

type ReportType = 'trial' | 'income' | 'balance' | 'ledger';
type ServerSummary = {
  totals: { revenue: number; expense: number; netIncome: number; receivables?: number; payables?: number };
  trialBalance: Array<{ id: string | number; code: string; name: string; type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'; debit: number; credit: number }>;
  incomeStatement: {
    revenue: Array<{ id: string | number; name: string; amount: number }>;
    expense: Array<{ id: string | number; name: string; amount: number }>;
    netIncome: number;
  };
  receivables: Array<{
    id: string | number;
    party: string;
    type: 'receivable' | 'payable';
    reference: string;
    dueDate: string;
    amount: number;
    paid: number;
    remaining: number;
    status: 'unpaid' | 'partial' | 'paid';
  }>;
};

export default function Reports() {
  const { accounts, journals, closePeriod, connectionMode } = useStore();
  const [reportType, setReportType] = useState<ReportType>('trial');
  const year = new Date().getFullYear();
  const [fromDate, setFromDate] = useState(`${year}-01-01`);
  const [toDate, setToDate] = useState(new Date().toISOString().slice(0, 10));
  const [closedPeriod, setClosedPeriod] = useState<string | null>(null);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const [serverSummary, setServerSummary] = useState<ServerSummary | null>(null);

  const handleClose = async () => {
    setCloseError(null);
    setIsClosing(true);
    try {
      const closure = await closePeriod(fromDate, toDate);
      setClosedPeriod(`تم اعتماد إقفال الفترة من ${closure.from} إلى ${closure.to} بنجاح. صافي الربح المحتجز: ${formatCurrency(closure.netIncome)}.`);
    } catch (error) {
      setCloseError(error instanceof Error ? error.message : 'تعذر إقفال الفترة.');
    } finally {
      setIsClosing(false);
    }
  };

  useEffect(() => {
    if (connectionMode !== 'remote') {
      setServerSummary(null);
      return;
    }
    let active = true;
    void (async () => {
      try {
        const response = await fetch(`/api/accounting/summary?from=${fromDate}&to=${toDate}`, { credentials: 'include' });
        if (!response.ok) return;
        const summary = await response.json() as ServerSummary;
        if (active) setServerSummary(summary);
      } catch {
        // Fallback to local report
      }
    })();
    return () => { active = false; };
  }, [connectionMode, fromDate, toDate]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ar-SA', { minimumFractionDigits: 2 }).format(amount);
  };

  const localReport = useMemo(() => {
    const closingBalances = new Map(accounts.map((account) => [account.id, Number(account.openingBalance ?? 0)]));
    const periodBalances = new Map(accounts.map((account) => [account.id, 0]));
    const applyJournal = (balances: Map<string, number>, journal: (typeof journals)[number]) => journal.lines
      .forEach((line) => {
        const account = accounts.find((item) => item.id === line.accountId);
        if (!account) return;
        const change = account.type === 'asset' || account.type === 'expense'
          ? line.debit - line.credit
          : line.credit - line.debit;
        balances.set(account.id, (balances.get(account.id) ?? 0) + change);
      });
    const postedJournals = journals.filter((journal) => journal.status === 'posted' && journal.date <= toDate);
    postedJournals.forEach((journal) => applyJournal(closingBalances, journal));
    postedJournals.filter((journal) => journal.date >= fromDate).forEach((journal) => applyJournal(periodBalances, journal));

    let debits = 0;
    let credits = 0;
    const balanceAccounts = accounts
      .filter((account) => account.status === 'active')
      .map((account) => ({ ...account, balance: closingBalances.get(account.id) ?? 0 }));
    const incomeAccounts = accounts
      .filter((account) => account.status === 'active')
      .map((account) => ({ ...account, balance: periodBalances.get(account.id) ?? 0 }));
    const trial = balanceAccounts.map((account) => {
      const debitNormal = account.type === 'asset' || account.type === 'expense';
      const debitMovement = debitNormal ? account.balance : -account.balance;
      const creditMovement = debitNormal ? -account.balance : account.balance;
      const debit = debitMovement > 0 ? debitMovement : 0;
      const credit = creditMovement > 0 ? creditMovement : 0;
      debits += debit;
      credits += credit;
      return { ...account, debit, credit };
    });
    return { balanceAccounts, incomeAccounts, totalTrialDebit: debits, totalTrialCredit: credits, trialData: trial };
  }, [accounts, journals, fromDate, toDate]);
  
  const { balanceAccounts, incomeAccounts, totalTrialDebit, totalTrialCredit, trialData } = serverSummary
    ? {
      balanceAccounts: serverSummary.trialBalance.map((account) => ({ ...account, id: String(account.id), balance: account.debit || account.credit, status: 'active' as const, parent: null })),
      incomeAccounts: [
        ...serverSummary.incomeStatement.revenue.map((account) => ({ ...account, id: String(account.id), code: '', balance: account.amount, type: 'revenue' as const, status: 'active' as const, parent: null })),
        ...serverSummary.incomeStatement.expense.map((account) => ({ ...account, id: String(account.id), code: '', balance: account.amount, type: 'expense' as const, status: 'active' as const, parent: null })),
      ],
      totalTrialDebit: serverSummary.trialBalance.reduce((sum, account) => sum + account.debit, 0),
      totalTrialCredit: serverSummary.trialBalance.reduce((sum, account) => sum + account.credit, 0),
      trialData: serverSummary.trialBalance,
    }
    : localReport;

  // Calculations for Income Statement
  const revenues = incomeAccounts.filter(a => a.type === 'revenue' && a.balance !== 0);
  const expenses = incomeAccounts.filter(a => a.type === 'expense' && a.balance !== 0);
  const totalRev = revenues.reduce((s, a) => s + a.balance, 0);
  const totalExp = expenses.reduce((s, a) => s + a.balance, 0);
  const netIncome = totalRev - totalExp;

  // Calculations for Balance Sheet
  const assets = balanceAccounts.filter(a => a.type === 'asset' && a.balance !== 0);
  const liabilities = balanceAccounts.filter(a => a.type === 'liability' && a.balance !== 0);
  const equities = balanceAccounts.filter(a => a.type === 'equity' && a.balance !== 0);
  
  const totalAssets = assets.reduce((s, a) => s + a.balance, 0);
  const totalLiab = liabilities.reduce((s, a) => s + a.balance, 0);
  const baseEquity = equities.reduce((s, a) => s + a.balance, 0);
  const totalEquity = baseEquity + netIncome;

  return (
    <div className="space-y-6" data-testid="page-reports">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6 border-b border-slate-200 pb-6">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">القوائم والتقارير المالية</h2>
          <p className="text-slate-500 mt-1 text-sm">استعرض وحلل القوائم الختامية وأداء المنشأة.</p>
          <div className="mt-3 flex items-center gap-2" data-testid="text-accounting-connection">
            {connectionMode === 'remote' ? (
              <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 py-1">
                <ShieldCheck className="mr-1.5 ml-1 h-3.5 w-3.5" />
                متصل بسجل المنشأة الموحد
              </Badge>
            ) : connectionMode === 'loading' ? (
              <Badge variant="outline" className="bg-slate-100 text-slate-600 border-slate-200 py-1">
                جارٍ الاتصال بالسجل...
              </Badge>
            ) : (
              <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 py-1">
                <AlertTriangle className="mr-1.5 ml-1 h-3.5 w-3.5" />
                وضع محلي غير متزامن (يرجى تسجيل الدخول لاعتماد الإقفال)
              </Badge>
            )}
          </div>
        </div>
        <div className="flex bg-slate-100/80 p-1.5 rounded-lg border border-slate-200 shadow-inner w-full sm:w-auto">
          <button
            className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 text-sm rounded-md transition-all duration-200 ${reportType === 'trial' ? 'bg-white text-primary font-bold shadow-sm ring-1 ring-black/5' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50 font-medium'}`}
            onClick={() => setReportType('trial')}
            data-testid="tab-report-trial"
          >
            <FileSpreadsheet className="h-4 w-4" />
            <span className="hidden sm:inline">ميزان المراجعة</span>
            <span className="sm:hidden">ميزان</span>
          </button>
          <button
            className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 text-sm rounded-md transition-all duration-200 ${reportType === 'income' ? 'bg-white text-primary font-bold shadow-sm ring-1 ring-black/5' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50 font-medium'}`}
            onClick={() => setReportType('income')}
            data-testid="tab-report-income"
          >
            <TrendingUp className="h-4 w-4" />
            <span className="hidden sm:inline">قائمة الدخل</span>
            <span className="sm:hidden">الدخل</span>
          </button>
          <button
            className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 text-sm rounded-md transition-all duration-200 ${reportType === 'balance' ? 'bg-white text-primary font-bold shadow-sm ring-1 ring-black/5' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50 font-medium'}`}
            onClick={() => setReportType('balance')}
            data-testid="tab-report-balance"
          >
            <Landmark className="h-4 w-4" />
            <span className="hidden sm:inline">الميزانية العمومية</span>
            <span className="sm:hidden">الميزانية</span>
          </button>
          <button
            className={`flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 text-sm rounded-md transition-all duration-200 ${reportType === 'ledger' ? 'bg-white text-primary font-bold shadow-sm ring-1 ring-black/5' : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50 font-medium'}`}
            onClick={() => setReportType('ledger')}
            data-testid="tab-report-ledger"
          >
            <BookOpen className="h-4 w-4" />
            <span className="hidden sm:inline">دفتر الأستاذ</span>
            <span className="sm:hidden">الأستاذ</span>
          </button>
        </div>
      </div>
      
      <Card className="border-slate-200 shadow-sm">
        <CardContent className="py-5">
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-5">
            <div className="flex-1 max-w-2xl bg-slate-50 p-4 rounded-lg border border-slate-100">
              <div className="flex items-center gap-2 mb-3">
                <Calculator className="h-4 w-4 text-slate-500" />
                <h3 className="text-sm font-bold text-slate-700">تحديد الفترة المالية</h3>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-600">من تاريخ</label>
                  <Input type="date" value={fromDate} max={toDate} onChange={(event) => setFromDate(event.target.value)} className="bg-white" data-testid="input-report-from" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-600">إلى تاريخ</label>
                  <Input type="date" value={toDate} min={fromDate} onChange={(event) => setToDate(event.target.value)} className="bg-white" data-testid="input-report-to" />
                </div>
              </div>
            </div>
            
            <div className="flex flex-col gap-3 lg:min-w-[280px]">
              <Button
                onClick={() => void handleClose()}
                disabled={isClosing || connectionMode === 'loading'}
                className="w-full shadow-sm bg-slate-900 hover:bg-slate-800 text-white py-6"
                data-testid="button-close-period"
              >
                <LockKeyhole className="ml-2 h-5 w-5" />
                <span className="text-base">{isClosing ? 'جارٍ اعتماد الإقفال...' : 'إقفال الفترة واعتماد الأرصدة'}</span>
              </Button>
              {closedPeriod && (
                <div className="flex items-start gap-2 bg-emerald-50 text-emerald-800 p-3 rounded border border-emerald-100 text-sm font-medium">
                  <ShieldCheck className="h-4 w-4 mt-0.5 shrink-0" />
                  <p data-testid="text-closed-period">{closedPeriod}</p>
                </div>
              )}
              {closeError && (
                <div className="flex items-start gap-2 bg-red-50 text-red-800 p-3 rounded border border-red-100 text-sm font-medium">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <p data-testid="text-close-error">{closeError}</p>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {reportType === 'trial' && (
        <Card className="border-slate-200 shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="bg-slate-50 border-b border-slate-200 p-4 text-center">
            <h3 className="text-xl font-bold text-slate-900 tracking-tight">ميزان المراجعة بالمجاميع والأرصدة</h3>
            <p className="text-sm text-slate-500 mt-1">للفترة من <span className="font-mono">{fromDate}</span> إلى <span className="font-mono">{toDate}</span></p>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader className="bg-white">
                <TableRow className="border-b-2 border-slate-200 hover:bg-transparent">
                  <TableHead className="w-32 font-bold text-slate-900 pl-4 py-4">رقم الحساب</TableHead>
                  <TableHead className="font-bold text-slate-900 py-4">اسم الحساب</TableHead>
                  <TableHead className="w-48 text-left font-bold text-slate-900 py-4">الجانب المدين</TableHead>
                  <TableHead className="w-48 text-left font-bold text-slate-900 pr-4 py-4">الجانب الدائن</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trialData.filter(acc => acc.debit > 0 || acc.credit > 0).map(acc => (
                  <TableRow key={acc.id} className="border-slate-100 hover:bg-slate-50/80">
                    <TableCell className="font-mono text-sm font-medium text-slate-500 pl-4">{acc.code}</TableCell>
                    <TableCell className="font-medium text-slate-800">{acc.name}</TableCell>
                    <TableCell className="text-left font-mono font-medium text-slate-700">{acc.debit > 0 ? formatCurrency(acc.debit) : '—'}</TableCell>
                    <TableCell className="text-left font-mono font-medium text-slate-700 pr-4">{acc.credit > 0 ? formatCurrency(acc.credit) : '—'}</TableCell>
                  </TableRow>
                ))}
                {trialData.filter(acc => acc.debit > 0 || acc.credit > 0).length === 0 && (
                  <TableRow><TableCell colSpan={4} className="h-32 text-center text-slate-500">لا توجد حركات أو أرصدة نشطة لعرضها في هذه الفترة.</TableCell></TableRow>
                )}
                <TableRow className="bg-slate-100/50 hover:bg-slate-100/50 border-t-[3px] border-double border-slate-300">
                  <TableCell colSpan={2} className="text-left font-bold text-slate-900 text-lg py-4">الإجمالي الكلي</TableCell>
                  <TableCell className="text-left font-mono font-bold text-emerald-700 text-lg py-4">{formatCurrency(totalTrialDebit)}</TableCell>
                  <TableCell className="text-left font-mono font-bold text-emerald-700 text-lg pr-4 py-4">{formatCurrency(totalTrialCredit)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </Card>
      )}

      {reportType === 'ledger' && <LedgerReport />}

      {reportType === 'income' && (
        <Card className="max-w-3xl mx-auto border-slate-200 shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="bg-slate-50 border-b border-slate-200 p-5 text-center">
            <h3 className="text-2xl font-bold text-slate-900 tracking-tight">قائمة الدخل (الأرباح والخسائر)</h3>
            <p className="text-sm text-slate-500 mt-1">عن الفترة المنتهية في <span className="font-mono">{toDate}</span></p>
          </div>
          <CardContent className="p-0">
            <div className="p-6 space-y-8">
              <section>
                <div className="flex items-center justify-between border-b-2 border-emerald-200 pb-2 mb-4">
                  <h4 className="font-bold text-xl text-emerald-800">الإيرادات والمبيعات</h4>
                </div>
                <div className="space-y-3 px-2">
                  {revenues.map(acc => (
                    <div key={acc.id} className="flex justify-between items-center py-1 group hover:bg-slate-50 rounded px-2 -mx-2">
                      <span className="font-medium text-slate-700">{acc.name}</span>
                      <span className="font-mono text-slate-900">{formatCurrency(acc.balance)}</span>
                    </div>
                  ))}
                  {revenues.length === 0 && <p className="py-4 text-sm text-slate-400 italic text-center">لا توجد إيرادات مسجلة.</p>}
                  
                  <div className="flex justify-between items-center font-bold border-t border-slate-200 pt-3 mt-4 text-emerald-800 bg-emerald-50/50 p-2 rounded">
                    <span>إجمالي الإيرادات</span>
                    <span className="font-mono text-lg">{formatCurrency(totalRev)}</span>
                  </div>
                </div>
              </section>

              <section>
                <div className="flex items-center justify-between border-b-2 border-amber-200 pb-2 mb-4">
                  <h4 className="font-bold text-xl text-amber-800">المصروفات وتكاليف التشغيل</h4>
                </div>
                <div className="space-y-3 px-2">
                  {expenses.map(acc => (
                    <div key={acc.id} className="flex justify-between items-center py-1 group hover:bg-slate-50 rounded px-2 -mx-2">
                      <span className="font-medium text-slate-700">{acc.name}</span>
                      <span className="font-mono text-slate-900">{formatCurrency(acc.balance)}</span>
                    </div>
                  ))}
                  {expenses.length === 0 && <p className="py-4 text-sm text-slate-400 italic text-center">لا توجد مصروفات مسجلة.</p>}
                  
                  <div className="flex justify-between items-center font-bold border-t border-slate-200 pt-3 mt-4 text-amber-800 bg-amber-50/50 p-2 rounded">
                    <span>إجمالي المصروفات</span>
                    <span className="font-mono text-lg">{formatCurrency(totalExp)}</span>
                  </div>
                </div>
              </section>
            </div>
            
            <div className={`p-6 border-t-4 border-double ${netIncome >= 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-900' : 'bg-red-50 border-red-200 text-red-900'}`}>
              <div className="flex justify-between items-center max-w-md mx-auto">
                <span className="font-bold text-2xl">صافي {netIncome >= 0 ? 'الربح للفترة' : 'الخسارة للفترة'}</span>
                <span className="font-mono font-bold text-3xl" data-testid="report-net-income" dir="ltr">
                  {formatCurrency(netIncome)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {reportType === 'balance' && (
        <div className="mx-auto max-w-5xl space-y-6">
        <Card className="border-slate-200 shadow-sm overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-300">
          <div className="bg-slate-50 border-b border-slate-200 p-5 text-center">
            <h3 className="text-2xl font-bold text-slate-900 tracking-tight">قائمة المركز المالي (الميزانية العمومية)</h3>
            <p className="text-sm text-slate-500 mt-1">كما في تاريخ <span className="font-mono">{toDate}</span></p>
          </div>
          <CardContent className="p-0">
            <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x md:divide-x-reverse divide-slate-200">
              
              {/* Assets column */}
              <div className="p-6 md:p-8 bg-white flex flex-col h-full">
                <div className="mb-6 pb-3 border-b-2 border-slate-800 text-center">
                  <h4 className="font-bold text-2xl text-slate-900">الأصول (الموجودات)</h4>
                </div>
                <div className="space-y-4 flex-1">
                  {assets.map(acc => (
                    <div key={acc.id} className="flex justify-between items-center group hover:bg-slate-50 p-1.5 -mx-1.5 rounded transition-colors">
                      <span className="font-medium text-slate-700">{acc.name}</span>
                      <span className="font-mono text-slate-900">{formatCurrency(acc.balance)}</span>
                    </div>
                  ))}
                  {assets.length === 0 && <p className="py-6 text-sm text-slate-400 italic text-center">لا توجد أرصدة أصول معتمدة.</p>}
                </div>
                
                <div className="mt-8 pt-4 border-t-[3px] border-double border-slate-300 bg-slate-50 -mx-6 md:-mx-8 -mb-6 md:-mb-8 px-6 md:px-8 py-5">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-xl text-slate-900">إجمالي الأصول</span>
                    <span className="font-mono font-bold text-2xl text-slate-900" data-testid="report-total-assets">
                      {formatCurrency(totalAssets)}
                    </span>
                  </div>
                </div>
              </div>

              {/* Liabilities & Equity column */}
              <div className="p-6 md:p-8 bg-slate-50/30 flex flex-col h-full">
                <div className="mb-6 pb-3 border-b-2 border-slate-800 text-center">
                  <h4 className="font-bold text-2xl text-slate-900">الخصوم وحقوق الملكية</h4>
                </div>
                
                <div className="flex-1 flex flex-col gap-8">
                  <div>
                    <h5 className="font-semibold text-lg text-slate-500 border-b border-slate-200 mb-3 pb-2">الخصوم (الالتزامات)</h5>
                    <div className="space-y-3">
                      {liabilities.map(acc => (
                         <div key={acc.id} className="flex justify-between items-center group hover:bg-slate-50 p-1.5 -mx-1.5 rounded transition-colors">
                          <span className="font-medium text-slate-700">{acc.name}</span>
                          <span className="font-mono text-slate-900">{formatCurrency(acc.balance)}</span>
                        </div>
                      ))}
                      {liabilities.length === 0 && <p className="py-3 text-sm text-slate-400 italic">لا توجد التزامات مسجلة.</p>}
                      <div className="flex justify-between items-center font-bold text-slate-800 pt-2 mt-2">
                        <span>إجمالي الخصوم</span>
                        <span className="font-mono text-lg">{formatCurrency(totalLiab)}</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h5 className="font-semibold text-lg text-slate-500 border-b border-slate-200 mb-3 pb-2">حقوق الملكية</h5>
                    <div className="space-y-3">
                      {equities.map(acc => (
                        <div key={acc.id} className="flex justify-between items-center group hover:bg-slate-50 p-1.5 -mx-1.5 rounded transition-colors">
                          <span className="font-medium text-slate-700">{acc.name}</span>
                          <span className="font-mono text-slate-900">{formatCurrency(acc.balance)}</span>
                        </div>
                      ))}
                      
                      <div className="flex justify-between items-center pt-2 text-primary font-medium">
                        <span>أرباح (خسائر) الفترة الحالية</span>
                        <span className="font-mono" dir="ltr">{formatCurrency(netIncome)}</span>
                      </div>
                      
                      <div className="flex justify-between items-center font-bold text-slate-800 pt-2 mt-2">
                        <span>إجمالي حقوق الملكية</span>
                        <span className="font-mono text-lg">{formatCurrency(totalEquity)}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-8 pt-4 border-t-[3px] border-double border-slate-300 bg-slate-50 -mx-6 md:-mx-8 -mb-6 md:-mb-8 px-6 md:px-8 py-5">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-xl text-slate-900">إجمالي الخصوم والملكية</span>
                    <span className="font-mono font-bold text-2xl text-slate-900" data-testid="report-total-liab-equity">
                      {formatCurrency(totalLiab + totalEquity)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
            
            {Math.abs(totalAssets - (totalLiab + totalEquity)) > 0.01 && (
              <div className="bg-red-50 border-t border-red-200 p-4 flex items-center justify-center gap-2 text-red-700">
                <AlertTriangle className="h-5 w-5 shrink-0" />
                <p className="font-bold text-sm">تنبيه محاسبي: الميزانية غير متزنة. يرجى مراجعة توازن القيود الافتتاحية واليومية.</p>
              </div>
            )}
          </CardContent>
        </Card>
        {serverSummary?.receivables && serverSummary.receivables.length > 0 && (
          <Card className="overflow-hidden border-slate-200 shadow-sm" data-testid="report-receivables">
            <div className="border-b border-slate-200 bg-slate-50 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-lg font-bold text-slate-900">تفاصيل الذمم والاستحقاقات</h3>
                  <p className="mt-1 text-sm text-slate-500">الأرصدة القائمة ومواعيد استحقاقها حتى {toDate}.</p>
                </div>
                <Badge variant="outline" className="bg-white">
                  صافي الذمم المدينة: {formatCurrency(serverSummary.totals.receivables ?? 0)}
                </Badge>
              </div>
            </div>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>النوع</TableHead>
                      <TableHead>الجهة</TableHead>
                      <TableHead>المرجع</TableHead>
                      <TableHead>تاريخ الاستحقاق</TableHead>
                      <TableHead className="text-left">المتبقي</TableHead>
                      <TableHead>الحالة</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {serverSummary.receivables.map((item) => (
                      <TableRow key={`${item.type}-${item.id}`} data-testid={`report-receivable-${item.id}`}>
                        <TableCell>{item.type === 'receivable' ? 'ذمة مدينة' : 'ذمة دائنة'}</TableCell>
                        <TableCell className="font-medium">{item.party}</TableCell>
                        <TableCell>{item.reference || '-'}</TableCell>
                        <TableCell className="font-mono">{item.dueDate || '-'}</TableCell>
                        <TableCell className="text-left font-mono font-bold">{formatCurrency(item.remaining)}</TableCell>
                        <TableCell>
                          <Badge variant={item.status === 'paid' ? 'success' : item.status === 'partial' ? 'warning' : 'destructive'}>
                            {item.status === 'paid' ? 'مسدد' : item.status === 'partial' ? 'جزئي' : 'غير مسدد'}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
        </div>
      )}
    </div>
  );
}
