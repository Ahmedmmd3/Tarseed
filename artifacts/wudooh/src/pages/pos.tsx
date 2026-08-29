import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { useStore } from '@/context/store';
import { Button } from '@/components/ui/button';
import {
  ArrowRight, CheckCircle2, CreditCard, Banknote, Search,
  ShoppingCart, Store, Package, AlertCircle, ReceiptText,
  Plus, Minus, X
} from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';

type Product = { id: number | string; name: string; sku?: string; salePrice?: number | string; price?: number | string; sellPrice?: number | string; stock?: number | string };
type Warehouse = { id: number | string; name: string; status?: string };
type InventoryBalance = { productId: number | string; warehouseId: number | string; quantity: number | string };
type CartItem = { product: Product; quantity: number };
type RecordsPayload<T> = { records?: T[]; error?: string };
type CheckoutPayload = { invoice?: { id: string | number; number: string; total: number | string; dueDate?: string }; error?: string };

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('ar-SA', { style: 'currency', currency: 'SAR' }).format(amount);
}

export default function POS() {
  const { currentUser } = useStore();
  const isMobile = useIsMobile();

  const [products, setProducts] = useState<Product[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [balances, setBalances] = useState<InventoryBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [selectedWarehouse, setSelectedWarehouse] = useState<string | number>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [cart, setCart] = useState<CartItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'credit'>('card');
  const [customerName, setCustomerName] = useState('');
  const [customerVatNumber, setCustomerVatNumber] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [dueDate, setDueDate] = useState('');

  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [invoice, setInvoice] = useState<{ id: string | number; number: string; total: number } | null>(null);
  const [pendingOperationId, setPendingOperationId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!currentUser) {
      setLoading(false);
      setError('سجّل الدخول أولاً للوصول إلى نقطة البيع.');
      return;
    }
    try {
      setLoading(true);
      setError('');
      const headers = { 'X-Wudooh-Data-Generation': String(currentUser.dataGeneration) };
      const [prodRes, whRes, balRes] = await Promise.all([
        fetch('/api/data/products', { credentials: 'include', headers }),
        fetch('/api/data/warehouses', { credentials: 'include', headers }),
        fetch('/api/data/inventoryBalances', { credentials: 'include', headers }),
      ]);
      const [prodData, whData, balData] = await Promise.all([
        prodRes.json() as Promise<RecordsPayload<Product>>,
        whRes.json() as Promise<RecordsPayload<Warehouse>>,
        balRes.json() as Promise<RecordsPayload<InventoryBalance>>,
      ]);
      if (!prodRes.ok) throw new Error(prodData.error ?? 'تعذر تحميل المنتجات.');
      if (!whRes.ok) throw new Error(whData.error ?? 'تعذر تحميل المستودعات.');
      if (!balRes.ok) throw new Error(balData.error ?? 'تعذر تحميل الأرصدة.');

      const productsList = prodData.records ?? [];
      const warehousesList = (whData.records ?? []).filter((warehouse) => warehouse.status !== 'inactive');
      setProducts(productsList);
      setWarehouses(warehousesList);
      setBalances(balData.records ?? []);
      setSelectedWarehouse((current) => warehousesList.some((warehouse) => String(warehouse.id) === String(current))
        ? current
        : (warehousesList[0]?.id ?? ''));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'تعذر تحميل بيانات نقطة البيع. أعد المحاولة.');
    } finally {
      setLoading(false);
    }
  }, [currentUser]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const getPrice = (p: Product) => Number(p.sellPrice ?? p.salePrice ?? p.price ?? 0);

  const getStock = (p: Product) => {
    if (selectedWarehouse) {
      const bal = balances.find(b => String(b.productId) === String(p.id) && String(b.warehouseId) === String(selectedWarehouse));
      if (bal) return Number(bal.quantity) || 0;
    }
    return Number(p.stock) || 0;
  };

  const filteredProducts = useMemo(() => {
    if (!searchQuery) return products;
    const q = searchQuery.toLowerCase();
    return products.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.sku && p.sku.toLowerCase().includes(q))
    );
  }, [products, searchQuery]);

  const addToCart = (product: Product) => {
    const available = getStock(product);
    if (available <= 0) {
      setError(`الصنف «${product.name}» غير متاح في الموقع المختار.`);
      return;
    }
    setCart(prev => {
      const existing = prev.find(item => String(item.product.id) === String(product.id));
      if (existing) {
        if (existing.quantity >= available) {
          setError(`لا يمكن إضافة كمية أكبر من الرصيد المتاح للصنف «${product.name}».`);
          return prev;
        }
        return prev.map(item =>
          String(item.product.id) === String(product.id)
            ? { ...item, quantity: item.quantity + 1 }
            : item
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
  };

  const updateQuantity = (productId: string | number, delta: number) => {
    setCart(prev => prev.map(item => {
      if (String(item.product.id) === String(productId)) {
        const newQ = item.quantity + delta;
        if (delta > 0 && newQ > getStock(item.product)) {
          setError(`لا يمكن تجاوز الرصيد المتاح للصنف «${item.product.name}».`);
          return item;
        }
        return newQ > 0 ? { ...item, quantity: newQ } : item;
      }
      return item;
    }));
  };

  const removeFromCart = (productId: string | number) => {
    setCart(prev => prev.filter(item => String(item.product.id) !== String(productId)));
  };

  const clearCart = () => setCart([]);

  const subtotal = cart.reduce((sum, item) => sum + getPrice(item.product) * item.quantity, 0);
  const cartHasInsufficientStock = cart.some((item) => item.quantity > getStock(item.product));
  const cartTotalItems = cart.reduce((sum, item) => sum + item.quantity, 0);

  const handleCheckout = async () => {
    if (!selectedWarehouse || cart.length === 0 || !currentUser || cartHasInsufficientStock) return;
    if (paymentMethod === 'credit' && !dueDate) {
      setError('حدد تاريخ استحقاق البيع الآجل قبل إتمام العملية.');
      return;
    }

    setCheckoutLoading(true);
    setError('');
    try {
      const clientOpId = pendingOperationId ?? crypto.randomUUID();
      setPendingOperationId(clientOpId);
      const payload = {
        warehouseId: Number(selectedWarehouse),
        issueDate: new Date().toISOString().slice(0, 10),
        paymentMethod,
        dueDate: paymentMethod === 'credit' ? dueDate : undefined,
        customerName: customerName.trim() || undefined,
        customerVatNumber: customerVatNumber.trim() || undefined,
        customerAddress: customerAddress.trim() || undefined,
        clientOperationId: clientOpId,
        items: cart.map(item => ({
          productId: Number(item.product.id),
          quantity: item.quantity
        }))
      };

      const headers = {
        'Content-Type': 'application/json',
        'X-Wudooh-Data-Generation': String(currentUser.dataGeneration),
      };

      const res = await fetch('/api/inventory/checkout', {
        method: 'POST',
        credentials: 'include',
        headers,
        body: JSON.stringify(payload)
      });

      const data = await res.json() as CheckoutPayload;
      if (!res.ok || !data.invoice) {
        if (res.status === 409 && data.error?.includes('تغيّرت بيانات المنشأة')) {
          window.dispatchEvent(new Event('wudooh:stale-data-generation'));
        }
        throw new Error(data.error ?? 'تعذر إتمام عملية البيع.');
      }
      setInvoice({ ...data.invoice, total: Number(data.invoice.total) || subtotal });
      setCart([]);
      setCustomerName('');
      setCustomerVatNumber('');
      setCustomerAddress('');
      setDueDate('');
      setPendingOperationId(null);
      await loadData();
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : 'تعذر إتمام عملية البيع. أعد المحاولة.');
    } finally {
      setCheckoutLoading(false);
    }
  };

  if (invoice) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center space-y-6 rounded-[28px] border border-slate-100 bg-white p-8 shadow-2xl shadow-slate-950/5" data-testid="page-pos-success">
        <div className="flex h-24 w-24 items-center justify-center rounded-full bg-teal-50 text-teal-600">
          <CheckCircle2 className="h-12 w-12" />
        </div>
        <h2 className="text-3xl font-black text-slate-900 text-center">تمت العملية بنجاح</h2>
        <div className="w-full max-w-sm rounded-2xl border border-slate-100 bg-slate-50 p-6 text-center">
          <p className="text-sm font-semibold text-slate-500">رقم الفاتورة</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{invoice.number}</p>
          <div className="mt-4 border-t border-slate-200 pt-4">
            <p className="text-sm font-semibold text-slate-500">الإجمالي</p>
            <p className="mt-1 text-3xl font-black text-teal-600">{formatCurrency(invoice.total)}</p>
          </div>
        </div>
        <div className="mt-8 flex flex-col sm:flex-row gap-4 w-full sm:w-auto">
          <Button onClick={() => setInvoice(null)} size="lg" className="h-12 w-full sm:w-auto gap-2 bg-teal-600 hover:bg-teal-700 touch-manipulation" data-testid="btn-new-order">
            <Plus className="h-5 w-5" /> طلب جديد
          </Button>
          <Link href="/dashboard" className="w-full sm:w-auto">
            <Button variant="outline" size="lg" className="h-12 w-full gap-2 touch-manipulation" data-testid="btn-back-home">
                العودة للوحة التحكم <ArrowRight className="h-5 w-5" />
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  const renderCartContent = (isMobileView: boolean) => (
    <div className={`flex w-full flex-col bg-white ${isMobileView ? 'h-full' : 'overflow-hidden rounded-[28px] border border-slate-200 shadow-xl shadow-slate-950/5 lg:w-[400px] sticky top-6'}`}>
      <div className={`border-b border-slate-100 bg-slate-50/50 ${isMobileView ? 'p-4 pt-2 shrink-0' : 'p-5'}`}>
        {!isMobileView && (
          <div className="flex items-center justify-between mb-5">
            <h2 className="flex items-center gap-2 text-lg font-black text-slate-900">
              <ShoppingCart className="h-5 w-5 text-teal-600" /> سلة المشتريات
            </h2>
            {cart.length > 0 && (
              <button onClick={clearCart} className="text-xs font-bold text-rose-500 hover:text-rose-700 touch-manipulation" data-testid="btn-clear-cart">
                تفريغ السلة
              </button>
            )}
          </div>
        )}

        <div>
          <label className="mb-1.5 block text-xs font-bold text-slate-500">المستودع المصدر</label>
          <select
            className="h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium shadow-sm focus:border-teal-500 focus:outline-none"
            value={selectedWarehouse}
            onChange={e => {
              setSelectedWarehouse(e.target.value);
              setError('');
            }}
            data-testid="select-warehouse"
          >
            {warehouses.map(w => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
            {warehouses.length === 0 && <option value="">لا يوجد مستودعات</option>}
          </select>
        </div>
      </div>

      <div className={`flex-1 overflow-y-auto ${isMobileView ? 'p-4' : 'p-5'}`} style={{ maxHeight: isMobileView ? 'none' : 'calc(100vh - 440px)', minHeight: isMobileView ? '200px' : '200px' }}>
        {cart.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center space-y-3 text-slate-400 py-10">
            <ReceiptText className="h-12 w-12 opacity-20" />
            <p className="text-sm font-medium">السلة فارغة. اختر منتجات للبدء.</p>
          </div>
        ) : (
          <div className="space-y-3 pb-8">
            {cart.map(item => {
              const price = getPrice(item.product);
              return (
                <div key={item.product.id} className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-white p-3 shadow-sm" data-testid={`cart-item-${item.product.id}`}>
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-bold leading-tight text-slate-900">{item.product.name}</span>
                    <button onClick={() => removeFromCart(item.product.id)} className="shrink-0 text-slate-300 hover:text-rose-500 touch-manipulation" data-testid={`btn-remove-${item.product.id}`}>
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="font-black text-teal-600">{formatCurrency(price * item.quantity)}</span>
                    <div className="flex items-center gap-3 rounded-lg border border-slate-100 bg-slate-50 p-1">
                      <button onClick={() => updateQuantity(item.product.id, -1)} className="flex h-8 w-8 items-center justify-center rounded bg-white text-slate-600 shadow-sm hover:bg-slate-100 hover:text-slate-900 touch-manipulation" data-testid={`btn-minus-${item.product.id}`}>
                        <Minus className="h-4 w-4" />
                      </button>
                      <span className="w-6 text-center text-sm font-bold" data-testid={`text-qty-${item.product.id}`}>{item.quantity}</span>
                      <button onClick={() => updateQuantity(item.product.id, 1)} className="flex h-8 w-8 items-center justify-center rounded bg-teal-100 text-teal-700 shadow-sm hover:bg-teal-200 touch-manipulation" data-testid={`btn-plus-${item.product.id}`}>
                        <Plus className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className={`border-t border-slate-100 bg-slate-50 shrink-0 ${isMobileView ? 'p-4 pb-[max(env(safe-area-inset-bottom),1.5rem)]' : 'p-5'}`}>
         {error && products.length > 0 && <p className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700" role="alert" data-testid="status-pos-message">{error}</p>}
         {cartHasInsufficientStock && <p className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800" role="alert" data-testid="status-insufficient-stock">تحتوي السلة على كمية أكبر من الرصيد المتاح. عدّل الكميات.</p>}
        <div className="mb-4 flex items-center justify-between">
          <span className="text-sm font-bold text-slate-600">المجموع النهائي</span>
          <span className="text-2xl font-black text-slate-900" data-testid="text-cart-total">{formatCurrency(subtotal)}</span>
        </div>

        <div className="mb-5 space-y-4">
          <input
             type="text"
             placeholder="اسم العميل (اختياري)"
             value={customerName}
             onChange={e => setCustomerName(e.target.value)}
             className="h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium shadow-sm focus:border-teal-500 focus:outline-none"
             data-testid="input-customer-name"
          />

          <div>
            <label className="mb-2 block text-xs font-bold text-slate-500">طريقة الدفع</label>
            <div className="grid grid-cols-3 gap-2">
                {[
                { id: 'cash', label: 'نقدي', icon: Banknote },
                { id: 'card', label: 'شبكة', icon: CreditCard },
                { id: 'credit', label: 'آجل', icon: Store }
              ].map(method => (
                <button
                  key={method.id}
                  onClick={() => setPaymentMethod(method.id as 'cash' | 'card' | 'credit')}
                  className={`flex h-16 flex-col items-center justify-center gap-1.5 rounded-xl border transition-all touch-manipulation ${
                    paymentMethod === method.id
                      ? 'border-teal-500 bg-teal-50 text-teal-700 shadow-md shadow-teal-900/5'
                      : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 hover:bg-slate-50'
                  }`}
                  data-testid={`btn-pay-${method.id}`}
                >
                  <method.icon className="h-5 w-5" />
                  <span className="text-[11px] font-bold">{method.label}</span>
                </button>
              ))}
            </div>
          </div>

          {paymentMethod === 'credit' && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <label htmlFor="pos-due-date" className="mb-2 block text-xs font-bold text-amber-900">
                استحقاق البيع الآجل <span className="text-rose-600">*</span>
              </label>
              <input
                id="pos-due-date"
                type="date"
                value={dueDate}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(event) => setDueDate(event.target.value)}
                required
                className="h-11 w-full rounded-xl border border-amber-200 bg-white px-4 text-sm font-medium text-slate-900 shadow-sm focus:border-teal-500 focus:outline-none"
                data-testid="input-credit-due-date"
              />
            </div>
          )}
        </div>

        <Button
          className="h-14 w-full rounded-xl bg-teal-600 text-lg font-black shadow-xl shadow-teal-900/20 hover:bg-teal-700 disabled:opacity-50 touch-manipulation"
          disabled={cart.length === 0 || !selectedWarehouse || checkoutLoading || cartHasInsufficientStock}
          onClick={handleCheckout}
          data-testid="btn-checkout"
        >
          {checkoutLoading ? 'جاري التنفيذ...' : `إتمام الدفع`}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-6" data-testid="page-pos">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/dashboard" className="mb-2 inline-flex items-center gap-1.5 text-sm font-bold text-slate-500 transition hover:text-slate-900 touch-manipulation" data-testid="link-back-dashboard">
            <ArrowRight className="h-4 w-4" /> لوحة التحكم
          </Link>
          <h1 className="text-2xl font-black text-slate-900 sm:text-3xl">نقطة البيع</h1>
        </div>
        <div className="hidden sm:block">
          <div className="inline-flex items-center gap-2 rounded-full border border-teal-200/20 bg-teal-50 px-3 py-1.5 text-xs font-bold text-teal-700">
            <Store className="h-4 w-4 text-teal-500" />
            {currentUser?.name || 'مستخدم'}
          </div>
        </div>
      </div>

      <div className={`flex flex-col gap-6 lg:flex-row lg:items-start ${isMobile ? 'pb-24' : ''}`}>
        <div className="flex-1 space-y-4">
          <div className="relative">
            <Search className="absolute right-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="ابحث عن منتج بالاسم أو الرمز..."
              className="h-12 w-full rounded-2xl border border-slate-200 bg-white pr-12 pl-4 text-sm font-medium shadow-sm focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              data-testid="input-search-products"
            />
               <input
                  type="text"
                  inputMode="numeric"
                  maxLength={15}
                  placeholder="الرقم الضريبي للعميل (لفاتورة ضريبية)"
                  value={customerVatNumber}
                  onChange={e => setCustomerVatNumber(e.target.value.replace(/\D/g, ''))}
                  className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium shadow-sm focus:border-teal-500 focus:outline-none"
                  data-testid="input-customer-vat"
               />
               {customerVatNumber && (
                 <input
                    type="text"
                    placeholder="عنوان العميل (مطلوب للفاتورة الضريبية)"
                    value={customerAddress}
                    onChange={e => setCustomerAddress(e.target.value)}
                    className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-medium shadow-sm focus:border-teal-500 focus:outline-none"
                    data-testid="input-customer-address"
                 />
               )}
          </div>

          {loading ? (
            <div className="flex min-h-[400px] items-center justify-center rounded-3xl border border-slate-200 bg-white">
              <p className="animate-pulse text-sm font-bold text-slate-400">جاري تحميل المنتجات...</p>
            </div>
          ) : error && products.length === 0 ? (
             <div className="flex min-h-[400px] flex-col items-center justify-center gap-4 rounded-3xl border border-rose-200 bg-rose-50 px-6 text-center text-rose-700" data-testid="status-pos-error">
               <AlertCircle className="h-6 w-6" />
               <p>{error}</p>
               <Button type="button" variant="outline" onClick={() => void loadData()} data-testid="button-retry-pos" className="touch-manipulation">إعادة المحاولة</Button>
             </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 xl:grid-cols-4">
              {filteredProducts.map(p => {
                const price = getPrice(p);
                const stock = getStock(p);
                return (
                  <button
                     type="button"
                    key={p.id}
                    className="group rounded-2xl border border-slate-100 bg-white p-3 sm:p-4 text-right shadow-sm transition-all hover:-translate-y-1 hover:border-teal-300 hover:shadow-xl hover:shadow-teal-900/5 active:scale-95 disabled:cursor-not-allowed disabled:opacity-55 touch-manipulation"
                    onClick={() => addToCart(p)}
                    disabled={stock <= 0}
                    data-testid={`card-product-${p.id}`}
                  >
                    <div className="mb-3 flex h-20 sm:h-24 items-center justify-center rounded-xl bg-slate-50 text-slate-400 transition-colors group-hover:bg-teal-50 group-hover:text-teal-600">
                      <Package className="h-8 w-8" />
                    </div>
                    <h3 className="font-bold text-sm sm:text-base text-slate-900 line-clamp-1" title={p.name}>{p.name}</h3>
                    <p className="mt-1 text-[10px] sm:text-xs text-slate-500">{p.sku || 'بدون رمز'}</p>
                    <div className="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-0">
                      <span className="font-black text-teal-600">{formatCurrency(price)}</span>
                      <span className={`self-start sm:self-auto rounded-md px-1.5 py-0.5 text-[10px] font-bold ${stock > 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'}`}>
                        {stock > 0 ? `${stock} حبة` : 'نفذت'}
                      </span>
                    </div>
                  </button>
                );
              })}
              {filteredProducts.length === 0 && (
                <div className="col-span-full flex min-h-[300px] flex-col items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-slate-50 text-slate-400">
                  <Package className="mb-2 h-8 w-8 opacity-20" />
                  <p>لا توجد منتجات مطابقة للبحث</p>
                </div>
              )}
            </div>
          )}
        </div>

        {!isMobile && renderCartContent(false)}
      </div>

      {isMobile && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-slate-200 bg-white/95 p-4 pb-[max(env(safe-area-inset-bottom),1rem)] backdrop-blur-md shadow-[0_-4px_20px_rgba(0,0,0,0.05)]">
          <Sheet>
            <SheetTrigger asChild>
              <Button className="w-full h-14 rounded-2xl bg-teal-600 text-lg font-black shadow-xl shadow-teal-900/20 hover:bg-teal-700 touch-manipulation relative overflow-hidden">
                {cartTotalItems > 0 && (
                  <span className="absolute right-0 top-0 bottom-0 w-24 bg-white/10" />
                )}
                <div className="flex w-full items-center justify-between px-2">
                   <div className="flex items-center gap-3">
                     <ShoppingCart className="h-6 w-6" />
                     <span className="mt-1">السلة ({cartTotalItems})</span>
                   </div>
                   <span className="mt-1">{formatCurrency(subtotal)}</span>
                </div>
              </Button>
            </SheetTrigger>
            <SheetContent side="bottom" className="h-[92dvh] p-0 flex flex-col rounded-t-[28px]" dir="rtl">
               <SheetHeader className="p-4 border-b border-slate-100 bg-slate-50/50 text-right shrink-0">
                 <div className="flex items-center justify-between">
                   <SheetTitle className="flex items-center gap-2 text-lg font-black text-slate-900">
                     <ShoppingCart className="h-5 w-5 text-teal-600" /> سلة المشتريات
                   </SheetTitle>
                   {cart.length > 0 && (
                     <button onClick={clearCart} className="text-xs font-bold text-rose-500 hover:text-rose-700 px-2 py-1 touch-manipulation">
                       تفريغ السلة
                     </button>
                   )}
                 </div>
               </SheetHeader>
               <div className="flex-1 overflow-hidden flex flex-col relative">
                  {renderCartContent(true)}
               </div>
            </SheetContent>
          </Sheet>
        </div>
      )}
    </div>
  );
}
