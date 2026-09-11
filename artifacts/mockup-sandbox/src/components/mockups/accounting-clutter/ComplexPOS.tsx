import { useState } from "react";
import {
  AlertTriangle,
  Archive,
  Bell,
  Calculator,
  ChevronDown,
  ClipboardList,
  FileBarChart,
  FileText,
  Filter,
  Grid3X3,
  HelpCircle,
  LockKeyhole,
  Menu,
  Package,
  PanelRight,
  Printer,
  Receipt,
  Search,
  Settings,
  ShoppingCart,
  SlidersHorizontal,
  UserRound,
  X,
} from "lucide-react";

const products = [
  ["قهوة عربية 250غ", "مخزن 01", "18.50", "42"],
  ["سكر أبيض صندوق", "مخزن 02", "9.75", "126"],
  ["أكواب ورقية 7أونصة", "مستلزمات", "22.00", "31"],
  ["مياه معدنية 330مل", "ثلاجة البيع", "1.50", "288"],
  ["شاي أحمر فاخر", "مخزن 01", "14.25", "19"],
  ["مناديل طاولة", "مستلزمات", "6.00", "74"],
  ["حليب طويل الأجل", "مخزن 02", "7.90", "54"],
  ["علبة تمر 500غ", "مخزن 01", "24.00", "12"],
  ["عصير برتقال", "ثلاجة البيع", "5.50", "83"],
  ["ملاعق بلاستيك", "مستلزمات", "3.25", "205"],
  ["خبز توست", "مخزن 02", "4.75", "28"],
  ["مشروب غازي", "ثلاجة البيع", "3.00", "96"],
];

const invoices = [
  ["فاتورة بيع #004821", "1,284.50", "نقدي"],
  ["فاتورة بيع #004820", "376.00", "شبكة"],
  ["فاتورة مرتجع #000119", "-84.75", "مرتجع"],
  ["مصاريف تشغيل #00077", "218.40", "معلّق"],
];

