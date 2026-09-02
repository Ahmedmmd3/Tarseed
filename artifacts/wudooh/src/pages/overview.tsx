import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowDownRight, ArrowLeft, ArrowUpRight, BarChart3, Boxes, BriefcaseBusiness, Check, CheckCircle2, ClipboardList, Copy, FileText, LoaderCircle, PackageOpen, ReceiptText, ShoppingCart, Sparkles, Store, Truck, UsersRound, Wallet, type LucideIcon } from 'lucide-react';
import { Link } from 'wouter';
import { useStore, type Journal } from '@/context/store';
import { Button } from '@/components/ui/button';
import { useCrud } from '@/hooks/use-crud';
import './overview.css';

type Module = { title: string; description: string; href: string; icon: LucideIcon; tone: string; permission: string; ready: boolean; id: string };

const modules: Module[] = [
  { title: 'نقطة البيع', description: 'سجّل مبيعاتك وفواتيرك بسرعة من شاشة واحدة.', href: '/pos', icon: Store, tone: 'bg-teal-50 text-teal-700', permission: 'sales', ready: true, id: 'pos' },
  { title: 'المبيعات والعملاء', description: 'تابع العملاء والفواتير وحركة البيع اليومية.', href: '/sales', icon: ShoppingCart, tone: 'bg-blue-50 text-blue-700', permission: 'sales', ready: true, id: 'sales' },
  { title: 'عروض الأسعار', description: 'أصدر عروض أسعار للعملاء وحولها لفواتير.', href: '/quotations', icon: ClipboardList, tone: 'bg-emerald-50 text-emerald-700', permission: 'sales', ready: true, id: 'quotations' },
  { title: 'المخزون والمنتجات', description: 'راقب الأرصدة والمنتجات وحركات المستودعات.', href: '/inventory', icon: Boxes, tone: 'bg-violet-50 text-violet-700', permission: 'inventory', ready: true, id: 'inventory' },
  { title: 'أوامر الشراء', description: 'أنشئ أوامر الموردين وتابع الاستلام الجزئي والكامل.', href: '/purchase-orders', icon: PackageOpen, tone: 'bg-indigo-50 text-indigo-700', permission: 'inventory', ready: true, id: 'purchase-orders' },
  { title: 'المشتريات والموردون', description: 'نظّم أوامر الشراء والتزامات الموردين.', href: '/purchases', icon: Truck, tone: 'bg-amber-50 text-amber-700', permission: 'inventory', ready: true, id: 'purchases' },
  { title: 'المحاسبة', description: 'الحسابات والقيود والذمم في سجل مترابط.', href: '/accounts', icon: ReceiptText, tone: 'bg-sky-50 text-sky-700', permission: 'accounting', ready: true, id: 'accounting' },
  { title: 'التقارير المالية', description: 'اقرأ أداء منشأتك من أرقام واضحة ومترابطة.', href: '/reports', icon: BarChart3, tone: 'bg-indigo-50 text-indigo-700', permission: 'reports', ready: true, id: 'reports' },
  { title: 'الموارد البشرية', description: 'رتّب بيانات فريقك وصلاحيات العمل.', href: '/hr', icon: UsersRound, tone: 'bg-rose-50 text-rose-700', permission: 'hr', ready: true, id: 'hr' },
  { title: 'العمليات والمشاريع', description: 'تابع أعمالك ومشاريعك من البداية حتى الإنجاز.', href: '/operations', icon: BriefcaseBusiness, tone: 'bg-orange-50 text-orange-700', permission: 'operations', ready: true, id: 'operations' },
];

type StoredWeeklySummary = {
  summary: string;
  generatedAt: string;
};

type DashboardAccountingSummary = {
  totals: {
    revenue: number;
    expense: number;
    netIncome: number;
  };
  incomeStatement: {
    expense: Array<{
      id: string | number;
      name: string;
      amount: number;
    }>;
  };
};

const weeklySummaryStoragePrefix = 'wudooh-weekly-summary-v1';

