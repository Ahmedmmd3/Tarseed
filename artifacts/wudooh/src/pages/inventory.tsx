import { useState, type FormEvent } from 'react';
import { Boxes, ChevronRight, LoaderCircle, Plus } from 'lucide-react';
import { Link } from 'wouter';
import { CrudTable } from '@/components/crud-table';
import { useCrud } from '@/hooks/use-crud';
import { useToast } from '@/hooks/use-toast';
import { useStore } from '@/context/store';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

type CatalogRecord = { id: number | string; name?: string; status?: string; cost?: number | string };
type Balance = { id: number | string; productId: number | string; warehouseId: number | string; quantity: number | string };
type Transfer = { id: number | string; productId: number | string; fromWarehouseId: number | string; toWarehouseId: number | string; quantity: number | string; status?: string; date?: string; note?: string };
type Adjustment = { id: number | string; productId: number | string; warehouseId: number | string; actualQuantity: number | string; delta?: number | string; reason?: string; date?: string };

function labelFor(records: CatalogRecord[], id: string | number): string {
  return records.find((record) => String(record.id) === String(id))?.name ?? `#${id}`;
}

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('ar-SA', { style: 'currency', currency: 'SAR', maximumFractionDigits: 0 }).format(amount);
}

function InventoryBalances({ data, products, warehouses, loading }: { data: Balance[]; products: CatalogRecord[]; warehouses: CatalogRecord[]; loading: boolean }) {
  if (loading) return <LoadingState />;
  return (
    <div className="rounded-2xl border border-slate-100 bg-white shadow-sm">
      <Table className="min-w-[480px]">
        <TableHeader><TableRow><TableHead>المنتج</TableHead><TableHead>الموقع</TableHead><TableHead>الكمية</TableHead><TableHead>القيمة التقريبية</TableHead></TableRow></TableHeader>
        <TableBody>
          {data.map((item) => {
            const product = products.find(p => String(p.id) === String(item.productId));
            const cost = product?.cost ? Number(product.cost) : 0;
            const approxValue = cost * Number(item.quantity);
            return (
              <TableRow key={item.id}>
                <TableCell>{product?.name ?? `#${item.productId}`}</TableCell>
                <TableCell>{labelFor(warehouses, item.warehouseId)}</TableCell>
                <TableCell className="font-bold text-teal-700">{item.quantity}</TableCell>
                <TableCell className="text-slate-500">{cost > 0 ? formatCurrency(approxValue) : '—'}</TableCell>
              </TableRow>
            );
          })}
          {!data.length && <EmptyRow columns={4} text="لا توجد أرصدة ظاهرة ضمن نطاق مواقعك." />}
        </TableBody>
      </Table>
    </div>
  );
}

