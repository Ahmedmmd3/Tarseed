import React, { ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { BarChart3, Book, Boxes, BriefcaseBusiness, ChevronLeft, Cloud, CloudOff, FileText, LayoutDashboard, LoaderCircle, LogOut, Menu, PackageOpen, ShoppingCart, Store, Truck, UsersRound, Wallet, X, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useStore } from '@/context/store';

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
      { name: 'التقارير المالية', href: '/reports', icon: BarChart3, permission: 'reports' },
    ],
  },
  {
    label: 'الإدارة',
    items: [
      { name: 'الموارد البشرية', href: '/hr', icon: UsersRound, permission: 'hr' },
      { name: 'العمليات والمشاريع', href: '/operations', icon: BriefcaseBusiness, permission: 'operations' },
      { name: 'إدارة الفريق', href: '/team', icon: UsersRound, ownerOnly: true },
    ],
  },
];

export function AppLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const { currentUser, signOut, connectionMode, canRetrySharedConnection, syncQueue, retrySharedConnection } = useStore();
  const [isSigningOut, setIsSigningOut] = React.useState(false);
  const canViewCurrentRoute = !currentUser || canAccessNavigationItem(location, currentUser);
  const closeSidebar = () => setSidebarOpen(false);
  const visibleGroups = navigationGroups
    .map((group) => ({ ...group, items: group.items.filter((item) => !currentUser || (item.ownerOnly ? currentUser.roleId === 'owner' : canAccessNavigationItem(item.href, currentUser))) }))
    .filter((group) => group.items.length > 0);

  return (
    <div className="min-h-screen bg-[#061d40] font-sans text-slate-900" dir="rtl">
      <div className="flex min-h-screen flex-col md:flex-row">
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:hidden">
          <BrandLockup />
          <Button variant="outline" size="sm" className="gap-2 border-slate-200 text-slate-700" onClick={() => setSidebarOpen((open) => !open)} data-testid="button-menu" aria-label={sidebarOpen ? 'إغلاق القائمة' : 'فتح القائمة'}>
            {sidebarOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />} لوحة التحكم
          </Button>
        </div>

        {sidebarOpen && <button type="button" className="fixed inset-0 z-20 bg-slate-950/40 md:hidden" onClick={closeSidebar} aria-label="إغلاق القائمة" data-testid="button-close-menu-overlay" />}

        <aside className={`${sidebarOpen ? 'translate-x-0' : 'translate-x-full'} fixed inset-y-0 right-0 z-30 flex w-[286px] flex-col border-l border-white/10 bg-[#062344] text-white shadow-2xl transition-transform duration-200 md:static md:z-auto md:w-72 md:translate-x-0 md:shadow-none`}>
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
                <div className="min-w-0"><p className="truncate text-sm font-bold">{currentUser.projectName}</p><p className="truncate text-xs text-slate-300">{currentUser.name} · {currentUser.email}</p></div>
                <Button type="button" variant="outline" size="sm" className="shrink-0 border-white/20 bg-white/5 text-white hover:bg-white/15 hover:text-white" disabled={isSigningOut} onClick={async () => { setIsSigningOut(true); try { await signOut(); } finally { setIsSigningOut(false); } }} data-testid="button-sign-out">
                  {isSigningOut ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <LogOut aria-hidden="true" />}{isSigningOut ? 'جارٍ تسجيل الخروج...' : 'تسجيل الخروج'}
                </Button>
              </div>
            )}
            <ConnectionStatus mode={connectionMode} canRetrySharedConnection={canRetrySharedConnection} syncQueue={syncQueue} onRetry={() => void retrySharedConnection()} />
            {connectionMode === 'loading' ? <DashboardLoading /> : canViewCurrentRoute ? children : <RestrictedRoute />}
          </div>
        </main>
      </div>
    </div>
  );
}

function BrandLockup({ dark = false }: { dark?: boolean }) {
  return (
    <div className={`flex items-center gap-3 ${dark ? 'text-white' : 'text-[#062344]'}`}>
      <div className="relative h-11 w-11 shrink-0 overflow-hidden">
        <img src={`${import.meta.env.BASE_URL}logo-transparent.png`} alt="شعار ترصيد" className={`absolute max-w-none ${dark ? 'brightness-0 invert' : ''}`} style={{ width: '115px', right: '-34px', top: '-22px' }} />
      </div>
      <div><p className="text-lg font-black leading-none">ترصيد</p><p className={`mt-1 text-[10px] font-semibold ${dark ? 'text-slate-400' : 'text-slate-500'}`}>وضوح أكبر لنمو أسرع</p></div>
    </div>
  );
}

function DashboardLoading() {
  return <div className="flex min-h-72 flex-col items-center justify-center rounded-3xl border border-white/10 bg-white p-8 text-center shadow-xl" role="status" data-testid="dashboard-content-loading"><LoaderCircle className="h-6 w-6 animate-spin text-primary" aria-hidden="true" /><p className="mt-3 font-semibold text-slate-800">جارٍ التحقق من صلاحيات الوصول</p><p className="mt-1 text-sm text-slate-500">لن نعرض بيانات السجل المشترك قبل تأكيد جلسة الدخول.</p></div>;
}

