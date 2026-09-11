import {
  AlertCircle, Bell, BookOpen, Boxes, Calculator, CalendarDays, ChevronDown,
  CircleHelp, ClipboardList, FileBarChart, FileText, Filter, Flag, Gauge,
  HandCoins, Inbox, LayoutDashboard, Menu, PackageSearch, PanelLeft, Plus, RefreshCw,
  Search, Settings, ShieldAlert, SlidersHorizontal, Ticket, TrendingDown,
  TrendingUp, UserRound, Wallet,
} from "lucide-react";

const nav = [
  ["لوحة المتابعة", LayoutDashboard], ["الفواتير", FileText], ["المصروفات", HandCoins],
  ["المخزون", Boxes], ["الضرائب والرسوم", Calculator], ["الحسابات", BookOpen],
  ["التقارير", FileBarChart], ["الإعدادات العامة", Settings],
] as const;

const invoices = [
  ["فاتورة #١٠٤٨", "مؤسسة الميناء الوهمي", "١٢٬٨٤٠٫٥٠", "متأخر", "bg-[#ffebe5] text-[#c43d21]"],
  ["فاتورة #١٠٤٧", "مكتبة السهل القديم", "٤٬٣٢٠٫٠٠", "بانتظار", "bg-[#fff4c7] text-[#8c6500]"],
  ["فاتورة #١٠٤٦", "شركة المدار للتجهيز", "٢٧٬١٠٠٫٧٥", "مدفوع", "bg-[#dff8e9] text-[#167449]"],
];

function Metric({ title, value, detail, tone, icon: Icon }: { title: string; value: string; detail: string; tone: string; icon: typeof Wallet }) {
  return (
    <div className={`relative min-w-0 overflow-hidden border-2 border-[#b7a993] ${tone} p-2 shadow-[3px_3px_0_#6e665d]`}>
      <div className="flex items-start justify-between gap-1">
        <div><div className="text-[10px] font-black text-[#574f46]">{title}</div><div className="mt-1 font-mono text-[19px] font-black leading-none text-[#27221e]">{value}</div></div>
        <span className="border border-[#837768] bg-[#f7eedc] p-1 text-[#5d4d39]"><Icon size={17} /></span>
      </div>
      <div className="mt-2 flex items-center justify-between text-[9px] font-bold text-[#5c564f]"><span>{detail}</span><span className="rounded-sm bg-[#f4df72] px-1">تنبيه</span></div>
    </div>
  );
}

function MiniBars() {
  return <div className="flex h-[72px] items-end gap-[3px] border-b border-l border-[#968b7b] bg-[#fff9e9] px-2 pb-1 pt-2">
    {[36, 55, 24, 62, 42, 68, 31, 52, 44, 70, 58, 32, 61, 46, 66, 38, 56, 28, 64, 49].map((h, i) => <i key={i} style={{ height: `${h}%` }} className={`block w-[7px] ${i % 3 === 0 ? "bg-[#dc4f39]" : i % 3 === 1 ? "bg-[#2585a7]" : "bg-[#d7a72c]"}`} />)}
  </div>;
}

