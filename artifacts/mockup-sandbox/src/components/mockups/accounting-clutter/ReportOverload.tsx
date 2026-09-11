import { useState } from "react";
import {
  Bell, CalendarDays, Check, ChevronDown, ChevronLeft, ClipboardList, Download,
  FileBarChart, Filter, FolderCog, HelpCircle, LayoutGrid, LockKeyhole, Menu,
  MoreHorizontal, Plus, Printer, RefreshCw, Search, Settings, ShieldAlert,
  SlidersHorizontal, Table2, X,
} from "lucide-react";

const rows = [
  ["1101", "النقدية بالصندوق", "حساب رئيسي", "18,420.75", "—", "18,420.75"],
  ["1204", "بنك السهل - جاري", "بنوك محلية", "83,950.00", "12,500.00", "71,450.00"],
  ["2108", "موردو البضاعة", "التزامات قصيرة", "—", "26,875.40", "(26,875.40)"],
  ["3102", "رأس المال التشغيلي", "حقوق ملكية", "44,000.00", "—", "44,000.00"],
  ["4107", "إيرادات مبيعات التجزئة", "إيرادات", "—", "119,640.20", "(119,640.20)"],
  ["5203", "مشتريات ومخزون", "تكلفة مبيعات", "71,880.30", "—", "71,880.30"],
  ["5309", "مصروفات نقل وشحن", "مصروفات تشغيل", "8,275.00", "—", "8,275.00"],
  ["5401", "مصروفات خدمات عامة", "مصروفات تشغيل", "5,942.60", "—", "5,942.60"],
];

