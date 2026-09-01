import { useState } from "react";
import {
  Activity, AlertTriangle, ArrowDownRight, ArrowLeft, ArrowUpRight, BarChart3,
  Book, BookOpen, Boxes, BriefcaseBusiness, Check, CheckCircle2, ChevronLeft,
  ClipboardList, Copy, FileBadge, FileText, LayoutDashboard, LogOut, Menu,
  PackageOpen, ReceiptText, ShoppingCart, Sparkles, Store, Truck, UsersRound,
  Wallet, X, type LucideIcon,
} from "lucide-react";
import "./_group.css";

type Item = { name: string; href: string; icon: LucideIcon };
const groups: Array<{ label: string; items: Item[] }> = [
  { label: "الرئيسية", items: [{ name: "لوحة التحكم", href: "/dashboard", icon: LayoutDashboard }, { name: "دليل الاستخدام", href: "/guide", icon: BookOpen }] },
  { label: "المبيعات والتشغيل", items: [
    { name: "نقطة البيع", href: "/pos", icon: Store }, { name: "المبيعات والعملاء", href: "/sales", icon: ShoppingCart },
    { name: "عروض الأسعار", href: "/quotations", icon: ClipboardList }, { name: "المخزون والمنتجات", href: "/inventory", icon: Boxes },
    { name: "أوامر الشراء", href: "/purchase-orders", icon: PackageOpen }, { name: "المشتريات والموردون", href: "/purchases", icon: Truck },
  ] },
  { label: "المالية", items: [
    { name: "دليل الحسابات", href: "/accounts", icon: Book }, { name: "القيود اليومية", href: "/journals", icon: FileText },
    { name: "الذمم والمستحقات", href: "/receivables", icon: Wallet }, { name: "المصاريف", href: "/expenses", icon: ReceiptText },
    { name: "التقارير المالية", href: "/reports", icon: BarChart3 }, { name: "الفوترة الإلكترونية", href: "/e-invoicing", icon: FileBadge },
  ] },
  { label: "الإدارة", items: [{ name: "الموارد البشرية", href: "/hr", icon: UsersRound }, { name: "العمليات والمشاريع", href: "/operations", icon: BriefcaseBusiness }, { name: "سجل العمليات", href: "/operations-log", icon: Activity }, { name: "إدارة الفريق", href: "/team", icon: UsersRound }] },
];

const modules = [
  ["نقطة البيع", "سجّل مبيعاتك وفواتيرك بسرعة من شاشة واحدة.", "/pos", Store, "teal", "pos"],
  ["المبيعات والعملاء", "تابع العملاء والفواتير وحركة البيع اليومية.", "/sales", ShoppingCart, "blue", "sales"],
  ["عروض الأسعار", "أصدر عروض أسعار للعملاء وحولها لفواتير.", "/quotations", ClipboardList, "emerald", "quotations"],
  ["المخزون والمنتجات", "راقب الأرصدة والمنتجات وحركات المستودعات.", "/inventory", Boxes, "violet", "inventory"],
  ["أوامر الشراء", "أنشئ أوامر الموردين وتابع الاستلام الجزئي والكامل.", "/purchase-orders", PackageOpen, "indigo", "purchase-orders"],
  ["المشتريات والموردون", "نظّم أوامر الشراء والتزامات الموردين.", "/purchases", Truck, "amber", "purchases"],
  ["المحاسبة", "الحسابات والقيود والذمم في سجل مترابط.", "/accounts", ReceiptText, "sky", "accounting"],
  ["التقارير المالية", "اقرأ أداء منشأتك من أرقام واضحة ومترابطة.", "/reports", BarChart3, "indigo", "reports"],
  ["الموارد البشرية", "رتّب بيانات فريقك وصلاحيات العمل.", "/hr", UsersRound, "rose", "hr"],
  ["العمليات والمشاريع", "تابع أعمالك ومشاريعك من البداية حتى الإنجاز.", "/operations", BriefcaseBusiness, "orange", "operations"],
] as const;

const expenses = [["إيجار الفرع الرئيسي", "5100", 18500], ["رواتب ومزايا الموظفين", "5200", 12750], ["مشتريات تشغيلية", "5300", 6840], ["خدمات وشحن", "5400", 3250]];
const dues = [["شركة روابي للتوريد", "2025-08-24", 9200, "دفع"], ["مؤسسة النخبة", "2025-08-27", 6750, "تحصيل"], ["متجر ألوان", "2025-09-01", 4320, "تحصيل"], ["شركة المدى", "2025-09-03", 2800, "دفع"]];

function jump(event: React.MouseEvent<HTMLAnchorElement>) { event.preventDefault(); }
function money(value: number) { return new Intl.NumberFormat("ar-SA", { style: "currency", currency: "SAR" }).format(value); }