export default function Overview() {
  const { accounts, receivables, journals, currentUser, connectionMode } = useStore();
  const [weeklySummary, setWeeklySummary] = useState('');
  const [weeklySummaryGeneratedAt, setWeeklySummaryGeneratedAt] = useState('');
  const [isGeneratingWeeklySummary, setIsGeneratingWeeklySummary] = useState(false);
  const [weeklySummaryError, setWeeklySummaryError] = useState('');
  const [weeklySummaryStorageWarning, setWeeklySummaryStorageWarning] = useState('');
  const [copyConfirmed, setCopyConfirmed] = useState(false);
  const [accountingSummary, setAccountingSummary] = useState<DashboardAccountingSummary | null>(null);
  const [dashboardJournals, setDashboardJournals] = useState<Journal[]>(journals);
  const weeklySummaryIdentityRef = useRef('');
  const canReadAccounting = Boolean(currentUser && (currentUser.roleId === 'owner' || currentUser.permissions.accounting === true));
  const localRevenue = accounts.filter((account) => account.type === 'revenue').reduce((sum, account) => sum + account.balance, 0);
  const localExpense = accounts.filter((account) => account.type === 'expense').reduce((sum, account) => sum + account.balance, 0);
  const totalRevenue = accountingSummary?.totals.revenue ?? localRevenue;
  const totalExpense = accountingSummary?.totals.expense ?? localExpense;
  const netProfit = accountingSummary?.totals.netIncome ?? totalRevenue - totalExpense;
  const totalReceivables = receivables.filter((record) => record.type === 'receivable').reduce((sum, record) => sum + (record.amount - record.paid), 0);
  const totalPayables = receivables.filter((record) => record.type === 'payable').reduce((sum, record) => sum + (record.amount - record.paid), 0);
  const pendingReceivables = receivables.filter((record) => record.status !== 'paid').sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()).slice(0, 4);
  const topExpenses = accountingSummary
    ? accountingSummary.incomeStatement.expense
      .filter((account) => account.amount > 0)
      .sort((left, right) => right.amount - left.amount)
      .slice(0, 4)
      .map((account) => ({ id: String(account.id), name: account.name, code: '', balance: account.amount }))
    : accounts
      .filter((account) => account.type === 'expense')
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 4);
  const canReadInventory = Boolean(currentUser && (currentUser.roleId === 'owner' || currentUser.permissions.inventory === true));
  const canReadSales = Boolean(currentUser && (currentUser.roleId === 'owner' || currentUser.permissions.sales === true));
  const quotationsCrud = useCrud<any>('quotations', canReadSales);
  const purchaseOrdersCrud = useCrud<any>('purchaseOrders', canReadInventory);
  const today = new Date().toISOString().slice(0, 10);
  const pendingQuotations = quotationsCrud.data.filter((q: any) =>
    (q.status === 'draft' || q.status === 'sent')
    && !q.convertedInvoiceId
    && String(q.expiryDate ?? '') >= today);
  const pendingPurchaseOrders = purchaseOrdersCrud.data.filter((order: any) =>
    order.status === 'draft' || order.status === 'sent' || order.status === 'partial');
  const overduePurchaseOrders = pendingPurchaseOrders.filter((order: any) =>
    String(order.expectedDate ?? '') !== '' && String(order.expectedDate) < today);
  const journalTrend = journalTrendFor(dashboardJournals);
  const recentJournals = dashboardJournals
    .slice()
    .sort((left, right) => compareJournalRecency(left, right))
    .slice(0, 6);
  const visibleModules = modules.filter((module) => !currentUser || currentUser.roleId === 'owner' || currentUser.permissions[module.permission] === true);
  const canUseWeeklySummary = Boolean(
    currentUser
    && (currentUser.roleId === 'owner' || (currentUser.permissions.sales === true && currentUser.permissions.accounting === true)),
  );
  weeklySummaryIdentityRef.current = currentUser && canUseWeeklySummary
    ? `${currentUser.organizationId}:${currentUser.id}`
    : '';

  useEffect(() => {
    if (connectionMode !== 'remote' || !canReadAccounting) {
      setAccountingSummary(null);
      return;
    }
    let active = true;
    const year = new Date().getFullYear();
    void (async () => {
      try {
        const response = await fetch(`/api/accounting/summary?from=${year}-01-01&to=${today}`, {
          credentials: 'include',
        });
        if (!response.ok) return;
        const payload = await response.json() as Partial<DashboardAccountingSummary>;
        if (
          active
          && payload.totals
          && payload.incomeStatement
          && Array.isArray(payload.incomeStatement.expense)
          && Number.isFinite(Number(payload.totals.revenue))
          && Number.isFinite(Number(payload.totals.expense))
          && Number.isFinite(Number(payload.totals.netIncome))
        ) {
          setAccountingSummary({
            totals: {
              revenue: Number(payload.totals.revenue),
              expense: Number(payload.totals.expense),
              netIncome: Number(payload.totals.netIncome),
            },
            incomeStatement: {
              expense: payload.incomeStatement.expense
                .map((account) => ({
                  id: account.id,
                  name: String(account.name ?? 'مصروف غير محدد'),
                  amount: Number(account.amount),
                }))
                .filter((account) => Number.isFinite(account.amount)),
            },
          });
        }
      } catch {
        // The local account snapshot remains available when the summary is unavailable.
      }
    })();
    return () => { active = false; };
  }, [canReadAccounting, connectionMode, currentUser?.dataGeneration, currentUser?.organizationId, today]);

  useEffect(() => {
    if (connectionMode !== 'remote' || !canReadAccounting) {
      setDashboardJournals(journals);
      return;
    }
    let active = true;
    void (async () => {
      try {
        const response = await fetch('/api/data/journalEntries', { credentials: 'include' });
        if (!response.ok) return;
        const payload = await response.json() as { records?: Journal[] };
        if (active && Array.isArray(payload.records)) setDashboardJournals(payload.records);
      } catch {
        // Keep the shared store snapshot when the activity refresh is unavailable.
      }
    })();
    return () => { active = false; };
  }, [canReadAccounting, connectionMode, currentUser?.dataGeneration, currentUser?.organizationId, journals]);

  useEffect(() => {
    setWeeklySummary('');
    setWeeklySummaryGeneratedAt('');
    setWeeklySummaryError('');
    setWeeklySummaryStorageWarning('');
    setCopyConfirmed(false);
    setIsGeneratingWeeklySummary(false);
    if (!currentUser || !canUseWeeklySummary) return;
    const stored = readStoredWeeklySummary(currentUser.organizationId, currentUser.id);
    if (!stored) return;
    setWeeklySummary(stored.summary);
    setWeeklySummaryGeneratedAt(stored.generatedAt);
  }, [canUseWeeklySummary, currentUser?.id, currentUser?.organizationId]);

  const generateWeeklySummary = async () => {
    if (isGeneratingWeeklySummary) return;
    const requestIdentity = weeklySummaryIdentityRef.current;
    if (!requestIdentity) return;
    setIsGeneratingWeeklySummary(true);
    setWeeklySummaryError('');
    setWeeklySummaryStorageWarning('');
    setCopyConfirmed(false);
    try {
      const response = await fetch('/api/assistant/weekly-summary', {
        method: 'POST',
        credentials: 'include',
      });
      const payload = await response.json().catch(() => ({})) as {
        summary?: string;
        generatedAt?: string;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? 'تعذر توليد الملخص الأسبوعي.');
      const summary = typeof payload.summary === 'string' ? payload.summary.trim() : '';
      const generatedAt = typeof payload.generatedAt === 'string' ? payload.generatedAt : new Date().toISOString();
      if (!summary) throw new Error('لم يتمكن المساعد من إنشاء الملخص الأسبوعي.');
      if (weeklySummaryIdentityRef.current !== requestIdentity) return;
      setWeeklySummary(summary);
      setWeeklySummaryGeneratedAt(generatedAt);
      if (currentUser) {
        try {
          localStorage.setItem(
            weeklySummaryStorageKey(currentUser.organizationId, currentUser.id),
            JSON.stringify({ summary, generatedAt } satisfies StoredWeeklySummary),
          );
        } catch {
          setWeeklySummaryStorageWarning('تم توليد الملخص، لكن تعذر حفظه على هذا الجهاز.');
        }
      }
    } catch (error) {
      if (weeklySummaryIdentityRef.current === requestIdentity) {
        setWeeklySummaryError(error instanceof Error ? error.message : 'تعذر توليد الملخص الأسبوعي.');
      }
    } finally {
      if (weeklySummaryIdentityRef.current === requestIdentity) setIsGeneratingWeeklySummary(false);
    }
  };

  const copyWeeklySummary = async () => {
    if (!weeklySummary) return;
    try {
      await copyPlainText(weeklySummary);
      setCopyConfirmed(true);
      window.setTimeout(() => setCopyConfirmed(false), 2_000);
    } catch {
      setWeeklySummaryError('تعذر نسخ الملخص. يمكنك تحديد النص ونسخه يدوياً.');
    }
  };

  return (
    <div className="production-dashboard space-y-6" data-testid="page-overview">
      <section className="relative overflow-hidden rounded-[28px] border border-white/10 bg-gradient-to-br from-[#0D47D9] via-[#0A1328] to-[#0A1328] px-5 py-7 text-white shadow-2xl shadow-slate-950/20 sm:px-8 sm:py-9">
        <div className="pointer-events-none absolute -left-16 -top-20 h-64 w-64 rounded-full bg-teal-400/15 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 right-1/3 h-40 w-40 rounded-full bg-blue-400/10 blur-3xl" />
        <div className="relative flex flex-col gap-7 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-teal-200/20 bg-teal-200/10 px-3 py-1.5 text-xs font-bold text-teal-100"><CheckCircle2 className="h-4 w-4 text-teal-300" />مساحة عملك جاهزة</div>
            <h1 className="text-3xl font-black leading-tight sm:text-4xl" data-testid="text-dashboard-heading">أهلاً {currentUser?.name ? currentUser.name.split(' ')[0] : 'بك'}، إدارة أوضح تبدأ من هنا</h1>
            <p className="mt-4 max-w-xl text-sm leading-7 text-slate-300 sm:text-base">تابع مبيعاتك ومخزونك وحساباتك وفريقك من لوحة واحدة مصممة لتختصر عليك الطريق.</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/pos" data-testid="link-open-pos"><span className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-white shadow-lg shadow-teal-950/20 transition hover:bg-teal-400">افتح نقطة البيع <ArrowLeft className="h-4 w-4" /></span></Link>
              <Link href="/reports" data-testid="link-open-reports"><span className="inline-flex h-11 items-center gap-2 rounded-xl border border-white/20 bg-white/5 px-5 text-sm font-bold text-white transition hover:bg-white/10">استكشف التقارير <BarChart3 className="h-4 w-4" /></span></Link>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 lg:w-[600px]" aria-label="مؤشرات سريعة">
            <QuickMetric label="حسابات نشطة" value={accounts.length.toLocaleString('ar-SA')} testId="accounts-count" />
            <QuickMetric label="قيود مسجلة" value={journals.length.toLocaleString('ar-SA')} testId="journals-count" />
            <QuickMetric label="ذمم معلقة" value={pendingReceivables.length.toLocaleString('ar-SA')} testId="receivables-count" />
            <QuickMetric label="عروض معلقة" value={pendingQuotations.length.toLocaleString('ar-SA')} testId="pending-quotations" />
            <QuickMetric label="أوامر قيد الاستلام" value={pendingPurchaseOrders.length.toLocaleString('ar-SA')} testId="pending-purchase-orders" />
          </div>
        </div>
      </section>

      {canReadInventory && overduePurchaseOrders.length > 0 && (
        <section className="flex flex-col gap-4 rounded-2xl border border-amber-300 bg-amber-50 p-5 shadow-xl shadow-slate-950/10 sm:flex-row sm:items-center sm:justify-between" role="alert" data-testid="alert-overdue-purchase-orders">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700"><AlertTriangle className="h-5 w-5" /></span>
            <div><h2 className="font-black text-amber-950">هناك أوامر شراء متأخرة</h2><p className="mt-1 text-sm text-amber-800">{overduePurchaseOrders.length.toLocaleString('ar-SA')} أمر تجاوز تاريخ التسليم المتوقع وما زال ينتظر الاستلام.</p></div>
          </div>
          <Link href="/purchase-orders" className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-amber-900 px-4 text-sm font-bold text-white transition hover:bg-amber-950">مراجعة الأوامر <ArrowLeft className="h-4 w-4" /></Link>
        </section>
      )}

      <section aria-labelledby="financial-summary-heading">
        <div className="mb-4 flex items-end justify-between gap-4 text-white">
          <div><p className="text-xs font-bold text-teal-200">صورة سريعة</p><h2 id="financial-summary-heading" className="mt-1 text-xl font-black sm:text-2xl">ملخصك المالي</h2></div>
          <Link href="/reports" className="hidden items-center gap-1 text-xs font-bold text-teal-200 transition hover:text-white sm:inline-flex" data-testid="link-financial-reports">عرض كل التقارير <ArrowLeft className="h-3.5 w-3.5" /></Link>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <MetricCard title="صافي الربح" value={formatCurrency(netProfit)} note="الإيرادات ناقص المصروفات" icon={Wallet} tone="teal" testId="text-net-profit" />
           <MetricCard title="إجمالي الإيرادات" value={formatCurrency(totalRevenue)} note="منذ بداية السنة المالية" icon={ArrowUpRight} tone="blue" testId="text-total-revenue" />
           <MetricCard title="إجمالي المصروفات" value={formatCurrency(totalExpense)} note="المصروفات المرحّلة" icon={ArrowDownRight} tone="rose" testId="text-total-expenses" />
          <MetricCard title="الذمم المدينة (لنا)" value={formatCurrency(totalReceivables)} note="مبالغ مستحقة من العملاء" icon={ArrowUpRight} tone="sky" testId="text-total-receivables" />
          <MetricCard title="الذمم الدائنة (علينا)" value={formatCurrency(totalPayables)} note="مبالغ مستحقة للموردين" icon={ArrowDownRight} tone="rose" testId="text-total-payables" />
        </div>
      </section>

      {canUseWeeklySummary && <section
        className="overflow-hidden rounded-2xl border border-indigo-200/80 bg-gradient-to-br from-indigo-50 via-white to-teal-50 p-5 shadow-xl shadow-slate-950/10 sm:p-6"
        aria-labelledby="weekly-summary-heading"
        data-testid="card-weekly-summary"
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700">
              <Sparkles className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <h2 id="weekly-summary-heading" className="text-lg font-black text-slate-900">ملخصك الأسبوعي</h2>
              <p className="mt-1 text-xs text-slate-500" data-testid="text-weekly-summary-updated">
                {weeklySummaryGeneratedAt
                  ? `آخر تحديث: ${formatGeneratedAt(weeklySummaryGeneratedAt)}`
                  : 'آخر تحديث: لم يتم التوليد بعد'}
              </p>
            </div>
          </div>
          <Button
            type="button"
            onClick={() => void generateWeeklySummary()}
            disabled={isGeneratingWeeklySummary}
            className="gap-2 bg-indigo-700 hover:bg-indigo-800"
            data-testid="button-generate-weekly-summary"
          >
            {isGeneratingWeeklySummary
              ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
              : <Sparkles className="h-4 w-4" aria-hidden="true" />}
            {isGeneratingWeeklySummary ? 'جارٍ توليد الملخص...' : 'توليد الملخص الآن'}
          </Button>
        </div>

        <div className="mt-5 rounded-xl border border-indigo-100 bg-white/75 p-4">
          {weeklySummary ? (
            <p className="whitespace-pre-wrap text-sm leading-7 text-slate-700" data-testid="text-weekly-summary">{weeklySummary}</p>
          ) : (
            <p className="text-sm leading-7 text-slate-500">ولّد ملخصاً سريعاً لأداء مشروعك خلال الأيام السبعة الماضية.</p>
          )}
        </div>

        {weeklySummaryError && (
          <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert" data-testid="error-weekly-summary">
            {weeklySummaryError}
          </div>
        )}

        {weeklySummaryStorageWarning && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" role="status" data-testid="warning-weekly-summary-storage">
            {weeklySummaryStorageWarning}
          </div>
        )}

        {weeklySummary && (
          <div className="mt-4 flex justify-end">
            <Button type="button" variant="outline" size="sm" onClick={() => void copyWeeklySummary()} className="gap-2 bg-white/80" data-testid="button-copy-weekly-summary">
              {copyConfirmed ? <Check className="h-4 w-4 text-emerald-600" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
              {copyConfirmed ? 'تم النسخ' : 'نسخ'}
            </Button>
          </div>
        )}
      </section>}

      <section className="overview-analytics-grid" aria-label="التحليلات والنشاط">
        <DataPanel title="حركة القيود" subtitle="إجمالي القيود حسب تاريخ التسجيل" icon={BarChart3} testId="panel-journal-trend">
          <div className="overview-bars" role="img" aria-label="مخطط مبسط لحركة القيود">
            {journalTrend.map((item) => (
              <div className="overview-bar-column" key={item.label}>
                <div className="overview-bar-track"><span style={{ height: `${item.height}%` }} /></div>
                <span>{item.label}</span>
              </div>
            ))}
          </div>
        </DataPanel>
        <DataPanel title="آخر النشاطات" subtitle="أحدث القيود المسجلة في السجل" icon={ReceiptText} testId="panel-recent-activity">
          <div className="overview-activity-list">
             {recentJournals.map((journal) => (
              <div className="overview-activity-row" key={journal.id} data-testid={`row-activity-${journal.id}`}>
                <span className="overview-activity-icon"><FileText className="h-4 w-4" aria-hidden="true" /></span>
                 <div className="min-w-0 flex-1"><p className="truncate font-bold text-slate-800">{journal.description}</p><p className="text-xs text-slate-400">{journal.number} · {journal.date} · {journalSourceLabel(journal.sourceType)}</p></div>
                <span className={`overview-status ${journal.status === 'posted' ? 'is-complete' : 'is-pending'}`}>{journal.status === 'posted' ? 'مرحل' : 'مسودة'}</span>
              </div>
            ))}
             {recentJournals.length === 0 && <EmptyState text="لا توجد نشاطات مسجلة" />}
          </div>
        </DataPanel>
      </section>

      <section aria-labelledby="modules-heading">
        <div className="mb-4 flex items-end justify-between gap-4 text-white">
          <div><p className="text-xs font-bold text-teal-200">كل أعمالك في مكان واحد</p><h2 id="modules-heading" className="mt-1 text-xl font-black sm:text-2xl">الوحدات الرئيسية</h2></div>
          <span className="hidden text-xs text-slate-300 sm:block">اختر الوحدة التي تريد العمل عليها</span>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">{visibleModules.map((module) => <ModuleCard key={module.href} module={module} />)}</div>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DataPanel title="أعلى المصروفات" subtitle="الحسابات الأعلى قيمة في سجلك" icon={PackageOpen} testId="panel-top-expenses">
          <div className="space-y-1">{topExpenses.map((account) => <div key={account.id} className="flex items-center justify-between rounded-xl px-2 py-3 transition hover:bg-slate-50" data-testid={`row-expense-${account.id}`}><div><p className="text-sm font-bold text-slate-800">{account.name}</p><p className="mt-0.5 text-xs text-slate-400">{account.code}</p></div><span className="text-sm font-black text-rose-600" data-testid={`text-expense-${account.id}`}>{formatCurrency(account.balance)}</span></div>)}{topExpenses.length === 0 && <EmptyState text="لا توجد مصروفات مسجلة" />}</div>
        </DataPanel>
        <DataPanel title="مستحقات قريبة الأجل" subtitle="تابع التحصيل والدفع القادم" icon={Wallet} testId="panel-due-soon">
          {pendingReceivables.length > 0 ? (
            <div className="overflow-x-auto"><table className="overview-table" dir="rtl"><thead><tr><th>الطرف</th><th>الاستحقاق</th><th>المبلغ</th></tr></thead><tbody>{pendingReceivables.map((record) => <tr key={record.id} data-testid={`row-receivable-${record.id}`}><td><strong>{record.party}</strong><small>{record.type === 'receivable' ? 'تحصيل' : 'دفع'}</small></td><td>{record.dueDate}</td><td className="overview-table-amount">{formatCurrency(record.amount - record.paid)}</td></tr>)}</tbody></table></div>
          ) : <EmptyState text="لا توجد مستحقات معلقة" />}
        </DataPanel>
      </section>
    </div>
  );
}

