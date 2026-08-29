import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, BookOpen, LoaderCircle, RefreshCw } from 'lucide-react';
import { useStore, type Account } from '@/context/store';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { buildLocalLedger } from '@/lib/local-ledger';

type LedgerMovement = {
  journalId: string | number;
  date: string;
  reference: string;
  description: string;
  counterpart: string;
  debit: number;
  credit: number;
  balance: number;
};

type LedgerReport = {
  account: {
    id: number;
    code: string;
    name: string;
    type: string;
    normalBalance: 'debit' | 'credit';
  };
  period: { from: string; to: string };
  openingBalance: number;
  balanceBeforePeriod: number;
  movements: LedgerMovement[];
  totals: {
    debit: number;
    credit: number;
    movement: number;
    endingBalance: number;
  };
};

const accountTypeLabels: Record<Account['type'], string> = {
  asset: 'أصل',
  liability: 'التزام',
  equity: 'حقوق ملكية',
  revenue: 'إيراد',
  expense: 'مصروف',
};

const accountTypeLabel = (type: string): string => accountTypeLabels[type as Account['type']] ?? 'حساب';

const formatCurrency = (amount: number): string => (
  new Intl.NumberFormat('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)
);

export function LedgerReport() {
  const { accounts, journals, connectionMode } = useStore();
  const activeAccounts = useMemo(
    () => accounts.filter((account) => account.status === 'active').sort((left, right) => left.code.localeCompare(right.code, 'en')),
    [accounts],
  );
  const year = new Date().getFullYear();
  const [accountId, setAccountId] = useState('');
  const [fromDate, setFromDate] = useState(`${year}-01-01`);
  const [toDate, setToDate] = useState(new Date().toISOString().slice(0, 10));
  const [serverReport, setServerReport] = useState<LedgerReport | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!activeAccounts.length) {
      setAccountId('');
      return;
    }
    if (!activeAccounts.some((account) => account.id === accountId)) {
      setAccountId(activeAccounts[0].id);
    }
  }, [accountId, activeAccounts]);

  useEffect(() => {
    if (connectionMode !== 'remote' || !accountId || fromDate > toDate) {
      setServerReport(null);
      setError(null);
      setIsLoading(false);
      return;
    }
    const controller = new AbortController();
    setIsLoading(true);
    setError(null);
    void (async () => {
      try {
        const params = new URLSearchParams({ accountId, from: fromDate, to: toDate });
        const response = await fetch(`/api/accounting/ledger?${params.toString()}`, {
          credentials: 'include',
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({})) as LedgerReport & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? 'تعذر تحميل دفتر الأستاذ.');
        setServerReport(payload);
      } catch (requestError) {
        if (requestError instanceof DOMException && requestError.name === 'AbortError') return;
        setServerReport(null);
        setError(requestError instanceof Error ? requestError.message : 'تعذر تحميل دفتر الأستاذ.');
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
      }
    })();
    return () => controller.abort();
  }, [accountId, connectionMode, fromDate, retryKey, toDate]);

  const localReport = useMemo(
    () => connectionMode === 'remote' ? null : buildLocalLedger(accounts, journals, accountId, fromDate, toDate),
    [accounts, accountId, connectionMode, fromDate, journals, toDate],
  );
  const report = connectionMode === 'remote' ? serverReport : localReport;
  const selectedAccount = activeAccounts.find((account) => account.id === accountId);
  const hasValidPeriod = Boolean(fromDate && toDate && fromDate <= toDate);

  return (
    <div className="space-y-5" data-testid="ledger-report">
      <Card className="border-slate-200 shadow-sm">
        <CardContent className="p-4 sm:p-5">
          <div className="mb-4 flex items-start gap-3">
            <div className="rounded-lg bg-primary/10 p-2 text-primary">
              <BookOpen className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-slate-900">دفتر الأستاذ وكشف الحساب</h3>
              <p className="mt-1 text-sm text-slate-500">راجع الرصيد السابق والحركات المرحلة والرصيد الجاري لحساب واحد.</p>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1.5fr)_repeat(2,minmax(0,1fr))]">
            <div className="space-y-1.5">
              <label htmlFor="ledger-account" className="text-xs font-bold text-slate-600">الحساب النشط</label>
              <select
                id="ledger-account"
                value={accountId}
                onChange={(event) => setAccountId(event.target.value)}
                disabled={activeAccounts.length === 0}
                className="flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm font-medium shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                data-testid="select-ledger-account"
              >
                {activeAccounts.length === 0 && <option value="">لا توجد حسابات نشطة</option>}
                {activeAccounts.map((account) => (
                  <option key={account.id} value={account.id}>{account.code} — {account.name}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="ledger-from" className="text-xs font-bold text-slate-600">من تاريخ</label>
              <Input id="ledger-from" type="date" value={fromDate} max={toDate} onChange={(event) => setFromDate(event.target.value)} data-testid="input-ledger-from" />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="ledger-to" className="text-xs font-bold text-slate-600">إلى تاريخ</label>
              <Input id="ledger-to" type="date" value={toDate} min={fromDate} onChange={(event) => setToDate(event.target.value)} data-testid="input-ledger-to" />
            </div>
          </div>
          {!hasValidPeriod && (
            <p className="mt-3 text-sm font-medium text-red-700" role="alert">يجب أن يكون تاريخ البداية قبل تاريخ النهاية أو مساوياً له.</p>
          )}
        </CardContent>
      </Card>

      {connectionMode === 'loading' && (
        <Card className="border-slate-200">
          <CardContent className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
            <LoaderCircle className="h-5 w-5 animate-spin" />
            جارٍ الاتصال بسجل المنشأة...
          </CardContent>
        </Card>
      )}

      {error && (
        <Card className="border-red-200 bg-red-50/60">
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4 text-red-800">
            <div className="flex items-start gap-2 text-sm font-medium">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{error}</span>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => setRetryKey((current) => current + 1)} className="border-red-200 bg-white text-red-800 hover:bg-red-100">
              <RefreshCw className="ml-2 h-4 w-4" />
              إعادة المحاولة
            </Button>
          </CardContent>
        </Card>
      )}

      {isLoading && (
        <Card className="border-slate-200">
          <CardContent className="flex items-center justify-center gap-2 py-12 text-sm text-slate-500">
            <LoaderCircle className="h-5 w-5 animate-spin" />
            جارٍ تحميل حركات الحساب...
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && connectionMode !== 'loading' && !report && (
        <Card className="border-slate-200">
          <CardContent className="py-12 text-center text-sm text-slate-500">
            {activeAccounts.length === 0 ? 'لا توجد حسابات نشطة لعرض كشف حسابها.' : 'اختر حساباً وفترة صحيحة لعرض التقرير.'}
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && report && selectedAccount && (
        <>
          <Card className="overflow-hidden border-slate-200 shadow-sm">
            <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-xl font-bold text-slate-900">{report.account.name}</h3>
                  <Badge variant="outline" className="bg-white font-mono">{report.account.code}</Badge>
                  <Badge variant="secondary">{accountTypeLabel(report.account.type)}</Badge>
                </div>
                <p className="mt-1 text-sm text-slate-500">كشف الحساب من <span className="font-mono">{fromDate}</span> إلى <span className="font-mono">{toDate}</span></p>
              </div>
              <Badge variant="outline" className={connectionMode === 'remote' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700'}>
                {connectionMode === 'remote' ? 'من سجل المنشأة الموحد' : 'نسخة محلية غير متزامنة'}
              </Badge>
            </div>
            <div className="grid grid-cols-1 divide-y divide-slate-200 sm:grid-cols-3 sm:divide-x sm:divide-y-0 sm:divide-x-reverse">
              <div className="p-4 sm:p-5">
                <p className="text-xs font-bold text-slate-500">الرصيد قبل الفترة</p>
                <p className="mt-1 font-mono text-xl font-bold text-slate-900" data-testid="ledger-opening-balance">{formatCurrency(report.balanceBeforePeriod)}</p>
              </div>
              <div className="p-4 sm:p-5">
                <p className="text-xs font-bold text-slate-500">حركة الفترة</p>
                <p className={`mt-1 font-mono text-xl font-bold ${report.totals.movement >= 0 ? 'text-emerald-700' : 'text-red-700'}`} data-testid="ledger-period-movement">{formatCurrency(report.totals.movement)}</p>
              </div>
              <div className="bg-primary/[0.04] p-4 sm:p-5">
                <p className="text-xs font-bold text-slate-500">الرصيد في نهاية الفترة</p>
                <p className="mt-1 font-mono text-xl font-bold text-primary" data-testid="ledger-ending-balance">{formatCurrency(report.totals.endingBalance)}</p>
              </div>
            </div>
          </Card>

          <Card className="overflow-hidden border-slate-200 shadow-sm">
            <div className="border-b border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-bold text-slate-900">الحركات المرحلة</h3>
                  <p className="mt-1 text-xs text-slate-500">تظهر القيود المعتمدة فقط، مرتبة من الأقدم إلى الأحدث.</p>
                </div>
                <Badge variant="secondary">{report.movements.length} حركة</Badge>
              </div>
            </div>
            <div className="overflow-x-auto">
              <Table className="min-w-[850px]">
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead className="w-32">التاريخ</TableHead>
                    <TableHead className="w-32">المرجع</TableHead>
                    <TableHead>البيان</TableHead>
                    <TableHead>الحساب المقابل</TableHead>
                    <TableHead className="text-left text-emerald-700">مدين</TableHead>
                    <TableHead className="text-left text-amber-700">دائن</TableHead>
                    <TableHead className="text-left">الرصيد الجاري</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {report.movements.map((movement, index) => (
                    <TableRow key={`${movement.journalId}-${index}`} data-testid={`ledger-movement-${movement.journalId}`}>
                      <TableCell className="font-mono text-sm text-slate-600">{movement.date}</TableCell>
                      <TableCell className="font-mono font-medium">{movement.reference}</TableCell>
                      <TableCell className="font-medium text-slate-800">{movement.description}</TableCell>
                      <TableCell className="text-sm text-slate-600">{movement.counterpart}</TableCell>
                      <TableCell className="text-left font-mono">{movement.debit > 0 ? formatCurrency(movement.debit) : '—'}</TableCell>
                      <TableCell className="text-left font-mono">{movement.credit > 0 ? formatCurrency(movement.credit) : '—'}</TableCell>
                      <TableCell className="text-left font-mono font-bold text-slate-900">{formatCurrency(movement.balance)}</TableCell>
                    </TableRow>
                  ))}
                  {report.movements.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="h-28 text-center text-sm text-slate-500">لا توجد حركات مرحلة لهذا الحساب في الفترة المحددة.</TableCell>
                    </TableRow>
                  )}
                  <TableRow className="border-t-2 border-slate-300 bg-slate-50 font-bold">
                    <TableCell colSpan={4} className="text-left">إجمالي الفترة</TableCell>
                    <TableCell className="text-left font-mono text-emerald-700">{formatCurrency(report.totals.debit)}</TableCell>
                    <TableCell className="text-left font-mono text-amber-700">{formatCurrency(report.totals.credit)}</TableCell>
                    <TableCell className="text-left font-mono text-slate-900">{formatCurrency(report.totals.endingBalance)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}