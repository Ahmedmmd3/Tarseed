import {
  Bell,
  BookOpen,
  ChevronLeft,
  FileText,
  LayoutDashboard,
  Menu,
  Search,
  Send,
  Settings,
  Sparkles,
  Store,
  Wallet,
} from "lucide-react";
import "./_group.css";

function Brand() {
  return (
    <div className="flex items-center gap-3 text-white">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#00a3ff] text-lg font-black">
        ت
      </div>
      <div className="text-right">
        <div className="text-base font-black leading-none">ترصيد</div>
        <div className="mt-1 text-[9px] font-semibold text-slate-400">إدارة أسهل لنمو أسرع</div>
      </div>
    </div>
  );
}

const navItems = [
  { label: "لوحة التحكم", icon: LayoutDashboard },
  { label: "المبيعات والفواتير", icon: FileText },
  { label: "المخزون والمنتجات", icon: Store },
  { label: "القيود اليومية", icon: BookOpen },
  { label: "الذمم والمستحقات", icon: Wallet },
];

export function AIChat() {
  return (
    <main className="h-screen min-h-[620px] w-full overflow-hidden bg-[#f1f3f6] font-sans text-slate-900" dir="rtl">
      <div className="flex h-full">
        <aside className="hidden w-[222px] shrink-0 flex-col bg-[#0a1328] p-5 lg:flex">
          <Brand />
          <div className="mt-9 space-y-1">
            <p className="mb-3 px-3 text-[10px] font-bold text-slate-500">القائمة الرئيسية</p>
            {navItems.map(({ label, icon: Icon }, index) => (
              <div
                key={label}
                className={`flex items-center gap-3 rounded-xl px-3 py-3 text-xs font-semibold ${
                  index === 0 ? "bg-[#172746] text-white" : "text-slate-400"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </div>
            ))}
          </div>
          <div className="mt-auto rounded-2xl border border-white/10 bg-white/5 p-3">
            <div className="flex items-center gap-2 text-xs font-bold text-white">
              <Settings className="h-4 w-4 text-[#00a3ff]" />
              إعدادات المنشأة
            </div>
            <p className="mt-2 text-[10px] leading-5 text-slate-500">متجر مدار للتقنية</p>
          </div>
        </aside>

        <section className="min-w-0 flex-1 bg-[#f1f3f6]">
          <header className="flex h-[72px] items-center justify-between border-b border-slate-200 bg-white px-5 lg:px-8">
            <div className="flex items-center gap-4">
              <Menu className="h-5 w-5 text-slate-400 lg:hidden" />
              <div>
                <p className="text-[11px] font-semibold text-slate-400">الأحد، 12 يناير 2025</p>
                <h1 className="mt-1 text-lg font-black text-[#0a1328]">لوحة التحكم</h1>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="hidden h-9 w-40 items-center gap-2 rounded-lg bg-slate-50 px-3 text-[11px] text-slate-400 sm:flex">
                <Search className="h-4 w-4" /> بحث سريع
              </div>
              <Bell className="h-5 w-5 text-slate-400" />
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#dbeafe] text-xs font-black text-[#0d47d9]">م</div>
            </div>
          </header>
          <div className="p-5 lg:p-8">
            <div className="mb-5 flex items-center justify-between">
              <div>
                <h2 className="text-base font-black">نظرة عامة</h2>
                <p className="mt-1 text-[11px] text-slate-400">ملخص أداء منشأتك لهذا الشهر</p>
              </div>
              <button className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-[10px] font-bold text-slate-500">يناير 2025 <ChevronLeft className="mr-1 inline h-3 w-3" /></button>
            </div>
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              {[
                ["إجمالي المبيعات", "٢٤,٨٥٠ ريال", "↑ 12.5%", "text-emerald-600"],
                ["صافي الربح", "٨,٤٢٠ ريال", "↑ 8.2%", "text-emerald-600"],
                ["الفواتير", "١٢٨", "هذا الشهر", "text-slate-400"],
                ["المصروفات", "١٦,٤٣٠ ريال", "↓ 3.1%", "text-rose-500"],
              ].map(([title, value, note, tone]) => (
                <div key={title} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <p className="text-[11px] font-semibold text-slate-400">{title}</p>
                  <p className="mt-3 text-lg font-black text-[#0a1328]">{value}</p>
                  <p className={`mt-2 text-[10px] font-bold ${tone}`}>{note}</p>
                </div>
              ))}
            </div>
            <div className="mt-5 grid gap-4 xl:grid-cols-2">
              <div className="h-52 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex items-center justify-between"><h3 className="text-sm font-black">حركة المبيعات</h3><span className="text-[10px] text-slate-400">آخر 7 أيام</span></div>
                <div className="mt-8 flex h-24 items-end gap-3 px-3">
                  {[42, 65, 50, 80, 58, 91, 72].map((height, i) => <div key={i} className="flex-1 rounded-t-md bg-[#dbeafe]" style={{ height: `${height}%` }}><div className="h-full rounded-t-md bg-[#0d47d9]" style={{ height: `${Math.max(35, height - 15)}%` }} /></div>)}
                </div>
              </div>
              <div className="h-52 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="text-sm font-black">آخر العمليات</h3>
                <div className="mt-4 space-y-3 text-[11px]">
                  {["فاتورة مبيعات #1048", "قيد يومية #0231", "فاتورة مشتريات #0084"].map((item, i) => <div key={item} className="flex items-center justify-between border-b border-slate-100 pb-2"><span className="font-semibold">{item}</span><span className="text-slate-400">{i === 0 ? "١,٢٦٥ ريال" : "اليوم"}</span></div>)}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="absolute inset-y-0 left-0 flex w-full max-w-[440px] flex-col border-l border-slate-200 bg-slate-50 shadow-[-12px_0_35px_rgba(10,19,40,0.16)] sm:w-[440px]">
          <header className="border-b border-slate-200 bg-white px-5 pb-4 pt-5">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-teal-100 text-teal-700">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-base font-black text-slate-900">المساعد المالي</h2>
                <p className="mt-1 text-xs text-slate-500">تحليل سريع لبيانات منشأتك</p>
              </div>
              <span className="mr-auto flex items-center gap-1.5 text-[10px] font-bold text-emerald-600"><span className="h-2 w-2 rounded-full bg-emerald-500" />متصل</span>
            </div>
          </header>
          <div className="flex-1 space-y-4 overflow-hidden px-4 py-5">
            <div className="rounded-2xl border border-teal-100 bg-teal-50 px-4 py-3 text-xs leading-6 text-teal-900">
              يعتمد المساعد على القيود والفواتير والذمم والأسعار وتكلفة المخزون الموثوقة في منشأتك.
            </div>
            <div className="flex justify-end">
              <div className="max-w-[90%] rounded-2xl rounded-br-md bg-[#0a1328] px-4 py-3 text-sm leading-7 text-white shadow-sm">
                ما القيد المناسب لتسجيل شراء بضاعة نقداً بقيمة 1,150 ريال؟
              </div>
            </div>
            <div className="flex justify-start">
              <div className="max-w-[94%] rounded-2xl rounded-bl-md border border-slate-200 bg-white px-4 py-3 text-sm leading-7 text-slate-700 shadow-sm">
                <div className="mb-2 flex items-center gap-2 text-[11px] font-bold text-teal-700"><Sparkles className="h-3.5 w-3.5" />المساعد المالي</div>
                القيد المقترح:<br />
                من حـ/ المشتريات 1,000 ريال،<br />
                ومن حـ/ ضريبة القيمة المضافة 150 ريال،<br />
                إلى حـ/ الصندوق 1,150 ريال.
              </div>
            </div>
          </div>
          <div className="border-t border-slate-200 bg-white p-4">
            <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2">
              <div className="min-h-10 flex-1 px-2 py-2 text-right text-sm text-slate-400">اكتب سؤالك المالي...</div>
              <button className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-500 text-[#0a1328]"><Send className="h-4 w-4" /></button>
            </div>
            <p className="mt-2 text-center text-[10px] text-slate-400">قد يخطئ المساعد. راجع القيود قبل اعتمادها.</p>
          </div>
        </section>
      </div>
    </main>
  );
}