function QuickMetric({ label, value, testId }: { label: string; value: string; testId: string }) {
  return <div className="rounded-2xl border border-white/10 bg-white/10 px-3 py-3 backdrop-blur"><p className="text-[11px] text-slate-300">{label}</p><p className="mt-1 text-sm font-black text-teal-200" data-testid={`text-${testId}`}>{value}</p></div>;
}

function MetricCard({ title, value, note, icon: Icon, tone, testId }: { title: string; value: string; note: string; icon: LucideIcon; tone: 'teal' | 'blue' | 'sky' | 'rose'; testId: string }) {
  const colors = { teal: 'bg-teal-50 text-teal-600', blue: 'bg-blue-50 text-blue-600', sky: 'bg-sky-50 text-sky-600', rose: 'bg-rose-50 text-rose-600' };
  return <div className="rounded-2xl border border-white/10 bg-white p-5 shadow-xl shadow-slate-950/10" data-testid={`card-${testId}`}><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-slate-500">{title}</p><p className="mt-3 text-xl font-black tracking-tight text-slate-900 sm:text-2xl" data-testid={testId}>{value}</p></div><span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${colors[tone]}`}><Icon className="h-5 w-5" /></span></div><p className="mt-3 text-xs text-slate-400">{note}</p></div>;
}

