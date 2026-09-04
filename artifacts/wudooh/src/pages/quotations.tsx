import { useState, useMemo } from 'react';
import { ClipboardList, ChevronRight, Plus, LoaderCircle, Trash2, Pencil, RefreshCw, AlertCircle } from 'lucide-react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCrud } from '@/hooks/use-crud';
import { useStore } from '@/context/store';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { addLocalDays, todayLocalDate } from '@/lib/date';

type Product = { id: number | string; name: string; sellPrice?: number; price?: number; unitPrice?: number; vatRate?: number | string };
type Customer = { id: number | string; name: string };

type QuotationItem = {
  description: string;
  productId?: number | string;
  quantity: number;
  unitPrice: number;
  discount: number;
  vatRate: number;
  lineNet: number;
  vatAmount: number;
  total: number;
};

type Quotation = {
  id: number;
  number: string;
  customerId?: number | string;
  customerName: string;
  issueDate: string;
  expiryDate: string;
  status: 'draft' | 'sent' | 'accepted' | 'rejected' | 'expired';
  items: QuotationItem[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  notes?: string;
  sourceQuotationId?: number | string;
  convertedInvoiceId?: number | string;
  createdAt: string;
};

const statusColors: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700',
  sent: 'bg-blue-50 text-blue-700',
  accepted: 'bg-emerald-50 text-emerald-700',
  rejected: 'bg-rose-50 text-rose-700',
  expired: 'bg-amber-50 text-amber-700',
};

const statusLabels: Record<string, string> = {
  draft: 'مسودة',
  sent: 'مرسل',
  accepted: 'مقبول',
  rejected: 'مرفوض',
  expired: 'منتهي',
};

const defaultForm = () => ({
  number: '',
  customerId: '',
  customerName: '',
  issueDate: todayLocalDate(),
  expiryDate: addLocalDays(30),
  status: 'draft' as Quotation['status'],
  notes: '',
});

const defaultItem = (): QuotationItem => ({
  description: '',
  productId: '',
  quantity: 1,
  unitPrice: 0,
  discount: 0,
  vatRate: 15,
  lineNet: 0,
  vatAmount: 0,
  total: 0,
});

