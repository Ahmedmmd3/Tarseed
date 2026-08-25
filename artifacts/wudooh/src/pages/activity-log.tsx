import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, BookOpen, CalendarClock, CheckCircle2, ClipboardList, FileText, Filter, LoaderCircle, PackageCheck, RefreshCw, Search, ShieldCheck, ShoppingCart, UsersRound, XCircle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';

type LogCategory = 'all' | 'sales' | 'accounting' | 'inventory' | 'team' | 'system';
type AuditLog = {
  id: number;
  actorName: string;
  action: string;
  entity: string;
  details: string;
  createdAt: string;
};

const categoryLabels: Record<LogCategory, string> = {
  all: 'كل العمليات',
  sales: 'المبيعات',
  accounting: 'المحاسبة',
  inventory: 'إدارة المخزون',
  team: 'الفريق والصلاحيات',
  system: 'النظام',
};

const actionLabels: Record<string, string> = {
  pos_checkout_completed: 'إتمام فاتورة نقطة البيع',
  inventory_sale_recorded: 'تسجيل حركة بيع',
  invoices_created: 'إنشاء فاتورة',
  invoices_updated: 'تعديل فاتورة',
  invoices_deleted: 'حذف فاتورة',
  sales_created: 'إنشاء عملية بيع',
  sales_updated: 'تعديل عملية بيع',
  sales_deleted: 'حذف عملية بيع',
  customers_created: 'إنشاء عميل',
  customers_updated: 'تعديل عميل',
  customers_deleted: 'حذف عميل',
  journalEntries_created: 'إنشاء قيد يومية',
  journalEntries_updated: 'تحديث قيد يومية',
  journalEntries_deleted: 'حذف قيد يومية',
  financial_period_closed: 'إقفال فترة مالية',
  source_journals_synced: 'مزامنة قيود المصادر',
  accounts_created: 'إنشاء حساب',
  accounts_updated: 'تعديل حساب',
  accounts_deleted: 'حذف حساب',
  receivables_created: 'إنشاء ذمة',
  receivables_updated: 'تحديث ذمة',
  receivables_deleted: 'حذف ذمة',
  products_created: 'إنشاء منتج',
  products_updated: 'تعديل منتج',
  products_deleted: 'حذف منتج',
  stock_transfer_created: 'إنشاء تحويل مخزني',
  stock_transfer_approved: 'اعتماد تحويل مخزني',
  stock_transfer_cancelled: 'إلغاء تحويل مخزني',
  stock_transfer_received: 'استلام تحويل مخزني',
  stock_adjustment_recorded: 'تسجيل تسوية مخزنية',
  erp_backup_restored: 'استعادة نسخة احتياطية',
  password_reset_delivery_failed: 'فشل إرسال رابط استعادة',
  password_reset_completed: 'إتمام استعادة كلمة المرور',
  member_created: 'إضافة عضو للفريق',
  member_updated: 'تعديل عضو بالفريق',
  member_disabled: 'تعطيل عضو بالفريق',
  member_enabled: 'تفعيل عضو بالفريق',
  subscription_activated: 'تفعيل الاشتراك',
  subscription_plan_changed: 'تغيير الباقة',
  subscription_renewed: 'تجديد الاشتراك',
  subscription_deactivated: 'إيقاف الاشتراك',
  login: 'تسجيل دخول',
};

function categoryForAction(action: string): Exclude<LogCategory, 'all'> {
  if (action.includes('invoice') || action.includes('sale') || action.includes('pos') || action.includes('customer')) return 'sales';
  if (action.includes('journal') || action.includes('account') || action.includes('receivable') || action.includes('financial') || action.includes('source_')) return 'accounting';
  if (action.includes('stock') || action.includes('product') || action.includes('warehouse') || action.includes('inventory')) return 'inventory';
  if (action.includes('member') || action.includes('password') || action === 'login') return 'team';
  return 'system';
}

function labelForAction(action: string): string {
  return actionLabels[action] ?? action.replaceAll('_', ' ');
}

function iconForCategory(category: Exclude<LogCategory, 'all'>) {
  if (category === 'sales') return ShoppingCart;
  if (category === 'accounting') return BookOpen;
  if (category === 'inventory') return PackageCheck;
  if (category === 'team') return UsersRound;
  return Activity;
}

