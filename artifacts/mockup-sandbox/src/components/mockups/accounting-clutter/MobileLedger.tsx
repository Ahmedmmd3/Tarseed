import { useState, type ReactNode } from "react";
import {
  AlertTriangle,
  BarChart3,
  Bell,
  Calculator,
  ChevronDown,
  ChevronLeft,
  CircleDollarSign,
  ClipboardList,
  FileBarChart,
  FileText,
  Filter,
  FolderKanban,
  Grid2X2,
  Menu,
  MoreVertical,
  Package,
  Plus,
  Receipt,
  Search,
  Settings,
  SlidersHorizontal,
  Tag,
  UserCircle,
  WalletCards,
  X,
} from "lucide-react";

const tabs = ["نظرة عامة", "الفواتير", "المصروفات", "الضرائب", "المخزون", "التقارير"];

const ledgerRows = [
  { ref: "قيد ٠٠٤٨١", name: "شركة المدار للتوريد", date: "١٨/٠٦/٢٠٢٤", amount: "١٢٬٨٤٠٫٧٥", status: "معلّق" },
  { ref: "فاتورة ٧٢٩", name: "مشتريات تشغيلية متنوعة", date: "١٧/٠٦/٢٠٢٤", amount: "٣٬٢٦٠٫٠٠", status: "مدفوع" },
  { ref: "قيد ٠٠٤٧٩", name: "إيجار مستودع الفرع", date: "١٦/٠٦/٢٠٢٤", amount: "٨٬٩٠٠٫٠٠", status: "مراجعة" },
  { ref: "مصروف ١١٢", name: "خدمات نقل وشحن", date: "١٥/٠٦/٢٠٢٤", amount: "١٬٤٤٥٫٥٠", status: "مدفوع" },
];

function TinyButton({ children, active = false }: { children: ReactNode; active?: boolean }) {
  return (
    <button className={`rounded-[3px] border px-2 py-1 text-[10px] font-bold shadow-[inset_0_1px_0_rgba(255,255,255,.6)] ${active ? "border-[#284c74] bg-[#315f8b] text-white" : "border-[#aeb8c2] bg-[#eef1f2] text-[#26323b]"}`}>
      {children}
    </button>
  );
}

