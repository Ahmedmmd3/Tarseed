import { useMemo, useState } from "react";
import {
  Bell, ChevronDown, ClipboardList, Grid2X2, Minus, Package,
  Plus, ReceiptText, Search, ShoppingCart, Store, UserRound, X,
} from "lucide-react";
import "./_group.css";

type Product = {
  id: string;
  name: string;
  sku: string;
  price: number;
  stock: number;
  tint: string;
};

const products: Product[] = [
  { id: "coffee", name: "قهوة عربية فاخرة", sku: "PRD-1024", price: 180, stock: 24, tint: "bg-amber-50 text-amber-700" },
  { id: "dates", name: "تمر خلاص", sku: "PRD-1041", price: 105, stock: 18, tint: "bg-orange-50 text-orange-700" },
  { id: "cardamom", name: "هيل أخضر فاخر", sku: "PRD-1088", price: 64, stock: 12, tint: "bg-emerald-50 text-emerald-700" },
  { id: "tea", name: "شاي ربيعي", sku: "PRD-1092", price: 38, stock: 31, tint: "bg-sky-50 text-sky-700" },
  { id: "box", name: "علبة ضيافة فاخرة", sku: "PRD-1110", price: 220, stock: 7, tint: "bg-violet-50 text-violet-700" },
  { id: "saffron", name: "زعفران إيراني", sku: "PRD-1128", price: 96, stock: 9, tint: "bg-rose-50 text-rose-700" },
];

function money(value: number) {
  return `${value.toLocaleString("en-US", { minimumFractionDigits: 2 })} ر.س`;
}