function RestrictedRoute() {
  return <div className="rounded-3xl border border-white/10 bg-white p-10 text-center shadow-xl" data-testid="restricted-route-message"><CloudOff className="mx-auto h-9 w-9 text-slate-300" aria-hidden="true" /><h2 className="mt-4 text-xl font-bold text-slate-900">هذه الوحدة غير متاحة لحسابك</h2><p className="mx-auto mt-2 max-w-md text-sm text-slate-500">تواصل مع مالك المنشأة إذا كنت تحتاج إلى صلاحية الوصول إليها.</p></div>;
}

function canAccessNavigationItem(href: string, user: { roleId: string; permissions: Record<string, boolean> }): boolean {
  if (user.roleId === 'owner') return true;
  const permissionByRoute: Record<string, string> = { '/dashboard': 'dashboard', '/pos': 'sales', '/sales': 'sales', '/inventory': 'inventory', '/purchases': 'inventory', '/accounts': 'accounting', '/journals': 'accounting', '/receivables': 'accounting', '/reports': 'reports', '/hr': 'hr', '/operations': 'operations', '/team': '__owner__' };
  const permission = permissionByRoute[href];
  return permission ? user.permissions[permission] === true : false;
}

function ConnectionStatus({ mode, canRetrySharedConnection, syncQueue, onRetry }: { mode: 'loading' | 'remote' | 'local'; canRetrySharedConnection: boolean; syncQueue: Array<{ status: 'pending' | 'failed'; error?: string }>; onRetry: () => void }) {
  const failedOperations = syncQueue.filter((operation) => operation.status === 'failed').length;
  const queueMessage = failedOperations ? `تعذرت مزامنة ${failedOperations} من ${syncQueue.length} عملية محفوظة محلياً.` : `هناك ${syncQueue.length} عملية محفوظة محلياً بانتظار المزامنة.`;
  if (mode === 'loading') return <div className="mb-6 flex items-start gap-3 rounded-2xl border border-white/10 bg-white px-4 py-3 text-slate-600 shadow-xl" role="status" aria-live="polite" data-testid="connection-status-loading"><LoaderCircle className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-slate-500" aria-hidden="true" /><div><p className="font-semibold">جارٍ التحقق من مصدر البيانات</p><p className="mt-1 text-sm">نحاول الاتصال بسجل المنشأة المشترك قبل عرض البيانات.</p></div></div>;
  if (mode === 'remote') return <div className="mb-6 flex items-start gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-900 shadow-xl" role="status" aria-live="polite" data-testid="connection-status-remote"><Cloud className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" /><div><p className="font-semibold">متصل بسجل المنشأة المشترك</p><p className="mt-1 text-sm text-emerald-800">التغييرات محفوظة وتظهر للأجهزة وأعضاء الفريق المصرح لهم.</p>{syncQueue.length > 0 && <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950" data-testid="sync-queue-status"><p>{queueMessage} ستبقى التغييرات ظاهرة هنا إلى أن تنجح المزامنة.</p>{failedOperations > 0 && <p className="w-full text-xs text-amber-900">{syncQueue.find((operation) => operation.status === 'failed')?.error}</p>}<Button type="button" variant="outline" size="sm" className="border-amber-300 bg-white text-amber-950 hover:bg-amber-100" onClick={onRetry} data-testid="button-retry-sync-queue">إعادة محاولة المزامنة</Button></div>}</div></div>;
  return <div className="mb-6 flex items-start gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950 shadow-xl" role="alert" aria-live="polite" data-testid="connection-status-local"><CloudOff className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" /><div className="flex-1"><p className="font-semibold">{canRetrySharedConnection ? 'تعذر الوصول إلى السجل المشترك' : 'وضع البيانات المحلي'}</p><p className="mt-1 text-sm text-amber-900">{canRetrySharedConnection ? 'نعرض الآن البيانات المحفوظة في هذا المتصفح فقط. لن تتم مزامنة التغييرات حتى إعادة الاتصال بالسجل المشترك.' : 'التغييرات محفوظة في هذا المتصفح فقط، ولن تظهر على الأجهزة أو لأعضاء الفريق. سجّل الدخول للاتصال بسجل المنشأة المشترك.'}</p>{syncQueue.length > 0 && <p className="mt-2 text-sm font-medium text-amber-950" data-testid="sync-queue-status">{queueMessage} ستتم محاولة الإرسال بالترتيب عند إعادة الاتصال.</p>}</div>{canRetrySharedConnection && <Button type="button" variant="outline" size="sm" className="border-amber-300 bg-white text-amber-950 hover:bg-amber-100" onClick={onRetry} data-testid="button-retry-shared-connection">إعادة الاتصال</Button>}</div>;
}