export function MobileLedger() {
  const [activeTab, setActiveTab] = useState("نظرة عامة");
  const [notice, setNotice] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <main dir="rtl" className="min-h-[100dvh] overflow-x-hidden bg-[#bac2c7] text-[#17232d]" style={{ fontFamily: "'Arial Narrow', Arial, sans-serif" }}>
      <div className="mx-auto min-h-[100dvh] w-full max-w-[390px] border-x border-[#69747c] bg-[#dfe3e4] text-[12px] shadow-[0_0_35px_rgba(20,28,34,.35)]">
        <header className="border-b border-[#1e3347] bg-[#274664] text-white">
          <div className="flex h-[33px] items-center justify-between bg-[#1c344b] px-2 text-[10px]">
            <div className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-[#d4a83a]" /> نظام الدفاتر المتقدم <span className="text-[#a9bfd0]">/ نسخة ٤٫٧</span></div>
            <div className="flex items-center gap-2"><span>مستخدم: ن.سالم</span><UserCircle size={14} /></div>
          </div>
          <div className="flex items-center justify-between px-2 py-2">
            <button onClick={() => setMenuOpen((v) => !v)} className="border border-[#7691a8] bg-[#355875] p-1"><Menu size={17} /></button>
            <div className="text-center"><div className="text-[16px] font-black tracking-tight">دفتر الأعمال المركزي</div><div className="text-[9px] text-[#c6d6e0]">آخر مزامنة: اليوم ٠٨:٤٢ ص · فرع المنطقة الشمالية</div></div>
            <button className="relative border border-[#7691a8] bg-[#355875] p-1"><Bell size={16} /><i className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-[#c94438]" /></button>
          </div>
          {menuOpen && <div className="absolute z-20 mr-2 mt-[-3px] w-40 border border-[#586a77] bg-[#f4f5f5] p-1 text-[#17232d] shadow-lg"><div className="border-b border-[#c1c8cc] px-2 py-1">تبديل الشركة</div><div className="px-2 py-1">صلاحيات المستخدم</div><div className="px-2 py-1">سجل النشاط</div></div>}
        </header>

        <div className="border-b border-[#9ca8b0] bg-[#edf0f0] px-2 py-1.5">
          <div className="flex items-center justify-between gap-1">
            <div className="flex min-w-0 flex-1 items-center border border-[#a3adb4] bg-white px-1.5 py-1"><Search size={13} className="ml-1 text-[#667783]" /><span className="truncate text-[10px] text-[#89939a]">بحث في القيود، العملاء، أرقام المستندات...</span></div>
            <TinyButton><Filter size={12} /></TinyButton><TinyButton><Settings size={12} /></TinyButton>
          </div>
          <div className="mt-1.5 flex gap-1 overflow-hidden whitespace-nowrap text-[10px]">
            {tabs.map((tab) => <button key={tab} onClick={() => setActiveTab(tab)} className={`border-b-2 px-1.5 pb-0.5 font-bold ${activeTab === tab ? "border-[#b34d35] text-[#263f59]" : "border-transparent text-[#66747d]"}`}>{tab}</button>)}
          </div>
        </div>

        <section className="space-y-1.5 p-2">
          <div className="flex items-center justify-between border border-[#8c9ba6] bg-[#c9d2d7] px-2 py-1">
            <div className="flex items-center gap-1 font-black text-[#233c55]"><Grid2X2 size={14} /> لوحة التحكم / {activeTab}</div>
            <div className="flex gap-1"><TinyButton active><Plus size={11} /> قيد</TinyButton><TinyButton><MoreVertical size={13} /></TinyButton></div>
          </div>

          {notice && <div className="relative flex gap-2 border border-[#c68b30] bg-[#fff0c9] p-1.5 text-[10px] leading-4 text-[#714b19]"><AlertTriangle size={17} className="mt-0.5 shrink-0 text-[#bd7a16]" /><div className="flex-1"><b>تنبيه إقفال الفترة:</b> توجد ١٤ حركة غير مرحلة و٣ إشعارات ضريبية تحتاج إلى اعتماد قبل الترحيل.</div><button onClick={() => setNotice(false)}><X size={13} /></button></div>}

          <div className="grid grid-cols-2 gap-1.5">
            {[
              { icon: WalletCards, title: "الرصيد المتاح", value: "١٢٤٬٨٦٠٫٣٠", note: "د.ر · حتى ١٨ يونيو" },
              { icon: Receipt, title: "فواتير مستحقة", value: "٣٨٬٤٢٠٫٧٥", note: "١٩ فاتورة · متأخر ٤" },
              { icon: Calculator, title: "ضريبة مخرجات", value: "٨٬٧١٢٫٤٠", note: "ربع ٢ / غير مسددة" },
              { icon: Package, title: "قيمة المخزون", value: "٢٨٦٬١١٠", note: "١٬٢٤٨ صنف · تنبيه ٧" },
            ].map(({ icon: Icon, title, value, note }) => <div key={title} className="border border-[#a5afb5] bg-[#f6f7f6] p-1.5 shadow-[1px_1px_0_#c3c9cc]"><div className="flex items-center justify-between text-[10px] font-bold text-[#52636e]"><span>{title}</span><Icon size={14} className="text-[#48667b]" /></div><div className="mt-1 text-[16px] font-black tracking-tight text-[#243f5a]">{value}</div><div className="text-[9px] text-[#8b4e38]">{note}</div></div>)}
          </div>

          <div className="flex items-center gap-1 border border-[#9ba7ae] bg-[#e9ecec] p-1"><SlidersHorizontal size={13} className="text-[#586b77]" /><span className="font-bold">الفترة:</span><TinyButton active>هذا الشهر <ChevronDown size={10} /></TinyButton><TinyButton>كل الفروع</TinyButton><TinyButton>مسودة فقط</TinyButton></div>

          <div className="border border-[#929fa7] bg-[#f6f7f6]">
            <div className="flex items-center justify-between border-b border-[#a8b1b6] bg-[#d1d8db] px-2 py-1 font-black text-[#29445e]"><span className="flex items-center gap-1"><FileBarChart size={14} /> سجل الحركات اليومية</span><span className="text-[9px] font-normal">عرض ١–٤ من ٢٧</span></div>
            <div className="overflow-hidden">
              <table className="w-full table-fixed text-[9px]">
                <thead className="bg-[#e4e8e9] text-[#4e5e68]"><tr><th className="w-[22%] border-l border-[#c2c8cb] p-1">المرجع</th><th className="w-[30%] border-l border-[#c2c8cb] p-1">الوصف</th><th className="w-[19%] border-l border-[#c2c8cb] p-1">التاريخ</th><th className="w-[29%] p-1">المبلغ / الحالة</th></tr></thead>
                <tbody>{ledgerRows.map((row, index) => <tr key={row.ref} className={index % 2 ? "bg-[#edf0ef]" : "bg-white"}><td className="border-t border-l border-[#d0d5d7] p-1 font-bold text-[#315878]">{row.ref}</td><td className="border-t border-l border-[#d0d5d7] p-1 leading-3">{row.name}</td><td className="border-t border-l border-[#d0d5d7] p-1 text-[#69757d]">{row.date}</td><td className="border-t border-[#d0d5d7] p-1"><b className="block">{row.amount}</b><span className={`inline-block px-1 text-[8px] ${row.status === "مدفوع" ? "bg-[#c9dfd0] text-[#286039]" : row.status === "مراجعة" ? "bg-[#f5d4b9] text-[#88451f]" : "bg-[#f2dcae] text-[#72531b]"}`}>{row.status}</span></td></tr>)}</tbody>
              </table>
            </div>
            <div className="flex items-center justify-between border-t border-[#a8b1b6] bg-[#e5e9e9] px-2 py-1 text-[9px]"><span>إجمالي الصفحة: <b>٢٦٬٤٤٦٫٢٥ د.ر</b></span><span className="flex gap-1"><TinyButton><ChevronLeft size={11} /></TinyButton><TinyButton active>١</TinyButton><TinyButton>٢</TinyButton></span></div>
          </div>

          <div className="grid grid-cols-[1.2fr_.8fr] gap-1.5">
            <div className="border border-[#9da8ae] bg-[#f5f6f5] p-1.5"><div className="mb-1 flex items-center gap-1 border-b border-[#c4cacc] pb-1 font-black text-[#334f66]"><BarChart3 size={13} /> توزيع المصروفات</div><div className="flex h-12 items-end gap-1 px-2">{[28, 44, 35, 52, 39, 61, 48, 70, 45, 57].map((height, i) => <div key={i} className="flex-1 bg-[#718ba0]" style={{ height: `${height}%` }} />)}</div><div className="mt-1 flex justify-between text-[8px] text-[#71808a]"><span>تشغيل</span><span>نقل</span><span>خدمات</span></div></div>
            <div className="border border-[#9da8ae] bg-[#f5f6f5] p-1.5"><div className="mb-1 flex items-center gap-1 border-b border-[#c4cacc] pb-1 font-black text-[#334f66]"><ClipboardList size={13} /> مهام معلقة</div><div className="space-y-1 text-[9px]"><div className="flex justify-between"><span>اعتماد فاتورة</span><b className="text-[#b34d35]">٠٧</b></div><div className="flex justify-between"><span>مطابقة بنكية</span><b className="text-[#b34d35]">٠٣</b></div><div className="flex justify-between"><span>جرد مستودع</span><b className="text-[#b34d35]">١١</b></div></div></div>
          </div>
          <div className="flex items-center justify-between border border-[#a1acb2] bg-[#d4dbdc] px-2 py-1 text-[9px] text-[#53646f]"><span className="flex items-center gap-1"><Tag size={12} /> مركز الرسائل: لا توجد رسائل جديدة</span><span>حالة الخدمة: <b className="text-[#39724d]">متصل</b></span></div>
        </section>

        <nav className="sticky bottom-0 flex h-14 items-end justify-around border-t-2 border-[#536975] bg-[#d0d7d9] px-1 pb-1 text-[9px] text-[#40525d] shadow-[0_-3px_8px_rgba(30,45,53,.18)]">
          {[{ icon: Grid2X2, label: "الرئيسية" }, { icon: FileText, label: "المستندات" }, { icon: CircleDollarSign, label: "الحسابات" }, { icon: FolderKanban, label: "التقارير" }, { icon: Settings, label: "الإعدادات" }].map(({ icon: Icon, label }, i) => <button key={label} className={`flex flex-col items-center gap-0.5 border-x border-[#b8c1c4] px-3 py-1 ${i === 0 ? "bg-[#b8c8d0] font-black text-[#294e6b]" : ""}`}><Icon size={18} /><span>{label}</span></button>)}
        </nav>
        <button className="fixed bottom-[67px] left-1/2 z-10 ml-[145px] flex h-10 w-10 -translate-x-1/2 items-center justify-center rounded-full border-2 border-[#743b30] bg-[#a84f3e] text-white shadow-[1px_2px_3px_rgba(0,0,0,.35)]"><Plus size={21} /></button>
      </div>
    </main>
  );
}