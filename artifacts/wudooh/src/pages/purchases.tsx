import { useState, useMemo, type FormEvent, useEffect, useCallback } from 'react';
import { Truck, ChevronRight, Plus, LoaderCircle, Trash2, CalendarClock, Paperclip, CreditCard } from 'lucide-react';
import { Link } from 'wouter';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCrud } from '@/hooks/use-crud';
import { useStore } from '@/context/store';
import { useToast } from '@/hooks/use-toast';
import { CrudTable } from '@/components/crud-table';
import { AttachmentsPanel } from '@/components/attachments-panel';
import { TransferDialog } from '@/components/transfer-dialog';

type Product = { id: number | string; name: string; vatRate?: number | string };
type Warehouse = { id: number | string; name: string; status?: string };
type Supplier = { id: number | string; name: string };
type PurchaseOrder = {
  id: number | string;
  orderNumber: string;
  supplierId?: number | string;
  supplierName: string;
  date: string;
  status: string;
  total: number | string;
  receivedTotal?: number | string;
  payableTotal?: number | string;
  paid?: number | string;
  remaining?: number | string;
  paymentStatus?: 'unpaid' | 'partial' | 'paid';
};
type SupplierPayable = {
  id: number | string;
  type: 'payable';
  supplierId?: number | string;
  supplierName?: string;
  party: string;
  purchaseOrderId?: number | string;
  reference: string;
  amount: number | string;
  paid: number | string;
  status: 'unpaid' | 'partial' | 'paid';
};
type SupplierPaymentAllocation = {
  payableId: number;
  amount: number;
  purchaseOrderId?: number;
  purchaseOrderNumber?: string;
  payableAmount?: number | string;
  payablePaid?: number | string;
  payableStatus?: string;
};
type SupplierPayment = {
  id: number;
  supplierName: string;
  paymentDate: string;
  paymentMethod: 'cash' | 'bank';
  reference?: string;
  amount: number | string;
  status?: 'reversed' | string;
  reversalReason?: string;
  reversalDate?: string;
  allocations: SupplierPaymentAllocation[];
};

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('ar-SA', { style: 'currency', currency: 'SAR' }).format(amount);
}

const payableRemaining = (payable: SupplierPayable) =>
  Math.max(0, Number(payable.amount) - Number(payable.paid));

