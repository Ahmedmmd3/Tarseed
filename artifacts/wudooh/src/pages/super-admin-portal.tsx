import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import {
  AlertTriangle,
  Building2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  FlaskConical,
  LogOut,
  LoaderCircle,
  Mail,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  UserRoundCog,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type SubscriptionStatus = 'trialing' | 'active' | 'expired' | 'inactive';
type SubscriptionAction = 'extend_trial' | 'extend_access' | 'suspend_access' | 'restore_access';
type InitializationStatus = 'ready' | 'pending' | 'failed';

type PlatformAdmin = {
  id: number;
  username: string;
  displayName: string;
  role: 'super_admin';
};

type OrganizationSummary = {
  id: number;
  name: string;
  owner: { name: string; email: string } | null;
  userCount: number;
  activeUserCount: number;
  planId: string;
  planName: string;
  status: SubscriptionStatus;
  effectiveEndsAt: string | null;
  daysRemaining: number | null;
  accessSuspended: boolean;
  hasBillingPortal: boolean;
  managedByStripe: boolean;
  isTestWorkspace: boolean;
  initializationStatus: InitializationStatus;
  initializationFailureCode: string | null;
  initializationFailureReason: string | null;
  initializationFailedAt: string | null;
  initializationAttempts: number;
  createdAt: string;
};

type OverviewResponse = {
  summary: {
    totalOrganizations: number;
    totalUsers: number;
    trialing: number;
    active: number;
    expired: number;
    inactive: number;
    initializationFailed: number;
  };
  organizations: OrganizationSummary[];
  initializationFailures: OrganizationSummary[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  generatedAt: string;
};

type PlatformAuditLog = {
  id: number;
  actorName: string;
  action: string;
  entity: string;
  details: string;
  createdAt: string;
};

const statusLabels: Record<SubscriptionStatus, string> = {
  trialing: 'فترة تجريبية',
  active: 'نشط',
  expired: 'منتهي',
  inactive: 'غير نشط',
};

const statusStyles: Record<SubscriptionStatus, string> = {
  trialing: 'border-amber-200 bg-amber-50 text-amber-700',
  active: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  expired: 'border-rose-200 bg-rose-50 text-rose-700',
  inactive: 'border-slate-200 bg-slate-100 text-slate-600',
};

export default function SuperAdminPortal() {
  const [admin, setAdmin] = useState<PlatformAdmin | null>(null);
  const [sessionState, setSessionState] = useState<'loading' | 'authenticated' | 'unauthenticated'>('loading');
  const [overview, setOverview] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState<'all' | SubscriptionStatus>('all');
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [actionOrganization, setActionOrganization] = useState<OrganizationSummary | null>(null);
  const [action, setAction] = useState<SubscriptionAction>('extend_access');
  const [durationDays, setDurationDays] = useState('7');
  const [reason, setReason] = useState('');
  const [actionError, setActionError] = useState('');
  const [isSubmittingAction, setIsSubmittingAction] = useState(false);
  const [auditOrganization, setAuditOrganization] = useState<OrganizationSummary | null>(null);
  const [auditLogs, setAuditLogs] = useState<PlatformAuditLog[]>([]);
  const [isLoadingAudit, setIsLoadingAudit] = useState(false);
  const [auditError, setAuditError] = useState('');
  const [testWorkspaceDialogOpen, setTestWorkspaceDialogOpen] = useState(false);
  const [testWorkspaceForm, setTestWorkspaceForm] = useState({ workspaceName: '', ownerName: '', ownerEmail: '' });
  const [testWorkspaceError, setTestWorkspaceError] = useState('');
  const [isCreatingTestWorkspace, setIsCreatingTestWorkspace] = useState(false);
  const [resendingInvitationId, setResendingInvitationId] = useState<number | null>(null);
  const [retryingInitializationId, setRetryingInitializationId] = useState<number | null>(null);
  const [initializationActionError, setInitializationActionError] = useState('');
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  useEffect(() => {
    let active = true;
    const verify = async () => {
      try {
        const response = await fetch('/api/platform-auth/me', { credentials: 'include', cache: 'no-store' });
        const payload = await response.json() as { admin?: PlatformAdmin | null };
        if (!active) return;
        if (response.ok && payload.admin) {
          setAdmin(payload.admin);
          setSessionState('authenticated');
        } else {
          setSessionState('unauthenticated');
          setLoading(false);
        }
      } catch {
        if (active) {
          setSessionState('unauthenticated');
          setLoading(false);
        }
      }
    };
    void verify();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    if (sessionState !== 'authenticated') return;
    let active = true;
    const loadOverview = async () => {
      setLoading(true);
      setError('');
      try {
        const query = new URLSearchParams({
          search: debouncedSearch,
          status,
          page: String(page),
          pageSize: '25',
        });
        const response = await fetch(`/api/super-admin/overview?${query}`, {
          credentials: 'include',
          cache: 'no-store',
        });
        const payload = await response.json().catch(() => ({})) as OverviewResponse & { error?: string };
        if (response.status === 401) {
          setSessionState('unauthenticated');
          setAdmin(null);
          return;
        }
        if (!response.ok || !payload.summary) throw new Error(payload.error ?? 'تعذر تحميل بيانات المنصة.');
        if (active) setOverview(payload);
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'تعذر تحميل بيانات المنصة.');
      } finally {
        if (active) setLoading(false);
      }
    };
    void loadOverview();
    return () => { active = false; };
  }, [debouncedSearch, page, refreshKey, sessionState, status]);

  const signOut = async () => {
    setIsSigningOut(true);
    try {
      await fetch('/api/platform-auth/logout', { method: 'POST', credentials: 'include' });
    } finally {
      setLocation('/');
    }
  };

  const openActionDialog = (organization: OrganizationSummary) => {
    setActionOrganization(organization);
    setAction(organization.accessSuspended ? 'restore_access' : organization.managedByStripe ? 'suspend_access' : organization.status === 'trialing' ? 'extend_trial' : 'extend_access');
    setDurationDays('7');
    setReason('');
    setActionError('');
  };

  const submitAction = async () => {
    if (!actionOrganization) return;
    const parsedDays = Number(durationDays);
    if ((action === 'extend_trial' || action === 'extend_access') && (!Number.isInteger(parsedDays) || parsedDays < 1 || parsedDays > 365)) {
      setActionError('اختر مدة صحيحة بين يوم واحد و365 يوماً.');
      return;
    }
    setIsSubmittingAction(true);
    setActionError('');
    try {
      const response = await fetch(`/api/super-admin/organizations/${actionOrganization.id}/subscription-action`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          ...(action === 'extend_trial' || action === 'extend_access' ? { durationDays: parsedDays } : {}),
          reason: reason.trim(),
          confirmed: true,
        }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'تعذر تنفيذ الإجراء.');
      toast({ title: 'تم تحديث الاشتراك', description: 'تم تنفيذ الإجراء وتسجيله في سجل الموافقات.' });
      setActionOrganization(null);
      setRefreshKey((value) => value + 1);
    } catch (submitError) {
      setActionError(submitError instanceof Error ? submitError.message : 'تعذر تنفيذ الإجراء.');
    } finally {
      setIsSubmittingAction(false);
    }
  };

  const openBillingPortal = async (organization: OrganizationSummary) => {
    try {
      const response = await fetch(`/api/super-admin/organizations/${organization.id}/billing-portal`, {
        method: 'POST',
        credentials: 'include',
      });
      const payload = await response.json().catch(() => ({})) as { url?: string; error?: string };
      if (!response.ok || !payload.url) throw new Error(payload.error ?? 'تعذر فتح إدارة الاشتراك.');
      window.location.assign(payload.url);
    } catch (portalError) {
      toast({ title: 'تعذر فتح إدارة الاشتراك', description: portalError instanceof Error ? portalError.message : 'حاول مرة أخرى.', variant: 'destructive' });
    }
  };

  const openAuditDialog = async (organization: OrganizationSummary) => {
    setAuditOrganization(organization);
    setAuditLogs([]);
    setAuditError('');
    setIsLoadingAudit(true);
    try {
      const response = await fetch(`/api/super-admin/organizations/${organization.id}/audit-logs`, {
        credentials: 'include',
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => ({})) as { logs?: PlatformAuditLog[]; error?: string };
      if (!response.ok || !Array.isArray(payload.logs)) throw new Error(payload.error ?? 'تعذر تحميل سجل الموافقات.');
      setAuditLogs(payload.logs);
    } catch (auditLoadError) {
      setAuditError(auditLoadError instanceof Error ? auditLoadError.message : 'تعذر تحميل سجل الموافقات.');
    } finally {
      setIsLoadingAudit(false);
    }
  };

  const createTestWorkspace = async () => {
    const workspaceName = testWorkspaceForm.workspaceName.trim();
    const ownerName = testWorkspaceForm.ownerName.trim();
    const ownerEmail = testWorkspaceForm.ownerEmail.trim();
    if (!workspaceName || !ownerName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
      setTestWorkspaceError('أدخل اسم المساحة واسم المالك وبريداً إلكترونياً صحيحاً.');
      return;
    }
    setIsCreatingTestWorkspace(true);
    setTestWorkspaceError('');
    try {
      const response = await fetch('/api/super-admin/test-workspaces', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceName, ownerName, ownerEmail }),
      });
      const payload = await response.json().catch(() => ({})) as { workspace?: { name: string }; error?: string; code?: string };
      if (payload.code === 'organization_initialization_failed' && payload.workspace) {
        toast({ title: 'تحتاج المساحة إلى إعادة تهيئة', description: payload.error, variant: 'destructive' });
        setTestWorkspaceForm({ workspaceName: '', ownerName: '', ownerEmail: '' });
        setTestWorkspaceDialogOpen(false);
        setRefreshKey((value) => value + 1);
        return;
      }
      if (payload.code === 'invitation_delivery_failed' && payload.workspace) {
        toast({ title: 'تعذر إرسال الدعوة', description: payload.error, variant: 'destructive' });
        setTestWorkspaceForm({ workspaceName: '', ownerName: '', ownerEmail: '' });
        setTestWorkspaceDialogOpen(false);
        setRefreshKey((value) => value + 1);
        return;
      }
      if (!response.ok || !payload.workspace) throw new Error(payload.error ?? 'تعذر إنشاء مساحة الاختبار.');
      toast({
        title: 'أُنشئت مساحة الاختبار',
        description: `أُرسلت دعوة آمنة إلى ${ownerEmail}. ستظهر المساحة مفعّلة بعد قبول المالك.`,
      });
      setTestWorkspaceForm({ workspaceName: '', ownerName: '', ownerEmail: '' });
      setTestWorkspaceDialogOpen(false);
      setRefreshKey((value) => value + 1);
    } catch (createError) {
      setTestWorkspaceError(createError instanceof Error ? createError.message : 'تعذر إنشاء مساحة الاختبار.');
    } finally {
      setIsCreatingTestWorkspace(false);
    }
  };

  const resendTestWorkspaceInvitation = async (organization: OrganizationSummary) => {
    setResendingInvitationId(organization.id);
    try {
      const response = await fetch(`/api/super-admin/test-workspaces/${organization.id}/resend-invitation`, {
        method: 'POST',
        credentials: 'include',
      });
      const payload = await response.json().catch(() => ({})) as { sent?: boolean; error?: string };
      if (!response.ok || !payload.sent) throw new Error(payload.error ?? 'تعذر إعادة إرسال الدعوة.');
      toast({ title: 'أُعيد إرسال الدعوة', description: 'تم تدوير الرابط السابق وإرسال رابط جديد صالح ليومين.' });
    } catch (resendError) {
      toast({ title: 'تعذر إعادة الإرسال', description: resendError instanceof Error ? resendError.message : 'حاول مرة أخرى.', variant: 'destructive' });
    } finally {
      setResendingInvitationId(null);
    }
  };

  const retryOrganizationInitialization = async (organization: OrganizationSummary) => {
    setRetryingInitializationId(organization.id);
    setInitializationActionError('');
    try {
      const response = await fetch(`/api/super-admin/organizations/${organization.id}/initialization-retry`, {
        method: 'POST',
        credentials: 'include',
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'تعذر إعادة تهيئة المنشأة.');
      toast({
        title: 'اكتملت تهيئة المنشأة',
        description: organization.isTestWorkspace && !organization.owner
          ? 'أصبحت البيانات الأساسية جاهزة. استخدم زر إعادة الدعوة لإرسال رابط جديد إلى المالك.'
          : 'أصبحت البيانات الأساسية جاهزة، ولن تُكرر إعادة المحاولة السجلات الموجودة.',
      });
      setRefreshKey((value) => value + 1);
    } catch (retryError) {
      setInitializationActionError(retryError instanceof Error ? retryError.message : 'تعذر إعادة تهيئة المنشأة.');
    } finally {
      setRetryingInitializationId(null);
    }
  };

  if (sessionState === 'loading') {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-[#0A1328] text-white" dir="rtl">
        <div className="text-center">
          <LoaderCircle className="mx-auto h-10 w-10 animate-spin text-teal-300" />
          <p className="mt-4 text-sm font-medium text-slate-300">جارٍ التحقق من جلسة الإدارة العليا...</p>
        </div>
      </div>
    );
  }

  if (sessionState === 'unauthenticated') {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-[#0A1328] px-5 text-white" dir="rtl">
        <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/5 p-8 text-center shadow-2xl">
          <ShieldCheck className="mx-auto h-11 w-11 text-teal-300" />
          <h1 className="mt-5 text-2xl font-black" data-testid="heading-super-admin-login-required">بوابة محمية</h1>
          <p className="mt-3 leading-7 text-slate-300">سجّل الدخول من الصفحة الرئيسية باستخدام اعتماد الإدارة العليا للوصول إلى هذه البوابة.</p>
          <Link href="/" className="mt-7 inline-flex h-11 items-center justify-center rounded-xl bg-teal-400 px-6 text-sm font-bold text-[#0A1328] hover:bg-teal-300" data-testid="link-super-admin-home">
            العودة إلى تسجيل الدخول
          </Link>
        </div>
      </div>
    );
  }

  const summary = overview?.summary;

  return (
    <div className="min-h-[100dvh] bg-slate-50 text-slate-900" dir="rtl">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-[#0A1328]/95 text-white shadow-sm backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-teal-300/20 bg-teal-300/10 text-teal-300">
              <UserRoundCog className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-lg font-black sm:text-xl" data-testid="heading-super-admin">الإدارة العليا لترصيد</h1>
              <p className="text-xs text-slate-300" data-testid="text-super-admin-name">{admin?.displayName}</p>
            </div>
          </div>
          <Button type="button" variant="outline" onClick={() => void signOut()} disabled={isSigningOut} className="border-white/15 bg-white/5 text-white hover:bg-white/10 hover:text-white" data-testid="button-super-admin-sign-out">
            {isSigningOut ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
            <span className="hidden sm:inline">تسجيل الخروج</span>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] space-y-6 px-4 py-6 sm:px-6 lg:py-8">
        <section className="flex flex-col gap-4 rounded-3xl bg-gradient-to-l from-[#0A1328] to-[#0D47D9] p-6 text-white shadow-xl sm:flex-row sm:items-end sm:justify-between lg:p-8">
          <div>
            <p className="text-sm font-bold text-teal-300">نظرة تشغيلية مباشرة</p>
            <h2 className="mt-2 text-2xl font-black sm:text-3xl">المنشآت والاشتراكات</h2>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-300">ملخص آمن لحالة حسابات العملاء من دون الوصول إلى بياناتهم المحاسبية أو التشغيلية.</p>
          </div>
          <Button type="button" onClick={() => setRefreshKey((value) => value + 1)} disabled={loading} className="bg-teal-400 text-[#0A1328] hover:bg-teal-300" data-testid="button-refresh-super-admin">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            تحديث البيانات
          </Button>
        </section>

        <section className="grid gap-4 rounded-3xl border border-teal-200 bg-teal-50/70 p-5 shadow-sm lg:grid-cols-[1fr_auto] lg:items-center" data-testid="section-test-workspaces">
          <div className="flex items-start gap-4">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-teal-600 text-white">
              <FlaskConical className="h-6 w-6" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-black text-slate-900">مساحات تدقيق مستقلة</h2>
                <span className="rounded-full border border-teal-200 bg-white px-2.5 py-1 text-xs font-bold text-teal-800" data-testid="text-test-workspaces-count">
                  {overview?.organizations.filter((organization) => organization.isTestWorkspace).length ?? 0} مساحة اختبار في الصفحة
                </span>
              </div>
              <p className="mt-2 max-w-3xl text-sm leading-7 text-slate-600">
                أنشئ مساحة موسومة للاختبار وأرسل دعوة أحادية إلى مالكها. الإدارة العليا تدير حالة الوصول فقط ولا تدخل إلى البيانات المحاسبية.
              </p>
            </div>
          </div>
          <Button
            type="button"
            onClick={() => { setTestWorkspaceError(''); setTestWorkspaceDialogOpen(true); }}
            className="bg-teal-700 text-white hover:bg-teal-800"
            data-testid="button-create-test-workspace"
          >
            <Plus className="h-4 w-4" />
            إنشاء مساحة اختبار
          </Button>
        </section>

        {overview && overview.initializationFailures.length > 0 && (
          <section className="rounded-3xl border border-rose-200 bg-rose-50/80 p-5 shadow-sm" data-testid="section-initialization-failures">
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-rose-600 text-white">
                <AlertTriangle className="h-5 w-5" />
              </span>
              <div>
                <h2 className="text-lg font-black text-rose-950">منشآت تحتاج إعادة تهيئة</h2>
                <p className="mt-1 text-sm leading-6 text-rose-800">لم تكتمل البيانات الأساسية لهذه المنشآت. أصلح السبب الموضح ثم أعد المحاولة بأمان.</p>
              </div>
            </div>
            {initializationActionError && (
              <p className="mt-4 rounded-xl border border-rose-300 bg-white p-3 text-sm font-bold text-rose-800" role="alert" data-testid="error-initialization-retry">
                {initializationActionError}
              </p>
            )}
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {overview.initializationFailures.map((organization) => (
                <article key={organization.id} className="rounded-2xl border border-rose-200 bg-white p-4" data-testid={`initialization-failure-${organization.id}`}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-black text-slate-900">{organization.name} <span className="text-xs font-medium text-slate-400">#{organization.id}</span></p>
                      <p className="mt-1 text-sm text-rose-800" data-testid={`initialization-failure-reason-${organization.id}`}>
                        {organization.initializationFailureReason ?? 'توقفت التهيئة قبل اكتمالها. أعد المحاولة بأمان.'}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        آخر فشل: {organization.initializationFailedAt ? new Date(organization.initializationFailedAt).toLocaleString('ar-SA') : 'غير محدد'}
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void retryOrganizationInitialization(organization)}
                      disabled={retryingInitializationId !== null}
                      className="shrink-0 gap-1.5 bg-rose-700 text-white hover:bg-rose-800"
                      data-testid={`button-retry-initialization-${organization.id}`}
                    >
                      {retryingInitializationId === organization.id ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      إعادة التهيئة
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          </section>
        )}

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-7" aria-label="ملخص المنصة">
          <SummaryCard label="إجمالي المنشآت" value={summary?.totalOrganizations} icon={Building2} accent="text-blue-700 bg-blue-50" testId="stat-total-organizations" />
          <SummaryCard label="إجمالي المستخدمين" value={summary?.totalUsers} icon={Users} accent="text-violet-700 bg-violet-50" testId="stat-total-users" />
          <SummaryCard label="نشطة" value={summary?.active} icon={ShieldCheck} accent="text-emerald-700 bg-emerald-50" testId="stat-active-organizations" />
          <SummaryCard label="تجريبية" value={summary?.trialing} icon={Clock3} accent="text-amber-700 bg-amber-50" testId="stat-trial-organizations" />
          <SummaryCard label="منتهية" value={summary?.expired} icon={AlertTriangle} accent="text-rose-700 bg-rose-50" testId="stat-expired-organizations" />
          <SummaryCard label="غير نشطة" value={summary?.inactive} icon={AlertTriangle} accent="text-slate-700 bg-slate-100" testId="stat-inactive-organizations" />
          <SummaryCard label="تحتاج تهيئة" value={summary?.initializationFailed} icon={RefreshCw} accent="text-rose-700 bg-rose-50" testId="stat-initialization-failed" />
        </section>

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div>
              <h2 className="text-lg font-black">سجل المنشآت</h2>
              <p className="mt-1 text-xs text-slate-500" data-testid="text-organizations-count">{overview ? `${overview.pagination.total} منشأة مطابقة` : 'جارٍ التحميل'}</p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <label className="relative min-w-64">
                <span className="sr-only">البحث في المنشآت</span>
                <Search className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-slate-400" />
                <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث بالمنشأة أو المالك أو البريد" className="pr-9" data-testid="input-super-admin-search" />
              </label>
              <select
                value={status}
                onChange={(event) => { setStatus(event.target.value as typeof status); setPage(1); }}
                className="h-10 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium outline-none focus:ring-2 focus:ring-primary"
                data-testid="select-super-admin-status"
              >
                <option value="all">كل الحالات</option>
                <option value="active">نشط</option>
                <option value="trialing">فترة تجريبية</option>
                <option value="expired">منتهي</option>
                <option value="inactive">غير نشط</option>
              </select>
            </div>
          </div>

          {error && (
            <div className="m-5 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-800" role="alert" data-testid="error-super-admin-overview">
              {error}
            </div>
          )}

          <div className="overflow-x-auto">
             <table className="w-full min-w-[1200px] table-fixed text-right text-sm" dir="rtl">
              <thead className="bg-slate-50 text-xs font-bold text-slate-500">
                <tr>
                  <th className="px-5 py-3">المنشأة</th>
                  <th className="px-5 py-3">المالك</th>
                  <th className="px-5 py-3">المستخدمون</th>
                  <th className="px-5 py-3">الباقة</th>
                  <th className="px-5 py-3">الحالة</th>
                  <th className="px-5 py-3">تاريخ الانتهاء</th>
                  <th className="px-5 py-3">المدة المتبقية</th>
                  <th className="px-5 py-3">إجراءات الإدارة</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading && !overview && (
                  <tr><td colSpan={8} className="px-5 py-16 text-center text-slate-500"><LoaderCircle className="mx-auto mb-3 h-6 w-6 animate-spin text-primary" />جارٍ تحميل المنشآت...</td></tr>
                )}
                {!loading && overview?.organizations.length === 0 && (
                  <tr><td colSpan={8} className="px-5 py-16 text-center text-slate-500">لا توجد منشآت مطابقة للبحث أو التصفية.</td></tr>
                )}
                {overview?.organizations.map((organization) => (
                  <tr key={organization.id} className="hover:bg-slate-50/80" data-testid={`row-organization-${organization.id}`}>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-bold text-slate-900" data-testid={`text-organization-name-${organization.id}`}>{organization.name}</p>
                        {organization.isTestWorkspace && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-[11px] font-bold text-teal-800" data-testid={`badge-test-workspace-${organization.id}`}>
                            <FlaskConical className="h-3 w-3" />مساحة اختبار
                          </span>
                        )}
                        {organization.initializationStatus !== 'ready' && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-2 py-0.5 text-[11px] font-bold text-rose-800" data-testid={`badge-initialization-failed-${organization.id}`}>
                            <AlertTriangle className="h-3 w-3" />تهيئة غير مكتملة
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-slate-400">#{organization.id}</p>
                    </td>
                    <td className="px-5 py-4">
                      <p className="font-semibold text-slate-800">{organization.owner?.name ?? 'لم يُحدد'}</p>
                      <p className="mt-1 text-xs text-slate-500" dir="ltr">{organization.owner?.email ?? '—'}</p>
                    </td>
                    <td className="px-5 py-4">
                      <p className="font-bold">{organization.activeUserCount} نشط</p>
                      <p className="mt-1 text-xs text-slate-500">من أصل {organization.userCount}</p>
                    </td>
                    <td className="px-5 py-4 font-semibold">{organization.planName}</td>
                    <td className="px-5 py-4">
                      <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-bold ${statusStyles[organization.status]}`} data-testid={`status-organization-${organization.id}`}>
                        {statusLabels[organization.status]}
                      </span>
                      {organization.isTestWorkspace && !organization.owner && (
                        <p className="mt-1 text-xs font-bold text-amber-700" data-testid={`status-test-workspace-owner-${organization.id}`}>بانتظار قبول المالك</p>
                      )}
                    </td>
                    <td className="px-5 py-4 font-medium">{formatDate(organization.effectiveEndsAt)}</td>
                    <td className="px-5 py-4">
                      <span className="font-black" data-testid={`text-days-remaining-${organization.id}`}>
                        {organization.daysRemaining === null ? 'غير محدد' : organization.daysRemaining === 0 ? 'انتهت' : `${organization.daysRemaining} يوم`}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" size="sm" onClick={() => openActionDialog(organization)} className="gap-1.5 bg-[#0A1328] text-white hover:bg-[#0D47D9]" data-testid={`button-manage-subscription-${organization.id}`}>
                          <SlidersHorizontal className="h-3.5 w-3.5" />إدارة
                        </Button>
                        <Button type="button" size="sm" variant="outline" onClick={() => void openAuditDialog(organization)} className="gap-1.5" data-testid={`button-view-subscription-audit-${organization.id}`}>
                          <ShieldCheck className="h-3.5 w-3.5" />السجل
                        </Button>
                        {organization.isTestWorkspace && !organization.owner && (
                          <Button type="button" size="sm" variant="outline" onClick={() => void resendTestWorkspaceInvitation(organization)} disabled={resendingInvitationId === organization.id} className="gap-1.5 border-teal-200 text-teal-800 hover:bg-teal-50" data-testid={`button-resend-test-workspace-invitation-${organization.id}`}>
                            {resendingInvitationId === organization.id ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Mail className="h-3.5 w-3.5" />}
                            إعادة الدعوة
                          </Button>
                        )}
                        {organization.initializationStatus !== 'ready' && (
                          <Button type="button" size="sm" variant="outline" onClick={() => void retryOrganizationInitialization(organization)} disabled={retryingInitializationId !== null} className="gap-1.5 border-rose-200 text-rose-800 hover:bg-rose-50" data-testid={`button-row-retry-initialization-${organization.id}`}>
                            {retryingInitializationId === organization.id ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                            إعادة التهيئة
                          </Button>
                        )}
                        {organization.hasBillingPortal && (
                          <Button type="button" size="sm" variant="outline" onClick={() => void openBillingPortal(organization)} className="gap-1.5" data-testid={`button-open-billing-portal-${organization.id}`}>
                            <ExternalLink className="h-3.5 w-3.5" />Stripe
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {overview && overview.pagination.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-200 px-5 py-4">
              <p className="text-xs font-medium text-slate-500" data-testid="text-super-admin-page">صفحة {overview.pagination.page} من {overview.pagination.totalPages}</p>
              <div className="flex gap-2">
                <Button type="button" variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage((value) => Math.max(1, value - 1))} data-testid="button-super-admin-previous-page">
                  <ChevronRight className="h-4 w-4" />السابق
                </Button>
                <Button type="button" variant="outline" size="sm" disabled={page >= overview.pagination.totalPages || loading} onClick={() => setPage((value) => value + 1)} data-testid="button-super-admin-next-page">
                  التالي<ChevronLeft className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </section>
      </main>

      <Dialog open={testWorkspaceDialogOpen} onOpenChange={(open) => { if (!isCreatingTestWorkspace) setTestWorkspaceDialogOpen(open); }}>
        <DialogContent dir="rtl" className="max-h-[85vh] overflow-y-auto sm:max-w-lg" data-testid="dialog-create-test-workspace">
          <DialogHeader>
            <DialogTitle>إنشاء مساحة اختبار ودعوة مالكها</DialogTitle>
            <DialogDescription>
              ستُنشأ مساحة مستقلة لمدة 30 يوماً. لا تحصل الإدارة العليا على جلسة داخلها؛ التفعيل يتم فقط بعد قبول المالك للرابط المرسل إلى بريده.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <label className="block text-sm font-bold text-slate-700">
              اسم مساحة الاختبار
              <Input
                value={testWorkspaceForm.workspaceName}
                onChange={(event) => { setTestWorkspaceForm((value) => ({ ...value, workspaceName: event.target.value })); setTestWorkspaceError(''); }}
                placeholder="مثال: تدقيق المحاسبة — أغسطس"
                maxLength={120}
                className="mt-2"
                data-testid="input-test-workspace-name"
              />
            </label>
            <label className="block text-sm font-bold text-slate-700">
              اسم مالك الاختبار
              <Input
                value={testWorkspaceForm.ownerName}
                onChange={(event) => { setTestWorkspaceForm((value) => ({ ...value, ownerName: event.target.value })); setTestWorkspaceError(''); }}
                placeholder="اسم المدقق أو مسؤول الاختبار"
                maxLength={120}
                className="mt-2"
                data-testid="input-test-workspace-owner-name"
              />
            </label>
            <label className="block text-sm font-bold text-slate-700">
              بريد مالك الاختبار
              <span className="relative mt-2 block">
                <Mail className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-slate-400" />
                <Input
                  type="email"
                  dir="ltr"
                  value={testWorkspaceForm.ownerEmail}
                  onChange={(event) => { setTestWorkspaceForm((value) => ({ ...value, ownerEmail: event.target.value })); setTestWorkspaceError(''); }}
                  placeholder="auditor@company.com"
                  maxLength={254}
                  className="pr-9 text-left"
                  data-testid="input-test-workspace-owner-email"
                />
              </span>
            </label>
            <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm leading-6 text-blue-900">
              الرابط صالح ليومين ويُستخدم مرة واحدة. بعد اختيار كلمة المرور يصبح البريد موثقاً عبر حيازة الدعوة، وتبقى المساحة موسومة بوضوح كاختبار.
            </div>
            {testWorkspaceError && (
              <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-800" role="alert" data-testid="error-create-test-workspace">
                {testWorkspaceError}
              </p>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => setTestWorkspaceDialogOpen(false)} disabled={isCreatingTestWorkspace} data-testid="button-cancel-test-workspace">
                إلغاء
              </Button>
              <Button type="button" onClick={() => void createTestWorkspace()} disabled={isCreatingTestWorkspace} className="bg-teal-700 text-white hover:bg-teal-800" data-testid="button-submit-test-workspace">
                {isCreatingTestWorkspace ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                {isCreatingTestWorkspace ? 'جارٍ الإنشاء والإرسال...' : 'إنشاء وإرسال الدعوة'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(actionOrganization)} onOpenChange={(open) => { if (!open && !isSubmittingAction) setActionOrganization(null); }}>
        <AlertDialogContent dir="rtl" data-testid="dialog-manage-subscription">
          <AlertDialogHeader>
            <AlertDialogTitle>إدارة اشتراك {actionOrganization?.name}</AlertDialogTitle>
            <AlertDialogDescription>
              هذه العملية تغيّر وصول المنشأة. راجع الإجراء والمدة والسبب ثم أكّد التنفيذ؛ سيُحفظ كل ذلك باسمك ووقت التنفيذ.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-4">
            <label className="block text-sm font-bold text-slate-700">
              الإجراء
              <select value={action} onChange={(event) => { setAction(event.target.value as SubscriptionAction); setActionError(''); }} className="mt-2 h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm font-medium outline-none focus:ring-2 focus:ring-primary" data-testid="select-subscription-action">
                <option value="extend_trial" disabled={actionOrganization?.managedByStripe}>تمديد الفترة التجريبية</option>
                <option value="extend_access" disabled={actionOrganization?.managedByStripe}>تمديد الوصول</option>
                <option value="suspend_access">تعليق الوصول فوراً</option>
                <option value="restore_access">استعادة الوصول</option>
              </select>
            </label>
            {actionOrganization?.managedByStripe && <p className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm font-medium text-blue-800">مدة الاشتراك والباقات تُدار من Stripe فقط. يمكنك تعليق الوصول محلياً أو استعادته من هنا دون تغيير بيانات الدفع.</p>}
            {(action === 'extend_trial' || action === 'extend_access') && (
              <label className="block text-sm font-bold text-slate-700">
                عدد الأيام
                <Input type="number" min={1} max={365} value={durationDays} onChange={(event) => setDurationDays(event.target.value)} className="mt-2" data-testid="input-subscription-duration" />
                <span className="mt-1 block text-xs font-normal text-slate-500">من يوم واحد إلى 365 يوماً، وتُضاف إلى نهاية الوصول الحالية إن كانت لاحقة.</span>
              </label>
            )}
            <label className="block text-sm font-bold text-slate-700">
              سبب الإجراء <span className="font-normal text-slate-400">(اختياري)</span>
              <Input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="مثال: منح مهلة بناءً على طلب الدعم" className="mt-2" maxLength={500} data-testid="input-subscription-action-reason" />
            </label>
            {action === 'suspend_access' && <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-800">سيُمنع الوصول فوراً، ولن تُحذف بيانات المنشأة أو تُلغى بيانات Stripe.</p>}
            {action === 'restore_access' && <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-medium text-emerald-800">ستعود المنشأة لاستخدام حالتها الأصلية المسجلة من Stripe أو قاعدة المنصة.</p>}
            {actionError && <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-800" role="alert" data-testid="error-subscription-action">{actionError}</p>}
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isSubmittingAction} data-testid="button-cancel-subscription-action">إلغاء</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => { event.preventDefault(); void submitAction(); }} disabled={isSubmittingAction} className={action === 'suspend_access' ? 'bg-rose-600 hover:bg-rose-700' : 'bg-[#0A1328] hover:bg-[#0D47D9]'} data-testid="button-confirm-subscription-action">
              {isSubmittingAction ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
              تأكيد وتنفيذ
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={Boolean(auditOrganization)} onOpenChange={(open) => { if (!open) setAuditOrganization(null); }}>
        <DialogContent dir="rtl" className="max-h-[85vh] overflow-y-auto sm:max-w-2xl" data-testid="dialog-subscription-audit">
          <DialogHeader>
            <DialogTitle>سجل موافقات {auditOrganization?.name}</DialogTitle>
            <DialogDescription>آخر إجراءات الإدارة العليا على حالة ووصول هذه المنشأة.</DialogDescription>
          </DialogHeader>
          {isLoadingAudit && <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500"><LoaderCircle className="h-5 w-5 animate-spin" />جارٍ تحميل السجل...</div>}
          {!isLoadingAudit && auditError && <p className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800" role="alert">{auditError}</p>}
          {!isLoadingAudit && !auditError && auditLogs.length === 0 && <p className="py-10 text-center text-sm text-slate-500">لا توجد إجراءات إدارة مسجلة لهذه المنشأة.</p>}
          {!isLoadingAudit && !auditError && auditLogs.length > 0 && (
            <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
              {auditLogs.map((log) => <AuditRow key={log.id} log={log} />)}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  accent,
  testId,
}: {
  label: string;
  value: number | undefined;
  icon: typeof Building2;
  accent: string;
  testId: string;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className={`flex h-10 w-10 items-center justify-center rounded-xl ${accent}`}><Icon className="h-5 w-5" /></div>
      <p className="mt-4 text-xs font-bold text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-black text-slate-900" data-testid={testId}>{value ?? '—'}</p>
    </article>
  );
}

function formatDate(value: string | null): string {
  if (!value) return 'غير محدد';
  return new Intl.DateTimeFormat('ar-SA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(new Date(value));
}

const actionLabels: Record<string, string> = {
  extend_trial: 'تمديد الفترة التجريبية',
  extend_access: 'تمديد الوصول',
  suspend_access: 'تعليق الوصول',
  restore_access: 'استعادة الوصول',
  subscription_portal_opened: 'فتح إدارة Stripe',
  test_workspace_created: 'إنشاء مساحة اختبار',
  test_workspace_activated: 'تفعيل مالك مساحة الاختبار',
  test_workspace_invitation_resent: 'إعادة إرسال دعوة مساحة الاختبار',
  organization_initialization_failed: 'فشل تهيئة المنشأة',
  organization_initialization_retried: 'إعادة تهيئة المنشأة',
};

function AuditRow({ log }: { log: PlatformAuditLog }) {
  let reason = '';
  try {
    const details = JSON.parse(log.details) as { reason?: unknown };
    reason = typeof details.reason === 'string' ? details.reason : '';
  } catch {
    reason = log.details;
  }
  return (
    <div className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:justify-between" data-testid={`subscription-audit-row-${log.id}`}>
      <div>
        <p className="font-bold text-slate-900">{actionLabels[log.action] ?? log.action}</p>
        <p className="mt-1 text-sm text-slate-500">{reason || 'تم تسجيل العملية.'}</p>
      </div>
      <div className="shrink-0 text-xs text-slate-500 sm:text-left">
        <p className="font-bold text-slate-700">{log.actorName}</p>
        <p className="mt-1">{new Date(log.createdAt).toLocaleString('ar-SA')}</p>
      </div>
    </div>
  );
}