function TransferWorkspace({ transfers, products, warehouses, loading, onChanged }: {
  transfers: Transfer[]; products: CatalogRecord[]; warehouses: CatalogRecord[]; loading: boolean; onChanged: () => Promise<void>;
}) {
  const { currentUser } = useStore();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ productId: '', fromWarehouseId: '', toWarehouseId: '', quantity: '', date: new Date().toISOString().slice(0, 10), note: '' });
  const activeWarehouses = warehouses.filter((warehouse) => warehouse.status !== 'inactive');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!currentUser) return;
    setSubmitting(true);
    try {
      const response = await fetch('/api/inventory/transfers', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Wudooh-Data-Generation': String(currentUser.dataGeneration) },
        body: JSON.stringify({ ...form, productId: Number(form.productId), fromWarehouseId: Number(form.fromWarehouseId), toWarehouseId: Number(form.toWarehouseId), quantity: Number(form.quantity) }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'تعذر إنشاء تحويل المخزون.');
      setOpen(false);
      setForm({ productId: '', fromWarehouseId: '', toWarehouseId: '', quantity: '', date: new Date().toISOString().slice(0, 10), note: '' });
      await onChanged();
      toast({ title: 'تم تسجيل التحويل بانتظار الاعتماد.' });
    } catch (error) {
      toast({ title: 'تعذر تسجيل التحويل', description: error instanceof Error ? error.message : 'أعد المحاولة.', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  const transition = async (transfer: Transfer, action: 'approve' | 'cancel' | 'receive') => {
    if (!currentUser) return;
    setSubmitting(true);
    try {
      const response = await fetch(`/api/inventory/transfers/${transfer.id}/${action}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-Wudooh-Data-Generation': String(currentUser.dataGeneration) },
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) {
        if (response.status === 409 && payload.error?.includes('تغيّرت بيانات المنشأة')) window.dispatchEvent(new Event('wudooh:stale-data-generation'));
        throw new Error(payload.error ?? 'تعذر تحديث حالة التحويل.');
      }
      await onChanged();
      toast({ title: action === 'approve' ? 'تم اعتماد التحويل.' : action === 'receive' ? 'تم استلام التحويل.' : 'تم إلغاء التحويل.' });
    } catch (error) {
      toast({ title: 'تعذر تحديث التحويل', description: error instanceof Error ? error.message : 'أعد المحاولة.', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button className="gap-2 bg-teal-600 hover:bg-teal-700" data-testid="button-create-transfer"><Plus className="h-4 w-4" />تحويل مخزون</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>تحويل مخزون جديد</DialogTitle></DialogHeader>
            <form onSubmit={submit} className="grid grid-cols-1 gap-4 py-4 sm:grid-cols-2">
              <FieldSelect id="transfer-product" label="المنتج" value={form.productId} onChange={(productId) => setForm({ ...form, productId })} options={products} required />
              <FieldNumber id="transfer-quantity" label="الكمية" value={form.quantity} onChange={(quantity) => setForm({ ...form, quantity })} min={1} />
              <FieldSelect id="transfer-source" label="الموقع المصدر" value={form.fromWarehouseId} onChange={(fromWarehouseId) => setForm({ ...form, fromWarehouseId })} options={activeWarehouses} required />
              <FieldSelect id="transfer-destination" label="الموقع الوجهة" value={form.toWarehouseId} onChange={(toWarehouseId) => setForm({ ...form, toWarehouseId })} options={activeWarehouses} required />
              <FieldDate id="transfer-date" label="التاريخ" value={form.date} onChange={(date) => setForm({ ...form, date })} />
              <div className="space-y-2"><Label htmlFor="transfer-note">ملاحظة</Label><Input id="transfer-note" value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} /></div>
              <div className="col-span-full flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setOpen(false)}>إلغاء</Button><Button type="submit" disabled={submitting}>{submitting ? <LoaderCircle className="animate-spin" /> : 'تسجيل التحويل'}</Button></div>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      {loading ? <LoadingState /> : <div className="rounded-2xl border border-slate-100 bg-white shadow-sm"><Table className="min-w-[760px]"><TableHeader><TableRow><TableHead>المنتج</TableHead><TableHead>من</TableHead><TableHead>إلى</TableHead><TableHead>الكمية</TableHead><TableHead>الحالة</TableHead><TableHead>الإجراء</TableHead></TableRow></TableHeader><TableBody>
        {transfers.map((transfer) => <TableRow key={transfer.id}><TableCell>{labelFor(products, transfer.productId)}</TableCell><TableCell>{labelFor(warehouses, transfer.fromWarehouseId)}</TableCell><TableCell>{labelFor(warehouses, transfer.toWarehouseId)}</TableCell><TableCell>{transfer.quantity}</TableCell><TableCell>{transfer.status === 'pending' ? 'بانتظار الاعتماد' : transfer.status === 'approved' ? 'معتمد' : transfer.status === 'received' ? 'مستلم' : 'ملغي'}</TableCell><TableCell>{transfer.status === 'pending' ? <div className="flex gap-2"><Button size="sm" variant="outline" disabled={submitting} onClick={() => void transition(transfer, 'approve')}>اعتماد</Button><Button size="sm" variant="outline" disabled={submitting} className="text-rose-700" onClick={() => void transition(transfer, 'cancel')}>إلغاء</Button></div> : transfer.status === 'approved' ? <Button size="sm" variant="outline" disabled={submitting} onClick={() => void transition(transfer, 'receive')}>استلام</Button> : <span className="text-xs text-slate-400">لا توجد إجراءات</span>}</TableCell></TableRow>)}
        {!transfers.length && <EmptyRow columns={6} text="لا توجد تحويلات ضمن مواقعك." />}
      </TableBody></Table></div>}
    </div>
  );
}

function AdjustmentWorkspace({ adjustments, products, warehouses, loading, onChanged }: {
  adjustments: Adjustment[]; products: CatalogRecord[]; warehouses: CatalogRecord[]; loading: boolean; onChanged: () => Promise<void>;
}) {
  const { currentUser } = useStore();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ productId: '', warehouseId: '', actualQuantity: '', reason: '', date: new Date().toISOString().slice(0, 10) });
  const activeWarehouses = warehouses.filter((warehouse) => warehouse.status !== 'inactive');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!currentUser) return;
    setSubmitting(true);
    try {
      const response = await fetch('/api/inventory/adjustments', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Wudooh-Data-Generation': String(currentUser.dataGeneration) },
        body: JSON.stringify({ ...form, productId: Number(form.productId), warehouseId: Number(form.warehouseId), actualQuantity: Number(form.actualQuantity) }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'تعذر تنفيذ التسوية.');
      setOpen(false);
      await onChanged();
      toast({ title: 'تمت تسوية المخزون وتحديث الرصيد.' });
    } catch (error) {
      toast({ title: 'تعذرت التسوية', description: error instanceof Error ? error.message : 'أعد المحاولة.', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button className="gap-2 bg-teal-600 hover:bg-teal-700" data-testid="button-create-adjustment"><Plus className="h-4 w-4" />تسوية مخزون</Button></DialogTrigger><DialogContent><DialogHeader><DialogTitle>تسوية مخزون</DialogTitle></DialogHeader><form onSubmit={submit} className="grid grid-cols-1 gap-4 py-4 sm:grid-cols-2"><FieldSelect id="adjustment-product" label="المنتج" value={form.productId} onChange={(productId) => setForm({ ...form, productId })} options={products} required /><FieldSelect id="adjustment-warehouse" label="الموقع" value={form.warehouseId} onChange={(warehouseId) => setForm({ ...form, warehouseId })} options={activeWarehouses} required /><FieldNumber id="adjustment-quantity" label="الكمية الفعلية" value={form.actualQuantity} onChange={(actualQuantity) => setForm({ ...form, actualQuantity })} min={0} /><FieldDate id="adjustment-date" label="التاريخ" value={form.date} onChange={(date) => setForm({ ...form, date })} /><div className="col-span-full space-y-2"><Label htmlFor="adjustment-reason">سبب التسوية</Label><Input id="adjustment-reason" required value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} /></div><div className="col-span-full flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setOpen(false)}>إلغاء</Button><Button type="submit" disabled={submitting}>{submitting ? <LoaderCircle className="animate-spin" /> : 'اعتماد التسوية'}</Button></div></form></DialogContent></Dialog></div>
      {loading ? <LoadingState /> : <div className="rounded-2xl border border-slate-100 bg-white shadow-sm"><Table className="min-w-[760px]"><TableHeader><TableRow><TableHead>المنتج</TableHead><TableHead>الموقع</TableHead><TableHead>الكمية الفعلية</TableHead><TableHead>الفرق</TableHead><TableHead>السبب</TableHead><TableHead>التاريخ</TableHead></TableRow></TableHeader><TableBody>{adjustments.map((adjustment) => <TableRow key={adjustment.id}><TableCell>{labelFor(products, adjustment.productId)}</TableCell><TableCell>{labelFor(warehouses, adjustment.warehouseId)}</TableCell><TableCell>{adjustment.actualQuantity}</TableCell><TableCell>{adjustment.delta ?? '—'}</TableCell><TableCell>{adjustment.reason || '—'}</TableCell><TableCell>{adjustment.date || '—'}</TableCell></TableRow>)}{!adjustments.length && <EmptyRow columns={6} text="لا توجد تسويات ضمن مواقعك." />}</TableBody></Table></div>}
    </div>
  );
}

function FieldSelect({ id, label, value, onChange, options, required = false }: { id: string; label: string; value: string; onChange: (value: string) => void; options: CatalogRecord[]; required?: boolean }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label><select id={id} required={required} className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm" value={value} onChange={(event) => onChange(event.target.value)}><option value="">اختر {label}</option>{options.map((option) => <option key={option.id} value={option.id}>{option.name ?? `#${option.id}`}</option>)}</select></div>;
}

function FieldNumber({ id, label, value, onChange, min }: { id: string; label: string; value: string; onChange: (value: string) => void; min: number }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label><Input id={id} required type="number" min={min} value={value} onChange={(event) => onChange(event.target.value)} /></div>;
}

function FieldDate({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label><Input id={id} required type="date" value={value} onChange={(event) => onChange(event.target.value)} /></div>;
}

function LoadingState() {
  return <div className="flex h-32 items-center justify-center rounded-2xl border border-slate-100 bg-white"><LoaderCircle className="h-6 w-6 animate-spin text-teal-600" /></div>;
}

function EmptyRow({ columns, text }: { columns: number; text: string }) {
  return <TableRow><TableCell colSpan={columns} className="h-24 text-center text-slate-500">{text}</TableCell></TableRow>;
}

export default function Inventory() {
  const { currentUser } = useStore();
  const products = useCrud<CatalogRecord>('products');
  const warehouses = useCrud<CatalogRecord>('warehouses');
  const balances = useCrud<Balance>('inventoryBalances');
  const transfers = useCrud<Transfer>('stockTransfers');
  const adjustments = useCrud<Adjustment>('stockAdjustments');
  const refreshInventory = async () => { await Promise.all([products.load(), balances.load(), transfers.load(), adjustments.load()]); };

  return (
    <div className="flex flex-col gap-6" data-testid="page-inventory">
      <div><Link href="/dashboard" className="mb-2 inline-flex items-center gap-1.5 text-sm font-bold text-slate-500 transition hover:text-slate-900"><ChevronRight className="h-4 w-4" />لوحة التحكم</Link><h1 className="flex items-center gap-2 text-2xl font-black text-slate-900 sm:text-3xl"><Boxes className="h-8 w-8 text-violet-600" />المخزون والمنتجات</h1><p className="mt-2 text-sm text-slate-500">الأرصدة تُقرأ من مواقع التشغيل، وتُعدّل فقط عبر التسويات والتحويلات المعتمدة.</p></div>
      <Tabs defaultValue="products" className="w-full">
        <div className="mb-6 overflow-x-auto pb-1"><TabsList className="flex h-auto w-max min-w-full justify-start"><TabsTrigger value="products" className="min-h-11 shrink-0 px-4">المنتجات</TabsTrigger><TabsTrigger value="warehouses" className="min-h-11 shrink-0 px-4">المواقع</TabsTrigger><TabsTrigger value="balances" className="min-h-11 shrink-0 px-4">الأرصدة</TabsTrigger><TabsTrigger value="transfers" className="min-h-11 shrink-0 px-4">التحويلات</TabsTrigger><TabsTrigger value="adjustments" className="min-h-11 shrink-0 px-4">التسويات</TabsTrigger></TabsList></div>
        <TabsContent value="products"><CrudTable table="products" title="إدارة المنتجات" fields={[{ key: 'name', label: 'الاسم', required: true }, { key: 'barcode', label: 'الباركود' }, { key: 'sku', label: 'رمز المنتج' }, { key: 'price', label: 'سعر البيع', type: 'number' }, { key: 'cost', label: 'سعر التكلفة', type: 'number' }, { key: 'vatRate', label: 'ضريبة المنتج', type: 'select', required: true, options: [{ label: 'لا توجد ضريبة', value: 0 }, { label: 'ضريبة 5٪', value: 5 }, { label: 'ضريبة 15٪', value: 15 }] }]} /></TabsContent>
        <TabsContent value="warehouses"><CrudTable table="warehouses" title="مواقع التشغيل" readOnly={currentUser?.roleId !== 'owner'} fields={[{ key: 'name', label: 'اسم الموقع', required: true }, { key: 'location', label: 'العنوان أو الوصف' }, { key: 'status', label: 'الحالة', type: 'select', options: [{ label: 'نشط', value: 'active' }, { label: 'غير نشط', value: 'inactive' }] }]} /></TabsContent>
        <TabsContent value="balances"><InventoryBalances data={balances.data} products={products.data} warehouses={warehouses.data} loading={balances.loading} /></TabsContent>
        <TabsContent value="transfers"><TransferWorkspace transfers={transfers.data} products={products.data} warehouses={warehouses.data} loading={transfers.loading} onChanged={refreshInventory} /></TabsContent>
        <TabsContent value="adjustments"><AdjustmentWorkspace adjustments={adjustments.data} products={products.data} warehouses={warehouses.data} loading={adjustments.loading} onChanged={refreshInventory} /></TabsContent>
      </Tabs>
    </div>
  );
}