import { useState, type ReactNode } from "react";
import {
  AlertCircle,
  ChevronDown,
  FilePlus2,
  FolderOpen,
  LockKeyhole,
  Menu,
  Printer,
  RefreshCw,
  Save,
  Search,
  Settings,
  ShieldAlert,
  SlidersHorizontal,
  Table2,
  Trash2,
  UserRound,
  X,
} from "lucide-react";

const rows = [
  ["1100-01", "الصندوق الرئيسي", "مدين", "184,250.00", "0.00", "184,250.00"],
  ["1100-07", "صندوق الفرع الشمالي", "مدين", "42,875.50", "0.00", "227,125.50"],
  ["1200-04", "حسابات العملاء المتنوعة", "مدين", "96,400.00", "8,750.00", "315,525.50"],
  ["2100-11", "الموردون - محلي", "دائن", "0.00", "74,800.00", "240,725.50"],
  ["3100-02", "رأس المال المدفوع", "دائن", "0.00", "250,000.00", " -9,274.50"],
  ["4100-09", "إيرادات مبيعات التجزئة", "دائن", "0.00", "138,660.25", "-147,934.75"],
  ["5200-13", "مصروفات نقل وشحن", "مدين", "12,890.00", "0.00", "-135,044.75"],
  ["5300-03", "مصروفات خدمات عامة", "مدين", "7,460.75", "0.00", "-127,584.00"],
  ["6100-22", "ضريبة قيمة مضافة معلقة", "مدين", "3,118.20", "0.00", "-124,465.80"],
  ["7100-99", "حساب تسويات مؤقت", "مدين", "15,000.00", "0.00", "-109,465.80"],
];

const IconButton = ({ children, label, onClick }: { children: ReactNode; label: string; onClick?: () => void }) => (
  <button onClick={onClick} title={label} className="flex h-7 min-w-[58px] items-center justify-center gap-1 border border-[#7d8791] bg-[#e9edf0] px-2 text-[10px] text-[#202a32] shadow-[inset_1px_1px_#fff,inset_-1px_-1px_#a3aab0] active:translate-y-px active:shadow-none">
    {children}<span>{label}</span>
  </button>
);

