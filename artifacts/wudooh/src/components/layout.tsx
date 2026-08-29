import React, { ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { Activity, AlertTriangle, BarChart3, Book, Boxes, BriefcaseBusiness, ChevronLeft, Cloud, CloudOff, CreditCard, FileText, FileBadge, LayoutDashboard, LoaderCircle, LogOut, Menu, PackageOpen, ReceiptText, RefreshCw, ShieldCheck, ShoppingCart, Smartphone, Sparkles, Store, Truck, UsersRound, Wallet, X, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ToastAction } from '@/components/ui/toast';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useStore } from '@/context/store';
import { useToast } from '@/hooks/use-toast';
import { FinancialAssistant } from '@/components/financial-assistant';

type NavigationItem = { name: string; href: string; icon: LucideIcon; permission?: string; ownerOnly?: boolean };

const navigationGroups: Array<{ label: string; items: NavigationItem[] }> = [
  { label: 'الرئيسية', items: [{ name: 'لوحة التحكم', href: '/dashboard', icon: LayoutDashboard, permission: 'dashboard' }] },
  {
    label: 'المبيعات والتشغيل',
    items: [
      { name: 'نقطة البيع', href: '/pos', icon: Store, permission: 'sales' },
      { name: 'المبيعات والعملاء', href: '/sales', icon: ShoppingCart, permission: 'sales' },
      { name: 'المخزون والمنتجات', href: '/inventory', icon: Boxes, permission: 'inventory' },
      { name: 'المشتريات والموردون', href: '/purchases', icon: Truck, permission: 'inventory' },
    ],
  },
  {
    label: 'المالية',
    items: [
      { name: 'دليل الحسابات', href: '/accounts', icon: Book, permission: 'accounting' },
      { name: 'القيود اليومية', href: '/journals', icon: FileText, permission: 'accounting' },
      { name: 'الذمم والمستحقات', href: '/receivables', icon: Wallet, permission: 'accounting' },
      { name: 'المصاريف', href: '/expenses', icon: ReceiptText, permission: 'accounting' },
      { name: 'التقارير المالية', href: '/reports', icon: BarChart3, permission: 'reports' },
      { name: 'الفوترة الإلكترونية', href: '/e-invoicing', icon: FileBadge, permission: 'accounting' },
    ],
  },
  {
    label: 'الإدارة',
    items: [
      { name: 'الموارد البشرية', href: '/hr', icon: UsersRound, permission: 'hr' },
      { name: 'العمليات والمشاريع', href: '/operations', icon: BriefcaseBusiness, permission: 'operations' },
      { name: 'سجل العمليات', href: '/operations-log', icon: Activity, ownerOnly: true },
      { name: 'إدارة الفريق', href: '/team', icon: UsersRound, ownerOnly: true },
    ],
  },
];

type FinancialAnomaly = {
  type: string;
  title: string;
  details: string;
  currentValue?: number;
  baselineValue?: number;
  changePercent?: number;
  count?: number;
  total?: number;
};

type AnomalyAnalysisResult = {
  hasAnomalies: boolean;
  anomalies: FinancialAnomaly[];
  analysis: string | null;
  analyzedAt: string;
  metrics: {
    period: { from: string; to: string };
    averagePreviousWeeklyExpenses: number;
    currentWeekExpenses: number;
    expenseChangePercent: number;
    averagePreviousWeeklySales: number;
    currentWeekSales: number;
    salesChangePercent: number;
    overdueReceivablesOverThirtyDays: number;
    unpaidInvoices: number;
  };
};

type StoredAnomalyAnalysis = {
  checkedAt: number;
  result?: AnomalyAnalysisResult;
};

const anomalyCooldownMs = 6 * 60 * 60 * 1000;
const anomalyStoragePrefix = 'wudooh-financial-anomaly-v1';
const anomalyCooldownMemory = new Map<string, number>();
const notifiedAnomalyKeys = new Set<string>();