export function ReportOverload() {
  const [tab, setTab] = useState("تقرير مخصص");
  const [modal, setModal] = useState(true);
  const [exported, setExported] = useState(false);
  const [menu, setMenu] = useState(false);
  const [filters, setFilters] = useState({ draft: true, closed: false });

  return (
    <main dir="rtl" className="min-h-screen overflow-hidden bg-[#d9d1c2] text-[#332d3b] font-sans text-[11px]">
      <header className="flex h-[50px] items-center justify-between border-b-2 border-[#554963] bg-[#493c52] px-3 text-[#f3ead9] shadow-[0_2px_0_#a89a8a]">
        <div className="flex items-center gap-3">
          <button className="flex h-7 w-7 items-center justify-center border border-[#9d8e9d] bg-[#66566d]" onClick={() => setMenu(!menu)}><Menu size={15} /></button>
          <div className="border border-[#b9a8b7] bg-[#3c3144] px-3 py-1 text-[13px] font-black tracking-wide">دفترية 2008</div>
          <span className="text-[#d9c9d7]">نظام الإدارة المالية الموحد</span>
          <span className="bg-[#817246] px-2 py-1 text-[9px] text-[#fff3bd]">نسخة تجريبية 4.7.19</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[#d6c8d1]">فرع الميناء / جلسة 19</span>
          <button className="relative border border-[#9d8e9d] p-1.5"><Bell size={14} /><i className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-[#e4a34d]" /></button>
          <div className="flex items-center gap-2 border-r border-[#837387] pr-3"><span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#c5a77a] font-black text-[#483b48]">م</span><span>مدير النظام ▾</span></div>
        </div>
      </header>

      <div className="flex h-[670px]">
        <aside className={`${menu ? "block" : "hidden"} absolute right-0 z-30 h-full w-[190px] border-l-2 border-[#72617a] bg-[#51445a] text-[#eee4d8] shadow-2xl md:static md:block`}>
          <div className="border-b border-[#76687c] px-3 py-3 text-[10px] font-bold text-[#cfc0d2]">قائمة العمليات المالية</div>
          {[
            [LayoutGrid, "لوحة المتابعة", false], [ClipboardList, "الفواتير والحركات", false],
            [Table2, "دفتر الأستاذ العام", true], [FileBarChart, "التقارير المالية", true],
            [SlidersHorizontal, "مراكز التكلفة", false], [FolderCog, "إدارة الحسابات", false],
            [LockKeyhole, "الإقفال والترحيل", false], [Settings, "إعدادات النظام", false],
          ].map(([Icon, label, active], index) => {
            const I = Icon as typeof LayoutGrid;
            return <button key={index} className={`flex w-full items-center gap-2 border-b border-[#655870] px-3 py-2.5 text-right ${active ? "bg-[#83718b] text-white shadow-inner" : "hover:bg-[#685a70]"}`}><I size={14} /><span className="flex-1">{label as string}</span>{active && <ChevronLeft size={12} />}</button>;
          })}
          <div className="m-2 mt-5 border border-[#81728a] bg-[#403544] p-2 text-[9px] leading-5 text-[#c9bacb]"><ShieldAlert size={13} className="mb-1 text-[#dfb274]" /> تنبيه النظام<br /><b className="text-[#ecd19e]">5 قيود لم تُرحّل</b><br />آخر فحص: 14:32:08</div>
        </aside>

        <section className="min-w-0 flex-1">
          <div className="flex h-9 items-center justify-between border-b border-[#b7aa9d] bg-[#eee8dc] px-3 text-[#665b66]">
            <div className="flex items-center gap-1"><span>الرئيسية</span><ChevronLeft size={11} /><b className="text-[#3e3442]">التقارير</b><ChevronLeft size={11} /><b>مركز التقارير المتقدم</b></div>
            <div className="flex gap-2"><button className="flex items-center gap-1 border border-[#b6a7a3] bg-[#faf7ef] px-2 py-1"><HelpCircle size={12} /> تعليمات</button><button className="border border-[#b6a7a3] bg-[#faf7ef] px-2 py-1"><MoreHorizontal size={14} /></button></div>
          </div>

          <div className="h-[631px] overflow-hidden p-2">
            <div className="mb-2 flex items-center justify-between border-b-2 border-[#76667a] bg-[#f6f0e5] px-3 py-2">
              <div><h1 className="text-[17px] font-black text-[#493d52]">تقرير حركة الحسابات التفصيلي</h1><p className="mt-0.5 text-[10px] text-[#897b82]">وحدة التقارير / تحليل القيود والمجاميع المرحلية</p></div>
              <div className="flex gap-1"><button className="flex items-center gap-1 border border-[#8e778f] bg-[#6b5871] px-3 py-1.5 text-white" onClick={() => setExported(true)}><Download size={13} />{exported ? "تم التصدير" : "تصدير Excel"}</button><button className="flex items-center gap-1 border border-[#aa9b90] bg-[#e8dfd0] px-3 py-1.5"><Printer size={13} /> طباعة</button></div>
            </div>

            <div className="mb-2 flex border-b-2 border-[#887b84] bg-[#ded5ca]">
              {["تقرير مخصص", "ميزان المراجعة", "حركة يومية", "مقارنة الفترات", "تقارير محفوظة"].map((t) => <button key={t} onClick={() => setTab(t)} className={`border-l border-[#b9aca0] px-4 py-2 text-[10px] font-bold ${tab === t ? "bg-[#f7f1e6] text-[#513c5a] shadow-[0_-2px_0_#76557e_inset]" : "text-[#71646a]"}`}>{t}</button>)}
            </div>

            <div className="border border-[#b4a79a] bg-[#eee7da] p-2 shadow-sm">
              <div className="mb-2 flex items-center justify-between border-b border-[#c7b9aa] pb-1 font-black text-[#53465b]"><span className="flex items-center gap-1"><Filter size={13} /> معايير استخراج التقرير - {tab}</span><button className="text-[#806682] underline">حفظ كقالب</button></div>
              <div className="grid grid-cols-6 gap-1.5">
                <Field label="من تاريخ" value="01 / 08 / 2024" icon={CalendarDays} /><Field label="إلى تاريخ" value="31 / 08 / 2024" icon={CalendarDays} /><Field label="الفرع / الوحدة" value="كل الفروع (04)" /><Field label="العملة" value="ريال محلي" /><Field label="نوع التقرير" value="تراكمي / مفصل" /><Field label="مستوى الحساب" value="حتى المستوى 04" />
              </div>
              <div className="mt-2 grid grid-cols-[1.2fr_1.2fr_1fr_1fr_auto] gap-1.5">
                <Field label="من حساب" value="1000 - الأصول (الرئيسي)" /><Field label="إلى حساب" value="5999 - المصروفات" /><Field label="مركز التكلفة" value="الكل" /><Field label="مشروع / نشاط" value="غير محدد" />
                <div className="flex items-end gap-1"><label className="flex items-center gap-1 border border-[#b2a398] bg-[#faf5ea] px-2 py-2"><input type="checkbox" checked={filters.draft} onChange={() => setFilters({ ...filters, draft: !filters.draft })} /> مسودة</label><label className="flex items-center gap-1 border border-[#b2a398] bg-[#faf5ea] px-2 py-2"><input type="checkbox" checked={filters.closed} onChange={() => setFilters({ ...filters, closed: !filters.closed })} /> مغلق</label></div>
              </div>
              <div className="mt-2 flex items-center justify-between border-t border-[#c3b6a7] pt-2"><div className="flex items-center gap-3 text-[#75686e]"><span><input type="checkbox" defaultChecked /> إظهار الحسابات الصفرية</span><span><input type="checkbox" defaultChecked /> تجميع حسب الشهر</span><span><input type="checkbox" /> إظهار الملاحظات</span></div><div className="flex gap-1"><button className="flex items-center gap-1 border border-[#9f8c9b] bg-[#806382] px-4 py-1.5 font-bold text-white"><Search size={13} /> تنفيذ الاستعلام</button><button className="border border-[#b0a19a] bg-[#f8f2e8] px-3 py-1.5"><RefreshCw size={13} /></button></div></div>
            </div>

            <div className="mt-2 border border-[#a69a90] bg-[#f5eee1]">
              <div className="flex items-center justify-between border-b border-[#b4a59b] bg-[#e2d8cc] px-2 py-1.5"><div className="flex items-center gap-3 font-bold"><span>نتائج التقرير: 8,426 حركة</span><span className="text-[#806782]">آخر تحديث 14:31:47</span><span className="bg-[#d5c59e] px-2 py-0.5 text-[9px]">غير متوازن: 0.15</span></div><div className="flex items-center gap-2 text-[#766970]">صفحة 1 من 18 <button className="border border-[#afa29a] bg-[#f8f2e8] px-1">‹</button><button className="border border-[#afa29a] bg-[#f8f2e8] px-1">›</button></div></div>
              <div className="overflow-hidden"><table className="w-full table-fixed text-right"><thead className="bg-[#6c5b70] text-[10px] text-[#fff8ec]"><tr><th className="w-[9%] border-l border-[#958398] px-2 py-2">رمز الحساب</th><th className="w-[28%] border-l border-[#958398] px-2 py-2">اسم الحساب / الوصف</th><th className="w-[18%] border-l border-[#958398] px-2 py-2">التصنيف الأب</th><th className="w-[15%] border-l border-[#958398] px-2 py-2">مدين الفترة</th><th className="w-[15%] border-l border-[#958398] px-2 py-2">دائن الفترة</th><th className="px-2 py-2">الرصيد الختامي</th></tr></thead><tbody>{rows.map((row, i) => <tr key={row[0]} className={`${i % 2 ? "bg-[#ebe3d6]" : "bg-[#f8f1e5]"} border-b border-[#d1c5b9]`}><td className="px-2 py-[5px] font-mono text-[#775f7f]">{row[0]}</td>{row.slice(1).map((cell, j) => <td key={j} className={`px-2 py-[5px] ${j > 1 ? "font-mono text-left" : ""}`}>{cell}</td>)}</tr>)}</tbody><tfoot className="bg-[#d3c5b8] font-black"><tr><td colSpan={3} className="px-2 py-2">الإجمالي العام قبل المطابقة</td><td className="px-2 py-2 font-mono text-left">232,468.65</td><td className="px-2 py-2 font-mono text-left">232,468.80</td><td className="px-2 py-2 font-mono text-left text-[#8d4e48]">(0.15)</td></tr></tfoot></table></div>
            </div>
          </div>
        </section>
      </div>

      {modal && <div className="absolute inset-0 z-40 flex items-start justify-center bg-[#2d2238]/25 pt-[126px]"><div className="w-[390px] border-2 border-[#6d5872] bg-[#eee5d6] shadow-[8px_9px_0_#4d3b54]/30"><div className="flex items-center justify-between bg-[#5b4961] px-3 py-2 font-black text-[#fff5e9]"><span className="flex items-center gap-2"><Settings size={14} /> إعدادات التقرير المتقدمة</span><button onClick={() => setModal(false)}><X size={16} /></button></div><div className="space-y-3 p-3"><p className="border-b border-[#c2b3a5] pb-2 text-[#665867]">خيارات إضافية لطريقة عرض النتائج وطباعة النموذج الرسمي.</p><div className="grid grid-cols-2 gap-2"><label className="border border-[#b7a99b] bg-[#faf4e8] p-2"><input type="checkbox" defaultChecked /> إخفاء الصفوف الفارغة</label><label className="border border-[#b7a99b] bg-[#faf4e8] p-2"><input type="checkbox" /> إظهار رقم المستند</label><label className="border border-[#b7a99b] bg-[#faf4e8] p-2"><input type="checkbox" defaultChecked /> فاصل آلاف</label><label className="border border-[#b7a99b] bg-[#faf4e8] p-2"><input type="checkbox" /> قيد المراجعة</label></div><div><label className="mb-1 block font-bold">قالب الطباعة</label><select className="w-full border border-[#aa9b91] bg-[#fbf5e9] px-2 py-2"><option>نموذج رسمي قديم - A4 RTL</option><option>نموذج داخلي طويل</option></select></div><div><label className="mb-1 block font-bold">طريقة ترتيب المخرجات</label><select className="w-full border border-[#aa9b91] bg-[#fbf5e9] px-2 py-2"><option>حسب رمز الحساب ثم التاريخ</option></select></div><div className="flex justify-between border-t border-[#c2b3a5] pt-3"><button className="border border-[#a99b90] bg-[#f9f2e5] px-4 py-1.5" onClick={() => setModal(false)}>إلغاء</button><button className="flex items-center gap-1 bg-[#76587b] px-5 py-1.5 font-bold text-white" onClick={() => setModal(false)}><Check size={13} /> تطبيق الإعدادات</button></div></div></div></div>}
    </main>
  );
}

function Field({ label, value, icon: Icon }: { label: string; value: string; icon?: typeof CalendarDays }) {
  return <label className="min-w-0"><span className="mb-0.5 block text-[9px] font-bold text-[#70636a]">{label}</span><div className="flex items-center justify-between border border-[#b6a79a] bg-[#fff9ee] px-2 py-1.5 text-[10px] shadow-inner">{value}{Icon ? <Icon size={12} className="text-[#806782]" /> : <ChevronDown size={11} className="text-[#8a7c80]" />}</div></label>;
}