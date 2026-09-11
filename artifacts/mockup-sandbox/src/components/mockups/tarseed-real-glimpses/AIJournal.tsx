import { useState } from "react";
import {
  Bell, BookOpen, CalendarDays, Check, ChevronLeft, FileText, LayoutDashboard,
  Menu, Plus, Search, Settings, Sparkles, WalletCards, X,
} from "lucide-react";
import "./_group.css";

const money = (value: number) =>
  new Intl.NumberFormat("ar-SA", { minimumFractionDigits: 2 }).format(value);

type JournalLine = {
  code: string;
  account: string;
  debit: number;
  credit: number;
};

const lines: JournalLine[] = [
  { code: "5100", account: "مشتريات", debit: 1000, credit: 0 },
  { code: "2150", account: "ضريبة قيمة مضافة", debit: 150, credit: 0 },
  { code: "1110", account: "الصندوق", debit: 0, credit: 1150 },
];

function Brand() {
  return (
    <div className="flex items-center gap-3 text-white">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#00a3ff] text-xl font-black">ت</div>
      <div>
        <p className="text-lg font-black leading-none">ترصيد</p>
        <p className="mt-1 text-[10px] font-semibold text-slate-400">إدارة أسهل لنمو أسرع</p>
      </div>
    </div>
  );
}

