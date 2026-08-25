import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowLeft, ArrowUpRight, BarChart3, Boxes, BriefcaseBusiness, CheckCircle2, PackageOpen, ReceiptText, ShoppingCart, Store, Truck, UsersRound, Wallet, type LucideIcon } from 'lucide-react';
import { Link } from 'wouter';
import { useStore } from '@/context/store';

type Module = { title: string; description: string; href: string; icon: LucideIcon; tone: string; permission: string; ready: boolean; id: string };

const modules: Module[] = [
  { title: 'نقطة البيع', description: 'سجّل مبيعاتك وفواتيرك بسرعة من شاشة واحدة.', href: '/pos', icon: Store, tone: 'bg-teal-50 text-teal-700', permission: 'sales', ready: true, id: 'pos' },
  { title: 'المبيعات والعملاء', description: 'تابع العملاء والفواتير وحركة البيع اليومية.', href: '/sales', icon: ShoppingCart, tone: 'bg-blue-50 text-blue-700', permission: 'sales', ready: false, id: 'sales' },
  { title: 'المخزون والمنتجات', description: 'راقب الأرصدة والمنتجات وحركات المستودعات.', href: '/inventory', icon: Boxes, tone: 'bg-violet-50 text-violet-700', permission: 'inventory', ready: false, id: 'inventory' },
  { title: 'المشتريات والموردون', description: 'نظّم أوامر الشراء والتزامات الموردين.', href: '/purchases', icon: Truck, tone: 'bg-amber-50 text-amber-700', permission: 'inventory', ready: false, id: 'purchases' },
  { title: 'المحاسبة', description: 'الحسابات والقيود والذمم في سجل مترابط.', href: '/accounts', icon: ReceiptText, tone: 'bg-sky-50 text-sky-700', permission: 'accounting', ready: true, id: 'accounting' },
  { title: 'التقارير المالية', description: 'اقرأ أداء منشأتك من أرقام واضحة ومترابطة.', href: '/reports', icon: BarChart3, tone: 'bg-indigo-50 text-indigo-700', permission: 'reports', ready: true, id: 'reports' },
  { title: 'الموارد البشرية', description: 'رتّب بيانات فريقك وصلاحيات العمل.', href: '/hr', icon: UsersRound, tone: 'bg-rose-50 text-rose-700', permission: 'hr', ready: false, id: 'hr' },
  { title: 'العمليات والمشاريع', description: 'تابع أعمالك ومشاريعك من البداية حتى الإنجاز.', href: '/operations', icon: BriefcaseBusiness, tone: 'bg-orange-50 text-orange-700', permission: 'operations', ready: false, id: 'operations' },
];

export default function Overview() {
  const { accounts, receivables, journals, currentUser } = useStore();
  const totalRevenue = accounts.filter((account) => account.type === 'revenue').reduce((sum, account) => sum + account.balance, 0);
  const totalExpense = accounts.filter((account) => account.type === 'expense').reduce((sum, account) => sum + account.balance, 0);
  const netProfit = totalRevenue - totalExpense;
  const totalReceivables = receivables.filter((record) => record.type === 'receivable').reduce((sum, record) => sum + (record.amount - record.paid), 0);
  const totalPayables = receivables.filter((record) => record.type === 'payable').reduce((sum, record) => sum + (record.amount - record.paid), 0);
  const pendingReceivables = receivables.filter((record) => record.status !== 'paid').sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()).slice(0, 4);
  const topExpenses = accounts.filter((account) => account.type === 'expense').sort((a, b) => b.balance - a.balance).slice(0, 4);
  const visibleModules = modules.filter((module) => !currentUser || currentUser.roleId === 'owner' || currentUser.permissions[module.permission] === true);

  return (
    <div className="space-y-6" data-testid="page-overview">
      <section className="relative overflow-hidden rounded-[28px] border border-white/10 bg-gradient-to-br from-[#0b3b61] via-[#082b4e] to-[#061d40] px-5 py-7 text-white shadow-2xl shadow-slate-950/20 sm:px-8 sm:py-9">
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
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:w-[390px]" aria-label="مؤشرات سريعة">
            <QuickMetric label="حسابات نشطة" value={accounts.length.toLocaleString('ar-SA')} testId="accounts-count" />
            <QuickMetric label="قيود مسجلة" value={journals.length.toLocaleString('ar-SA')} testId="journals-count" />
            <QuickMetric label="ذمم معلقة" value={pendingReceivables.length.toLocaleString('ar-SA')} testId="receivables-count" />
          </div>
        </div>
      </section>

      <section aria-labelledby="financial-summary-heading">
        <div className="mb-4 flex items-end justify-between gap-4 text-white">
          <div><p className="text-xs font-bold text-teal-200">صورة سريعة</p><h2 id="financial-summary-heading" className="mt-1 text-xl font-black sm:text-2xl">ملخصك المالي</h2></div>
          <Link href="/reports" className="hidden items-center gap-1 text-xs font-bold text-teal-200 transition hover:text-white sm:inline-flex" data-testid="link-financial-reports">عرض كل التقارير <ArrowLeft className="h-3.5 w-3.5" /></Link>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard title="صافي الربح" value={formatCurrency(netProfit)} note="الإيرادات ناقص المصروفات" icon={Wallet} tone="teal" testId="text-net-profit" />
          <MetricCard title="إجمالي الإيرادات" value={formatCurrency(totalRevenue)} note="إيرادات الحسابات المسجلة" icon={ArrowUpRight} tone="blue" testId="text-total-revenue" />
          <MetricCard title="الذمم المدينة (لنا)" value={formatCurrency(totalReceivables)} note="مبالغ مستحقة من العملاء" icon={ArrowUpRight} tone="sky" testId="text-total-receivables" />
          <MetricCard title="الذمم الدائنة (علينا)" value={formatCurrency(totalPayables)} note="مبالغ مستحقة للموردين" icon={ArrowDownRight} tone="rose" testId="text-total-payables" />
        </div>
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
          <div className="space-y-1">{pendingReceivables.map((record) => <div key={record.id} className="flex items-center justify-between rounded-xl px-2 py-3 transition hover:bg-slate-50" data-testid={`row-receivable-${record.id}`}><div><p className="text-sm font-bold text-slate-800">{record.party}</p><p className="mt-0.5 text-xs text-slate-400">تستحق في {record.dueDate}</p></div><div className="text-left"><p className={`text-sm font-black ${record.type === 'receivable' ? 'text-blue-600' : 'text-rose-600'}`}>{formatCurrency(record.amount - record.paid)}</p><p className="mt-0.5 text-xs text-slate-400">{record.type === 'receivable' ? 'تحصيل' : 'دفع'}</p></div></div>)}{pendingReceivables.length === 0 && <EmptyState text="لا توجد مستحقات معلقة" />}</div>
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

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('ar-SA', { style: 'currency', currency: 'SAR' }).format(amount);
}