export function Current() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  return (
    <div className="min-h-screen bg-[#0A1328] font-sans text-slate-900" dir="rtl">
      <div className="flex min-h-screen flex-col md:flex-row">
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 md:hidden">
          <Brand />
          <button type="button" className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-sm font-bold" onClick={() => setOpen(!open)} data-testid="button-menu">{open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />} لوحة التحكم</button>
        </div>
        {open && <button type="button" className="fixed inset-0 z-20 bg-slate-950/40 md:hidden" onClick={() => setOpen(false)} aria-label="إغلاق القائمة" />}
        <aside className={`${open ? "translate-x-0" : "translate-x-full"} fixed inset-y-0 right-0 z-30 flex w-[286px] flex-col bg-[#0A1328] text-white shadow-2xl transition-transform md:static md:w-72 md:translate-x-0 md:shadow-none`}>
          <div className="border-b border-white/10 px-6 py-6"><Brand dark /><div className="mt-6 rounded-2xl border border-white/10 bg-white/5 px-4 py-3"><p className="text-xs font-semibold text-teal-200">مساحة العمل</p><p className="mt-1 text-sm font-bold">متجر النخبة</p><p className="mt-1 text-xs text-slate-400">أحمد العتيبي</p></div></div>
          <nav className="flex-1 space-y-6 overflow-y-auto px-4 py-6" aria-label="القائمة الرئيسية">{groups.map(group => <div key={group.label}><p className="mb-2 px-3 text-[11px] font-bold tracking-wide text-slate-400">{group.label}</p><div className="space-y-1">{group.items.map(item => <a href={item.href} onClick={jump} key={item.href} data-testid={`link-${item.href.slice(1)}`}><div className={`group flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold transition ${item.href === "/dashboard" ? "bg-teal-400 text-[#0A1328]" : "text-slate-200 hover:bg-white/10"}`}><item.icon className="h-[18px] w-[18px] shrink-0 text-teal-200" /><span className="flex-1">{item.name}</span>{item.href === "/dashboard" && <ChevronLeft className="h-4 w-4" />}</div></a>)}</div></div>)}</nav>
          <div className="border-t border-white/10 p-4"><div className="rounded-2xl bg-white/5 p-3 text-xs leading-6 text-slate-300"><div className="flex items-center gap-2 font-bold text-white"><PackageOpen className="h-4 w-4 text-teal-300" />ترصيد لإدارة أوضح</div><p className="mt-1">كل عمليات منشأتك في مكان واحد.</p></div></div>
        </aside>
        <main className="min-w-0 flex-1 overflow-x-hidden"><div className="mx-auto max-w-[1440px] p-4 sm:p-6 lg:p-8">
          <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/10 px-4 py-3 text-white shadow-xl sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-bold">متجر النخبة</p><p className="text-xs text-slate-300">أحمد العتيبي · ahmad@elite-store.sa</p></div><div className="flex gap-2"><button className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/20 bg-white/5 px-3 text-xs font-bold text-white" data-testid="button-sign-out"><LogOut className="h-4 w-4" />تسجيل الخروج</button></div></div>
          <DashboardContent copied={copied} onCopy={() => setCopied(true)} />
        </div></main>
      </div>
    </div>
  );
}