function SupplierPaymentsPanel() {
  const { currentUser } = useStore();
  const { toast } = useToast();
  const canUseAccounting = currentUser?.roleId === 'owner' || currentUser?.permissions.accounting === true;
  const suppliersCrud = useCrud<Supplier>('suppliers');
  const payablesCrud = useCrud<SupplierPayable>('receivables', canUseAccounting);
  const purchaseOrdersCrud = useCrud<PurchaseOrder>('purchaseOrders');
  const [paymentSupplier, setPaymentSupplier] = useState<Supplier | null>(null);
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'bank'>('bank');
  const [reference, setReference] = useState('');
  const [operationId, setOperationId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [supplierPayments, setSupplierPayments] = useState<SupplierPayment[]>([]);
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [reversingPayment, setReversingPayment] = useState<SupplierPayment | null>(null);
  const [reversalReason, setReversalReason] = useState('');
  const [reversalDate, setReversalDate] = useState(new Date().toISOString().slice(0, 10));
  const [reversalOperationId, setReversalOperationId] = useState('');
  const [reversing, setReversing] = useState(false);

  const purchasePayables = payablesCrud.data.filter((item) =>
    item.type === 'payable' && item.purchaseOrderId && payableRemaining(item) > 0.005);
  const payablesForSupplier = (supplier: Supplier) => purchasePayables.filter((item) =>
    (item.supplierId != null && String(item.supplierId) === String(supplier.id))
    || String(item.supplierName ?? item.party).trim() === supplier.name.trim());
  const supplierRows = suppliersCrud.data.map((supplier) => {
    const related = payablesCrud.data.filter((item) =>
      item.type === 'payable' && item.purchaseOrderId
      && ((item.supplierId != null && String(item.supplierId) === String(supplier.id))
        || String(item.supplierName ?? item.party).trim() === supplier.name.trim()));
    const total = related.reduce((sum, item) => sum + Number(item.amount), 0);
    const paid = related.reduce((sum, item) => sum + Number(item.paid), 0);
    return { supplier, total, paid, remaining: Math.max(0, total - paid), payables: related };
  });
  const activePayables = paymentSupplier ? payablesForSupplier(paymentSupplier) : [];
  const allocatedTotal = activePayables.reduce((sum, item) => sum + (Number(allocations[String(item.id)]) || 0), 0);

  const loadPaymentHistory = useCallback(async () => {
    if (!canUseAccounting) return;
    setPaymentsLoading(true);
    try {
      const response = await fetch('/api/accounting/supplier-payments', {
        credentials: 'include',
        headers: { 'X-Wudooh-Data-Generation': String(currentUser?.dataGeneration ?? '') },
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'تعذر تحميل سجل دفعات الموردين');
      setSupplierPayments(Array.isArray(payload.payments) ? payload.payments : []);
    } catch (error) {
      toast({
        title: 'تعذر تحميل سجل الدفعات',
        description: error instanceof Error ? error.message : 'أعد المحاولة.',
        variant: 'destructive',
      });
    } finally {
      setPaymentsLoading(false);
    }
  }, [canUseAccounting, currentUser?.dataGeneration, toast]);

  useEffect(() => {
    void loadPaymentHistory();
  }, [loadPaymentHistory]);

  const openPayment = (supplier: Supplier) => {
    const related = payablesForSupplier(supplier);
    setPaymentSupplier(supplier);
    setPaymentDate(new Date().toISOString().slice(0, 10));
    setPaymentMethod('bank');
    setReference('');
    setOperationId(crypto.randomUUID());
    setAllocations(Object.fromEntries(related.map((item) => [String(item.id), ''])));
  };

  const submitPayment = async (event: FormEvent) => {
    event.preventDefault();
    if (!currentUser || !paymentSupplier) return;
    const selected = activePayables
      .map((item) => ({ payableId: Number(item.id), amount: Number(allocations[String(item.id)]) }))
      .filter((item) => Number.isFinite(item.amount) && item.amount > 0);
    if (!selected.length) {
      toast({ title: 'أدخل مبلغاً لذمة واحدة على الأقل', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch('/api/accounting/supplier-payments', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Wudooh-Data-Generation': String(currentUser.dataGeneration),
          'Idempotency-Key': operationId || crypto.randomUUID(),
        },
        body: JSON.stringify({
          supplierId: Number(paymentSupplier.id),
          supplierName: paymentSupplier.name,
          paymentDate,
          paymentMethod,
          reference,
          allocations: selected,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 409 && payload.error?.includes('تغيّرت بيانات المنشأة')) {
          window.dispatchEvent(new Event('wudooh:stale-data-generation'));
        }
        throw new Error(payload.error || 'تعذر تسجيل سداد المورد');
      }
      toast({ title: 'تم تسجيل سداد المورد وتحديث الذمم' });
      setPaymentSupplier(null);
      setAllocations({});
      await Promise.all([payablesCrud.load(), purchaseOrdersCrud.load(), loadPaymentHistory()]);
    } catch (error) {
      toast({
        title: 'تعذر تسجيل السداد',
        description: error instanceof Error ? error.message : 'أعد المحاولة.',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const openReversal = (payment: SupplierPayment) => {
    setReversingPayment(payment);
    setReversalReason('');
    setReversalDate(new Date().toISOString().slice(0, 10));
    setReversalOperationId(crypto.randomUUID());
  };

  const submitReversal = async (event: FormEvent) => {
    event.preventDefault();
    if (!currentUser || !reversingPayment) return;
    if (reversalReason.trim().length < 3) {
      toast({ title: 'أدخل سبباً واضحاً لعكس الدفعة', variant: 'destructive' });
      return;
    }
    setReversing(true);
    try {
      const response = await fetch(`/api/accounting/supplier-payments/${reversingPayment.id}/reverse`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Wudooh-Data-Generation': String(currentUser.dataGeneration),
          'Idempotency-Key': reversalOperationId || crypto.randomUUID(),
        },
        body: JSON.stringify({ reason: reversalReason.trim(), effectiveDate: reversalDate }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 409 && payload.error?.includes('تغيّرت بيانات المنشأة')) {
          window.dispatchEvent(new Event('wudooh:stale-data-generation'));
        }
        throw new Error(payload.error || 'تعذر عكس دفعة المورد');
      }
      toast({ title: 'تم عكس الدفعة وإعادة فتح الذمم المرتبطة' });
      setReversingPayment(null);
      await Promise.all([payablesCrud.load(), purchaseOrdersCrud.load(), loadPaymentHistory()]);
    } catch (error) {
      toast({
        title: 'تعذر عكس الدفعة',
        description: error instanceof Error ? error.message : 'أعد المحاولة.',
        variant: 'destructive',
      });
    } finally {
      setReversing(false);
    }
  };

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-black text-slate-900">أرصدة الموردين</h2>
        <p className="text-sm text-slate-500">الأرصدة ناتجة عن استلامات أوامر الشراء الآجلة، والسداد يوزع على الذمم المحددة.</p>
      </div>
      {!canUseAccounting ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          عرض الذمم وتسجيل السداد يتطلب صلاحية المحاسبة.
        </div>
      ) : payablesCrud.loading || purchaseOrdersCrud.loading ? (
        <div className="flex h-24 items-center justify-center rounded-xl border border-slate-100 bg-white">
          <LoaderCircle className="h-5 w-5 animate-spin text-teal-600" />
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-100 bg-white shadow-sm">
          <Table className="min-w-[720px]">
            <TableHeader>
              <TableRow>
                <TableHead>المورد</TableHead>
                <TableHead>إجمالي الذمم</TableHead>
                <TableHead>المدفوع</TableHead>
                <TableHead>المتبقي</TableHead>
                <TableHead>أوامر مفتوحة</TableHead>
                <TableHead className="text-left">الإجراء</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {supplierRows.map(({ supplier, total, paid, remaining, payables }) => (
                <TableRow key={supplier.id} data-testid={`supplier-balance-row-${supplier.id}`}>
                  <TableCell className="font-bold text-slate-900">{supplier.name}</TableCell>
                  <TableCell>{formatCurrency(total)}</TableCell>
                  <TableCell className="font-bold text-emerald-700">{formatCurrency(paid)}</TableCell>
                  <TableCell className="font-black text-rose-700" data-testid={`supplier-remaining-${supplier.id}`}>
                    {formatCurrency(remaining)}
                  </TableCell>
                  <TableCell>{payables.filter((item) => payableRemaining(item) > 0.005).length}</TableCell>
                  <TableCell className="text-left">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={remaining <= 0.005}
                      onClick={() => openPayment(supplier)}
                      data-testid={`button-pay-supplier-${supplier.id}`}
                    >
                      <CreditCard className="ml-2 h-4 w-4" />
                      تسجيل سداد
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!supplierRows.length && (
                <TableRow><TableCell colSpan={6} className="h-20 text-center text-slate-500">لا يوجد موردون.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-black text-slate-900">سجل دفعات الموردين</h2>
          <p className="text-sm text-slate-500">راجع كل دفعة وتوزيعها على الذمم، واعكس الدفعة الخاطئة من دون تعديل القيد الأصلي.</p>
        </div>
        {paymentsLoading ? (
          <div className="flex h-20 items-center justify-center rounded-xl border border-slate-100 bg-white">
            <LoaderCircle className="h-5 w-5 animate-spin text-teal-600" />
          </div>
        ) : (
          <div className="overflow-x-auto rounded-2xl border border-slate-100 bg-white shadow-sm">
            <Table className="min-w-[920px]">
              <TableHeader>
                <TableRow>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>المورد</TableHead>
                  <TableHead>المبلغ</TableHead>
                  <TableHead>طريقة السداد</TableHead>
                  <TableHead>التوزيعات</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead className="text-left">الإجراء</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {supplierPayments.map((payment) => (
                  <TableRow key={payment.id} data-testid={`supplier-payment-row-${payment.id}`}>
                    <TableCell className="whitespace-nowrap">{payment.paymentDate}</TableCell>
                    <TableCell className="font-bold">{payment.supplierName}</TableCell>
                    <TableCell className="font-black">{formatCurrency(Number(payment.amount))}</TableCell>
                    <TableCell>{payment.paymentMethod === 'bank' ? 'البنك' : 'الصندوق'}</TableCell>
                    <TableCell>
                      <div className="space-y-1 text-xs">
                        {payment.allocations.map((allocation) => (
                          <div key={allocation.payableId}>
                            <span className="font-bold">{allocation.purchaseOrderNumber ?? `ذمة #${allocation.payableId}`}</span>
                            <span className="text-slate-500"> — {formatCurrency(Number(allocation.amount))}</span>
                          </div>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      {payment.status === 'reversed' ? (
                        <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700">معكوسة</span>
                      ) : (
                        <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700">مرحّلة</span>
                      )}
                    </TableCell>
                    <TableCell className="text-left">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={payment.status === 'reversed'}
                        onClick={() => openReversal(payment)}
                        data-testid={`button-reverse-supplier-payment-${payment.id}`}
                      >
                        عكس الدفعة
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!supplierPayments.length && (
                  <TableRow><TableCell colSpan={7} className="h-20 text-center text-slate-500">لا توجد دفعات موردين.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <Dialog open={Boolean(paymentSupplier)} onOpenChange={(open) => { if (!open) setPaymentSupplier(null); }}>
        <DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>تسجيل سداد للمورد {paymentSupplier?.name}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitPayment} className="space-y-5 py-2">
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="supplier-payment-date">تاريخ السداد</Label>
                <Input id="supplier-payment-date" type="date" required value={paymentDate} onChange={(event) => setPaymentDate(event.target.value)} data-testid="input-supplier-payment-date" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="supplier-payment-method">حساب السداد</Label>
                <select id="supplier-payment-method" className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as 'cash' | 'bank')} data-testid="select-supplier-payment-method">
                  <option value="bank">البنك</option>
                  <option value="cash">الصندوق</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="supplier-payment-reference">مرجع اختياري</Label>
                <Input id="supplier-payment-reference" value={reference} onChange={(event) => setReference(event.target.value)} placeholder="رقم التحويل أو السند" data-testid="input-supplier-payment-reference" />
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>توزيع مبلغ السداد</Label>
                <Button type="button" size="sm" variant="ghost" onClick={() => setAllocations(Object.fromEntries(activePayables.map((item) => [String(item.id), String(payableRemaining(item))])))}>
                  سداد كل الأرصدة
                </Button>
              </div>
              <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                {activePayables.map((payable) => {
                  const order = purchaseOrdersCrud.data.find((item) => String(item.id) === String(payable.purchaseOrderId));
                  const remaining = payableRemaining(payable);
                  return (
                    <div key={payable.id} className="grid items-center gap-3 rounded-lg bg-white p-3 sm:grid-cols-[1fr_140px]">
                      <div>
                        <p className="font-bold text-slate-900">{order?.orderNumber ?? payable.reference}</p>
                        <p className="text-xs text-slate-500">الرصيد المتبقي: {formatCurrency(remaining)}</p>
                      </div>
                      <Input
                        type="number"
                        min="0"
                        max={remaining}
                        step="0.01"
                        value={allocations[String(payable.id)] ?? ''}
                        onChange={(event) => setAllocations((current) => ({ ...current, [String(payable.id)]: event.target.value }))}
                        placeholder="0.00"
                        data-testid={`input-payable-allocation-${payable.id}`}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center justify-between rounded-xl bg-slate-900 px-4 py-3 text-white">
              <span className="font-bold">إجمالي السداد</span>
              <span className="text-lg font-black" data-testid="supplier-payment-total">{formatCurrency(allocatedTotal)}</span>
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setPaymentSupplier(null)}>إلغاء</Button>
              <Button type="submit" disabled={submitting || allocatedTotal <= 0} data-testid="button-submit-supplier-payment">
                {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : 'حفظ السداد'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={Boolean(reversingPayment)} onOpenChange={(open) => { if (!open) setReversingPayment(null); }}>
        <DialogContent dir="rtl" className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>عكس دفعة المورد {reversingPayment?.reference ? `— ${reversingPayment.reference}` : ''}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitReversal} className="space-y-5 py-2">
            <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
              سيُنشأ قيد عكسي مستقل وتُعاد مبالغ التوزيع إلى الذمم. لا يمكن العكس إذا وُجدت تسوية لاحقة أو كانت الفترة مقفلة.
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="supplier-payment-reversal-date">تاريخ العكس</Label>
                <Input id="supplier-payment-reversal-date" type="date" required value={reversalDate} onChange={(event) => setReversalDate(event.target.value)} data-testid="input-supplier-payment-reversal-date" />
              </div>
              <div className="space-y-2">
                <Label>مبلغ الدفعة</Label>
                <div className="flex h-10 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-black">{formatCurrency(Number(reversingPayment?.amount ?? 0))}</div>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="supplier-payment-reversal-reason">سبب العكس</Label>
              <Input id="supplier-payment-reversal-reason" required minLength={3} maxLength={1000} value={reversalReason} onChange={(event) => setReversalReason(event.target.value)} placeholder="مثال: تم تسجيل التحويل على المورد الخطأ" data-testid="input-supplier-payment-reversal-reason" />
            </div>
            <DialogFooter className="gap-2">
              <Button type="button" variant="outline" onClick={() => setReversingPayment(null)}>إلغاء</Button>
              <Button type="submit" disabled={reversing || reversalReason.trim().length < 3} data-testid="button-submit-supplier-payment-reversal">
                {reversing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : 'تأكيد عكس الدفعة'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
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
  const [attachmentOrder, setAttachmentOrder] = useState<PurchaseOrder | null>(null);

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
    const tax = items.reduce((sum, item) => {
      const product = productsCrud.data.find((candidate) => String(candidate.id) === String(item.productId));
      const configuredRate = Number(product?.vatRate);
      const rate = [0, 5, 15].includes(configuredRate) ? configuredRate / 100 : vatRate;
      return sum + (Number(item.quantity) * Number(item.unitCostExVat) * rate);
    }, 0);
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
      <div className="flex flex-wrap justify-end gap-2">
        <TransferDialog tableName="purchaseOrders" title="أوامر الشراء" importEnabled={false} />
        <Dialog open={open} onOpenChange={(isOpen) => { setOpen(isOpen); if (!isOpen) setClientOperationId(''); }}>
          <DialogTrigger asChild>
            <Button className="gap-2 bg-teal-600 hover:bg-teal-700" data-testid="btn-create-purchase-receipt">
              <Plus className="h-4 w-4" /> استلام مباشر
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
            <DialogHeader><DialogTitle>استلام مباشر دون أمر شراء مسبق</DialogTitle></DialogHeader>
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
                  <span>الضريبة (حسب المنتج)</span>
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
                <TableHead className="w-16">مرفقات</TableHead>
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
                  <TableCell>
                    <Button type="button" variant="ghost" size="icon" onClick={() => setAttachmentOrder(order)} aria-label="مرفقات أمر الشراء" data-testid={`button-attachments-purchase-order-${order.id}`}>
                      <Paperclip className="h-4 w-4 text-teal-700" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!purchaseOrdersCrud.data.length && (
                <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-slate-500">
                    لا توجد أوامر شراء مسجلة.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
      <Dialog open={Boolean(attachmentOrder)} onOpenChange={(nextOpen) => { if (!nextOpen) setAttachmentOrder(null); }}>
        <DialogContent dir="rtl" className="sm:max-w-xl">
          <DialogHeader><DialogTitle>مرفقات أمر الشراء {attachmentOrder?.orderNumber}</DialogTitle></DialogHeader>
          <AttachmentsPanel tableName="purchaseOrders" recordId={attachmentOrder?.id} />
        </DialogContent>
      </Dialog>
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
          <p className="mt-2 text-sm text-slate-500">لإنشاء أمر ومتابعة استلامه الجزئي استخدم <Link href="/purchase-orders" className="font-bold text-indigo-700 hover:underline">وحدة أوامر الشراء</Link>.</p>
        </div>
      </div>
      
      <Tabs defaultValue="suppliers" className="w-full">
        <TabsList className="mb-6 grid w-full grid-cols-2 md:w-[400px]">
          <TabsTrigger value="suppliers">الموردون</TabsTrigger>
          <TabsTrigger value="orders">الاستلام المباشر</TabsTrigger>
        </TabsList>
        
        <TabsContent value="suppliers">
          <div className="space-y-8">
            <SupplierPaymentsPanel />
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
          </div>
        </TabsContent>
        
        <TabsContent value="orders">
          <PurchaseReceiptsWorkspace />
        </TabsContent>
      </Tabs>
    </div>
  );
}