export default function Quotations() {
  const { currentUser } = useStore();
  const { toast } = useToast();

  const quotationsCrud = useCrud<Quotation>('quotations');
  const productsCrud = useCrud<Product>('products');
  const customersCrud = useCrud<Customer>('customers');

  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [convertingId, setConvertingId] = useState<number | null>(null);
  const [filter, setFilter] = useState('all');

  const [form, setForm] = useState(defaultForm());
  const [items, setItems] = useState<QuotationItem[]>([defaultItem()]);

  const resetForm = () => {
    setForm(defaultForm());
    setItems([defaultItem()]);
    setEditingId(null);
  };

  const openEdit = (q: Quotation) => {
    setForm({
      number: q.number,
      customerId: q.customerId ? String(q.customerId) : '',
      customerName: q.customerName,
      issueDate: q.issueDate,
      expiryDate: q.expiryDate,
      status: q.status,
      notes: q.notes || '',
    });
    setItems(q.items && q.items.length > 0 ? q.items : [defaultItem()]);
    setEditingId(q.id);
    setOpen(true);
  };

  const updateItem = (index: number, field: keyof QuotationItem, value: any) => {
    const newItems = [...items];
    const item = { ...newItems[index], [field]: value };

    const qty = Number(item.quantity) || 0;
    const price = Number(item.unitPrice) || 0;
    const discount = Number(item.discount) || 0;
    const vatRate = Number(item.vatRate) || 0;

    const lineGross = qty * price;
    item.lineNet = Math.max(0, lineGross - discount);
    item.vatAmount = item.lineNet * (vatRate / 100);
    item.total = item.lineNet + item.vatAmount;

    newItems[index] = item;
    setItems(newItems);
  };

  const handleProductSelect = (index: number, productId: string) => {
    const product = productsCrud.data.find((p) => String(p.id) === productId);
    setItems((current) => current.map((item, itemIndex) => {
      if (itemIndex !== index) return item;
      const next = product
        ? {
            ...item,
            productId: product.id,
            description: product.name,
            unitPrice: Number(product.sellPrice ?? product.price ?? product.unitPrice ?? 0),
            vatRate: product.vatRate !== undefined ? Number(product.vatRate) : 15,
          }
        : { ...item, productId: '' };
      const gross = Number(next.quantity) * Number(next.unitPrice);
      const lineNet = Math.max(0, gross - Number(next.discount));
      const vatAmount = lineNet * Number(next.vatRate) / 100;
      return { ...next, lineNet, vatAmount, total: lineNet + vatAmount };
    }));
  };

  const handleCustomerSelect = (customerId: string) => {
    const customer = customersCrud.data.find((c) => String(c.id) === customerId);
    setForm((f) => ({
      ...f,
      customerId,
      customerName: customer ? customer.name : f.customerName,
    }));
  };

  const calculateTotals = () => {
    const subtotal = items.reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);
    const totalDiscount = items.reduce((sum, item) => sum + Number(item.discount), 0);
    const tax = items.reduce((sum, item) => sum + item.vatAmount, 0);
    const total = items.reduce((sum, item) => sum + item.total, 0);
    return { subtotal, discount: totalDiscount, tax, total };
  };

  const totals = calculateTotals();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.customerName) {
      toast({ title: 'يجب تحديد العميل', variant: 'destructive' });
      return;
    }
    if (items.length === 0) {
      toast({ title: 'يجب إضافة منتج واحد على الأقل', variant: 'destructive' });
      return;
    }
    if (form.issueDate > form.expiryDate) {
      toast({ title: 'تاريخ الانتهاء يجب أن يأتي بعد تاريخ الإصدار', variant: 'destructive' });
      return;
    }
    if (items.some((item) => !item.description.trim() || Number(item.quantity) <= 0 || Number(item.unitPrice) < 0 || Number(item.discount) < 0 || Number(item.discount) > Number(item.quantity) * Number(item.unitPrice) || ![0, 5, 15].includes(Number(item.vatRate)))) {
      toast({ title: 'تحقق من بيانات الأصناف والخصم ونسبة الضريبة', variant: 'destructive' });
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        ...form,
        number: undefined,
        customerId: form.customerId ? Number(form.customerId) : undefined,
        items: items.map((item) => ({
          description: item.description,
          productId: item.productId ? Number(item.productId) : undefined,
          quantity: Number(item.quantity),
          unitPrice: Number(item.unitPrice),
          discount: Number(item.discount),
          vatRate: Number(item.vatRate),
          lineNet: Number(item.lineNet),
          vatAmount: Number(item.vatAmount),
          total: Number(item.total),
        })),
        ...totals,
      };

      const success = editingId
        ? await quotationsCrud.update(editingId, payload)
        : await quotationsCrud.create(payload);
      if (!success) return;

      setOpen(false);
      resetForm();
    } catch (err) {
      toast({ title: 'خطأ', description: err instanceof Error ? err.message : 'تعذر الحفظ', variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  const convertToInvoice = async (quotation: Quotation) => {
    if (!currentUser) return;
    setConvertingId(quotation.id);
    try {
      const res = await fetch(`/api/data/quotations/${quotation.id}/convert`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Wudooh-Data-Generation': String(currentUser.dataGeneration),
        },
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'تعذر تحويل العرض إلى فاتورة');
      }
      toast({ title: 'تم التحويل بنجاح', description: 'تم إنشاء الفاتورة في المبيعات.' });
      await quotationsCrud.load();
    } catch (err) {
      toast({ title: 'تعذر التحويل', description: err instanceof Error ? err.message : 'تأكد من صحة العرض', variant: 'destructive' });
    } finally {
      setConvertingId(null);
    }
  };

  const filteredQuotations = useMemo(() => {
    if (filter === 'all') return quotationsCrud.data;
    if (filter === 'pending') return quotationsCrud.data.filter((q) => q.status === 'draft' || q.status === 'sent');
    if (filter === 'accepted') return quotationsCrud.data.filter((q) => q.status === 'accepted' || q.convertedInvoiceId);
    if (filter === 'expired') {
      const today = todayLocalDate();
      return quotationsCrud.data.filter((q) => q.status === 'expired' || q.status === 'rejected' || (q.expiryDate < today && q.status !== 'accepted'));
    }
    return quotationsCrud.data.filter((q) => q.status === filter);
  }, [filter, quotationsCrud.data]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ar-SA', { style: 'currency', currency: 'SAR' }).format(amount);
  };

  return (
    <div className="flex flex-col gap-6" data-testid="page-quotations">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link href="/dashboard" className="mb-2 inline-flex items-center gap-1.5 text-sm font-bold text-slate-500 transition hover:text-slate-900">
            <ChevronRight className="h-4 w-4" /> لوحة التحكم
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-black text-slate-900 sm:text-3xl">
            <ClipboardList className="h-8 w-8 text-emerald-600" />
            عروض الأسعار
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Dialog open={open} onOpenChange={(isOpen) => { setOpen(isOpen); if (!isOpen) resetForm(); }}>
            <DialogTrigger asChild>
              <Button className="gap-2 bg-emerald-600 hover:bg-emerald-700" data-testid="btn-create-quotation">
                <Plus className="h-4 w-4" /> إنشاء عرض سعر
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" dir="rtl">
              <DialogHeader><DialogTitle>{editingId ? 'تعديل عرض السعر' : 'إنشاء عرض سعر جديد'}</DialogTitle></DialogHeader>
              <form onSubmit={submit} className="flex flex-col gap-6 py-4">
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="space-y-2 lg:col-span-1">
                    <Label>رقم العرض</Label>
                    <Input value={editingId ? form.number : 'يُولّد تلقائياً عند الحفظ'} readOnly className="bg-slate-100 text-slate-500" data-testid="input-quotation-number" />
                  </div>
                  <div className="space-y-2 lg:col-span-2">
                    <Label>العميل</Label>
                    <div className="flex gap-2">
                      <select
                        className="flex h-9 w-1/3 rounded-md border border-input bg-background px-3 text-sm"
                        value={form.customerId}
                        onChange={(e) => handleCustomerSelect(e.target.value)}
                      >
                        <option value="">تحديد عميل...</option>
                        {customersCrud.data.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                      <Input
                        required
                        className="w-2/3 h-9"
                        placeholder="اسم العميل"
                        value={form.customerName}
                        onChange={(e) => setForm({ ...form, customerName: e.target.value })}
                        data-testid="input-quotation-customer"
                      />
                    </div>
                  </div>
                  <div className="space-y-2 lg:col-span-1">
                    <Label>الحالة</Label>
                    <select
                      className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      value={form.status}
                      onChange={(e) => setForm({ ...form, status: e.target.value as Quotation['status'] })}
                    >
                      <option value="draft">مسودة</option>
                      <option value="sent">مرسل</option>
                      <option value="rejected">مرفوض</option>
                    </select>
                  </div>
                  <div className="space-y-2 lg:col-span-2">
                    <Label>تاريخ الإصدار</Label>
                    <Input required type="date" value={form.issueDate} onChange={(e) => setForm({ ...form, issueDate: e.target.value })} data-testid="input-quotation-issue-date" />
                  </div>
                  <div className="space-y-2 lg:col-span-2">
                    <Label>تاريخ الانتهاء</Label>
                    <Input required type="date" value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} data-testid="input-quotation-expiry-date" />
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="font-bold text-slate-900">الأصناف</h3>
                    <Button type="button" variant="outline" size="sm" onClick={() => setItems([...items, defaultItem()])}>
                      <Plus className="mr-2 h-4 w-4" /> إضافة صنف
                    </Button>
                  </div>
                  <div className="space-y-3">
                    {items.map((item, index) => (
                      <div key={index} className="grid grid-cols-12 gap-2 items-end border-b border-slate-200 pb-4 last:border-0 last:pb-0">
                        <div className="col-span-12 sm:col-span-3 space-y-1">
                          <Label className="text-xs">المنتج / الوصف</Label>
                          <select
                            className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm mb-1"
                            value={item.productId || ''}
                            onChange={(e) => handleProductSelect(index, e.target.value)}
                          >
                            <option value="">اختيار منتج...</option>
                            {productsCrud.data.map((p) => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                          </select>
                          <Input required className="h-9" placeholder="وصف الصنف" value={item.description} onChange={(e) => updateItem(index, 'description', e.target.value)} data-testid={`input-quotation-description-${index}`} />
                        </div>
                        <div className="col-span-4 sm:col-span-2 space-y-1">
                          <Label className="text-xs">الكمية</Label>
                          <Input required type="number" min="0.01" step="any" className="h-9" value={item.quantity} onChange={(e) => updateItem(index, 'quantity', e.target.value)} data-testid={`input-quotation-quantity-${index}`} />
                        </div>
                        <div className="col-span-4 sm:col-span-2 space-y-1">
                          <Label className="text-xs">السعر</Label>
                          <Input required type="number" min="0" step="any" className="h-9" value={item.unitPrice} onChange={(e) => updateItem(index, 'unitPrice', e.target.value)} data-testid={`input-quotation-price-${index}`} />
                        </div>
                        <div className="col-span-4 sm:col-span-2 space-y-1">
                          <Label className="text-xs">الخصم</Label>
                          <Input type="number" min="0" step="any" className="h-9" value={item.discount} onChange={(e) => updateItem(index, 'discount', e.target.value)} data-testid={`input-quotation-discount-${index}`} />
                        </div>
                        <div className="col-span-6 sm:col-span-2 space-y-1">
                          <Label className="text-xs">الضريبة %</Label>
                          <Input type="number" min="0" step="any" className="h-9" value={item.vatRate} onChange={(e) => updateItem(index, 'vatRate', e.target.value)} data-testid={`input-quotation-vat-${index}`} />
                        </div>
                        <div className="col-span-6 sm:col-span-1 flex justify-center pb-0.5">
                          <Button type="button" variant="ghost" size="icon" className="text-rose-500 h-9 w-9 hover:bg-rose-100" onClick={() => { if (items.length > 1) setItems(items.filter((_, i) => i !== index)); }}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label>ملاحظات وشروط العرض</Label>
                    <textarea
                      className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      placeholder="الشروط والأحكام الخاصة..."
                      value={form.notes}
                      onChange={(e) => setForm({ ...form, notes: e.target.value })}
                    />
                  </div>
                  <div className="rounded-xl bg-emerald-950 p-5 text-white space-y-3">
                    <div className="flex justify-between text-sm text-emerald-200/80">
                      <span>المجموع الفرعي</span>
                      <span>{formatCurrency(totals.subtotal)}</span>
                    </div>
                    <div className="flex justify-between text-sm text-emerald-200/80">
                      <span>إجمالي الخصم</span>
                      <span>{formatCurrency(totals.discount)}</span>
                    </div>
                    <div className="flex justify-between text-sm text-emerald-200/80">
                      <span>إجمالي الضريبة</span>
                      <span>{formatCurrency(totals.tax)}</span>
                    </div>
                    <div className="flex justify-between text-lg font-bold border-t border-emerald-800 pt-3">
                      <span>الإجمالي الكلي</span>
                      <span>{formatCurrency(totals.total)}</span>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-4">
                  <Button type="button" variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
                  <Button type="submit" className="bg-emerald-600 hover:bg-emerald-700" disabled={submitting || items.length === 0} data-testid="btn-save-quotation">
                    {submitting ? <LoaderCircle className="animate-spin" /> : 'حفظ عرض السعر'}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Tabs value={filter} onValueChange={setFilter} className="w-full">
        <TabsList className="mb-6 grid w-full grid-cols-2 sm:flex sm:w-auto">
          <TabsTrigger value="all">الكل</TabsTrigger>
          <TabsTrigger value="pending">معلق (مسودة / مرسل)</TabsTrigger>
          <TabsTrigger value="accepted">مقبول</TabsTrigger>
          <TabsTrigger value="expired">منتهي / مرفوض</TabsTrigger>
        </TabsList>
      </Tabs>

      {quotationsCrud.error && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {quotationsCrud.error}
        </div>
      )}
      {quotationsCrud.loading ? (
        <div className="flex h-32 items-center justify-center rounded-2xl border border-slate-100 bg-white">
          <LoaderCircle className="h-6 w-6 animate-spin text-emerald-600" />
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <Table className="min-w-[800px]">
              <TableHeader>
                <TableRow>
                  <TableHead>رقم العرض</TableHead>
                  <TableHead>العميل</TableHead>
                  <TableHead>تاريخ الإصدار</TableHead>
                  <TableHead>تاريخ الانتهاء</TableHead>
                  <TableHead>الإجمالي</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead className="text-left">الإجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredQuotations.map((q) => (
                  <TableRow key={q.id} data-testid={`row-quotation-${q.id}`}>
                    <TableCell className="font-medium text-slate-900">{q.number}</TableCell>
                    <TableCell>{q.customerName}</TableCell>
                    <TableCell>{q.issueDate}</TableCell>
                    <TableCell>
                      {q.expiryDate}
                      {q.expiryDate < todayLocalDate() && q.status !== 'accepted' && q.status !== 'expired' && (
                        <span className="mr-2 inline-flex items-center gap-1 text-xs font-bold text-rose-600" data-testid={`quotation-expired-${q.id}`}>
                          <AlertCircle className="h-3.5 w-3.5" /> منتهي الصلاحية
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="font-bold">{formatCurrency(q.total)}</TableCell>
                    <TableCell>
                      <span className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${statusColors[q.status]}`}>
                        {statusLabels[q.status] || q.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-left">
                      <div className="flex items-center justify-end gap-1.5">
                        {q.status !== 'accepted' && q.status !== 'rejected' && q.status !== 'expired' && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1.5 text-emerald-600 border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700"
                            onClick={() => convertToInvoice(q)}
                            disabled={convertingId === q.id}
                            data-testid={`btn-convert-${q.id}`}
                          >
                            {convertingId === q.id ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                            <span className="hidden sm:inline">تحويل لفاتورة</span>
                          </Button>
                        )}
                        {!q.convertedInvoiceId && q.status !== 'accepted' && <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-slate-500 hover:text-slate-900"
                            onClick={() => openEdit(q)}
                            data-testid={`btn-edit-${q.id}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-rose-500 hover:bg-rose-50 hover:text-rose-700"
                            onClick={() => {
                              if (confirm('هل أنت متأكد من حذف عرض السعر؟')) {
                                void quotationsCrud.remove(q.id);
                              }
                            }}
                            data-testid={`btn-delete-${q.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {!filteredQuotations.length && (
                  <TableRow>
                    <TableCell colSpan={7} className="h-24 text-center text-slate-500">
                      لا توجد عروض أسعار مسجلة في هذا التصنيف.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}
    </div>
  );
}