export function ComplexPOS() {
  const [selected, setSelected] = useState(0);
  const [notice, setNotice] = useState("تنبيه: لم تتم مزامنة 3 عمليات مع الخادم المركزي");
  const [activeTab, setActiveTab] = useState("الفواتير");

  const action = (text: string) => setNotice(text);

  return (
    <main dir="rtl" className="h-[720px] w-[1280px] overflow-hidden bg-[#d7e1e5] font-sans text-[11px] text-[#172936] select-none">
      <header className="h-[43px] bg-[#102b3a] text-[#e9f4f6] flex items-center border-b-4 border-[#ec792d]">
        <div className="flex items-center gap-3 px-3 w-[245px] border-l border-[#355362] h-full">
          <div className="h-7 w-7 bg-[#e37b2d] grid place-items-center text-[#102b3a] font-black text-sm">ق</div>
          <div className="leading-3"><div className="font-black tracking-wide">قِيد<span className="text-[#ef8a37]">+</span></div><div className="text-[9px] text-[#9bb1ba]">نظام نقاط البيع المتقدم</div></div>
          <Menu size={15} className="mr-auto text-[#8ca8b5]" />
        </div>
        <div className="flex items-center gap-1 px-2 text-[10px]">
          {["F1 المنتجات", "F2 فاتورة", "F3 بحث", "F4 عميل", "F5 دفع", "F8 تعليق", "F12 إغلاق"].map((x) => <span key={x} className="border border-[#45606b] bg-[#1b3c4b] px-2 py-1">{x}</span>)}
        </div>
        <div className="mr-auto flex items-center gap-3 px-4 text-[#a9c0c7]"><Bell size={15} /><span>المستخدم: س.محمود</span><UserRound size={16} /></div>
      </header>

      <div className="h-[31px] bg-[#eef3f4] border-b border-[#96aab2] flex items-center gap-1 px-2 text-[10px]">
        {[
          [Grid3X3, "نقطة البيع"], [ClipboardList, "الحركات"], [Receipt, "الفواتير"], [Package, "المخزون"], [FileBarChart, "التقارير"], [Settings, "الإعدادات"],
        ].map(([Icon, label]) => <button key={label as string} onClick={() => setActiveTab(label as string)} className={`h-6 flex items-center gap-1 border px-3 ${activeTab === label ? "bg-[#c6dbe2] border-[#527986] font-bold" : "bg-[#e3eaec] border-[#b1c0c5]"}`}><Icon size={12} />{label as string}</button>)}
        <span className="mr-auto border-r border-[#abbac0] px-3 text-[#607780]">الفرع: المركز الرئيسي ▾</span>
        <span className="bg-[#f6e3a8] border border-[#c8a84a] px-2 py-1 font-bold">وردية 07 • مفتوحة</span>
      </div>

      <div className="h-[31px] bg-[#fff5dc] border-b border-[#bd9e55] flex items-center px-3 gap-3 text-[#61491b]">
        <AlertTriangle size={15} className="text-[#bd6a21]" /><strong>{notice}</strong><button onClick={() => setNotice("تم تجاهل التنبيه حتى 14:30")} className="mr-auto border border-[#b9994b] bg-[#f4e3af] px-3 py-0.5">إخفاء</button><span>آخر فحص: 14:22:08</span><X size={13} />
      </div>

      <section className="p-2 grid grid-cols-[1fr_318px] gap-2 h-[548px]">
        <div className="min-w-0 flex flex-col gap-2">
          <div className="h-[42px] border border-[#859ca5] bg-[#eaf0f1] p-1 flex gap-1">
            <div className="flex-1 flex items-center gap-1 border border-[#9eb0b6] bg-white px-2 text-[#9aa7aa]"><Search size={14} />ابحث بالباركود / اسم الصنف / رقم الحساب ...</div>
            <button onClick={() => action("تم فتح البحث المتقدم")} className="border border-[#788e96] bg-[#d1dde1] px-3 flex gap-1 items-center"><Filter size={13} /> بحث متقدم</button>
            <button onClick={() => action("تم تحديث قائمة الأصناف")} className="border border-[#788e96] bg-[#d1dde1] px-2">تحديث</button>
          </div>
          <div className="flex-1 border border-[#8298a0] bg-[#e7edef] overflow-hidden">
            <div className="h-[29px] bg-[#244858] text-[#eff8f8] flex items-center px-2 gap-2 font-bold"><span>دليل الأصناف السريع</span><span className="mr-auto text-[9px] font-normal text-[#b6cdd1]">عرض: 12 من 4,218 • صفحة 01/352</span><SlidersHorizontal size={14} /></div>
            <div className="grid grid-cols-4 gap-1 p-1.5">
              {products.map((p, i) => <button key={p[0]} onClick={() => { setSelected(i); action(`تم اختيار الصنف: ${p[0]}`); }} className={`h-[92px] text-right border p-2 bg-[#f4f7f6] relative hover:bg-[#fff5dd] ${selected === i ? "border-2 border-[#e47a2b] bg-[#fff2d8]" : "border-[#aebdc1]"}`}>
                <span className="absolute top-1 left-1 text-[9px] text-[#7e9299]">#{String(i + 1).padStart(3, "0")}</span><div className="font-bold text-[#1d4654] truncate pl-4">{p[0]}</div><div className="mt-2 text-[10px] text-[#668087]">{p[1]}</div><div className="mt-1 flex justify-between border-t border-[#d2dfe1] pt-1"><b className="text-[#ba591e]">{p[2]} ر.س</b><span className="text-[#53716c]">متاح {p[3]}</span></div>
              </button>)}
            </div>
          </div>
          <div className="h-[112px] border border-[#849aa2] bg-[#edf2f2]">
            <div className="bg-[#cedde1] border-b border-[#9aaeb5] px-2 py-1 font-bold flex"><span>شريط العمليات السريع</span><span className="mr-auto font-normal text-[#647b83]">المخزن: 01 | التسعير: تجزئة | ضريبة: 15%</span></div>
            <div className="grid grid-cols-8 gap-1 p-2">{["عميل جديد", "حفظ مؤقت", "تعليق بيع", "استرجاع", "سعر خاص", "طباعة نسخة", "فتح درج", "إلغاء سطر"].map((x, i) => <button key={x} onClick={() => action(`تم تنفيذ: ${x}`)} className="h-11 border border-[#99abb0] bg-[#f8faf9] text-[10px] flex flex-col justify-center gap-1 hover:bg-[#dcecf0]"><span className="text-[#dc6f27] font-bold">F{i + 1}</span>{x}</button>)}</div>
          </div>
        </div>

        <aside className="flex flex-col gap-2">
          <div className="border border-[#788e97] bg-[#f3f6f5]">
            <div className="bg-[#234857] text-white px-2 py-1.5 font-bold flex items-center gap-2"><ShoppingCart size={14} />الفاتورة الحالية <span className="mr-auto text-[#c2d6d9] text-[9px]">#004821 • 14:24</span></div>
            <div className="p-1.5 border-b border-[#b8c5c7] bg-[#eaf0ef] flex justify-between"><span>العميل: <b>عميل نقدي</b></span><button className="text-[#c45d24] underline">تغيير</button></div>
            <div className="h-[120px] bg-white overflow-hidden">
              {[["1", "قهوة عربية 250غ", "18.50", "18.50"], ["2", "مياه معدنية 330مل", "1.50", "3.00"], ["1", "أكواب ورقية 7أونصة", "22.00", "22.00"], ["3", "مناديل طاولة", "6.00", "18.00"]].map((r) => <div key={r[1]} className="grid grid-cols-[27px_1fr_55px_60px] border-b border-[#e3e9e8] px-1.5 py-1"><span>{r[0]}</span><span className="truncate">{r[1]}</span><span>{r[2]}</span><b className="text-left">{r[3]}</b></div>)}
            </div>
            <div className="p-2 bg-[#e9efee] space-y-1"><div className="flex justify-between"><span>الإجمالي قبل الضريبة</span><b>61.50</b></div><div className="flex justify-between text-[#a95524]"><span>خصم يدوي (-)</span><b>2.50</b></div><div className="flex justify-between"><span>ضريبة القيمة المضافة (15%)</span><b>8.85</b></div><div className="flex justify-between border-t border-[#94a8ad] pt-1 text-base font-black"><span>المطلوب دفعه</span><strong className="text-[#d56522]">67.85 ر.س</strong></div></div>
          </div>
          <div className="border border-[#788e97] bg-[#eff4f3]">
            <div className="bg-[#d0dfe1] border-b border-[#a6b9be] px-2 py-1.5 font-bold flex items-center gap-2"><Calculator size={14} />لوحة الدفع والتسوية <span className="mr-auto text-[9px] font-normal">نقدي / شبكة / آجل</span></div>
            <div className="grid grid-cols-[1fr_126px] gap-1 p-2"><div className="grid grid-cols-3 gap-1">{["7","8","9","4","5","6","1","2","3","00","0","٫"].map(x => <button key={x} onClick={() => action(`إدخال مبلغ: ${x}`)} className="h-7 bg-white border border-[#9aadb3] font-bold">{x}</button>)}</div><div className="space-y-1"><button onClick={() => action("طريقة الدفع: نقدي")} className="w-full h-7 bg-[#dcebd9] border border-[#84a78b] font-bold">نقدي</button><button onClick={() => action("طريقة الدفع: شبكة")} className="w-full h-7 bg-[#d7e5ee] border border-[#7a9db0] font-bold">شبكة</button><button onClick={() => action("تم تعليق الفاتورة")} className="w-full h-7 bg-[#f5deb5] border border-[#c29652]">تعليق F8</button><button onClick={() => action("تنبيه: المبلغ غير مكتمل")} className="w-full h-7 bg-[#dc6d2b] text-white font-black">اعتماد F5</button></div></div>
          </div>
          <div className="border border-[#889da3] bg-[#f7f8f5] p-2">
            <div className="flex items-center gap-2 font-bold border-b border-[#c1cccd] pb-1 mb-1"><PanelRight size={13} />مراقبة الصندوق اليومية <span className="mr-auto text-[#ca6327]">غير متوازن</span></div>
            <div className="grid grid-cols-2 gap-y-1"><span>رصيد افتتاحي</span><b className="text-left">1,250.00</b><span>مبيعات اليوم</span><b className="text-left">8,472.35</b><span>مصروفات معلقة</span><b className="text-left text-[#b45a27]">-318.40</b><span>فروقات متوقعة</span><b className="text-left text-[#b45a27]">+12.00</b></div>
          </div>
        </aside>
      </section>

      <footer className="h-[36px] bg-[#102b3a] text-[#d4e4e6] flex items-center px-3 gap-3 text-[10px]">
        <span className="flex items-center gap-1"><LockKeyhole size={12} className="text-[#e58032]" /> جلسة آمنة: 00:42:18</span><span className="border-r border-[#506772] pr-3">قاعدة البيانات: محلية (تأخير 82ms)</span><span>النسخة 4.7.19 / وضع الاختبار</span><span className="mr-auto flex items-center gap-2"><Printer size={13} /> F11 طباعة التقرير <HelpCircle size={13} /></span>
      </footer>
    </main>
  );
}