export function LegacyERP() {
  const [notice, setNotice] = useState("جاهز - آخر تحديث 14:32:07");
  const [selected, setSelected] = useState(2);
  const [query, setQuery] = useState("");
  const [locked, setLocked] = useState(false);

  const toast = (text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice("جاهز - آخر تحديث 14:32:07"), 1800);
  };

  return (
    <main dir="rtl" className="min-h-[100dvh] overflow-hidden bg-[#c7cdd2] text-[#172029]" style={{ fontFamily: "Tahoma, Arial, sans-serif" }}>
      <div className="h-[720px] min-w-[1120px] text-[11px]">
        <header className="flex h-[31px] items-center justify-between border-b border-[#58636d] bg-[#344450] px-2 text-[#edf1f3]">
          <div className="flex items-center gap-3"><span className="font-bold tracking-tight">منظومة الدفاتر المتقدمة - إصدار 4.7.19</span><span className="text-[10px] text-[#b5c0c7]">[وحدة الحسابات العامة]</span></div>
          <div className="flex items-center gap-3"><span>المستخدم: مدير النظام (SYS-004)</span><span className="rounded-sm bg-[#65737d] px-2 py-0.5 text-[10px]">شركة السهل الوهمي ذ.م.م</span><X className="h-3.5 w-3.5" /></div>
        </header>

        <nav className="flex h-[28px] items-center gap-5 border-b border-[#9ca5ac] bg-[#dfe3e6] px-3 text-[#172029] shadow-[inset_0_1px_#fff]">
          {["ملف", "تحرير", "عرض", "الحسابات", "المستندات", "التقارير", "أدوات", "نافذة", "مساعدة"].map((item, i) => <button key={item} onClick={() => toast(`تم فتح قائمة ${item}`)} className={`h-full px-2 hover:bg-[#c4ccd1] ${i === 3 ? "bg-[#c4ccd1] font-bold" : ""}`}>{item}</button>)}
          <span className="mr-auto text-[10px] text-[#64717a]">F1 مساعدة النظام</span>
        </nav>

        <div className="flex h-[45px] items-center gap-1 border-b border-[#7b858c] bg-[#d1d7db] px-2 shadow-[inset_0_1px_#fff]">
          <IconButton label="جديد" onClick={() => toast("مستند جديد: أدخل رقم القيد")}><FilePlus2 className="h-3.5 w-3.5" /></IconButton>
          <IconButton label="فتح" onClick={() => toast("اختر ملف الدفتر") }><FolderOpen className="h-3.5 w-3.5" /></IconButton>
          <IconButton label="حفظ" onClick={() => toast("تم الحفظ محلياً") }><Save className="h-3.5 w-3.5" /></IconButton>
          <IconButton label="طباعة" onClick={() => toast("إرسال إلى الطابعة الافتراضية") }><Printer className="h-3.5 w-3.5" /></IconButton>
          <span className="mx-1 h-6 border-r border-[#9ca5ac]" />
          <IconButton label="تحديث" onClick={() => toast("جاري جلب آخر القيود…")}><RefreshCw className="h-3.5 w-3.5" /></IconButton>
          <IconButton label="بحث" onClick={() => toast("نتيجة البحث: 47 سجلاً")}><Search className="h-3.5 w-3.5" /></IconButton>
          <IconButton label="حذف" onClick={() => toast("لا يمكن حذف القيد المرحّل")}><Trash2 className="h-3.5 w-3.5" /></IconButton>
          <span className="mx-1 h-6 border-r border-[#9ca5ac]" />
          <IconButton label="إقفال الفترة" onClick={() => setLocked(!locked)}><LockKeyhole className="h-3.5 w-3.5" /></IconButton>
          <IconButton label="إعدادات" onClick={() => toast("إعدادات الشركة - صلاحية مقيدة")}><Settings className="h-3.5 w-3.5" /></IconButton>
          <div className="mr-auto flex items-center gap-2 text-[10px] text-[#5b6870]"><AlertCircle className="h-3.5 w-3.5 text-[#a4432e]" /> {locked ? "الفترة مقفلة" : "تنبيه: يوجد 6 قيود غير مرحّلة"}</div>
        </div>

        <section className="flex h-[41px] items-center gap-1 border-b border-[#818b93] bg-[#bbc3c8] px-2">
          {["الرئيسية", "دفتر الأستاذ العام", "القيود اليومية", "مراجعة الحسابات", "الأرصدة الافتتاحية", "ملحقات"].map((tab, i) => <button key={tab} onClick={() => toast(`الوحدة: ${tab}`)} className={`h-[27px] border border-[#89939b] px-3 shadow-[inset_1px_1px_#fff] ${i === 1 ? "border-b-[#eef1f2] bg-[#eef1f2] font-bold" : "bg-[#d8dde0]"}`}>{tab}</button>)}
          <div className="mr-auto flex items-center gap-1 text-[10px]"><span>الفرع:</span><select className="h-6 border border-[#7e8991] bg-[#f1f3f4] px-2"><option>الكل / 00</option><option>فرع الشمال / 02</option></select><ChevronDown className="h-3 w-3" /></div>
        </section>

        <div className="grid h-[515px] grid-cols-[212px_1fr] gap-1 bg-[#8e989e] p-1" dir="ltr">
          <aside className="border border-[#69757e] bg-[#dfe3e5] text-right" dir="rtl">
            <div className="flex h-7 items-center gap-1 border-b border-[#7f8a91] bg-[#c1c9ce] px-2 font-bold"><Menu className="h-3.5 w-3.5" /> شجرة الوحدات</div>
            <div className="space-y-0.5 p-1 text-[10px]">
              <button className="w-full border border-[#9ba4a9] bg-[#eef0f1] py-1 text-right font-bold">[-] المحاسبة العامة (GL)</button>
              {["[-] دليل الحسابات", "[+] المبيعات والعملاء", "[+] المشتريات والموردين", "[+] المصروفات", "[+] الضرائب والرسوم", "[+] المخزون والمستودعات", "[+] الأصول الثابتة", "[+] الرواتب والتعويضات", "[+] التقارير المخصصة"].map((v, i) => <button key={v} onClick={() => toast(`تم تحديد: ${v.slice(4)}`)} className={`block w-full border-b border-[#c2c8cb] px-2 py-1 text-right ${i === 0 ? "bg-[#b9cfe0] font-bold" : "hover:bg-[#d0dce4]"}`}>{v}</button>)}
            </div>
            <div className="mt-3 border-y border-[#a1a9ae] bg-[#d3d8db] px-2 py-1 text-[10px] font-bold">اختصارات النظام</div>
            {["إدخال فاتورة شراء", "تسوية بنكية يدوية", "كشف حساب عميل", "تقرير أعمار الديون"].map(v => <button key={v} className="block w-full px-3 py-1 text-right text-[10px] text-[#314b5c] underline" onClick={() => toast(v)}>{v}</button>)}
            <div className="m-2 border border-[#a27636] bg-[#fff0ba] p-2 text-[10px] text-[#664b1c]"><ShieldAlert className="mb-1 inline h-3.5 w-3.5" /> تنبيه ترحيل<br />فشل آخر تحقق من التسلسل رقم 8821.</div>
          </aside>

          <section className="min-w-0 border border-[#69757e] bg-[#f0f2f3]" dir="rtl">
            <div className="flex h-7 items-center gap-2 border-b border-[#8b959c] bg-[#d0d6da] px-2"><Table2 className="h-3.5 w-3.5" /><b>كشف حركة وأرصدة الحسابات</b><span className="text-[#66747d]">| دفتر الأستاذ العام / الفترة 01-12-2024 إلى 31-12-2024</span><button onClick={() => toast("تم تطبيق المرشح")} className="mr-auto flex items-center gap-1 border border-[#87929a] bg-[#e9edef] px-2 py-0.5 text-[10px]"><SlidersHorizontal className="h-3 w-3" /> إظهار المرشح</button></div>
            <div className="flex h-[40px] items-center gap-2 border-b border-[#a2abb1] bg-[#e1e5e7] px-2">
              <label>الحساب يبدأ بـ <input value={query} onChange={e => setQuery(e.target.value)} className="h-6 w-20 border border-[#89949c] bg-[#fff] px-1 text-[10px]" placeholder="1100" /></label>
              <label>العملة <select className="h-6 border border-[#89949c] bg-[#fff] px-2 text-[10px]"><option>ريال خيالي</option></select></label>
              <label><input type="checkbox" defaultChecked /> تضمين الحسابات الصفرية</label>
              <button onClick={() => toast("تم تحميل 128 حساباً")} className="border border-[#697981] bg-[#c1d3df] px-3 py-1 font-bold shadow-[inset_1px_1px_#fff]">تنفيذ F9</button>
              <span className="mr-auto text-[10px] text-[#66747d]">المستند: GL-2024-12-8821</span>
            </div>
            <div className="h-[390px] overflow-hidden border-b border-[#69757e] bg-[#fff]">
              <table className="w-full border-collapse text-[10px]">
                <thead className="sticky top-0 bg-[#b9c5cd] text-[#202b32]"><tr>{["رمز الحساب", "اسم الحساب / الوصف", "طبيعة", "مدين افتتاحي", "دائن افتتاحي", "الرصيد الجاري"].map(h => <th key={h} className="border border-[#88949c] px-2 py-1 text-right font-bold">{h}</th>)}</tr></thead>
                <tbody>{rows.filter(r => !query || r[0].startsWith(query)).map((r, i) => <tr key={r[0]} onClick={() => setSelected(i)} className={`${i === selected ? "bg-[#bcd7eb]" : i % 2 ? "bg-[#f0f2f3]" : "bg-[#fff]"} cursor-default hover:bg-[#dceaf3]`}><td className="border border-[#c1c8cc] px-2 py-[5px] font-mono">{r[0]}</td><td className="border border-[#c1c8cc] px-2 py-[5px]">{r[1]}</td><td className="border border-[#c1c8cc] px-2 py-[5px]">{r[2]}</td><td className="border border-[#c1c8cc] px-2 py-[5px] text-left font-mono">{r[3]}</td><td className="border border-[#c1c8cc] px-2 py-[5px] text-left font-mono">{r[4]}</td><td className="border border-[#c1c8cc] px-2 py-[5px] text-left font-mono font-bold">{r[5]}</td></tr>)}</tbody>
                <tfoot className="bg-[#c7d0d5] font-bold"><tr><td colSpan={3} className="border border-[#88949c] px-2 py-1">الإجمالي العام (مدين = دائن؟)</td><td className="border border-[#88949c] px-2 py-1 text-left">371,994.45</td><td className="border border-[#88949c] px-2 py-1 text-left">471,?10.25</td><td className="border border-[#88949c] px-2 py-1 text-left text-[#9d3b2a]">فرق: 99,515.80</td></tr></tfoot>
              </table>
            </div>
            <div className="grid grid-cols-4 gap-1 bg-[#d5dadd] p-1 text-[10px]"><div className="border border-[#a0aab0] bg-[#eef0f1] p-1">عدد السجلات: <b>128</b></div><div className="border border-[#a0aab0] bg-[#eef0f1] p-1">المحدد: <b>10</b></div><div className="border border-[#a0aab0] bg-[#fff1be] p-1 text-[#785a18]">قيود معلقة: <b>6</b></div><div className="border border-[#a0aab0] bg-[#f6d3ca] p-1 text-[#873b2d]">فرق الموازنة: <b>99,515.80</b></div></div>
          </section>
        </div>

        <footer className="flex h-[33px] items-center gap-3 border-t border-[#53616b] bg-[#aeb8be] px-2 text-[10px] text-[#28343c]"><span className="flex items-center gap-1"><UserRound className="h-3 w-3" /> SYS-004</span><span className="h-4 border-r border-[#87939b]" /><span>{notice}</span><span className="mr-auto flex items-center gap-2"><span>ذاكرة: 64,928 ك.ب</span><span>نسخة قاعدة البيانات: 18</span><span className="border border-[#7a8790] bg-[#cbd2d6] px-2">اتصال: محلي</span></span></footer>
      </div>
    </main>
  );
}