function DashboardContent({ copied, onCopy }: { copied: boolean; onCopy: () => void }) {
  return <div className="space-y-6">
    <section className="relative overflow-hidden rounded-[28px] border border-white/10 bg-gradient-to-br from-[#0D47D9] via-[#0A1328] to-[#0A1328] px-5 py-7 text-white shadow-2xl sm:px-8 sm:py-9"><div className="pointer-events-none absolute -left-16 -top-20 h-64 w-64 rounded-full bg-teal-400/15 blur-3xl" /><div className="relative flex flex-col gap-7 lg:flex-row lg:items-end lg:justify-between"><div className="max-w-2xl"><div className="mb-4 inline-flex items-center gap-2 rounded-full border border-teal-200/20 bg-teal-200/10 px-3 py-1.5 text-xs font-bold text-teal-100"><CheckCircle2 className="h-4 w-4 text-teal-300" />مساحة عملك جاهزة</div><h1 className="text-3xl font-black leading-tight sm:text-4xl" data-testid="text-dashboard-heading">أهلاً أحمد، إدارة أوضح تبدأ من هنا</h1><p className="mt-4 max-w-xl text-sm leading-7 text-slate-300 sm:text-base">تابع مبيعاتك ومخزونك وحساباتك وفريقك من لوحة واحدة مصممة لتختصر عليك الطريق.</p><div className="mt-6 flex flex-wrap gap-3"><Action href="/pos">افتح نقطة البيع <ArrowLeft className="h-4 w-4" /></Action><Action href="/reports" secondary>استكشف التقارير <BarChart3 className="h-4 w-4" /></Action></div></div><div className="grid grid-cols-2 gap-3 sm:grid-cols-5 lg:w-[600px]" aria-label="مؤشرات سريعة"><Quick label="حسابات نشطة" value="24" /><Quick label="قيود مسجلة" value="186" /><Quick label="ذمم معلقة" value="4" /><Quick label="عروض معلقة" value="7" /><Quick label="أوامر قيد الاستلام" value="3" /></div></div></section>
    <section className="flex flex-col gap-4 rounded-2xl border border-amber-300 bg-amber-50 p-5 shadow-xl sm:flex-row sm:items-center sm:justify-between" role="alert"><div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-700"><AlertTriangle className="h-5 w-5" /></span><div><h2 className="font-black text-amber-950">هناك أوامر شراء متأخرة</h2><p className="mt-1 text-sm text-amber-800">2 أمر تجاوز تاريخ التسليم المتوقع وما زال ينتظر الاستلام.</p></div></div><Action href="/purchase-orders" alert>مراجعة الأوامر <ArrowLeft className="h-4 w-4" /></Action></section>
    <section><Header eyebrow="صورة سريعة" title="ملخصك المالي" /><div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"><Metric title="صافي الربح" value={money(67250)} note="الإيرادات ناقص المصروفات" icon={Wallet} tone="teal" /><Metric title="إجمالي الإيرادات" value={money(98500)} note="إيرادات الحسابات المسجلة" icon={ArrowUpRight} tone="blue" /><Metric title="الذمم المدينة (لنا)" value={money(17300)} note="مبالغ مستحقة من العملاء" icon={ArrowUpRight} tone="sky" /><Metric title="الذمم الدائنة (علينا)" value={money(8600)} note="مبالغ مستحقة للموردين" icon={ArrowDownRight} tone="rose" /></div></section>
    <section className="overflow-hidden rounded-2xl border border-indigo-200/80 bg-gradient-to-br from-indigo-50 via-white to-teal-50 p-5 shadow-xl sm:p-6"><div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"><div className="flex items-start gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700"><Sparkles className="h-5 w-5" /></span><div><h2 className="text-lg font-black text-slate-900">ملخصك الأسبوعي</h2><p className="mt-1 text-xs text-slate-500">آخر تحديث: اليوم، 10:30 ص</p></div></div><button className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-indigo-700 px-4 text-sm font-bold text-white" data-testid="button-generate-weekly-summary"><Sparkles className="h-4 w-4" />توليد الملخص الآن</button></div><div className="mt-5 rounded-xl border border-indigo-100 bg-white/75 p-4"><p className="text-sm leading-7 text-slate-700">ارتفعت المبيعات هذا الأسبوع بنسبة 12٪، مع تحسن ملحوظ في تحصيل الذمم. ننصح بمراجعة أوامر الشراء المتأخرة ومتابعة العملاء المستحقين.</p></div><div className="mt-4 flex justify-end"><button onClick={onCopy} className="inline-flex h-8 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold" data-testid="button-copy-weekly-summary">{copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}{copied ? "تم النسخ" : "نسخ"}</button></div></section>
    <section><Header eyebrow="كل أعمالك في مكان واحد" title="الوحدات الرئيسية" /><div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">{modules.map(([title, description, href, Icon, tone, id]) => <Module key={id} title={title} description={description} href={href} Icon={Icon} tone={tone} id={id} />)}</div></section>
    <section className="grid grid-cols-1 gap-4 lg:grid-cols-2"><Panel title="أعلى المصروفات" subtitle="الحسابات الأعلى قيمة في سجلك" icon={PackageOpen}>{expenses.map(([name, code, amount]) => <Row key={code} left={<><p className="text-sm font-bold text-slate-800">{name}</p><p className="mt-0.5 text-xs text-slate-400">{code}</p></>} right={<span className="text-sm font-black text-rose-600">{money(Number(amount))}</span>} />)}</Panel><Panel title="مستحقات قريبة الأجل" subtitle="تابع التحصيل والدفع القادم" icon={Wallet}>{dues.map(([party, date, amount, type]) => <Row key={party} left={<><p className="text-sm font-bold text-slate-800">{party}</p><p className="mt-0.5 text-xs text-slate-400">تستحق في {date}</p></>} right={<div className="text-left"><p className={`text-sm font-black ${type === "تحصيل" ? "text-blue-600" : "text-rose-600"}`}>{money(Number(amount))}</p><p className="mt-0.5 text-xs text-slate-400">{type}</p></div>} />)}</Panel></section>
  </div>;
}

