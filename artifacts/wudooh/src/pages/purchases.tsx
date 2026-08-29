import { useState, useMemo, type FormEvent, useEffect, useCallback } from 'react';
import { Truck, ChevronRight, Plus, LoaderCircle, Trash2, CalendarClock } from 'lucide-react';
import { Link } from 'wouter';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCrud } from '@/hooks/use-crud';
import { useStore } from '@/context/store';
import { useToast } from '@/hooks/use-toast';
import { CrudTable } from '@/components/crud-table';

type Product = { id: number | string; name: string };
type Warehouse = { id: number | string; name: string; status?: string };
type Supplier = { id: number | string; name: string };
type PurchaseOrder = { id: number | string; orderNumber: string; supplierName: string; date: string; status: string; total: number | string };

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('ar-SA', { style: 'currency', currency: 'SAR' }).format(amount);
}

function PurchaseReceiptsWorkspace() {
  const { currentUser } = useStore();
  const { toast } = useToast();

  const productsCrud = useCrud<Product>('products');
  const warehousesCrud = useCrud<Warehouse>('warehouses');
  const suppliersCrud = useCrud<Supplier>('suppliers');
  const purchaseOrdersCrud = useCrud<PurchaseOrder>('purchaseOrders');

  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [vatRate, setVatRate] = useState(0.15);
  const [clientOperationId, setClientOperationId] = useState('');

  const [form, setForm] = useState({
    orderNumber: '',
    supplierName: '',
    date: new Date().toISOString().slice(0, 10),
    warehouseId: '',
    paymentMethod: 'cash' as 'cash' | 'credit',
    dueDate: '',
  });

  type ReceiptItem = { productId: string; quantity: string; unitCostExVat: string };
  const [items, setItems] = useState<ReceiptItem[]>([]);

  const loadBillingSettings = useCallback(async () => {
    if (!currentUser) return;
    try {
      const res = await fetch('/api/inventory/settings', {
        credentials: 'include',
        headers: { 'X-Wudooh-Data-Generation': String(currentUser.dataGeneration) }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.vatRate !== undefined) setVatRate(Number(data.vatRate) / 100);
      }
    } catch {
      // ignore
    }
  }, [currentUser]);

  useEffect(() => {
    void loadBillingSettings();
  }, [loadBillingSettings]);

  useEffect(() => {
    if (open && !clientOperationId) {
      setClientOperationId(crypto.randomUUID());
    }
  }, [open, clientOperationId]);

  const activeWarehouses = warehousesCrud.data.filter((w) => w.status !== 'inactive');

  const handleAddItem = () => {
    setItems([...items, { productId: '', quantity: '1', unitCostExVat: '0' }]);
  };

  const updateItem = (index: number, field: keyof ReceiptItem, value: string) => {
    const newItems = [...items];
    newItems[index] = { ...newItems[index], [field]: value };
    setItems(newItems);
  };

  const removeItem = (index: number) => {
    setItems(items.filter((_, i) => i !== index));
  };

  const calculateTotals = () => {
    const subtotal = items.reduce((sum, item) => sum + (Number(item.quantity) * Number(item.unitCostExVat)), 0);
    const tax = subtotal * vatRate;
    const total = subtotal + tax;
    return { subtotal, tax, total };
  };

  const totals = calculateTotals();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!currentUser) return;
    if (items.length === 0) {
      toast({ title: 'يجب إضافة منتج واحد على الأقل', variant: 'destructive' });
      return;
    }
    if (form.paymentMethod === 'credit' && !form.dueDate) {
      toast({ title: 'يجب تحديد تاريخ الاستحقاق للآجل', variant: 'destructive' });
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        ...form,
        warehouseId: Number(form.warehouseId),
        dueDate: form.paymentMethod === 'credit' ? form.dueDate : undefined,
        clientOperationId: clientOperationId,
        items: items.map(item => ({
          productId: Number(item.productId),
          quantity: Number(item.quantity),
          unitCostExVat: Number(item.unitCostExVat)
        }))
      };

      const res = await fetch('/api/inventory/purchase-receipts', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Wudooh-Data-Generation': String(currentUser.dataGeneration)
        },
        body: JSON.stringify(payload)
      });

      const data = await res.json() as { error?: string };
      if (!res.ok) {
        if (res.status === 409 && data.error?.includes('تغيّرت بيانات المنشأة')) {
          window.dispatchEvent(new Event('wudooh:stale-data-generation'));
        }
        throw new Error(data.error ?? 'تعذر تسجيل استلام المشتريات.');
      }

      setOpen(false);
      setForm({ orderNumber: '', supplierName: '', date: new Date().toISOString().slice(0, 10), warehouseId: '', paymentMethod: 'cash', dueDate: '' });
      setItems([]);
      setClientOperationId('');
      await purchaseOrdersCrud.load();
      toast({ title: 'تم تسجيل استلام المشتريات بنجاح.' });
    } catch (error) {
      toast({ title: 'تعذر التسجيل', description: error instanceof Error ? error.message : 'أعد المحاولة.', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={(isOpen) => { setOpen(isOpen); if (!isOpen) setClientOperationId(''); }}>
          <DialogTrigger asChild>
            <Button className="gap-2 bg-teal-600 hover:bg-teal-700" data-testid="btn-create-purchase-receipt">
              <Plus className="h-4 w-4" /> استلام مشتريات
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>استلام مشتريات جديد</DialogTitle></DialogHeader>
            <form onSubmit={submit} className="flex flex-col gap-6 py-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="pr-orderNumber">رقم أمر الشراء / الفاتورة</Label>
                  <Input id="pr-orderNumber" required value={form.orderNumber} onChange={e => setForm({...form, orderNumber: e.target.value})} data-testid="input-pr-ordernumber" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pr-supplier">اسم المورد</Label>
                  <Input id="pr-supplier" required list="suppliers-list" value={form.supplierName} onChange={e => setForm({...form, supplierName: e.target.value})} data-testid="input-pr-supplier" />
                  <datalist id="suppliers-list">
                    {suppliersCrud.data.map(s => <option key={s.id} value={s.name} />)}
                  </datalist>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pr-warehouse">موقع الاستلام</Label>
                  <select id="pr-warehouse" required className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.warehouseId} onChange={e => setForm({...form, warehouseId: e.target.value})} data-testid="select-pr-warehouse">
                    <option value="">اختر الموقع</option>
                    {activeWarehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pr-date">تاريخ الاستلام</Label>
                  <Input id="pr-date" required type="date" value={form.date} onChange={e => setForm({...form, date: e.target.value})} data-testid="input-pr-date" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="pr-payment">طريقة الدفع</Label>
                  <select id="pr-payment" required className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={form.paymentMethod} onChange={e => setForm({...form, paymentMethod: e.target.value as 'cash'|'credit'})} data-testid="select-pr-payment">
                    <option value="cash">نقدي / شبكة / تحويل</option>
                    <option value="credit">آجل</option>
                  </select>
                </div>
                {form.paymentMethod === 'credit' && (
                  <div className="space-y-2">
                    <Label htmlFor="pr-dueDate">تاريخ الاستحقاق (آجل)</Label>
                    <Input id="pr-dueDate" required type="date" value={form.dueDate} onChange={e => setForm({...form, dueDate: e.target.value})} data-testid="input-pr-duedate" />
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-slate-900">المنتجات</h3>
                  <Button type="button" variant="outline" size="sm" onClick={handleAddItem} data-testid="btn-pr-add-item">
                    <Plus className="mr-2 h-4 w-4" /> إضافة منتج
                  </Button>
                </div>
                {items.length === 0 ? (
                  <div className="text-center py-6 text-sm text-slate-500">لم يتم إضافة منتجات بعد.</div>
                ) : (
                  <div className="space-y-3">
                    {items.map((item, index) => (
                      <div key={index} className="grid grid-cols-12 gap-2 items-end border-b border-slate-200 pb-3 last:border-0 last:pb-0">
                        <div className="col-span-5 space-y-1">
                          <Label className="text-xs">المنتج</Label>
                          <select required className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={item.productId} onChange={e => updateItem(index, 'productId', e.target.value)} data-testid={`select-pr-item-product-${index}`}>
                            <option value="">اختر المنتج</option>
                            {productsCrud.data.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                          </select>
                        </div>
                        <div className="col-span-3 space-y-1">
                          <Label className="text-xs">الكمية</Label>
                          <Input required type="number" min="1" step="any" value={item.quantity} onChange={e => updateItem(index, 'quantity', e.target.value)} data-testid={`input-pr-item-qty-${index}`} />
                        </div>
                        <div className="col-span-3 space-y-1">
                          <Label className="text-xs">التكلفة (قبل الضريبة)</Label>
                          <Input required type="number" min="0" step="any" value={item.unitCostExVat} onChange={e => updateItem(index, 'unitCostExVat', e.target.value)} data-testid={`input-pr-item-cost-${index}`} />
                        </div>
                        <div className="col-span-1">
                          <Button type="button" variant="ghost" size="icon" className="text-rose-500 hover:text-rose-700 hover:bg-rose-50" onClick={() => removeItem(index)} data-testid={`btn-pr-item-remove-${index}`}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-xl bg-slate-900 p-5 text-white space-y-3">
                <div className="flex justify-between text-sm text-slate-300">
                  <span>الصافي (قبل الضريبة)</span>
                  <span>{formatCurrency(totals.subtotal)}</span>
                </div>
                <div className="flex justify-between text-sm text-slate-300">
                  <span>الضريبة ({(vatRate * 100).toFixed(0)}%)</span>
                  <span>{formatCurrency(totals.tax)}</span>
                </div>
                <div className="flex justify-between text-lg font-bold border-t border-slate-700 pt-3">
                  <span>الإجمالي</span>
                  <span data-testid="text-pr-total">{formatCurrency(totals.total)}</span>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
                <Button type="submit" disabled={submitting || items.length === 0} data-testid="btn-pr-submit">
                  {submitting ? <LoaderCircle className="animate-spin" /> : 'اعتماد الاستلام'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {purchaseOrdersCrud.loading ? (
        <div className="flex h-32 items-center justify-center rounded-2xl border border-slate-100 bg-white">
          <LoaderCircle className="h-6 w-6 animate-spin text-teal-600" />
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
          <Table className="min-w-[760px]">
            <TableHeader>
              <TableRow>
                <TableHead>رقم الأمر</TableHead>
                <TableHead>المورد</TableHead>
                <TableHead>التاريخ</TableHead>
                <TableHead>الإجمالي</TableHead>
                <TableHead>الحالة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {purchaseOrdersCrud.data.map((order) => (
                <TableRow key={order.id} data-testid={`row-pr-${order.id}`}>
                  <TableCell className="font-medium text-slate-900">{order.orderNumber}</TableCell>
                  <TableCell>{order.supplierName}</TableCell>
                  <TableCell>{order.date}</TableCell>
                  <TableCell className="font-bold">{formatCurrency(Number(order.total))}</TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                      (order.status === 'completed' || order.status === 'received') ? 'bg-emerald-50 text-emerald-700' :
                      order.status === 'pending' ? 'bg-amber-50 text-amber-700' :
                      'bg-slate-100 text-slate-700'
                    }`}>
                       {order.status === 'completed' ? 'مكتمل' :
                        order.status === 'received' ? 'تم الاستلام' :
                       order.status === 'pending' ? 'قيد الانتظار' :
                       order.status === 'cancelled' ? 'ملغي' : order.status}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
              {!purchaseOrdersCrud.data.length && (
                <TableRow>
                  <TableCell colSpan={5} className="h-24 text-center text-slate-500">
                    لا توجد أوامر شراء مسجلة.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

export default function Purchases() {
  return (
    <div className="flex flex-col gap-6" data-testid="page-purchases">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/dashboard" className="mb-2 inline-flex items-center gap-1.5 text-sm font-bold text-slate-500 transition hover:text-slate-900">
            <ChevronRight className="h-4 w-4" /> لوحة التحكم
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-black text-slate-900 sm:text-3xl">
            <Truck className="h-8 w-8 text-amber-600" />
            المشتريات والموردون
          </h1>
        </div>
      </div>
      
      <Tabs defaultValue="suppliers" className="w-full">
        <TabsList className="mb-6 grid w-full grid-cols-2 md:w-[400px]">
          <TabsTrigger value="suppliers">الموردون</TabsTrigger>
          <TabsTrigger value="orders">أوامر واستلامات الشراء</TabsTrigger>
        </TabsList>
        
        <TabsContent value="suppliers">
          <CrudTable
            table="suppliers"
            title="إدارة الموردين"
            fields={[
              { key: 'name', label: 'اسم المورد', required: true },
              { key: 'contactPerson', label: 'الشخص المسؤول' },
              { key: 'phone', label: 'رقم الهاتف' },
              { key: 'email', label: 'البريد الإلكتروني' },
            ]}
          />
        </TabsContent>
        
        <TabsContent value="orders">
          <PurchaseReceiptsWorkspace />
        </TabsContent>
      </Tabs>
    </div>
  );
}