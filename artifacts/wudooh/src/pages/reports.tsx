import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@/context/store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { LockKeyhole } from 'lucide-react';

type ReportType = 'trial' | 'income' | 'balance';
type ServerSummary = {
  totals: { revenue: number; expense: number; netIncome: number };
  trialBalance: Array<{ id: string | number; code: string; name: string; type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'; debit: number; credit: number }>;
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
      setClosedPeriod(`تم اعتماد إقفال الفترة من ${closure.from} إلى ${closure.to} وحفظ صافي الربح ${formatCurrency(closure.netIncome)}.`);
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
        // The local report remains available when the shared service is down.
      }
    })();
    return () => { active = false; };
  }, [connectionMode, fromDate, toDate]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ar-SA', { minimumFractionDigits: 2 }).format(amount);
  };

  const localReport = useMemo(() => {
    const movements = new Map(accounts.map((account) => [account.id, 0]));
    journals
      .filter((journal) => journal.status === 'posted' && journal.date >= fromDate && journal.date <= toDate)
      .forEach((journal) => journal.lines.forEach((line) => {
        const account = accounts.find((item) => item.id === line.accountId);
        if (!account) return;
        const change = account.type === 'asset' || account.type === 'expense'
          ? line.debit - line.credit
          : line.credit - line.debit;
        movements.set(account.id, (movements.get(account.id) ?? 0) + change);
      }));

    let debits = 0;
    let credits = 0;
    const currentAccounts = accounts
      .filter((account) => account.status === 'active')
      .map((account) => ({ ...account, balance: movements.get(account.id) ?? 0 }));
    const trial = currentAccounts.map((account) => {
      const debitNormal = account.type === 'asset' || account.type === 'expense';
      const debit = debitNormal ? account.balance : 0;
      const credit = debitNormal ? 0 : account.balance;
      debits += debit;
      credits += credit;
      return { ...account, debit, credit };
    });
    return { activeAccounts: currentAccounts, totalTrialDebit: debits, totalTrialCredit: credits, trialData: trial };
  }, [accounts, journals, fromDate, toDate]);
  const { activeAccounts, totalTrialDebit, totalTrialCredit, trialData } = serverSummary
    ? {
      activeAccounts: serverSummary.trialBalance.map((account) => ({ ...account, id: String(account.id), balance: account.debit || account.credit, status: 'active' as const, parent: null })),
      totalTrialDebit: serverSummary.trialBalance.reduce((sum, account) => sum + account.debit, 0),
      totalTrialCredit: serverSummary.trialBalance.reduce((sum, account) => sum + account.credit, 0),
      trialData: serverSummary.trialBalance,
    }
    : localReport;

  // Calculations for Income Statement
  const revenues = activeAccounts.filter(a => a.type === 'revenue');
  const expenses = activeAccounts.filter(a => a.type === 'expense');
  const totalRev = revenues.reduce((s, a) => s + a.balance, 0);
  const totalExp = expenses.reduce((s, a) => s + a.balance, 0);
  const netIncome = totalRev - totalExp;

  // Calculations for Balance Sheet
  const assets = activeAccounts.filter(a => a.type === 'asset');
  const liabilities = activeAccounts.filter(a => a.type === 'liability');
  const equities = activeAccounts.filter(a => a.type === 'equity');
  
  const totalAssets = assets.reduce((s, a) => s + a.balance, 0);
  const totalLiab = liabilities.reduce((s, a) => s + a.balance, 0);
  const baseEquity = equities.reduce((s, a) => s + a.balance, 0);
  // Total Equity = Base Equity + Net Income (retained earnings for this period)
  const totalEquity = baseEquity + netIncome;

  return (
    <div className="space-y-6" data-testid="page-reports">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b pb-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">التقارير المالية</h2>
          <p className="text-gray-500 mt-1">استعراض القوائم المالية للمنشأة.</p>
          <p className="text-xs text-muted-foreground mt-1" data-testid="text-accounting-connection">
            {connectionMode === 'remote' ? 'متصل بسجل المنشأة المحمي' : connectionMode === 'loading' ? 'جارٍ ربط السجل المحاسبي...' : 'وضع محلي: سجّل الدخول لاعتماد الإقفال في سجل المنشأة'}
          </p>
        </div>
        <div className="flex bg-gray-100 p-1 rounded-md">
          <button
            className={`px-4 py-2 text-sm rounded-md transition-colors ${reportType === 'trial' ? 'bg-white shadow-sm font-medium' : 'text-gray-600 hover:text-gray-900'}`}
            onClick={() => setReportType('trial')}
            data-testid="tab-report-trial"
          >
            ميزان المراجعة
          </button>
          <button
            className={`px-4 py-2 text-sm rounded-md transition-colors ${reportType === 'income' ? 'bg-white shadow-sm font-medium' : 'text-gray-600 hover:text-gray-900'}`}
            onClick={() => setReportType('income')}
            data-testid="tab-report-income"
          >
            قائمة الدخل
          </button>
          <button
            className={`px-4 py-2 text-sm rounded-md transition-colors ${reportType === 'balance' ? 'bg-white shadow-sm font-medium' : 'text-gray-600 hover:text-gray-900'}`}
            onClick={() => setReportType('balance')}
            data-testid="tab-report-balance"
          >
            المركز المالي
          </button>
        </div>
      </div>
      <Card>
        <CardContent className="py-4">
          <div className="flex flex-col lg:flex-row lg:items-end gap-3">
            <div className="grid grid-cols-2 gap-3 flex-1 max-w-md">
              <label className="text-sm font-medium">من
                <Input className="mt-1" type="date" value={fromDate} max={toDate} onChange={(event) => setFromDate(event.target.value)} data-testid="input-report-from" />
              </label>
              <label className="text-sm font-medium">إلى
                <Input className="mt-1" type="date" value={toDate} min={fromDate} onChange={(event) => setToDate(event.target.value)} data-testid="input-report-to" />
              </label>
            </div>
            <Button
              variant="outline"
              onClick={() => void handleClose()}
              disabled={isClosing || connectionMode === 'loading'}
              data-testid="button-close-period"
            >
              <LockKeyhole className="ml-2 h-4 w-4" />
              {isClosing ? 'جارٍ اعتماد الإقفال...' : 'إقفال الفترة'}
            </Button>
          </div>
          {closedPeriod && <p className="mt-3 text-sm text-emerald-700" data-testid="text-closed-period">{closedPeriod}</p>}
          {closeError && <p className="mt-3 text-sm text-red-700" data-testid="text-close-error">{closeError}</p>}
        </CardContent>
      </Card>

      {reportType === 'trial' && (
        <Card>
          <CardHeader>
            <CardTitle className="text-center text-xl">ميزان المراجعة بالمجاميع</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>رقم الحساب</TableHead>
                  <TableHead>اسم الحساب</TableHead>
                  <TableHead className="text-left">مدين</TableHead>
                  <TableHead className="text-left">دائن</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trialData.map(acc => (
                  <TableRow key={acc.id}>
                    <TableCell className="font-mono">{acc.code}</TableCell>
                    <TableCell>{acc.name}</TableCell>
                    <TableCell className="text-left">{acc.debit > 0 ? formatCurrency(acc.debit) : '-'}</TableCell>
                    <TableCell className="text-left">{acc.credit > 0 ? formatCurrency(acc.credit) : '-'}</TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-gray-50 font-bold border-t-2">
                  <TableCell colSpan={2} className="text-center">الإجمالي</TableCell>
                  <TableCell className="text-left">{formatCurrency(totalTrialDebit)}</TableCell>
                  <TableCell className="text-left">{formatCurrency(totalTrialCredit)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {reportType === 'income' && (
        <Card className="max-w-3xl mx-auto">
          <CardHeader>
            <CardTitle className="text-center text-xl">قائمة الدخل</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              <div>
                <h4 className="font-bold text-lg mb-2 text-primary border-b pb-1">الإيرادات</h4>
                <div className="space-y-2">
                  {revenues.map(acc => (
                    <div key={acc.id} className="flex justify-between">
                      <span>{acc.name}</span>
                      <span>{formatCurrency(acc.balance)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between font-bold border-t pt-2 mt-2">
                    <span>إجمالي الإيرادات</span>
                    <span>{formatCurrency(totalRev)}</span>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="font-bold text-lg mb-2 text-destructive border-b pb-1">المصروفات</h4>
                <div className="space-y-2">
                  {expenses.map(acc => (
                    <div key={acc.id} className="flex justify-between">
                      <span>{acc.name}</span>
                      <span>{formatCurrency(acc.balance)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between font-bold border-t pt-2 mt-2">
                    <span>إجمالي المصروفات</span>
                    <span>{formatCurrency(totalExp)}</span>
                  </div>
                </div>
              </div>

              <div className={`flex justify-between font-bold text-xl p-4 rounded-md ${netIncome >= 0 ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                <span>صافي {netIncome >= 0 ? 'الربح' : 'الخسارة'}</span>
                <span data-testid="report-net-income">{formatCurrency(Math.abs(netIncome))}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {reportType === 'balance' && (
        <Card className="max-w-4xl mx-auto">
          <CardHeader>
            <CardTitle className="text-center text-xl">قائمة المركز المالي (الميزانية العمومية)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-8">
              {/* Assets column */}
              <div>
                <h4 className="font-bold text-xl mb-4 bg-gray-100 p-2 rounded text-center">الأصول</h4>
                <div className="space-y-2">
                  {assets.map(acc => (
                    <div key={acc.id} className="flex justify-between">
                      <span>{acc.name}</span>
                      <span>{formatCurrency(acc.balance)}</span>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between font-bold border-t-2 pt-2 mt-4 text-lg">
                  <span>إجمالي الأصول</span>
                  <span data-testid="report-total-assets">{formatCurrency(totalAssets)}</span>
                </div>
              </div>

              {/* Liabilities & Equity column */}
              <div>
                <h4 className="font-bold text-xl mb-4 bg-gray-100 p-2 rounded text-center">الخصوم وحقوق الملكية</h4>
                
                <h5 className="font-semibold text-lg text-gray-700 border-b mb-2 pb-1">الخصوم</h5>
                <div className="space-y-2 mb-6">
                  {liabilities.map(acc => (
                    <div key={acc.id} className="flex justify-between">
                      <span>{acc.name}</span>
                      <span>{formatCurrency(acc.balance)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between font-medium border-t pt-1">
                    <span>إجمالي الخصوم</span>
                    <span>{formatCurrency(totalLiab)}</span>
                  </div>
                </div>

                <h5 className="font-semibold text-lg text-gray-700 border-b mb-2 pb-1">حققوق الملكية</h5>
                <div className="space-y-2">
                  {equities.map(acc => (
                    <div key={acc.id} className="flex justify-between">
                      <span>{acc.name}</span>
                      <span>{formatCurrency(acc.balance)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between text-primary">
                    <span>أرباح (خسائر) الفترة</span>
                    <span>{formatCurrency(netIncome)}</span>
                  </div>
                  <div className="flex justify-between font-medium border-t pt-1">
                    <span>إجمالي حقوق الملكية</span>
                    <span>{formatCurrency(totalEquity)}</span>
                  </div>
                </div>

                <div className="flex justify-between font-bold border-t-2 pt-2 mt-4 text-lg">
                  <span>إجمالي الخصوم وحقوق الملكية</span>
                  <span data-testid="report-total-liab-equity">{formatCurrency(totalLiab + totalEquity)}</span>
                </div>
              </div>
            </div>
            
            {Math.abs(totalAssets - (totalLiab + totalEquity)) > 0.01 && (
              <div className="mt-8 p-4 bg-red-50 text-red-700 rounded-md text-center font-bold">
                تحذير: الميزانية غير متزنة. يرجى مراجعة القيود اليومية.
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