export default function ActivityLog() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [category, setCategory] = useState<LogCategory>('all');
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');

  const loadLogs = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const response = await fetch('/api/audit-logs', { credentials: 'include', cache: 'no-store' });
      const payload = await response.json() as { logs?: AuditLog[]; error?: string };
      if (!response.ok || !Array.isArray(payload.logs)) {
        throw new Error(payload.error ?? 'تعذر تحميل سجل العمليات.');
      }
      setLogs(payload.logs);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'تعذر تحميل سجل العمليات.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  const filteredLogs = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ar');
    return logs.filter((log) => {
      const logCategory = categoryForAction(log.action);
      const matchesCategory = category === 'all' || logCategory === category;
      const haystack = `${labelForAction(log.action)} ${log.actorName} ${log.entity} ${log.details}`.toLocaleLowerCase('ar');
      return matchesCategory && (!query || haystack.includes(query));
    });
  }, [category, logs, search]);

  const counts = useMemo(() => logs.reduce<Record<string, number>>((result, log) => {
    const key = categoryForAction(log.action);
    result[key] = (result[key] ?? 0) + 1;
    return result;
  }, {}), [logs]);

  return (
    <div className="space-y-6" data-testid="page-activity-log">
      <section className="overflow-hidden rounded-[28px] border border-white/10 bg-gradient-to-br from-[#0b3b61] via-[#082b4e] to-[#061d40] px-5 py-7 text-white shadow-2xl shadow-slate-950/20 sm:px-8 sm:py-9">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-teal-200/20 bg-teal-200/10 px-3 py-1.5 text-xs font-bold text-teal-100">
              <ShieldCheck className="h-4 w-4 text-teal-300" aria-hidden="true" />سجل المنشأة المشترك
            </div>
            <h1 className="text-3xl font-black sm:text-4xl">سجل العمليات</h1>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-slate-300">كل فاتورة وقيد وحركة مخزون وتغيير إداري موثق في مكان واحد مع اسم المنفذ ووقت العملية.</p>
          </div>
          <Button type="button" variant="outline" onClick={() => void loadLogs()} disabled={isLoading} className="w-fit border-white/20 bg-white/5 text-white hover:bg-white/15 hover:text-white" data-testid="button-refresh-activity-log">
            <RefreshCw className={`ml-2 h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />تحديث السجل
          </Button>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="إجمالي العمليات" value={logs.length} icon={ClipboardList} />
        <SummaryCard label="المبيعات" value={counts.sales ?? 0} icon={ShoppingCart} />
        <SummaryCard label="المحاسبة" value={counts.accounting ?? 0} icon={FileText} />
        <SummaryCard label="المخزون" value={counts.inventory ?? 0} icon={PackageCheck} />
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="ابحث باسم المنفذ أو نوع العملية أو المرجع..." className="pr-9" aria-label="البحث في سجل العمليات" data-testid="input-search-activity-log" />
          </div>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="تصفية سجل العمليات">
            <Filter className="hidden h-4 w-4 text-slate-400 sm:block" aria-hidden="true" />
            {(Object.keys(categoryLabels) as LogCategory[]).map((item) => (
              <button key={item} type="button" onClick={() => setCategory(item)} className={`rounded-lg px-3 py-2 text-xs font-bold transition ${category === item ? 'bg-primary text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`} data-testid={`filter-activity-${item}`}>
                {categoryLabels[item]}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b border-slate-100">
          <div className="flex items-center justify-between gap-3">
            <CardTitle className="text-lg">آخر العمليات</CardTitle>
            <Badge variant="secondary">{filteredLogs.length.toLocaleString('ar-SA')} عملية</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading && <div className="flex items-center justify-center gap-2 p-12 text-sm text-slate-500" role="status"><LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />جارٍ تحميل سجل العمليات...</div>}
          {!isLoading && error && <div className="m-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800" role="alert"><XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><div className="flex-1">{error}</div><Button type="button" variant="outline" size="sm" onClick={() => void loadLogs()}>إعادة المحاولة</Button></div>}
          {!isLoading && !error && filteredLogs.length === 0 && <div className="p-12 text-center text-sm text-slate-500"><ClipboardList className="mx-auto h-9 w-9 text-slate-300" aria-hidden="true" /><p className="mt-3 font-semibold">{logs.length === 0 ? 'لا توجد عمليات مسجلة بعد.' : 'لا توجد نتائج مطابقة للفلاتر الحالية.'}</p><p className="mt-1 text-xs text-slate-400">ستظهر هنا الفواتير والقيود وحركات المخزون فور اعتمادها.</p></div>}
          {!isLoading && !error && filteredLogs.length > 0 && (
            <div className="divide-y divide-slate-100">
              {filteredLogs.map((log) => <ActivityRow key={log.id} log={log} />)}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({ label, value, icon: Icon }: { label: string; value: number; icon: typeof Activity }) {
  return <div className="rounded-2xl border border-white/10 bg-white p-4 shadow-xl shadow-slate-950/10"><div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold text-slate-500">{label}</p><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-50 text-teal-700"><Icon className="h-4 w-4" aria-hidden="true" /></span></div><p className="mt-3 text-2xl font-black text-slate-900">{value.toLocaleString('ar-SA')}</p></div>;
}

function ActivityRow({ log }: { log: AuditLog }) {
  const category = categoryForAction(log.action);
  const Icon = iconForCategory(category);
  const date = new Date(log.createdAt);
  return (
    <div className="flex flex-col gap-4 px-5 py-4 transition hover:bg-slate-50 sm:flex-row sm:items-center" data-testid={`activity-row-${log.id}`}>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600"><Icon className="h-5 w-5" aria-hidden="true" /></span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-bold text-slate-900">{labelForAction(log.action)}</h3>
          <Badge variant="outline">{categoryLabels[category]}</Badge>
        </div>
        <p className="mt-1 truncate text-sm text-slate-500">{log.details || (log.entity ? `المرجع: ${log.entity}` : 'تم تسجيل العملية بنجاح.')}</p>
      </div>
      <div className="flex shrink-0 flex-col gap-1 text-xs text-slate-400 sm:items-end">
        <span className="inline-flex items-center gap-1 font-semibold text-slate-600"><UsersRound className="h-3.5 w-3.5" aria-hidden="true" />{log.actorName}</span>
        <span className="inline-flex items-center gap-1"><CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />{date.toLocaleString('ar-SA')}</span>
      </div>
    </div>
  );
}