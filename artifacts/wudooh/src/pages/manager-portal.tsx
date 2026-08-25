import { useEffect, useState } from 'react';
import { useStore } from '@/context/store';
import { Link, useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { 
  Building2, 
  User, 
  CreditCard, 
  LogOut, 
  ArrowLeft, 
  ShieldCheck, 
  Clock, 
  AlertTriangle,
  LoaderCircle,
  CalendarDays,
  Briefcase
} from 'lucide-react';

type BillingPlan = {
  id: string;
  name: string;
  description: string | null;
  prices: Array<{
    id: string;
    amount: number | null;
    currency: string;
    interval: string | null;
    intervalCount: number | null;
  }>;
};

export default function ManagerPortal() {
  const { currentUser, signOut, connectionMode, refreshSession } = useStore();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [plans, setPlans] = useState<BillingPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [plansError, setPlansError] = useState('');
  const [billingError, setBillingError] = useState('');
  const [billingMessage, setBillingMessage] = useState('');
  const [billingAction, setBillingAction] = useState<'checkout' | 'portal' | null>(null);
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!currentUser) {
      setPlansLoading(false);
      return;
    }
    let active = true;
    const loadPlans = async () => {
      setPlansLoading(true);
      setPlansError('');
      try {
        const response = await fetch('/api/billing/plans', { cache: 'no-store' });
        const payload = await response.json() as { plans?: BillingPlan[]; error?: string };
        if (!response.ok || !Array.isArray(payload.plans)) throw new Error(payload.error ?? 'تعذر تحميل الباقات.');
        if (active) setPlans(payload.plans);
      } catch (error) {
        if (active) setPlansError(error instanceof Error ? error.message : 'تعذر تحميل الباقات.');
      } finally {
        if (active) setPlansLoading(false);
      }
    };
    void loadPlans();
    return () => { active = false; };
  }, [currentUser?.organizationId]);

  useEffect(() => {
    if (!currentUser || new URLSearchParams(window.location.search).get('billing') !== 'success') return;
    let active = true;
    setBillingMessage('تم استلام عملية الدفع. نتحقق الآن من تفعيل اشتراكك.');
    const refresh = async () => {
      await refreshSession();
      if (active && currentUser.subscription.status === 'active') {
        setBillingMessage('تم تفعيل اشتراكك بنجاح.');
      }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 3_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [currentUser?.subscription.status, refreshSession]);

  if (!currentUser) {
    return (
      <div className="min-h-[100dvh] bg-[#061d40] flex flex-col items-center justify-center text-white" dir="rtl">
        {connectionMode === 'loading' ? (
          <>
            <LoaderCircle className="mb-6 h-10 w-10 animate-spin text-teal-400" />
            <p className="text-lg font-medium text-slate-300">جارٍ تحميل بيانات الحساب...</p>
          </>
        ) : (
          <div className="max-w-md px-6 text-center">
            <CreditCard className="mx-auto mb-5 h-10 w-10 text-teal-300" />
            <h1 className="text-2xl font-black text-white">سجّل الدخول لعرض بوابة الحساب</h1>
            <p className="mt-3 leading-7 text-slate-300">ستظهر هنا بيانات منشأتك وخطتك وحالة الوصول إلى مساحة العمل.</p>
            <Link href="/" className="mt-7 inline-flex h-11 items-center justify-center rounded-xl bg-teal-400 px-5 text-sm font-bold text-[#061d40] transition hover:bg-teal-300" data-testid="link-login-from-manager">العودة إلى الصفحة الرئيسية</Link>
          </div>
        )}
      </div>
    );
  }

  const user = currentUser;
  const sub = user.subscription;
  const isOwner = user.roleId === 'owner';
  const isActive = sub?.status === 'active';

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await signOut();
      setLocation('/');
    } catch (error) {
      setIsSigningOut(false);
    }
  };

  const formatPrice = (price: BillingPlan['prices'][number]) => {
    if (price.amount === null) return 'السعر عند الطلب';
    return new Intl.NumberFormat('ar-SA', {
      style: 'currency',
      currency: price.currency.toUpperCase(),
      maximumFractionDigits: 0,
    }).format(price.amount / 100);
  };

  const checkout = async (priceId: string) => {
    setBillingAction('checkout');
    setBillingError('');
    try {
      const response = await fetch('/api/billing/checkout', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ priceId }),
      });
      const payload = await response.json() as { url?: string; error?: string };
      if (!response.ok || !payload.url) throw new Error(payload.error ?? 'تعذر فتح صفحة الدفع.');
      window.location.assign(payload.url);
    } catch (error) {
      setBillingError(error instanceof Error ? error.message : 'تعذر فتح صفحة الدفع.');
      setBillingAction(null);
    }
  };

  const openPortal = async () => {
    setBillingAction('portal');
    setBillingError('');
    try {
      const response = await fetch('/api/billing/portal', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
      });
      const payload = await response.json() as { url?: string; error?: string };
      if (!response.ok || !payload.url) throw new Error(payload.error ?? 'تعذر فتح إدارة الاشتراك.');
      window.location.assign(payload.url);
    } catch (error) {
      setBillingError(error instanceof Error ? error.message : 'تعذر فتح إدارة الاشتراك.');
      setBillingAction(null);
    }
  };

  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return '—';
    try {
      return new Intl.DateTimeFormat('ar-SA', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      }).format(new Date(dateStr));
    } catch {
      return dateStr;
    }
  };

  const statusConfig = {
    trialing: { label: 'فترة تجريبية', color: 'bg-amber-500/10 text-amber-400 border-amber-500/20', icon: Clock },
    active: { label: 'نشط', color: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', icon: ShieldCheck },
    expired: { label: 'منتهي', color: 'bg-rose-500/10 text-rose-400 border-rose-500/20', icon: AlertTriangle },
    inactive: { label: 'غير نشط', color: 'bg-slate-500/10 text-slate-400 border-slate-500/20', icon: AlertTriangle },
  };

  const currentStatus = sub ? statusConfig[sub.status] : statusConfig['inactive'];
  const StatusIcon = currentStatus.icon;

  return (
    <div className="min-h-[100dvh] bg-[#061d40] flex flex-col font-sans selection:bg-teal-500/30 text-slate-200" dir="rtl">
      {/* Top Bar */}
      <header className="px-6 py-4 flex items-center justify-between border-b border-white/5 bg-[#062344]/50 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-white/5 flex items-center justify-center border border-white/10 shadow-inner">
             <img 
               src={`${import.meta.env.BASE_URL}logo-transparent.png`} 
               alt="شعار ترصيد" 
               className="absolute max-w-none brightness-0 invert" 
               style={{ width: '100px', right: '-30px', top: '-18px' }} 
             />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white tracking-tight" data-testid="portal-heading">بوابة الحساب</h1>
            <p className="text-xs text-teal-200/70 font-medium">ترصيد لإدارة أوضح</p>
          </div>
        </div>
        
        <Button 
          variant="outline" 
          size="sm" 
          onClick={handleSignOut}
          disabled={isSigningOut}
          className="border-white/10 bg-white/5 text-white hover:bg-white/10 hover:text-white transition-all shadow-sm"
          data-testid="button-sign-out"
        >
          {isSigningOut ? <LoaderCircle className="h-4 w-4 animate-spin ml-2" /> : <LogOut className="h-4 w-4 ml-2" />}
          تسجيل الخروج
        </Button>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center p-4 sm:p-6 md:p-12 relative overflow-hidden">
        {/* Decorative background blur */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] md:w-[600px] md:h-[600px] bg-teal-500/10 blur-[100px] md:blur-[120px] rounded-full pointer-events-none" />

        <div className="w-full max-w-4xl relative z-10 space-y-6">
          
          {/* Welcome Section */}
          <div className="text-center space-y-3 mb-8 md:mb-12">
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-black text-white tracking-tight">أهلاً بك، {user.name}</h2>
            <p className="text-slate-400 text-base md:text-lg max-w-xl mx-auto leading-relaxed">
              إليك نظرة عامة على حالة حسابك ومنشأتك. يمكنك استعراض التفاصيل قبل الدخول لمساحة العمل.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-6">
            {/* Organization Card */}
            <div className="bg-[#0a2a4e]/80 backdrop-blur-xl border border-white/10 rounded-3xl p-5 md:p-6 shadow-2xl transition-all hover:border-white/20 hover:bg-[#0a2a4e]">
              <div className="flex items-center gap-4 mb-6">
                <div className="p-3 bg-teal-500/20 text-teal-400 rounded-2xl shadow-inner shrink-0">
                  <Building2 className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white leading-tight">بيانات المنشأة</h3>
                  <p className="text-sm text-slate-400">معلومات مساحة العمل</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex flex-col gap-1.5 pb-4 border-b border-white/5">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">اسم المنشأة</span>
                  <span className="text-lg font-bold text-white">{user.projectName || '—'}</span>
                </div>
                <div className="flex flex-col gap-1.5 pb-2">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">الرقم المرجعي للمنشأة (ID)</span>
                  <span className="text-base font-mono text-slate-200">{user.organizationId || '—'}</span>
                </div>
              </div>
            </div>

            {/* User Details Card */}
            <div className="bg-[#0a2a4e]/80 backdrop-blur-xl border border-white/10 rounded-3xl p-5 md:p-6 shadow-2xl transition-all hover:border-white/20 hover:bg-[#0a2a4e]">
              <div className="flex items-center gap-4 mb-6">
                <div className="p-3 bg-blue-500/20 text-blue-400 rounded-2xl shadow-inner shrink-0">
                  <User className="h-6 w-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white leading-tight">بيانات المستخدم</h3>
                  <p className="text-sm text-slate-400">حسابك الشخصي وصلاحياتك</p>
                </div>
              </div>

              <div className="space-y-4">
                <div className="flex flex-col gap-1.5 pb-4 border-b border-white/5">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">البريد الإلكتروني</span>
                  <span className="text-base font-medium text-white truncate" title={user.email}>{user.email || '—'}</span>
                </div>
                <div className="flex flex-col gap-1.5 pb-2">
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">الصلاحية المعينة</span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Briefcase className="h-4 w-4 text-slate-400 shrink-0" />
                    <span className="text-base font-medium text-slate-200">
                      {user.roleId === 'owner' ? 'المالك (وصول كامل)' : user.roleId === 'admin' ? 'مدير النظام' : 'مستخدم'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Subscription Status Card - Full Width */}
          <div className="bg-gradient-to-br from-[#062344] to-[#0a2a4e] border border-white/10 rounded-3xl p-1 shadow-2xl relative overflow-hidden">
             {/* Inner border line for premium feel */}
            <div className="bg-[#061d40]/90 rounded-[22px] p-5 md:p-8 backdrop-blur-xl h-full w-full">
              
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-5 mb-8">
                <div className="flex items-center gap-4">
                  <div className={`p-4 rounded-2xl shadow-inner border shrink-0 ${currentStatus.color}`}>
                    <CreditCard className="h-6 w-6 sm:h-7 sm:w-7" />
                  </div>
                  <div>
                    <h3 className="text-lg sm:text-xl font-bold text-white">الاشتراك والوصول</h3>
                    <p className="text-sm text-slate-400 mt-1">حالة الباقة الخاصة بك</p>
                  </div>
                </div>

                <div 
                  className={`inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-full border text-sm font-bold shadow-sm ${currentStatus.color}`}
                  data-testid="plan-status"
                >
                  <StatusIcon className="h-4 w-4" />
                  {currentStatus.label}
                </div>
              </div>

              {sub ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-8">
                  <div className="bg-white/5 rounded-2xl p-4 border border-white/5 transition-colors hover:bg-white/10">
                    <span className="text-xs font-medium text-slate-400 flex items-center gap-2 mb-2">
                      <CalendarDays className="h-3.5 w-3.5" />
                      بداية الفترة التجريبية
                    </span>
                    <span className="text-sm font-bold text-white block">{formatDate(sub.trialStartedAt)}</span>
                  </div>
                  <div className="bg-white/5 rounded-2xl p-4 border border-white/5 transition-colors hover:bg-white/10">
                    <span className="text-xs font-medium text-slate-400 flex items-center gap-2 mb-2">
                      <CalendarDays className="h-3.5 w-3.5" />
                      نهاية الفترة التجريبية
                    </span>
                    <span className="text-sm font-bold text-white block">{formatDate(sub.trialEndsAt)}</span>
                  </div>
                  <div className="bg-white/5 rounded-2xl p-4 border border-white/5 transition-colors hover:bg-white/10">
                    <span className="text-xs font-medium text-slate-400 flex items-center gap-2 mb-2">
                      <CalendarDays className="h-3.5 w-3.5" />
                      بداية الاشتراك
                    </span>
                    <span className="text-sm font-bold text-white block">{formatDate(sub.subscriptionStartedAt)}</span>
                  </div>
                  <div className="bg-white/5 rounded-2xl p-4 border border-white/5 transition-colors hover:bg-white/10">
                    <span className="text-xs font-medium text-slate-400 flex items-center gap-2 mb-2">
                      <CalendarDays className="h-3.5 w-3.5" />
                      نهاية الاشتراك
                    </span>
                    <span className="text-sm font-bold text-white block">{formatDate(sub.subscriptionEndsAt)}</span>
                  </div>
                </div>
              ) : (
                <div className="bg-white/5 rounded-2xl p-6 border border-white/5 mb-8 flex flex-col items-center justify-center text-center">
                  <CreditCard className="h-8 w-8 text-slate-500 mb-3 opacity-50" />
                  <p className="text-slate-400 font-medium">بيانات الاشتراك غير متوفرة حالياً.</p>
                </div>
              )}

               <section className="border-t border-white/10 pt-6">
                 <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                   <div>
                     <h4 className="text-base font-bold text-white">اختر باقتك</h4>
                     <p className="mt-1 text-sm leading-6 text-slate-400">تتم معالجة الدفع بأمان عبر Stripe، ويُحدّث الوصول تلقائياً بعد تأكيد الدفع.</p>
                   </div>
                   {isActive && isOwner && (
                     <Button type="button" onClick={() => void openPortal()} disabled={billingAction !== null} className="bg-white/10 text-white hover:bg-white/15" data-testid="button-manage-subscription">
                       {billingAction === 'portal' && <LoaderCircle className="h-4 w-4 animate-spin" />}
                       إدارة الاشتراك
                     </Button>
                   )}
                 </div>
                 {!isOwner && <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-sm leading-7 text-slate-300">تتوفر إدارة الباقة لمالك المنشأة فقط.</div>}
                 {billingMessage && <div className="mb-4 rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-4 text-sm font-medium text-emerald-200" role="status">{billingMessage}</div>}
                 {billingError && <div className="mb-4 rounded-xl border border-rose-400/20 bg-rose-400/10 p-4 text-sm font-medium text-rose-200" role="alert">{billingError}</div>}
                 {plansLoading && <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 p-5 text-sm text-slate-300"><LoaderCircle className="h-4 w-4 animate-spin" />جارٍ تحميل الباقات المتاحة...</div>}
                 {!plansLoading && plansError && <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 p-4 text-sm text-amber-200">{plansError}</div>}
                 {!plansLoading && !plansError && plans.length === 0 && <div className="rounded-xl border border-white/10 bg-white/5 p-5 text-sm text-slate-300">لا توجد باقات متاحة حالياً. حاول لاحقاً أو تواصل مع الدعم.</div>}
                 {!plansLoading && !plansError && plans.length > 0 && (
                   <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
                     {plans.map((plan) => (
                       <article key={plan.id} className={`rounded-2xl border p-4 ${sub?.planId === plan.id ? 'border-teal-400/50 bg-teal-400/10' : 'border-white/10 bg-white/5'}`} data-testid={`plan-card-${plan.id}`}>
                         <p className="text-base font-bold text-white">{plan.name}</p>
                         <p className="mt-1 min-h-10 text-xs leading-5 text-slate-400">{plan.description || 'باقة اشتراك لإدارة أعمالك.'}</p>
                         <div className="mt-4 space-y-2">
                           {plan.prices.map((price) => (
                             <button
                               key={price.id}
                               type="button"
                               disabled={!isOwner || isActive || billingAction !== null}
                               onClick={() => void checkout(price.id)}
                               className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-[#061d40] px-3 py-3 text-right transition hover:border-teal-300/50 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                               data-testid={`button-checkout-${price.id}`}
                             >
                               <span className="text-sm font-bold text-white">{formatPrice(price)}</span>
                               <span className="text-xs text-slate-400">{price.interval === 'year' ? 'سنوي' : 'شهري'}</span>
                             </button>
                           ))}
                         </div>
                       </article>
                     ))}
                   </div>
                 )}
               </section>

              {/* Action Area */}
              <div className="pt-6 border-t border-white/10 flex flex-col md:flex-row items-center justify-between gap-5">
                <div className="flex-1 w-full text-center md:text-right">
                  {(!sub || !sub.accessActive) && (
                    <div className="flex items-start gap-3 text-amber-400/90 bg-amber-500/10 p-3 md:p-4 rounded-xl border border-amber-500/20">
                      <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
                      <p className="text-sm font-medium leading-relaxed">
                        انتهت صلاحية الوصول. اختر باقة لإتمام التجديد واستعادة الوصول تلقائياً بعد تأكيد الدفع.
                      </p>
                    </div>
                  )}
                </div>
                
                <div className="w-full md:w-auto">
                  {sub?.accessActive ? (
                    <Link 
                      href="/dashboard"
                      className="inline-flex w-full md:w-auto shrink-0 items-center justify-center rounded-xl px-8 h-12 text-sm md:text-base font-bold shadow-lg transition-all bg-teal-500 hover:bg-teal-400 text-[#061d40] shadow-teal-500/25 hover:shadow-teal-400/40 hover:-translate-y-0.5"
                      data-testid="button-dashboard-action"
                    >
                      الدخول لمساحة العمل
                      <ArrowLeft className="h-5 w-5 mr-2" />
                    </Link>
                  ) : (
                    <button 
                      disabled
                      className="inline-flex w-full md:w-auto shrink-0 items-center justify-center rounded-xl px-8 h-12 text-sm md:text-base font-bold bg-white/5 text-white/40 border border-white/5 cursor-not-allowed"
                      data-testid="button-dashboard-action"
                      aria-label="الوصول غير متاح"
                    >
                      الدخول لمساحة العمل
                      <ArrowLeft className="h-5 w-5 mr-2" />
                    </button>
                  )}
                </div>
              </div>

            </div>
          </div>
          
        </div>
      </main>
    </div>
  );
}