export function DashboardChaos() {
  return (
    <main dir="rtl" className="min-h-[100dvh] overflow-hidden bg-[#d7d0c2] font-sans text-[#27221e] selection:bg-[#f0c13b]">
      <div className="flex h-[720px] min-w-[1080px] flex-col border-[5px] border-[#514941] bg-[#eee5d2] text-[12px]">
        <header className="flex h-[54px] shrink-0 items-center justify-between border-b-4 border-[#62584e] bg-[#273d43] px-3 text-[#f7edd6] shadow-[0_3px_0_#ae7e28]">
          <div className="flex items-center gap-3"><Menu size={20} /><div className="border-2 border-[#e4c763] bg-[#182d31] px-2 py-1 text-sm font-black tracking-tight">دفتر الحسابات ٧.٣</div><span className="bg-[#dc4f39] px-2 py-1 text-[10px] font-black">نسخة تجريبية قديمة</span></div>
          <div className="flex items-center gap-3"><div className="border border-[#829196] bg-[#35535a] px-3 py-1 text-[10px]">الفترة: ربيع ٢٠٢٤ <ChevronDown className="mr-2 inline" size={12} /></div><div className="relative"><Bell size={19} /><b className="absolute -left-2 -top-2 rounded-full bg-[#e35136] px-1 text-[9px]">٧</b></div><div className="flex items-center gap-2 border-r border-[#829196] pr-3"><UserRound size={18} /><span className="text-[10px]">مستخدم النظام</span></div></div>
        </header>
        <div className="flex min-h-0 flex-1">
          <aside className="w-[184px] shrink-0 border-l-4 border-[#665d52] bg-[#b9b0a1] px-2 py-2 text-[#312c28]">
            <div className="mb-2 flex items-center justify-between border-b-2 border-[#887e70] pb-2 font-black"><span>القائمة الرئيسية</span><PanelLeft size={15} /></div>
            <div className="mb-2 border-2 border-[#8d8273] bg-[#ddd3c1] p-1"><div className="flex items-center gap-1 bg-[#f7edcf] px-2 py-1"><Search size={13} /><span className="text-[10px] text-[#786f63]">ابحث عن أي شيء...</span></div></div>
            {nav.map(([label, Icon], i) => <div key={label} className={`mb-1 flex items-center gap-2 border px-2 py-[7px] text-[11px] font-bold ${i === 0 ? "border-[#6a4f27] bg-[#e8c554] text-[#31271b]" : "border-transparent hover:border-[#837767]"}`}><Icon size={15} />{label}<span className="mr-auto text-[9px] text-[#746b61]">{i === 1 ? "١٢" : i === 2 ? "٣" : ""}</span></div>)}
            <div className="mt-4 border-t-2 border-[#83786b] pt-2 text-[10px] font-black text-[#5e554c]">اختصارات سريعة</div>
            {["قيد يومي جديد", "طباعة كشف حساب", "إقفال الشهر"].map((x, i) => <div key={x} className="flex items-center gap-2 border-b border-[#988e80] py-2 text-[10px]"><Plus size={12} className={i === 2 ? "text-[#bd3c2b]" : "text-[#397a76"} />{x}</div>)}
            <div className="mt-5 border-2 border-[#c0742b] bg-[#ffdf9b] p-2 text-[10px] font-bold leading-4"><ShieldAlert size={15} className="mb-1 text-[#b5412c]" />تنبيه النظام: توجد بيانات غير مرحّلة منذ ٤ أيام</div>
          </aside>
          <section className="min-w-0 flex-1 overflow-hidden bg-[#e9dfcc]">
            <div className="flex h-[40px] items-center justify-between border-b-2 border-[#b3a897] bg-[#f7edd8] px-3"><div className="flex items-center gap-2 font-black"><Gauge size={16} /> لوحة التحكم المالية <span className="text-[#967f52]">/</span> ملخص النشاط</div><div className="flex gap-1"><button className="border-2 border-[#7b6e60] bg-[#fff9e9] px-2 py-1 text-[10px] font-black"><RefreshCw size={12} className="ml-1 inline" />تحديث يدوي</button><button className="border-2 border-[#704a35] bg-[#d65a38] px-2 py-1 text-[10px] font-black text-white"><Plus size={12} className="ml-1 inline" />مستند جديد</button></div></div>
            <div className="space-y-2 overflow-hidden p-2">
              <div className="grid grid-cols-5 gap-2"><Metric title="إجمالي المبيعات" value="١٨٧٬٤٥٠٫٧٥" detail="▲ ١٢٫٤٪ عن أمس" tone="bg-[#f5d96b]" icon={TrendingUp} /><Metric title="المصروفات المسجلة" value="٥٤٬٨٢٣٫١٠" detail="▲ ٨٫٢٪ هذا الشهر" tone="bg-[#ed927c]" icon={TrendingDown} /><Metric title="ذمم العملاء" value="٧٦٬٠٠٠٫٠٠" detail="٢١ فاتورة مفتوحة" tone="bg-[#89c9c5]" icon={Wallet} /><Metric title="ضريبة مستحقة" value="١٢٬٤٥٠٫٨٠" detail="استحقاق ٣٠/٠٦" tone="bg-[#b6a2d3]" icon={Calculator} /><Metric title="رصيد المخزون" value="٣٤٦ صنف" detail="١٧ صنف منخفض" tone="bg-[#dca6b0]" icon={Boxes} /></div>
              <div className="grid grid-cols-[1.48fr_1fr_1fr] gap-2">
                <div className="border-2 border-[#968b7c] bg-[#f8efd9] p-2 shadow-[2px_2px_0_#948675]"><div className="mb-1 flex items-center justify-between border-b-2 border-[#bbae9b] pb-1 font-black"><span><TrendingUp size={14} className="ml-1 inline" />حركة الإيرادات والمصروفات</span><span className="text-[9px] text-[#8a7663]">شهري / تراكمي <ChevronDown className="inline" size={11} /></span></div><MiniBars /><div className="mt-1 flex justify-between text-[9px] font-bold text-[#777064]"><span>يناير</span><span>فبراير</span><span>مارس</span><span>أبريل</span><span>مايو</span><span>يونيو</span></div></div>
                <div className="border-2 border-[#968b7c] bg-[#f8efd9] p-2 shadow-[2px_2px_0_#948675]"><div className="mb-2 flex items-center justify-between border-b-2 border-[#bbae9b] pb-1 font-black"><span>توزيع المصروفات</span><SlidersHorizontal size={14} /></div><div className="flex items-center gap-2"><div className="relative h-[86px] w-[86px] rounded-full border-[17px] border-[#d65a38] border-l-[#48a2ad] border-t-[#e1b633]"><span className="absolute -right-1 top-[23px] w-12 text-center text-[9px] font-black">٥٤٫٨ك</span></div><div className="space-y-1 text-[9px] font-bold"><div><i className="ml-1 inline-block h-2 w-2 bg-[#d65a38]" />تشغيل ٤١٪</div><div><i className="ml-1 inline-block h-2 w-2 bg-[#48a2ad]" />رواتب ٣٤٪</div><div><i className="ml-1 inline-block h-2 w-2 bg-[#e1b633]" />أخرى ٢٥٪</div></div></div></div>
                <div className="border-2 border-[#968b7c] bg-[#f8efd9] p-2 shadow-[2px_2px_0_#948675]"><div className="mb-2 flex items-center justify-between border-b-2 border-[#bbae9b] pb-1 font-black"><span>حالة النظام</span><AlertCircle size={14} className="text-[#c1432e]" /></div><div className="space-y-2 text-[10px] font-bold"><div className="flex justify-between"><span>ترحيل القيود</span><b className="bg-[#f1c84d] px-2 text-[#614b11]">معلّق ١٣</b></div><div className="flex justify-between"><span>مزامنة المخزون</span><b className="bg-[#dd7c68] px-2 text-white">خطأ</b></div><div className="flex justify-between"><span>آخر نسخة احتياط</span><b className="bg-[#a8d3b8] px-2 text-[#1b6546]">منذ ٢ يوم</b></div><div className="mt-2 border-t border-[#c7b9a2] pt-2 text-[#765c48]">المستخدمون الآن: ٠٤ / ٠٥</div></div></div>
              </div>
              <div className="grid grid-cols-[1.7fr_1fr] gap-2">
                <div className="border-2 border-[#968b7c] bg-[#f8efd9] shadow-[2px_2px_0_#948675]"><div className="flex items-center justify-between border-b-2 border-[#a99c8a] bg-[#ddcfb7] px-2 py-1 font-black"><span><ClipboardList size={14} className="ml-1 inline" />آخر الفواتير والحركات</span><span className="flex gap-1"><button className="border border-[#847567] bg-[#fff9e9] px-1 text-[9px]"><Filter size={11} className="inline" /> تصفية</button><button className="border border-[#847567] bg-[#fff9e9] px-1 text-[9px]">عرض الكل</button></span></div><table className="w-full text-right text-[10px]"><thead className="bg-[#c8bca8] text-[#544a3e]"><tr><th className="p-1">المستند</th><th className="p-1">الجهة / البيان</th><th className="p-1">القيمة (ر.س)</th><th className="p-1">الحالة</th><th className="p-1">تعديل</th></tr></thead><tbody>{invoices.map((r) => <tr key={r[0]} className="border-b border-[#d1c5b1]"><td className="p-2 font-black text-[#3d6470] underline">{r[0]}</td><td className="p-2">{r[1]}</td><td className="p-2 font-mono font-black">{r[2]}</td><td className="p-2"><span className={`px-2 py-1 text-[9px] font-black ${r[4]}`}>{r[3]}</span></td><td className="p-2"><MoreDots /></td></tr>)}</tbody></table></div>
                <div className="border-2 border-[#968b7c] bg-[#f8efd9] shadow-[2px_2px_0_#948675]"><div className="border-b-2 border-[#a99c8a] bg-[#ddcfb7] px-2 py-1 font-black"><AlertCircle size={14} className="ml-1 inline text-[#c1432e]" />تنبيهات تحتاج مراجعة</div><div className="space-y-1 p-2 text-[10px] font-bold"><div className="flex items-start gap-1 border-b border-[#d0c1ab] pb-1"><Flag size={13} className="mt-0.5 text-[#c1432e]" />رقم ضريبي ناقص في ٤ فواتير <b className="mr-auto bg-[#e57358] px-1 text-white">عاجل</b></div><div className="flex items-start gap-1 border-b border-[#d0c1ab] pb-1"><PackageSearch size={13} className="mt-0.5 text-[#b17b24]" />مخزون سلبي لصنفين <b className="mr-auto bg-[#efcb57] px-1">تنبيه</b></div><div className="flex items-start gap-1"><Ticket size={13} className="mt-0.5 text-[#397c87]" />إقفال الفترة لم يتم تأكيده <b className="mr-auto bg-[#9ec4c1] px-1">معلّق</b></div></div></div>
              </div>
              <div className="flex items-center justify-between border-2 border-[#8f8374] bg-[#c9bea9] px-2 py-1 text-[9px] font-bold text-[#5c5348]"><span><CalendarDays size={12} className="ml-1 inline" />آخر تحديث: ٠٩:٤٢:١٧ ص — الفرع: المنطقة القديمة — قاعدة البيانات: محلية</span><span>العملة: ر.س | اللغة: العربية <Settings size={12} className="mr-2 inline" /></span></div>
            </div>
          </section>
        </div>
        <footer className="flex h-[23px] shrink-0 items-center justify-between border-t-2 border-[#5a5148] bg-[#6e665c] px-2 text-[9px] font-bold text-[#f4e6c9]"><span>وحدة الحسابات المتقدمة — لا توجد جلسة آمنة</span><span>حالة الاتصال: متصل جزئياً ● | ٤ رسائل نظام غير مقروءة</span></footer>
      </div>
      <button className="fixed bottom-5 left-5 flex items-center gap-2 border-4 border-[#594a38] bg-[#f1c64f] px-3 py-2 text-xs font-black shadow-[4px_4px_0_#493d30]"><CircleHelp size={19} />مساعدة؟</button>
    </main>
  );
}

function MoreDots() {
  return <button className="border border-[#8e8170] bg-[#eee2ca] px-2 py-0.5 text-[10px] font-black"><span className="tracking-[3px]">•••</span></button>;
}