export function AppLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const { currentUser, signOut, connectionMode, canRetrySharedConnection, syncQueue, retrySharedConnection } = useStore();
  const { toast, dismiss } = useToast();
  const dismissToastRef = React.useRef(dismiss);
  dismissToastRef.current = dismiss;
  const [isSigningOut, setIsSigningOut] = React.useState(false);
  const [phoneDialogOpen, setPhoneDialogOpen] = React.useState(false);
  const [anomalyResult, setAnomalyResult] = React.useState<AnomalyAnalysisResult | null>(null);
  const [anomalyResultIdentity, setAnomalyResultIdentity] = React.useState('');
  const [anomalyDrawerOpen, setAnomalyDrawerOpen] = React.useState(false);
  const [anomalyLoading, setAnomalyLoading] = React.useState(false);
  const [anomalyError, setAnomalyError] = React.useState('');
  const subscriptionRequired = isSubscriptionProtectedRoute(location);
  const authenticationBlocked = subscriptionRequired && !currentUser;
  const subscriptionBlocked = Boolean(currentUser && subscriptionRequired && !currentUser.subscription?.accessActive);
  const canViewCurrentRoute = !subscriptionRequired || Boolean(currentUser && !subscriptionBlocked && canAccessNavigationItem(location, currentUser));
  const canReadAnomalies = Boolean(
    currentUser
    && currentUser.subscription.accessActive
    && (currentUser.roleId === 'owner' || (currentUser.permissions.sales === true && currentUser.permissions.accounting === true)),
  );
  const anomalyScope = currentUser ? anomalyScopeFingerprint(currentUser) : '';
  const anomalyIdentity = currentUser && canReadAnomalies ? `${currentUser.organizationId}:${currentUser.id}:${anomalyScope}` : '';
  const visibleAnomalyResult = anomalyResultIdentity === anomalyIdentity ? anomalyResult : null;
  const anomalyIdentityRef = React.useRef('');
  anomalyIdentityRef.current = anomalyIdentity;
  const closeSidebar = () => setSidebarOpen(false);
  const visibleGroups = navigationGroups
    .map((group) => ({ ...group, items: group.items.filter((item) => !currentUser || (item.ownerOnly ? currentUser.roleId === 'owner' : canAccessNavigationItem(item.href, currentUser))) }))
    .filter((group) => group.items.length > 0);

  React.useEffect(() => {
    if (!anomalyIdentity || !currentUser) return;
    setAnomalyResult(null);
    setAnomalyResultIdentity('');
    setAnomalyDrawerOpen(false);
    setAnomalyLoading(false);
    setAnomalyError('');
    const storageKey = anomalyStorageKey(currentUser.organizationId, currentUser.id, anomalyScope);
    const previous = readStoredAnomalyAnalysis(storageKey);
    const now = Date.now();
    const cooldownUntil = Math.max(previous?.checkedAt ?? 0, anomalyCooldownMemory.get(storageKey) ?? 0) + anomalyCooldownMs;
    let toastId: string | undefined;

    const showAnomalyToast = (result: AnomalyAnalysisResult) => {
      if (!result.hasAnomalies || notifiedAnomalyKeys.has(storageKey)) return;
      notifiedAnomalyKeys.add(storageKey);
      const firstAnomaly = result.anomalies[0];
      const description = result.analysis || firstAnomaly?.details || 'يرجى مراجعة التفاصيل المالية لمنشأتك.';
      toastId = toast({
        title: 'تنبيه مالي ذكي',
        description,
        className: 'border-amber-300 bg-amber-50 text-amber-950',
        action: (
          <ToastAction altText="عرض تفاصيل التنبيه المالي" onClick={() => setAnomalyDrawerOpen(true)} className="border-amber-400 text-amber-900 hover:bg-amber-100">
            عرض التفاصيل
          </ToastAction>
        ),
      }).id;
    };

    if (now < cooldownUntil) {
      if (previous?.result) {
        setAnomalyResult(previous.result);
        setAnomalyResultIdentity(anomalyIdentity);
        showAnomalyToast(previous.result);
      }
      return () => { if (toastId) dismissToastRef.current(toastId); };
    }

    anomalyCooldownMemory.set(storageKey, now);
    try {
      localStorage.setItem(storageKey, JSON.stringify({ checkedAt: now }));
    } catch {
      // The in-memory cooldown still prevents duplicate requests in this session.
    }
    setAnomalyLoading(true);
    setAnomalyError('');
    let active = true;
    void analyzeAnomalies()
      .then((result) => {
        if (!active || anomalyIdentityRef.current !== anomalyIdentity) return;
        setAnomalyResult(result);
        setAnomalyResultIdentity(anomalyIdentity);
        try {
          localStorage.setItem(storageKey, JSON.stringify({ checkedAt: Date.now(), result } satisfies StoredAnomalyAnalysis));
        } catch {
          // The current result remains visible even when local storage is unavailable.
        }
        showAnomalyToast(result);
      })
      .catch((error: unknown) => {
        if (active && anomalyIdentityRef.current === anomalyIdentity) {
          setAnomalyError(error instanceof Error ? error.message : 'تعذر تحليل التنبيهات المالية.');
        }
      })
      .finally(() => {
        if (active && anomalyIdentityRef.current === anomalyIdentity) setAnomalyLoading(false);
      });
    return () => {
      active = false;
      if (toastId) dismissToastRef.current(toastId);
    };
  }, [anomalyIdentity, anomalyScope, currentUser?.id, currentUser?.organizationId, toast]);

  if (connectionMode === 'loading') {
    return <div className="flex min-h-screen items-center justify-center bg-[#061d40] p-4" dir="rtl"><DashboardLoading /></div>;
  }

  if (authenticationBlocked || subscriptionBlocked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#061d40] p-4" dir="rtl">
        <div className="w-full max-w-2xl">
          {authenticationBlocked ? <AuthenticationRequiredRoute /> : <SubscriptionRestrictedRoute />}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#061d40] font-sans text-slate-900" dir="rtl">
      <div className="flex min-h-screen flex-col md:flex-row">
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 pb-3 pt-[max(env(safe-area-inset-top),0.75rem)] md:hidden">
          <BrandLockup />
          <Button variant="outline" size="sm" className="gap-2 border-slate-200 text-slate-700" onClick={() => setSidebarOpen((open) => !open)} data-testid="button-menu" aria-label={sidebarOpen ? 'إغلاق القائمة' : 'فتح القائمة'}>
            {sidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />} لوحة التحكم
          </Button>
        </div>

        {sidebarOpen && <button type="button" className="fixed inset-0 z-20 bg-slate-950/40 md:hidden" onClick={closeSidebar} aria-label="إغلاق القائمة" data-testid="button-close-menu-overlay" />}

        <aside className={`${sidebarOpen ? 'translate-x-0' : 'translate-x-full'} fixed inset-y-0 right-0 z-30 flex w-[286px] flex-col border-l border-white/10 bg-[#062344] pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] text-white shadow-2xl transition-transform duration-200 md:static md:z-auto md:w-72 md:translate-x-0 md:shadow-none`}>
          <div className="border-b border-white/10 px-6 py-6">
            <BrandLockup dark />
            <div className="mt-6 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
              <p className="text-xs font-semibold text-teal-200">مساحة العمل</p>
              <p className="mt-1 truncate text-sm font-bold text-white">{currentUser?.projectName ?? 'منشأتك'}</p>
              <p className="mt-1 truncate text-xs text-slate-400">{currentUser?.name ?? 'نظرة عامة على أعمالك'}</p>
            </div>
          </div>

          <nav className="flex-1 space-y-6 overflow-y-auto px-4 py-6" aria-label="القائمة الرئيسية">
            {visibleGroups.map((group) => (
              <div key={group.label}>
                <p className="mb-2 px-3 text-[11px] font-bold tracking-wide text-slate-400">{group.label}</p>
                <div className="space-y-1">
                  {group.items.map((item) => {
                    const isActive = location === item.href;
                    return (
                      <Link key={item.href} href={item.href} onClick={closeSidebar} data-testid={`link-${item.href.replace('/', '') || 'home'}`}>
                        <div className={`group flex cursor-pointer items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold transition ${isActive ? 'bg-teal-400 text-[#062344] shadow-lg shadow-teal-950/20' : 'text-slate-200 hover:bg-white/10 hover:text-white'}`}>
                          <item.icon className={`h-[18px] w-[18px] shrink-0 ${isActive ? 'text-[#062344]' : 'text-teal-200'}`} />
                          <span className="flex-1">{item.name}</span>
                          {isActive && <ChevronLeft className="h-4 w-4" />}
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
          </nav>

          <div className="border-t border-white/10 p-4">
            <div className="rounded-2xl bg-white/5 p-3 text-xs leading-6 text-slate-300">
              <div className="flex items-center gap-2 font-bold text-white"><PackageOpen className="h-4 w-4 text-teal-300" />ترصيد لإدارة أوضح</div>
              <p className="mt-1">كل عمليات منشأتك في مكان واحد.</p>
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-x-hidden">
          <div className="mx-auto max-w-[1440px] p-4 sm:p-6 lg:p-8">
            {currentUser && (
              <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-white shadow-xl shadow-slate-950/10 backdrop-blur sm:flex-row sm:items-center sm:justify-between" data-testid="shared-account-bar">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="min-w-0"><p className="truncate text-sm font-bold">{currentUser.projectName}</p><p className="truncate text-xs text-slate-300">{currentUser.name} · {currentUser.email}</p></div>
                  <ConnectionStatus mode={connectionMode} canRetrySharedConnection={canRetrySharedConnection} syncQueue={syncQueue} onRetry={() => void retrySharedConnection()} />
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button type="button" variant="outline" size="sm" className="border-white/20 bg-white/5 text-white hover:bg-white/15 hover:text-white" onClick={() => setPhoneDialogOpen(true)} data-testid="button-change-phone">
                    <Smartphone aria-hidden="true" />تغيير الجوال
                  </Button>
                  <Button type="button" variant="outline" size="sm" className="border-white/20 bg-white/5 text-white hover:bg-white/15 hover:text-white" disabled={isSigningOut} onClick={async () => { setIsSigningOut(true); try { await signOut(); } finally { setIsSigningOut(false); } }} data-testid="button-sign-out">
                    {isSigningOut ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <LogOut aria-hidden="true" />}{isSigningOut ? 'جارٍ تسجيل الخروج...' : 'تسجيل الخروج'}
                  </Button>
                </div>
              </div>
            )}
            {canViewCurrentRoute ? children : <RestrictedRoute />}
          </div>
        </main>
      </div>
      <PhoneChangeDialog
        open={phoneDialogOpen}
        currentPhone={currentUser?.phone ?? null}
        onOpenChange={setPhoneDialogOpen}
        onCompleted={() => void signOut()}
      />
      <FinancialAnomalyDrawer
        result={visibleAnomalyResult}
        loading={anomalyLoading}
        error={anomalyError}
        open={anomalyDrawerOpen && Boolean(visibleAnomalyResult)}
        onOpenChange={setAnomalyDrawerOpen}
      />
      <FinancialAssistant />
    </div>
  );
}

async function analyzeAnomalies(): Promise<AnomalyAnalysisResult> {
  const response = await fetch('/api/assistant/anomalies', {
    method: 'POST',
    credentials: 'include',
  });
  const payload = await response.json().catch(() => ({})) as Partial<AnomalyAnalysisResult> & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? 'تعذر تحليل التنبيهات المالية.');
  if (!Array.isArray(payload.anomalies) || typeof payload.hasAnomalies !== 'boolean' || typeof payload.analyzedAt !== 'string') {
    throw new Error('استجابة تحليل التنبيهات المالية غير صالحة.');
  }
  return {
    hasAnomalies: payload.hasAnomalies,
    anomalies: payload.anomalies as FinancialAnomaly[],
    analysis: typeof payload.analysis === 'string' ? payload.analysis : null,
    analyzedAt: payload.analyzedAt,
    metrics: payload.metrics as AnomalyAnalysisResult['metrics'],
  };
}

function anomalyScopeFingerprint(user: {
  dataGeneration: number;
  roleId: string;
  locationScope: string;
  warehouseIds: number[];
  permissions: Record<string, boolean>;
}): string {
  return [
    user.dataGeneration,
    user.roleId,
    user.locationScope,
    [...user.warehouseIds].map(Number).sort((left, right) => left - right).join('.'),
    user.permissions.sales === true ? 's1' : 's0',
    user.permissions.accounting === true ? 'a1' : 'a0',
  ].join('-');
}

function anomalyStorageKey(organizationId: number, userId: number, scope: string): string {
  return `${anomalyStoragePrefix}-${organizationId}-${userId}-${scope}`;
}

function readStoredAnomalyAnalysis(storageKey: string): StoredAnomalyAnalysis | null {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredAnomalyAnalysis>;
    if (!Number.isFinite(parsed.checkedAt)) return null;
    if (parsed.result !== undefined && (!parsed.result || typeof parsed.result !== 'object')) return null;
    return parsed as StoredAnomalyAnalysis;
  } catch {
    return null;
  }
}

function FinancialAnomalyDrawer({
  result,
  loading,
  error,
  open,
  onOpenChange,
}: {
  result: AnomalyAnalysisResult | null;
  loading: boolean;
  error: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" dir="rtl" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader className="text-right sm:text-right">
          <SheetTitle className="flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-500" />التنبيه المالي الذكي</SheetTitle>
          <SheetDescription>تحليل تلقائي لأداء منشأتك مقارنة بالفترات السابقة.</SheetDescription>
        </SheetHeader>
        {loading && <div className="mt-8 rounded-xl bg-slate-50 p-5 text-center text-sm text-slate-500">جارٍ تحليل المؤشرات المالية...</div>}
        {error && <div className="mt-8 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700" role="alert">{error}</div>}
        {result && (
          <div className="mt-6 space-y-5">
            {result.analysis && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-7 text-amber-950">
                <div className="mb-2 flex items-center gap-2 font-black"><Sparkles className="h-4 w-4 text-amber-600" />تحليل المراقب المالي</div>
                <p>{result.analysis}</p>
              </div>
            )}
            <div className="space-y-3">
              {result.anomalies.map((anomaly) => (
                <div key={anomaly.type} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="font-black text-slate-900">{anomaly.title}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{anomaly.details}</p>
                </div>
              ))}
              {!result.anomalies.length && <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">لم يرصد التحليل أي شذوذ مالي يتجاوز الحدود المحددة.</div>}
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm">
              <p className="font-black text-slate-800">الفترة محل التحليل</p>
              <p className="mt-1 text-slate-500">{result.metrics.period.from} إلى {result.metrics.period.to}</p>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <AnomalyMetric label="مصاريف الأسبوع" value={formatAnomalyNumber(result.metrics.currentWeekExpenses)} />
                <AnomalyMetric label="تغير المصاريف" value={formatPercent(result.metrics.expenseChangePercent)} />
                <AnomalyMetric label="مبيعات الأسبوع" value={formatAnomalyNumber(result.metrics.currentWeekSales)} />
                <AnomalyMetric label="تغير المبيعات" value={formatPercent(result.metrics.salesChangePercent)} />
                <AnomalyMetric label="ذمم +30 يوماً" value={String(result.metrics.overdueReceivablesOverThirtyDays)} />
                <AnomalyMetric label="فواتير غير مدفوعة" value={String(result.metrics.unpaidInvoices)} />
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function AnomalyMetric({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg bg-white p-3"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 font-black text-slate-900">{value}</p></div>;
}

function formatAnomalyNumber(value: number): string {
  return new Intl.NumberFormat('ar-SA', { maximumFractionDigits: 2 }).format(value);
}

function formatPercent(value: number): string {
  return `${new Intl.NumberFormat('ar-SA', { maximumFractionDigits: 1, signDisplay: 'exceptZero' }).format(value)}٪`;
}

function PhoneChangeDialog({
  open,
  currentPhone,
  onOpenChange,
  onCompleted,
}: {
  open: boolean;
  currentPhone: string | null;
  onOpenChange: (open: boolean) => void;
  onCompleted: () => void;
}) {
  const [step, setStep] = React.useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = React.useState('');
  const [code, setCode] = React.useState('');
  const [maskedPhone, setMaskedPhone] = React.useState('');
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setStep('phone');
    setPhone('');
    setCode('');
    setMaskedPhone('');
    setError('');
  }, [open]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await fetch(step === 'phone' ? '/api/auth/phone-change/request' : '/api/auth/phone-change/verify', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(step === 'phone' ? { phone } : { code }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string; phone?: string };
      if (!response.ok) throw new Error(payload.error ?? 'تعذر تحديث رقم الجوال.');
      if (step === 'phone') {
        setMaskedPhone(payload.phone ?? phone);
        setStep('code');
        return;
      }
      onOpenChange(false);
      onCompleted();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'تعذر تحديث رقم الجوال.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle>تغيير رقم الجوال</DialogTitle>
          <DialogDescription>
            {step === 'phone'
              ? `رقمك الحالي ${currentPhone ?? 'غير مسجل'}. سيبقى صالحاً حتى توثيق الرقم الجديد.`
              : `أدخل الرمز المرسل إلى ${maskedPhone}. بعد النجاح ستحتاج إلى تسجيل الدخول مجدداً.`}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          {step === 'phone' ? (
            <div className="space-y-2">
              <Label htmlFor="new-phone">رقم الجوال الجديد</Label>
              <Input id="new-phone" type="tel" dir="ltr" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="05xxxxxxxx" autoComplete="tel" data-testid="input-new-phone" />
            </div>
          ) : (
            <div className="space-y-2">
              <Label htmlFor="new-phone-code">رمز التحقق</Label>
              <Input id="new-phone-code" inputMode="numeric" autoComplete="one-time-code" dir="ltr" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} className="text-center text-xl tracking-[0.35em]" data-testid="input-new-phone-code" />
            </div>
          )}
          {error && <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{error}</div>}
          <Button type="submit" className="w-full" disabled={loading || (step === 'phone' ? !phone.trim() : code.length !== 6)} data-testid="button-submit-phone-change">
            {loading ? <LoaderCircle className="animate-spin" /> : <ShieldCheck />}
            {loading ? 'جارٍ التحقق...' : step === 'phone' ? 'إرسال رمز التحقق' : 'توثيق الرقم الجديد'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function BrandLockup({ dark = false }: { dark?: boolean }) {
  return (
    <div className={`flex items-center gap-3 ${dark ? 'text-white' : 'text-[#062344]'}`}>
      <div className="relative h-11 w-11 shrink-0 overflow-hidden">
        <img src={`${import.meta.env.BASE_URL}logo-transparent.png`} alt="شعار ترصيد" className={`absolute max-w-none ${dark ? 'brightness-0 invert' : ''}`} style={{ width: '115px', right: '-34px', top: '-22px' }} />
      </div>
      <div><p className="text-lg font-black leading-none">ترصيد</p><p className={`mt-1 text-[10px] font-semibold ${dark ? 'text-slate-400' : 'text-slate-500'}`}>إدارة أسهل لنمو أسرع</p></div>
    </div>
  );
}

function DashboardLoading() {
  return <div className="flex min-h-72 flex-col items-center justify-center rounded-3xl border border-white/10 bg-white p-8 text-center shadow-xl" role="status" data-testid="dashboard-content-loading"><LoaderCircle className="h-6 w-6 animate-spin text-primary" aria-hidden="true" /><p className="mt-3 font-semibold text-slate-800">جارٍ التحقق من صلاحيات الوصول</p><p className="mt-1 text-sm text-slate-500">لن نعرض بيانات السجل المشترك قبل تأكيد جلسة الدخول.</p></div>;
}

function RestrictedRoute() {
  return <div className="rounded-3xl border border-white/10 bg-white p-10 text-center shadow-xl" data-testid="restricted-route-message"><CloudOff className="mx-auto h-9 w-9 text-slate-300" aria-hidden="true" /><h2 className="mt-4 text-xl font-bold text-slate-900">هذه الوحدة غير متاحة لحسابك</h2><p className="mx-auto mt-2 max-w-md text-sm text-slate-500">تواصل مع مالك المنشأة إذا كنت تحتاج إلى صلاحية الوصول إليها.</p></div>;
}

function SubscriptionRestrictedRoute() {
  return <div className="rounded-3xl border border-white/10 bg-white p-10 text-center shadow-xl" data-testid="subscription-restricted-message">
    <CreditCard className="mx-auto h-9 w-9 text-amber-500" aria-hidden="true" />
    <h2 className="mt-4 text-xl font-bold text-slate-900">لوحة التحكم غير متاحة حالياً</h2>
    <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">يلزم اشتراك فعال أو فترة تجريبية سارية للدخول إلى مساحة العمل. يمكنك مراجعة حالة حسابك من بوابة المدير.</p>
    <Link href="/manager" className="mt-6 inline-flex h-11 items-center justify-center rounded-xl bg-[#062344] px-5 text-sm font-bold text-white transition hover:bg-[#0a426f]" data-testid="link-manager-portal">الذهاب إلى بوابة المدير</Link>
  </div>;
}

function AuthenticationRequiredRoute() {
  return <div className="rounded-3xl border border-white/10 bg-white p-10 text-center shadow-xl" data-testid="authentication-required-message">
    <CloudOff className="mx-auto h-9 w-9 text-slate-400" aria-hidden="true" />
    <h2 className="mt-4 text-xl font-bold text-slate-900">سجّل الدخول للوصول إلى مساحة العمل</h2>
    <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500">نحتاج إلى التحقق من حسابك وحالة اشتراك المنشأة قبل عرض بيانات لوحة التحكم.</p>
    <Link href="/" className="mt-6 inline-flex h-11 items-center justify-center rounded-xl bg-[#062344] px-5 text-sm font-bold text-white transition hover:bg-[#0a426f]" data-testid="link-sign-in">العودة لتسجيل الدخول</Link>
  </div>;
}

function isSubscriptionProtectedRoute(href: string): boolean {
  return new Set(['/dashboard', '/pos', '/sales', '/inventory', '/purchases', '/accounts', '/journals', '/receivables', '/expenses', '/reports', '/hr', '/operations', '/team', '/operations-log', '/e-invoicing']).has(href);
}

function canAccessNavigationItem(href: string, user: { roleId: string; permissions: Record<string, boolean> }): boolean {
  if (user.roleId === 'owner') return true;
  if (href === '/e-invoicing') return user.permissions['accounting'] === true || user.permissions['sales'] === true;
  const permissionByRoute: Record<string, string> = { '/dashboard': 'dashboard', '/pos': 'sales', '/sales': 'sales', '/inventory': 'inventory', '/purchases': 'inventory', '/accounts': 'accounting', '/journals': 'accounting', '/receivables': 'accounting', '/expenses': 'accounting', '/reports': 'reports', '/hr': 'hr', '/operations': 'operations', '/team': '__owner__', '/operations-log': '__owner__' };
  const permission = permissionByRoute[href];
  return permission ? user.permissions[permission] === true : false;
}

function ConnectionStatus({ mode, canRetrySharedConnection, syncQueue, onRetry }: { mode: 'loading' | 'remote' | 'local'; canRetrySharedConnection: boolean; syncQueue: Array<{ status: 'pending' | 'failed'; error?: string }>; onRetry: () => void }) {
  const failedOperations = syncQueue.filter((operation) => operation.status === 'failed').length;
  const queueMessage = failedOperations ? `تعذرت مزامنة ${failedOperations} من ${syncQueue.length} عملية محفوظة محلياً.` : `هناك ${syncQueue.length} عملية محفوظة محلياً بانتظار المزامنة.`;
  const statusLabel = mode === 'loading' ? 'جارٍ التحقق من الاتصال' : mode === 'remote' ? 'متصل بسجل المنشأة المشترك' : canRetrySharedConnection ? 'غير متصل بالسجل المشترك' : 'وضع البيانات المحلي';
  const statusDescription = mode === 'loading'
    ? 'نحاول الاتصال بسجل المنشأة المشترك.'
    : mode === 'remote'
      ? 'التغييرات محفوظة وتظهر للأجهزة وأعضاء الفريق المصرح لهم.'
      : canRetrySharedConnection
        ? 'نعرض البيانات المحفوظة محلياً. اضغط على السحابة لإعادة الاتصال.'
        : 'التغييرات محفوظة في هذا المتصفح فقط. سجّل الدخول للاتصال بسجل المنشأة المشترك.';
  const StatusIcon = mode === 'loading' ? LoaderCircle : mode === 'remote' ? Cloud : CloudOff;
  const statusColor = mode === 'loading' ? 'text-slate-300' : mode === 'remote' ? 'text-emerald-300' : 'text-rose-300';
  const statusTestId = `connection-status-${mode}`;
  const indicator = (
    <span className={`relative inline-flex h-9 w-9 items-center justify-center rounded-full border bg-white/5 ${mode === 'remote' ? 'border-emerald-300/30' : mode === 'local' ? 'border-rose-300/30' : 'border-white/20'}`} role={mode === 'local' ? 'alert' : 'status'} aria-live="polite" data-testid={statusTestId} aria-label={statusLabel}>
      <StatusIcon className={`h-[18px] w-[18px] ${statusColor} ${mode === 'loading' ? 'animate-spin' : ''}`} aria-hidden="true" />
      {mode !== 'loading' && <span className={`absolute bottom-1 right-1 h-2 w-2 rounded-full border-2 border-[#102e54] ${mode === 'remote' ? 'bg-emerald-400' : 'bg-rose-400'}`} aria-hidden="true" />}
      <span className="sr-only">{statusLabel}: {statusDescription}</span>
    </span>
  );

  return (
    <div className="flex shrink-0 items-center gap-2">
      <Tooltip>
        <TooltipTrigger asChild>
          {mode === 'local' && canRetrySharedConnection
            ? <Button type="button" variant="ghost" size="icon" className="h-9 w-9 rounded-full p-0 hover:bg-rose-400/10" onClick={onRetry} data-testid="button-retry-shared-connection" aria-label="إعادة الاتصال بالسجل المشترك">{indicator}</Button>
            : indicator}
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-xs text-right">
          <p className="font-semibold">{statusLabel}</p>
          <p className="mt-1 text-xs opacity-90">{statusDescription}</p>
        </TooltipContent>
      </Tooltip>
      {syncQueue.length > 0 && (
        <div className="flex items-center gap-1 rounded-full border border-amber-300/30 bg-amber-300/10 px-2 py-1 text-[11px] font-semibold text-amber-100" role={failedOperations > 0 ? 'alert' : 'status'} aria-live="polite" data-testid="sync-queue-status">
          <span aria-hidden="true">{syncQueue.length}</span>
          <span className="sr-only">{queueMessage} ستتم محاولة الإرسال بالترتيب عند إعادة الاتصال.</span>
          {syncQueue.length > 0 && (
            <Button type="button" variant="ghost" size="icon" className="h-5 w-5 rounded-full p-0 text-amber-100 hover:bg-amber-200/20 hover:text-white" onClick={onRetry} data-testid={mode === 'remote' ? 'button-retry-sync-queue' : undefined} aria-label="إعادة محاولة المزامنة">
              <RefreshCw className="h-3 w-3" aria-hidden="true" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}