function Action({ href, children, secondary, alert }: { href: string; children: React.ReactNode; secondary?: boolean; alert?: boolean }) { return <a href={href} onClick={jump} className={`inline-flex h-11 items-center gap-2 rounded-xl px-5 text-sm font-bold ${alert ? "h-10 bg-amber-900 text-white" : secondary ? "border border-white/20 bg-white/5 text-white" : "bg-primary text-white shadow-lg"}`}>{children}</a>; }
function Quick({ label, value }: { label: string; value: string }) { return <div className="rounded-2xl border border-white/10 bg-white/10 px-3 py-3 backdrop-blur"><p className="text-[11px] text-slate-300">{label}</p><p className="mt-1 text-sm font-black text-teal-200">{value}</p></div>; }
function Header({ eyebrow, title }: { eyebrow: string; title: string }) { return <div className="mb-4 flex items-end justify-between text-white"><div><p className="text-xs font-bold text-teal-200">{eyebrow}</p><h2 className="mt-1 text-xl font-black sm:text-2xl">{title}</h2></div></div>; }
function Metric({ title, value, note, icon: Icon, tone }: { title: string; value: string; note: string; icon: LucideIcon; tone: string }) { const colors: Record<string, string> = { teal: "bg-teal-50 text-teal-600", blue: "bg-blue-50 text-blue-600", sky: "bg-sky-50 text-sky-600", rose: "bg-rose-50 text-rose-600" }; return <div className="rounded-2xl border border-white/10 bg-white p-5 shadow-xl"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-semibold text-slate-500">{title}</p><p className="mt-3 text-xl font-black tracking-tight text-slate-900 sm:text-2xl">{value}</p></div><span className={`flex h-10 w-10 items-center justify-center rounded-xl ${colors[tone]}`}><Icon className="h-5 w-5" /></span></div><p className="mt-3 text-xs text-slate-400">{note}</p></div>; }
function Module({ title, description, href, Icon, tone, id }: { title: string; description: string; href: string; Icon: LucideIcon; tone: string; id: string }) { const tones: Record<string, string> = { teal: "bg-teal-50 text-teal-700", blue: "bg-blue-50 text-blue-700", emerald: "bg-emerald-50 text-emerald-700", violet: "bg-violet-50 text-violet-700", indigo: "bg-indigo-50 text-indigo-700", amber: "bg-amber-50 text-amber-700", sky: "bg-sky-50 text-sky-700", rose: "bg-rose-50 text-rose-700", orange: "bg-orange-50 text-orange-700" }; return <a href={href} onClick={jump}><div className={`group relative h-full min-h-[168px] rounded-2xl border p-5 shadow-xl transition hover:-translate-y-1 ${id === "pos" ? "border-teal-300 bg-gradient-to-br from-white to-teal-50/80" : "border-white/10 bg-white"}`}><span className="absolute left-4 top-4 rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-black text-emerald-700">متاح</span><div className={`flex h-11 w-11 items-center justify-center rounded-xl ${tones[tone]}`}><Icon className="h-5 w-5" /></div><h3 className="mt-5 text-base font-black text-slate-900">{title}</h3><p className="mt-2 text-xs leading-6 text-slate-500">{description}</p><span className="mt-4 inline-flex items-center gap-1 text-xs font-black text-primary opacity-0 transition group-hover:opacity-100">فتح الوحدة <ArrowLeft className="h-3.5 w-3.5" /></span></div></a>; }
function Panel({ title, subtitle, icon: Icon, children }: { title: string; subtitle: string; icon: LucideIcon; children: React.ReactNode }) { return <div className="rounded-2xl border border-white/10 bg-white p-5 shadow-xl"><div className="flex items-start gap-3 border-b border-slate-100 pb-4"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-600"><Icon className="h-5 w-5" /></span><div><h2 className="text-lg font-black text-slate-900">{title}</h2><p className="mt-1 text-xs text-slate-400">{subtitle}</p></div></div><div className="pt-2">{children}</div></div>; }
function Row({ left, right }: { left: React.ReactNode; right: React.ReactNode }) { return <div className="flex items-center justify-between rounded-xl px-2 py-3">{left}{right}</div>; }
function Brand({ dark = false }: { dark?: boolean }) { return <div className={`flex items-center gap-3 ${dark ? "text-white" : "text-[#0A1328]"}`}><div className="flex h-12 w-12 items-center justify-center"><img src="/__mockup/images/logo-mark.png" alt="شعار ترصيد" className="h-full w-full object-contain" /></div><div><p className="text-lg font-black leading-none">ترصيد</p><p className={`mt-1 text-[10px] font-semibold ${dark ? "text-slate-400" : "text-slate-500"}`}>إدارة أسهل لنمو أسرع</p></div></div>; }