function ModuleCard({ module }: { module: Module }) {
  const Icon = module.icon;
  return <Link href={module.href} data-testid={`card-module-${module.id}`}><div className={`group relative h-full min-h-[168px] cursor-pointer rounded-2xl border p-5 shadow-xl shadow-slate-950/10 transition hover:-translate-y-1 hover:shadow-2xl ${module.id === 'pos' ? 'border-teal-300 bg-gradient-to-br from-white to-teal-50/80' : 'border-white/10 bg-white'}`}><span className={`absolute left-4 top-4 rounded-full px-2 py-1 text-[10px] font-black ${module.ready ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{module.ready ? 'متاح' : 'قيد التجهيز'}</span><div className={`flex h-11 w-11 items-center justify-center rounded-xl ${module.tone}`}><Icon className="h-5 w-5" /></div><h3 className="mt-5 text-base font-black text-slate-900">{module.title}</h3><p className="mt-2 text-xs leading-6 text-slate-500">{module.description}</p><span className="mt-4 inline-flex items-center gap-1 text-xs font-black text-primary opacity-0 transition group-hover:opacity-100">فتح الوحدة <ArrowLeft className="h-3.5 w-3.5" /></span></div></Link>;
}

function DataPanel({ title, subtitle, icon: Icon, children, testId }: { title: string; subtitle: string; icon: LucideIcon; children: ReactNode; testId: string }) {
  return <div className="rounded-2xl border border-white/10 bg-white p-5 shadow-xl shadow-slate-950/10" data-testid={testId}><div className="flex items-start gap-3 border-b border-slate-100 pb-4"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-600"><Icon className="h-5 w-5" /></span><div><h2 className="text-lg font-black text-slate-900">{title}</h2><p className="mt-1 text-xs text-slate-400">{subtitle}</p></div></div><div className="pt-2">{children}</div></div>;
}

function EmptyState({ text }: { text: string }) {
  return <div className="py-8 text-center text-sm text-slate-400">{text}</div>;
}

function journalTrendFor(journals: Array<{ date: string }>) {
  const byDate = journals.reduce<Record<string, number>>((counts, journal) => {
    counts[journal.date] = (counts[journal.date] ?? 0) + 1;
    return counts;
  }, {});
  const dates = Object.keys(byDate).sort().slice(-7);
  const max = Math.max(1, ...dates.map((date) => byDate[date]));
  return dates.map((date) => ({
    label: date.slice(5),
    height: Math.max(12, Math.round((byDate[date] / max) * 100)),
  }));
}

function compareJournalRecency(left: { date: string; id: string }, right: { date: string; id: string }): number {
  return String(right.date).localeCompare(String(left.date))
    || String(right.id).localeCompare(String(left.id), undefined, { numeric: true });
}

function journalSourceLabel(sourceType?: string): string {
  if (sourceType === 'expense' || sourceType === 'expenses') return 'مصروف';
  if (sourceType === 'sale') return 'بيع';
  if (sourceType === 'purchase') return 'شراء';
  if (sourceType === 'opening_balance' || sourceType === 'opening_balance_correction') return 'رصيد افتتاحي';
  return 'قيد يدوي';
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('ar-SA', { style: 'currency', currency: 'SAR' }).format(amount);
}

function weeklySummaryStorageKey(organizationId: number, userId: number): string {
  return `${weeklySummaryStoragePrefix}-${organizationId}-${userId}`;
}

function readStoredWeeklySummary(organizationId: number, userId: number): StoredWeeklySummary | null {
  try {
    const raw = localStorage.getItem(weeklySummaryStorageKey(organizationId, userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredWeeklySummary>;
    if (typeof parsed.summary !== 'string' || !parsed.summary.trim() || typeof parsed.generatedAt !== 'string') return null;
    if (Number.isNaN(new Date(parsed.generatedAt).getTime())) return null;
    return { summary: parsed.summary.trim(), generatedAt: parsed.generatedAt };
  } catch {
    return null;
  }
}

function formatGeneratedAt(generatedAt: string): string {
  const date = new Date(generatedAt);
  if (Number.isNaN(date.getTime())) return 'غير معروف';
  return new Intl.DateTimeFormat('ar-SA', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Riyadh',
  }).format(date);
}

async function copyPlainText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.opacity = '0';
  document.body.appendChild(textArea);
  textArea.select();
  const copied = document.execCommand('copy');
  textArea.remove();
  if (!copied) throw new Error('copy_failed');
}