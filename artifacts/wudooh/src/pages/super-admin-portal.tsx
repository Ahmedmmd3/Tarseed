import { useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import {
  AlertTriangle,
  Building2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  LogOut,
  LoaderCircle,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRoundCog,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

type SubscriptionStatus = 'trialing' | 'active' | 'expired' | 'inactive';

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
  };
  organizations: OrganizationSummary[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
  generatedAt: string;
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
  const [, setLocation] = useLocation();

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

  if (sessionState === 'loading') {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-[#061d40] text-white" dir="rtl">
        <div className="text-center">
          <LoaderCircle className="mx-auto h-10 w-10 animate-spin text-teal-300" />
          <p className="mt-4 text-sm font-medium text-slate-300">جارٍ التحقق من جلسة الإدارة العليا...</p>
        </div>
      </div>
    );
  }

  if (sessionState === 'unauthenticated') {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-[#061d40] px-5 text-white" dir="rtl">
        <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/5 p-8 text-center shadow-2xl">
          <ShieldCheck className="mx-auto h-11 w-11 text-teal-300" />
          <h1 className="mt-5 text-2xl font-black" data-testid="heading-super-admin-login-required">بوابة محمية</h1>
          <p className="mt-3 leading-7 text-slate-300">سجّل الدخول من الصفحة الرئيسية باستخدام اعتماد الإدارة العليا للوصول إلى هذه البوابة.</p>
          <Link href="/" className="mt-7 inline-flex h-11 items-center justify-center rounded-xl bg-teal-400 px-6 text-sm font-bold text-[#061d40] hover:bg-teal-300" data-testid="link-super-admin-home">
            العودة إلى تسجيل الدخول
          </Link>
        </div>
      </div>
    );
  }

  const summary = overview?.summary;

  return (
    <div className="min-h-[100dvh] bg-slate-50 text-slate-900" dir="rtl">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-[#061d40]/95 text-white shadow-sm backdrop-blur">
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
        <section className="flex flex-col gap-4 rounded-3xl bg-gradient-to-l from-[#062344] to-[#0b315d] p-6 text-white shadow-xl sm:flex-row sm:items-end sm:justify-between lg:p-8">
          <div>
            <p className="text-sm font-bold text-teal-300">نظرة تشغيلية مباشرة</p>
            <h2 className="mt-2 text-2xl font-black sm:text-3xl">المنشآت والاشتراكات</h2>
            <p className="mt-2 max-w-2xl text-sm leading-7 text-slate-300">ملخص آمن لحالة حسابات العملاء من دون الوصول إلى بياناتهم المحاسبية أو التشغيلية.</p>
          </div>
          <Button type="button" onClick={() => setRefreshKey((value) => value + 1)} disabled={loading} className="bg-teal-400 text-[#061d40] hover:bg-teal-300" data-testid="button-refresh-super-admin">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            تحديث البيانات
          </Button>
        </section>

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6" aria-label="ملخص المنصة">
          <SummaryCard label="إجمالي المنشآت" value={summary?.totalOrganizations} icon={Building2} accent="text-blue-700 bg-blue-50" testId="stat-total-organizations" />
          <SummaryCard label="إجمالي المستخدمين" value={summary?.totalUsers} icon={Users} accent="text-violet-700 bg-violet-50" testId="stat-total-users" />
          <SummaryCard label="نشطة" value={summary?.active} icon={ShieldCheck} accent="text-emerald-700 bg-emerald-50" testId="stat-active-organizations" />
          <SummaryCard label="تجريبية" value={summary?.trialing} icon={Clock3} accent="text-amber-700 bg-amber-50" testId="stat-trial-organizations" />
          <SummaryCard label="منتهية" value={summary?.expired} icon={AlertTriangle} accent="text-rose-700 bg-rose-50" testId="stat-expired-organizations" />
          <SummaryCard label="غير نشطة" value={summary?.inactive} icon={AlertTriangle} accent="text-slate-700 bg-slate-100" testId="stat-inactive-organizations" />
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
            <table className="w-full min-w-[1050px] text-right text-sm">
              <thead className="bg-slate-50 text-xs font-bold text-slate-500">
                <tr>
                  <th className="px-5 py-3">المنشأة</th>
                  <th className="px-5 py-3">المالك</th>
                  <th className="px-5 py-3">المستخدمون</th>
                  <th className="px-5 py-3">الباقة</th>
                  <th className="px-5 py-3">الحالة</th>
                  <th className="px-5 py-3">تاريخ الانتهاء</th>
                  <th className="px-5 py-3">المدة المتبقية</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading && !overview && (
                  <tr><td colSpan={7} className="px-5 py-16 text-center text-slate-500"><LoaderCircle className="mx-auto mb-3 h-6 w-6 animate-spin text-primary" />جارٍ تحميل المنشآت...</td></tr>
                )}
                {!loading && overview?.organizations.length === 0 && (
                  <tr><td colSpan={7} className="px-5 py-16 text-center text-slate-500">لا توجد منشآت مطابقة للبحث أو التصفية.</td></tr>
                )}
                {overview?.organizations.map((organization) => (
                  <tr key={organization.id} className="hover:bg-slate-50/80" data-testid={`row-organization-${organization.id}`}>
                    <td className="px-5 py-4">
                      <p className="font-bold text-slate-900" data-testid={`text-organization-name-${organization.id}`}>{organization.name}</p>
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
                    </td>
                    <td className="px-5 py-4 font-medium">{formatDate(organization.effectiveEndsAt)}</td>
                    <td className="px-5 py-4">
                      <span className="font-black" data-testid={`text-days-remaining-${organization.id}`}>
                        {organization.daysRemaining === null ? 'غير محدد' : organization.daysRemaining === 0 ? 'انتهت' : `${organization.daysRemaining} يوم`}
                      </span>
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