export function Invoice() {
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<Record<string, number>>({ coffee: 1, dates: 1 });
  const [notice, setNotice] = useState(false);
  const filtered = products.filter((product) => product.name.includes(query) || product.sku.toLowerCase().includes(query.toLowerCase()));
  const cartProducts = products.filter((product) => cart[product.id]);
  const subtotal = useMemo(() => cartProducts.reduce((sum, product) => sum + product.price * cart[product.id], 0), [cartProducts, cart]);
  const tax = subtotal * 0.15;
  const total = subtotal + tax;

  function add(product: Product) {
    setCart((current) => ({ ...current, [product.id]: (current[product.id] || 0) + 1 }));
  }
  function remove(product: Product) {
    setCart((current) => {
      const next = { ...current };
      if ((next[product.id] || 0) <= 1) delete next[product.id];
      else next[product.id] -= 1;
      return next;
    });
  }

  return (
    <div dir="rtl" className="min-h-screen w-full overflow-hidden bg-[#f1f3f6] font-sans text-slate-900">
      <div className="flex h-screen min-h-[620px] w-full">
        <aside className="hidden w-[224px] shrink-0 flex-col bg-[#0a1328] text-white lg:flex">
          <div className="flex items-center gap-3 border-b border-white/10 px-6 py-5">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0d47d9] text-xl font-black">ت</div>
            <div><div className="text-lg font-black leading-none">ترصيد</div><div className="mt-1 text-[10px] text-slate-400">إدارة أسهل لنمو أسرع</div></div>
          </div>
          <div className="border-b border-white/10 px-5 py-4">
            <div className="mb-1 text-[10px] font-bold text-slate-400">مساحة العمل</div>
            <div className="flex items-center justify-between text-sm font-bold"><span>متجر الضيافة</span><ChevronDown size={14} className="text-slate-400" /></div>
          </div>
          <nav className="flex-1 space-y-1 px-3 py-5 text-[13px] font-semibold">
            <div className="mb-3 px-3 text-[10px] font-bold text-slate-500">الرئيسية</div>
            <NavItem icon={Grid2X2} label="لوحة التحكم" />
            <NavItem active icon={Store} label="نقطة البيع" />
            <NavItem icon={ShoppingCart} label="المبيعات والعملاء" />
            <NavItem icon={Package} label="المخزون والمنتجات" />
            <div className="mb-3 mt-7 px-3 text-[10px] font-bold text-slate-500">المالية</div>
            <NavItem icon={ReceiptText} label="الفواتير" />
            <NavItem icon={ClipboardList} label="التقارير المالية" />
          </nav>
          <div className="border-t border-white/10 p-4 text-xs text-slate-400"><div className="font-bold text-white">أحمد العتيبي</div><div className="mt-1">مدير الحساب</div></div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <header className="flex h-[68px] shrink-0 items-center justify-between border-b border-slate-200 bg-white px-7">
            <div className="flex items-center gap-4"><div><div className="text-[11px] font-bold text-slate-400">المبيعات والتشغيل</div><h1 className="text-xl font-black text-slate-900">نقطة البيع</h1></div><span className="h-8 w-px bg-slate-200" /><span className="rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700">● المتجر الرئيسي</span></div>
            <div className="flex items-center gap-5"><Bell size={19} className="text-slate-400" /><div className="flex items-center gap-2 border-r border-slate-200 pr-5"><div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-xs font-black text-blue-700">أ</div><span className="text-xs font-bold">أحمد العتيبي</span><ChevronDown size={14} className="text-slate-400" /></div></div>
          </header>
          <div className="flex min-h-0 flex-1 gap-5 p-5">
            <section className="flex min-w-0 flex-1 flex-col">
              <div className="mb-4 flex items-center justify-between"><div><h2 className="text-lg font-black">اختيار المنتجات</h2><p className="mt-1 text-xs text-slate-500">اختر منتجاً لإضافته إلى الفاتورة</p></div><button className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600"><Package size={15} /> كل المنتجات <ChevronDown size={14} /></button></div>
              <div className="relative mb-4"><Search size={18} className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث عن منتج بالاسم أو الرمز أو الباركود..." className="h-12 w-full rounded-xl border border-slate-200 bg-white pr-11 pl-4 text-sm outline-none transition focus:border-[#0d47d9] focus:ring-2 focus:ring-blue-100" /></div>
              <div className="grid min-h-0 flex-1 grid-cols-2 gap-3 overflow-y-auto xl:grid-cols-3">
                {filtered.map((product) => <button key={product.id} type="button" onClick={() => add(product)} className="group flex min-h-[170px] flex-col rounded-2xl border border-slate-200 bg-white p-3 text-right shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md">
                  <div className={`flex h-[76px] items-center justify-center rounded-xl ${product.tint}`}><Package size={29} strokeWidth={1.6} /></div>
                  <div className="mt-3 text-sm font-black">{product.name}</div><div className="mt-1 text-[10px] text-slate-400">{product.sku}</div>
                  <div className="mt-auto flex items-end justify-between pt-3"><span className="text-sm font-black text-[#0d47d9]">{money(product.price)}</span><span className="text-[10px] font-bold text-slate-400">{product.stock} متوفر</span></div>
                </button>)}
              </div>
            </section>

            <aside className="flex w-[348px] shrink-0 flex-col rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4"><div className="flex items-center gap-2"><div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-[#0d47d9]"><ShoppingCart size={17} /></div><div><h2 className="text-sm font-black">سلة المشتريات</h2><p className="text-[10px] text-slate-400">{cartProducts.length} منتجات في الفاتورة</p></div></div><button onClick={() => setCart({})} className="text-[10px] font-bold text-rose-500">تفريغ السلة</button></div>
              <div className="border-b border-slate-100 px-5 py-3"><div className="mb-2 text-[10px] font-bold text-slate-500">العميل</div><div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5"><div className="flex items-center gap-2 text-xs font-bold"><UserRound size={15} className="text-[#0d47d9]" />شركة الضيافة العربية</div><ChevronDown size={14} className="text-slate-400" /></div></div>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
                {cartProducts.length === 0 && <div className="py-12 text-center text-xs text-slate-400">السلة فارغة</div>}
                {cartProducts.map((product) => <div key={product.id} className="rounded-xl border border-slate-100 bg-slate-50/70 p-3"><div className="flex items-start justify-between gap-2"><div><div className="text-xs font-black">{product.name}</div><div className="mt-1 text-[10px] text-slate-400">{money(product.price)} / وحدة</div></div><button onClick={() => remove(product)} className="text-slate-300 hover:text-rose-500"><X size={15} /></button></div><div className="mt-3 flex items-center justify-between"><div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5"><button onClick={() => remove(product)} className="flex h-6 w-6 items-center justify-center rounded-md text-slate-500"><Minus size={12} /></button><span className="w-6 text-center text-xs font-black">{cart[product.id]}</span><button onClick={() => add(product)} className="flex h-6 w-6 items-center justify-center rounded-md bg-blue-50 text-[#0d47d9]"><Plus size={12} /></button></div><span className="text-xs font-black">{money(product.price * cart[product.id])}</span></div></div>)}
              </div>
              <div className="border-t border-slate-100 px-5 py-4"><div className="space-y-2 text-xs"><div className="flex justify-between text-slate-500"><span>المجموع الفرعي</span><span className="font-bold text-slate-700">{money(subtotal)}</span></div><div className="flex justify-between text-slate-500"><span>ضريبة القيمة المضافة (15%)</span><span className="font-bold text-slate-700">{money(tax)}</span></div><div className="my-3 border-t border-dashed border-slate-200" /><div className="flex items-center justify-between"><span className="text-sm font-black">الإجمالي المستحق</span><span className="text-lg font-black text-[#0d47d9]">{money(total)}</span></div></div><button onClick={() => setNotice(true)} className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#0d47d9] text-sm font-black text-white shadow-lg shadow-blue-900/20 transition hover:bg-blue-800"><ReceiptText size={17} /> إتمام الدفع</button>{notice && <div className="mt-2 rounded-lg bg-emerald-50 p-2 text-center text-[11px] font-bold text-emerald-700">تم تجهيز الفاتورة بنجاح</div>}</div>
            </aside>
          </div>
        </main>
      </div>
    </div>
  );
}

function NavItem({ icon: Icon, label, active = false }: { icon: typeof Store; label: string; active?: boolean }) {
  return <div className={`flex items-center gap-3 rounded-xl px-3 py-3 ${active ? "bg-[#0d47d9] text-white shadow-lg shadow-blue-950/30" : "text-slate-300 hover:bg-white/5"}`}><Icon size={17} className={active ? "text-white" : "text-slate-400"} /><span>{label}</span>{active && <span className="mr-auto h-1.5 w-1.5 rounded-full bg-cyan-300" />}</div>;
}