function NavItem({ icon: Icon, children, active = false }: { icon: typeof FileText; children: string; active?: boolean }) {
  return (
    <div className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-[12px] font-semibold ${active ? "bg-[#0d47d9] text-white shadow-lg" : "text-slate-300"}`}>
      <Icon className={`h-4 w-4 ${active ? "text-cyan-200" : "text-slate-400"}`} />
      <span className="flex-1">{children}</span>
      {active && <ChevronLeft className="h-3.5 w-3.5" />}
    </div>
  );
}

export function AIJournal() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  return (
    <div dir="rtl" className="min-h-screen bg-[#f1f3f6] font-sans text-slate-900">
      <div className="flex min-h-screen">
        <aside className={`${menuOpen ? "translate-x-0" : "translate-x-full"} fixed inset-y-0 right-0 z-20 flex w-64 flex-col bg-[#0a1328] px-4 py-5 transition-transform md:static md:translate-x-0`}>
          <div className="border-b border-white/10 px-2 pb-5"><Brand /></div>
          <nav className="mt-5 flex-1 space-y-5">
            <div><p className="mb-2 px-3 text-[10px] font-bold text-slate-500">الرئيسية</p><NavItem icon={LayoutDashboard}>لوحة التحكم</NavItem></div>
            <div><p className="mb-2 px-3 text-[10px] font-bold text-slate-500">المالية</p><div className="space-y-1"><NavItem icon={BookOpen}>دليل الحسابات</NavItem><NavItem icon={FileText} active>القيود اليومية</NavItem><NavItem icon={WalletCards}>الذمم والمستحقات</NavItem></div></div>
            <div><p className="mb-2 px-3 text-[10px] font-bold text-slate-500">الإدارة</p><NavItem icon={Settings}>الإعدادات</NavItem></div>
          </nav>
          <div className="rounded-xl border border-white/10 bg-white/5 p-3 text-[11px] leading-5 text-slate-400">كل عمليات منشأتك في مكان واحد.</div>
        </aside>
        {menuOpen && <button aria-label="إغلاق القائمة" className="fixed inset-0 z-10 bg-slate-950/40 md:hidden" onClick={() => setMenuOpen(false)} />}

        <main className="min-w-0 flex-1 overflow-hidden">
          <header className="flex h-[62px] items-center justify-between border-b border-slate-200 bg-white px-5 shadow-sm">
            <div className="flex items-center gap-3"><button className="rounded-lg border border-slate-200 p-2 md:hidden" onClick={() => setMenuOpen(true)}><Menu className="h-4 w-4" /></button><div><p className="text-sm font-black text-slate-900">القيود اليومية</p><p className="text-[10px] text-slate-400">المحاسبة / القيود اليومية</p></div></div>
            <div className="flex items-center gap-4"><Bell className="h-4 w-4 text-slate-500" /><div className="flex items-center gap-2 border-r border-slate-200 pr-4"><div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-xs font-black text-blue-700">أ</div><span className="text-xs font-bold">أحمد العتيبي</span></div></div>
          </header>

          <div className="mx-auto max-w-[1120px] px-5 py-4">
            <div className="mb-3 flex items-center justify-between">
              <div><h1 className="text-xl font-black">القيود اليومية</h1><p className="mt-1 text-xs text-slate-500">سجل وراجع جميع الحركات المالية لمنشأتك</p></div>
              <button className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#0d47d9] px-3.5 text-xs font-bold text-white shadow-sm"><Plus className="h-4 w-4" /> قيد يومية جديد</button>
            </div>

            {!dismissed && <div className="mb-3 flex items-center justify-between rounded-xl border border-indigo-200 bg-gradient-to-l from-indigo-50 to-white px-4 py-2.5 shadow-sm">
              <div className="flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700"><Sparkles className="h-4 w-4" /></span><div><p className="text-xs font-black text-indigo-950">تم إنشاء اقتراح القيد بالذكاء الاصطناعي</p><p className="text-[10px] text-indigo-700">راجع الأطراف قبل الحفظ — الاقتراح متزن وجاهز للمراجعة.</p></div></div>
              <button aria-label="إخفاء التنبيه" onClick={() => setDismissed(true)} className="p-1 text-indigo-400"><X className="h-4 w-4" /></button>
            </div>}

            <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                <div className="flex items-center gap-2"><span className="rounded-md bg-slate-900 px-2 py-1 font-mono text-xs font-bold text-white">#JE-1048</span><span className="flex items-center gap-1 text-[11px] text-slate-500"><CalendarDays className="h-3.5 w-3.5" /> 2025-09-18</span><span className="text-slate-300">|</span><span className="text-sm font-bold">شراء بضاعة نقداً مع ضريبة القيمة المضافة</span></div>
                <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-[10px] font-bold text-emerald-700">اقتراح ذكي</span>
              </div>
              <div className="border-b border-slate-100 px-4 py-3">
                <label className="mb-1 block text-[11px] font-bold text-slate-600">البيان / الشرح</label>
                <div className="flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs text-slate-800 shadow-sm"><FileText className="h-3.5 w-3.5 text-slate-400" />شراء بضاعة نقداً مع ضريبة القيمة المضافة</div>
              </div>
              <div className="p-4">
                <div className="mb-2 flex items-center justify-between"><h2 className="text-sm font-black">أطراف القيد</h2><span className="text-[10px] text-slate-500">اختر حساباً لكل سطر مع تحديد قيمته مدينة أو دائنة</span></div>
                <div className="overflow-hidden rounded-lg border border-slate-200">
                  <table className="w-full border-collapse text-xs"><thead className="bg-slate-100/70 text-[11px] font-bold text-slate-600"><tr><th className="w-10 p-2 text-center">#</th><th className="p-2 text-right">الحساب</th><th className="w-36 p-2 text-center text-emerald-700">مدين (له)</th><th className="w-36 p-2 text-center text-amber-700">دائن (منه)</th></tr></thead>
                    <tbody>{lines.map((line, index) => <tr key={line.code} className="border-t border-slate-100"><td className="p-2 text-center font-mono text-slate-400">{index + 1}</td><td className="p-2"><span className="font-mono text-[10px] text-slate-400">{line.code}</span><span className="mr-2 font-semibold">{line.account}</span></td><td className="p-2 text-center font-mono">{line.debit ? <span className="rounded bg-emerald-50 px-2 py-1 text-emerald-700">{money(line.debit)}</span> : <span className="text-slate-300">—</span>}</td><td className="p-2 text-center font-mono">{line.credit ? <span className="rounded bg-amber-50 px-2 py-1 text-amber-700">{money(line.credit)}</span> : <span className="text-slate-300">—</span>}</td></tr>)}</tbody>
                    <tfoot><tr className="border-t border-slate-200 bg-slate-50 font-bold"><td colSpan={2} className="p-2 text-left text-slate-600">الإجمالي المتزن</td><td className="p-2 text-center font-mono text-emerald-700">{money(1150)}</td><td className="p-2 text-center font-mono text-amber-700">{money(1150)}</td></tr></tfoot>
                  </table>
                </div>
                <div className="mt-3 flex items-center justify-between"><button className="inline-flex h-8 items-center gap-1 rounded-md border border-dashed border-slate-300 px-3 text-[11px] font-bold text-slate-600"><Plus className="h-3.5 w-3.5" /> إضافة طرف جديد</button><div className="flex items-center gap-2 text-[10px] font-bold text-emerald-700"><Check className="h-4 w-4" /> القيد متزن وجاهز للحفظ</div></div>
              </div>
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}