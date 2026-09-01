import { useState, useMemo, FormEvent } from 'react';
import {
  ShoppingCart,
  ChevronRight,
  Plus,
  LoaderCircle,
  Trash2,
  Pencil,
  PackageCheck,
  Eye,
  Building2,
  Ban,
  ReceiptText,
  Printer,
  Share2,
} from 'lucide-react';
import { Link } from 'wouter';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useCrud } from '@/hooks/use-crud';
import { useStore } from '@/context/store';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

type Product = {
  id: number | string;
  name: string;
  cost?: number;
  unitPrice?: number;
  vatRate?: number | string;
};
type Supplier = { id: number | string; name: string };
type Warehouse = { id: number | string; name: string };

type PurchaseOrderItem = {
  productId: number | string;
  productName: string;
  name?: string;
  quantity: number;
  receivedQuantity: number;
  unitCost: number;
  unitCostExVat?: number;
  vatRate: number;
  lineNet: number;
  vatAmount: number;
  total: number;
  lineGross?: number;
};

type PurchaseOrder = {
  id: number;
  orderNumber: string;
  supplierId?: number | string;
  supplierName: string;
  issueDate: string;
  expectedDate?: string;
  warehouseId: number | string;
  warehouseName?: string;
  status: 'draft' | 'sent' | 'partial' | 'received' | 'cancelled';
  paymentStatus: 'unpaid' | 'partial' | 'paid';
  paymentMethod: 'cash' | 'credit';
  dueDate?: string;
  items: PurchaseOrderItem[];
  subtotal: number;
  vat: number;
  total: number;
  notes?: string;
  createdAt: string;
};

type PublicPurchaseOrderDocument = Pick<
  PurchaseOrder,
  | 'orderNumber'
  | 'supplierName'
  | 'warehouseName'
  | 'issueDate'
  | 'expectedDate'
  | 'status'
  | 'items'
  | 'subtotal'
  | 'vat'
  | 'total'
  | 'notes'
>;

const statusColors: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700',
  sent: 'bg-indigo-50 text-indigo-700',
  partial: 'bg-amber-50 text-amber-700',
  received: 'bg-emerald-50 text-emerald-700',
  cancelled: 'bg-rose-50 text-rose-700',
};

const statusLabels: Record<string, string> = {
  draft: 'مسودة',
  sent: 'مرسل',
  partial: 'مستلم جزئياً',
  received: 'مكتمل',
  cancelled: 'ملغي',
};

const paymentStatusLabels: Record<string, string> = {
  unpaid: 'غير مدفوع',
  partial: 'مدفوع جزئياً',
  paid: 'مدفوع',
};

const defaultForm = () => ({
  orderNumber: '',
  supplierId: '',
  supplierName: '',
  issueDate: new Date().toISOString().slice(0, 10),
  expectedDate: '',
  warehouseId: '',
  status: 'draft' as 'draft' | 'sent',
  paymentMethod: 'credit' as 'cash' | 'credit',
  dueDate: '',
  notes: '',
});

const defaultItem = (): PurchaseOrderItem => ({
  productId: '',
  productName: '',
  quantity: 1,
  receivedQuantity: 0,
  unitCost: 0,
  vatRate: 15,
  lineNet: 0,
  vatAmount: 0,
  total: 0,
});

const formatCurrencyValue = (amount: number) =>
  new Intl.NumberFormat('ar-SA', {
    style: 'currency',
    currency: 'SAR',
  }).format(Number(amount) || 0);

const formatDocumentDate = (value?: string) => {
  if (!value) return '-';
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('ar-SA-u-ca-gregory', {
        dateStyle: 'medium',
      }).format(date);
};

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const itemDisplayName = (item: PurchaseOrderItem) =>
  item.productName || item.name || 'صنف';

const itemDisplayUnitCost = (item: PurchaseOrderItem) =>
  Number(item.unitCost ?? item.unitCostExVat) || 0;

const itemDisplayTotal = (item: PurchaseOrderItem) =>
  Number(item.total ?? item.lineGross) || 0;

function buildPurchaseOrderPrintHtml(order: PublicPurchaseOrderDocument) {
  const statusLabel = statusLabels[order.status] || order.status;
  const itemRows = order.items
    .map(
      (item, index) => `
        <tr>
          <td class="item-name"><span class="item-number">${index + 1}</span>${escapeHtml(item.productName)}</td>
          <td>${escapeHtml(item.quantity)}</td>
          <td>${escapeHtml(formatCurrencyValue(item.unitCost))}</td>
          <td>${escapeHtml(item.vatRate)}٪</td>
          <td class="amount">${escapeHtml(formatCurrencyValue(item.total))}</td>
        </tr>`,
    )
    .join('');

  return `<!doctype html>
<html lang="ar" dir="rtl">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>أمر شراء ${escapeHtml(order.orderNumber)}</title>
    <style>
      @page { size: A4; margin: 14mm; }
      :root { color-scheme: light; font-family: Cairo, Tahoma, Arial, sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; background: #eef2f7; color: #17233d; font-family: Cairo, Tahoma, Arial, sans-serif; }
      .page { width: 210mm; min-height: 267mm; margin: 24px auto; padding: 18mm; background: #fff; box-shadow: 0 16px 40px rgba(10, 19, 40, .12); }
      .header { display: flex; align-items: flex-start; justify-content: space-between; gap: 24px; padding-bottom: 24px; border-bottom: 3px solid #0d47d9; }
      .brand { color: #0d47d9; font-size: 25px; font-weight: 900; letter-spacing: -.03em; }
      .brand-subtitle { margin-top: 4px; color: #65738c; font-size: 11px; }
      .document-title { color: #0a1328; font-size: 25px; font-weight: 900; }
      .document-number { margin-top: 5px; color: #0d47d9; font-size: 14px; font-weight: 700; }
      .meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 24px 0; }
      .meta-card { min-height: 70px; padding: 12px 14px; border: 1px solid #dce3ed; border-radius: 10px; background: #f7f9fc; }
      .meta-label { margin-bottom: 5px; color: #65738c; font-size: 10px; font-weight: 700; }
      .meta-value { color: #17233d; font-size: 13px; font-weight: 800; }
      .status { display: inline-flex; padding: 5px 10px; border-radius: 999px; background: #eaf1ff; color: #0d47d9; font-size: 11px; font-weight: 800; }
      .section-title { margin: 24px 0 10px; color: #0a1328; font-size: 15px; font-weight: 900; }
      table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 11px; }
      th { padding: 11px 9px; background: #0a1328; color: #fff; text-align: right; font-weight: 800; }
      th:first-child { width: 40%; }
      th:nth-child(2) { width: 12%; }
      th:nth-child(3) { width: 18%; }
      th:nth-child(4) { width: 12%; }
      th:last-child { width: 18%; }
      td { padding: 12px 9px; border-bottom: 1px solid #e3e8f0; vertical-align: middle; }
      tr:last-child td { border-bottom: 2px solid #b8c4d5; }
      .item-name { font-weight: 800; }
      .item-number { display: inline-flex; align-items: center; justify-content: center; width: 21px; height: 21px; margin-left: 8px; border-radius: 50%; background: #eaf1ff; color: #0d47d9; font-size: 10px; }
      .amount { font-weight: 800; white-space: nowrap; }
      .summary { width: min(100%, 260px); margin-top: 18px; margin-right: auto; padding: 15px 17px; border: 1px solid #dce3ed; border-radius: 12px; background: #f7f9fc; }
      .summary-row { display: flex; justify-content: space-between; gap: 20px; padding: 5px 0; color: #65738c; font-size: 11px; }
      .summary-total { margin-top: 8px; padding-top: 10px; border-top: 2px solid #0d47d9; color: #0a1328; font-size: 15px; font-weight: 900; }
      .notes { margin-top: 24px; padding: 13px 15px; border-right: 4px solid #00a3ff; border-radius: 8px; background: #f2f8ff; color: #40516c; font-size: 11px; line-height: 1.9; white-space: pre-wrap; }
      .footer { margin-top: 35px; padding-top: 14px; border-top: 1px solid #e3e8f0; color: #8a96a9; font-size: 10px; text-align: center; }
      @media (max-width: 700px) {
        body { background: #fff; }
        .page { width: 100%; min-height: auto; margin: 0; padding: 20px 16px; box-shadow: none; }
        .header { gap: 12px; padding-bottom: 18px; }
        .brand, .document-title { font-size: 19px; }
        .meta { grid-template-columns: repeat(2, 1fr); margin: 18px 0; }
        .meta-card { min-height: 64px; padding: 10px; }
        table { font-size: 10px; }
        th, td { padding: 9px 5px; }
        .item-number { width: 18px; height: 18px; margin-left: 4px; }
        .summary { width: 100%; }
      }
      @media print {
        body { background: #fff; }
        .page { width: auto; min-height: auto; margin: 0; padding: 0; box-shadow: none; }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <header class="header">
        <div>
          <div class="brand">ترصيد</div>
          <div class="brand-subtitle">نظام الكاشير والمحاسبة</div>
        </div>
        <div>
          <div class="document-title">أمر شراء</div>
          <div class="document-number">${escapeHtml(order.orderNumber)}</div>
        </div>
      </header>
      <section class="meta" aria-label="بيانات أمر الشراء">
        <div class="meta-card"><div class="meta-label">المورد</div><div class="meta-value">${escapeHtml(order.supplierName)}</div></div>
        <div class="meta-card"><div class="meta-label">موقع التسليم</div><div class="meta-value">${escapeHtml(order.warehouseName || '-')}</div></div>
        <div class="meta-card"><div class="meta-label">تاريخ الإصدار</div><div class="meta-value">${escapeHtml(formatDocumentDate(order.issueDate))}</div></div>
        <div class="meta-card"><div class="meta-label">التسليم المتوقع</div><div class="meta-value">${escapeHtml(formatDocumentDate(order.expectedDate))}</div></div>
        <div class="meta-card"><div class="meta-label">حالة الأمر</div><div class="meta-value"><span class="status">${escapeHtml(statusLabel)}</span></div></div>
      </section>
      <h2 class="section-title">تفاصيل الأصناف</h2>
      <table>
        <thead><tr><th>الصنف / الوصف</th><th>الكمية</th><th>سعر الوحدة</th><th>الضريبة</th><th>الإجمالي</th></tr></thead>
        <tbody>${itemRows}</tbody>
      </table>
      <section class="summary" aria-label="ملخص المبالغ">
        <div class="summary-row"><span>المجموع الفرعي</span><strong>${escapeHtml(formatCurrencyValue(order.subtotal))}</strong></div>
        <div class="summary-row"><span>ضريبة القيمة المضافة</span><strong>${escapeHtml(formatCurrencyValue(order.vat))}</strong></div>
        <div class="summary-row summary-total"><span>الإجمالي الكلي</span><strong>${escapeHtml(formatCurrencyValue(order.total))}</strong></div>
      </section>
      ${order.notes ? `<div class="notes"><strong>ملاحظات المورد</strong><br />${escapeHtml(order.notes)}</div>` : ''}
      <footer class="footer">هذا المستند صادر من نظام ترصيد — يرجى مراجعة الأصناف والكميات عند الاستلام.</footer>
    </main>
  </body>
</html>`;
}

export default function PurchaseOrders() {
  const { currentUser } = useStore();
  const { toast } = useToast();

  const purchaseOrdersCrud = useCrud<PurchaseOrder>('purchaseOrders');
  const productsCrud = useCrud<Product>('products');
  const suppliersCrud = useCrud<Supplier>('suppliers');
  const warehousesCrud = useCrud<Warehouse>('warehouses');

  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [filter, setFilter] = useState('all');

  const [viewingOrder, setViewingOrder] = useState<PurchaseOrder | null>(null);
  const [printingOrderId, setPrintingOrderId] = useState<number | null>(null);
  const [sharingOrderId, setSharingOrderId] = useState<number | null>(null);

  const [receiveOrder, setReceiveOrder] = useState<PurchaseOrder | null>(null);
  const [receiptDate, setReceiptDate] = useState(new Date().toISOString().slice(0, 10));
  const [receiptOperationId, setReceiptOperationId] = useState('');
  const [receiveItems, setReceiveItems] = useState<
    { productId: string; productName: string; quantity: number; max: number }[]
  >([]);

  const [form, setForm] = useState(defaultForm());
  const [items, setItems] = useState<PurchaseOrderItem[]>([defaultItem()]);

  const resetForm = () => {
    setForm(defaultForm());
    setItems([defaultItem()]);
    setEditingId(null);
  };

  const openEdit = (po: PurchaseOrder) => {
    setForm({
      orderNumber: po.orderNumber || '',
      supplierId: po.supplierId ? String(po.supplierId) : '',
      supplierName: po.supplierName || '',
      issueDate: po.issueDate || '',
      expectedDate: po.expectedDate || '',
      warehouseId: po.warehouseId ? String(po.warehouseId) : '',
      status: (po.status === 'draft' || po.status === 'sent' ? po.status : 'draft') as
        | 'draft'
        | 'sent',
      paymentMethod: po.paymentMethod || 'credit',
      dueDate: po.dueDate || '',
      notes: po.notes || '',
    });
    setItems(
      po.items && po.items.length > 0
        ? po.items.map((i) => ({ ...i }))
        : [defaultItem()]
    );
    setEditingId(po.id);
    setOpen(true);
  };

  const openReceive = (po: PurchaseOrder) => {
    setReceiveOrder(po);
    setReceiptDate(new Date().toISOString().slice(0, 10));
    setReceiptOperationId(crypto.randomUUID());
    setReceiveItems(
      po.items
        .filter((i) => i.quantity > i.receivedQuantity)
        .map((i) => ({
          productId: String(i.productId),
          productName: i.productName,
          quantity: i.quantity - i.receivedQuantity,
          max: i.quantity - i.receivedQuantity,
        }))
    );
  };

  const updateItem = (index: number, field: keyof PurchaseOrderItem, value: any) => {
    const newItems = [...items];
    const item = { ...newItems[index], [field]: value };

    const qty = Number(item.quantity) || 0;
    const cost = Number(item.unitCost) || 0;
    const vatRate = Number(item.vatRate) || 0;

    item.lineNet = qty * cost;
    item.vatAmount = item.lineNet * (vatRate / 100);
    item.total = item.lineNet + item.vatAmount;

    newItems[index] = item;
    setItems(newItems);
  };

  const handleProductSelect = (index: number, productId: string) => {
    const product = productsCrud.data.find((p) => String(p.id) === productId);
    setItems((current) =>
      current.map((item, itemIndex) => {
        if (itemIndex !== index) return item;
        const next = product
          ? {
              ...item,
              productId: product.id,
              productName: product.name,
              unitCost: Number(product.cost ?? product.unitPrice ?? 0),
              vatRate: product.vatRate !== undefined ? Number(product.vatRate) : 15,
            }
          : { ...item, productId: '', productName: '' };

        const lineNet = Number(next.quantity) * Number(next.unitCost);
        const vatAmount = lineNet * (Number(next.vatRate) / 100);
        return { ...next, lineNet, vatAmount, total: lineNet + vatAmount };
      })
    );
  };

  const handleSupplierSelect = (supplierId: string) => {
    const supplier = suppliersCrud.data.find((s) => String(s.id) === supplierId);
    setForm((f) => ({
      ...f,
      supplierId,
      supplierName: supplier ? supplier.name : f.supplierName,
    }));
  };

  const calculateTotals = () => {
    const subtotal = items.reduce(
      (sum, item) => sum + item.quantity * item.unitCost,
      0
    );
    const vat = items.reduce((sum, item) => sum + item.vatAmount, 0);
    const total = subtotal + vat;
    return { subtotal, vat, total };
  };

  const totals = calculateTotals();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.supplierName) {
      toast({ title: 'يجب تحديد المورد', variant: 'destructive' });
      return;
    }
    if (!form.warehouseId) {
      toast({ title: 'يجب تحديد المستودع', variant: 'destructive' });
      return;
    }
    if (items.length === 0) {
      toast({ title: 'يجب إضافة منتج واحد على الأقل', variant: 'destructive' });
      return;
    }
    if (
      items.some(
        (item) =>
          !item.productId ||
          Number(item.quantity) <= 0 ||
          Number(item.unitCost) < 0 ||
          ![0, 5, 15].includes(Number(item.vatRate))
      )
    ) {
      toast({
        title: 'تحقق من بيانات الأصناف ونسبة الضريبة',
        variant: 'destructive',
      });
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        ...form,
        supplierId: form.supplierId ? Number(form.supplierId) : undefined,
        warehouseId: Number(form.warehouseId),
        items: items.map((item) => ({
          productId: Number(item.productId),
          productName: item.productName,
          quantity: Number(item.quantity),
          unitCost: Number(item.unitCost),
          vatRate: Number(item.vatRate),
          lineNet: Number(item.lineNet),
          vatAmount: Number(item.vatAmount),
          total: Number(item.total),
        })),
        ...totals,
      };

      const success = editingId
        ? await purchaseOrdersCrud.update(editingId, payload)
        : await purchaseOrdersCrud.create(payload);
      if (!success) return;

      setOpen(false);
      resetForm();
    } catch (err) {
      toast({
        title: 'خطأ',
        description: err instanceof Error ? err.message : 'تعذر الحفظ',
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const submitReceive = async (e: FormEvent) => {
    e.preventDefault();
    if (!receiveOrder || !currentUser) return;

    const validItemsToReceive = receiveItems.filter((i) => i.quantity > 0);
    if (validItemsToReceive.length === 0) {
      toast({
        title: 'يجب استلام كمية أكبر من صفر لأحد الأصناف على الأقل',
        variant: 'destructive',
      });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/data/purchaseOrders/${receiveOrder.id}/receive`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Wudooh-Data-Generation': String(currentUser.dataGeneration),
          'Idempotency-Key': receiptOperationId || crypto.randomUUID(),
        },
        body: JSON.stringify({
          receiptDate,
          items: validItemsToReceive.map((i) => ({
            productId: Number(i.productId),
            quantity: i.quantity,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409 && data.error?.includes('تغيّرت بيانات المنشأة')) {
          window.dispatchEvent(new Event('wudooh:stale-data-generation'));
        }
        throw new Error(data.error || 'تعذر تسجيل الاستلام');
      }

      toast({ title: 'تم تسجيل الاستلام بنجاح' });
      setReceiveOrder(null);
      setReceiptOperationId('');
      await purchaseOrdersCrud.load();
    } catch (err: any) {
      toast({ title: 'خطأ', description: err.message, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  const cancelOrder = async (id: number) => {
    if (!confirm('هل أنت متأكد من إلغاء أمر الشراء؟')) return;
    await purchaseOrdersCrud.update(id, { status: 'cancelled' });
  };

  const filteredOrders = useMemo(() => {
    if (filter === 'all') return purchaseOrdersCrud.data;
    if (filter === 'pending')
      return purchaseOrdersCrud.data.filter(
        (o) => o.status === 'draft' || o.status === 'sent'
      );
    if (filter === 'partial')
      return purchaseOrdersCrud.data.filter((o) => o.status === 'partial');
    if (filter === 'received')
      return purchaseOrdersCrud.data.filter((o) => o.status === 'received');
    if (filter === 'cancelled')
      return purchaseOrdersCrud.data.filter((o) => o.status === 'cancelled');
    return purchaseOrdersCrud.data;
  }, [filter, purchaseOrdersCrud.data]);

  const formatCurrency = (amount: number) => {
    return formatCurrencyValue(amount);
  };

  const printOrder = async (order: PurchaseOrder) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast({
        title: 'تعذر فتح مستند الطباعة',
        description: 'اسمح بالنوافذ المنبثقة لهذا الموقع ثم حاول مرة أخرى.',
        variant: 'destructive',
      });
      return;
    }

    setPrintingOrderId(order.id);
    printWindow.document.write('<!doctype html><html lang="ar" dir="rtl"><body style="font-family:Tahoma,Arial,sans-serif;padding:32px">جارٍ تجهيز مستند أمر الشراء...</body></html>');
    printWindow.document.close();
    try {
      const response = await fetch(`/api/data/purchaseOrders/${order.id}/print`, {
        credentials: 'include',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.document) {
        throw new Error(payload.error || 'تعذر تجهيز مستند الطباعة');
      }
      printWindow.document.open();
      printWindow.document.write(buildPurchaseOrderPrintHtml(payload.document as PublicPurchaseOrderDocument));
      printWindow.document.close();
      window.setTimeout(() => {
        printWindow.focus();
        printWindow.print();
      }, 250);
    } catch (error) {
      printWindow.close();
      toast({
        title: 'تعذر تجهيز المستند',
        description: error instanceof Error ? error.message : 'حاول مرة أخرى.',
        variant: 'destructive',
      });
    } finally {
      setPrintingOrderId(null);
    }
  };

  const shareOrder = async (order: PurchaseOrder) => {
    setSharingOrderId(order.id);
    try {
      const response = await fetch(`/api/data/purchaseOrders/${order.id}/print`, {
        credentials: 'include',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.document) {
        throw new Error(payload.error || 'تعذر تجهيز بيانات المشاركة');
      }
      const document = payload.document as PublicPurchaseOrderDocument;
      const itemSummary = document.items
        .map((item) => `- ${itemDisplayName(item)}: ${Number(item.quantity) || 0}`)
        .join('\n');
      const text = [
        `أمر شراء ${document.orderNumber}`,
        `المورد: ${document.supplierName}`,
        `موقع التسليم: ${document.warehouseName || '-'}`,
        `تاريخ الإصدار: ${formatDocumentDate(document.issueDate)}`,
        `الحالة: ${statusLabels[document.status] || document.status}`,
        '',
        'الأصناف:',
        itemSummary,
        '',
        `الإجمالي الكلي: ${formatCurrencyValue(document.total)}`,
      ].join('\n');
      const shareCapableNavigator = navigator as Navigator & {
        share?: (data: { title: string; text: string }) => Promise<void>;
      };
      if (shareCapableNavigator.share) {
        await shareCapableNavigator.share({
          title: `أمر شراء ${document.orderNumber}`,
          text,
        });
        toast({ title: 'تم فتح خيارات المشاركة' });
      } else if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        toast({ title: 'تم نسخ ملخص الأمر', description: 'يمكنك لصقه وإرساله للمورد.' });
      } else {
        throw new Error('المشاركة غير مدعومة في هذا المتصفح.');
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      toast({
        title: 'تعذرت مشاركة الأمر',
        description: error instanceof Error ? error.message : 'حاول مرة أخرى.',
        variant: 'destructive',
      });
    } finally {
      setSharingOrderId(null);
    }
  };

  return (
    <div className="flex flex-col gap-6" data-testid="page-purchase-orders">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <Link
            href="/dashboard"
            className="mb-2 inline-flex items-center gap-1.5 text-sm font-bold text-slate-500 transition hover:text-slate-900"
          >
            <ChevronRight className="h-4 w-4" /> لوحة التحكم
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-black text-slate-900 sm:text-3xl">
            <ShoppingCart className="h-8 w-8 text-indigo-600" />
            أوامر الشراء
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/purchases">
            <Button
              variant="outline"
              className="gap-2"
              data-testid="po-btn-suppliers"
            >
              <Building2 className="h-4 w-4 text-slate-500" /> إدارة الموردين
            </Button>
          </Link>
          <Button
            onClick={() => {
              resetForm();
              setOpen(true);
            }}
            className="gap-2 bg-indigo-600 hover:bg-indigo-700"
            data-testid="po-btn-create"
          >
            <Plus className="h-4 w-4" /> أمر شراء جديد
          </Button>
        </div>
      </div>

      <Tabs value={filter} onValueChange={setFilter} className="w-full">
        <TabsList className="mb-6 flex flex-wrap w-full sm:w-auto">
          <TabsTrigger value="all">الكل</TabsTrigger>
          <TabsTrigger value="pending">معلق (مسودة / مرسل)</TabsTrigger>
          <TabsTrigger value="partial">استلام جزئي</TabsTrigger>
          <TabsTrigger value="received">مكتمل</TabsTrigger>
          <TabsTrigger value="cancelled">ملغي</TabsTrigger>
        </TabsList>
      </Tabs>

      {purchaseOrdersCrud.error && (
        <div
          role="alert"
          className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
        >
          {purchaseOrdersCrud.error}
        </div>
      )}
      {purchaseOrdersCrud.loading ? (
        <div className="flex h-32 items-center justify-center rounded-2xl border border-slate-100 bg-white shadow-sm">
          <LoaderCircle className="h-6 w-6 animate-spin text-indigo-600" />
        </div>
      ) : (
        <div className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <Table className="min-w-[850px]">
              <TableHeader className="bg-slate-50/50">
                <TableRow>
                  <TableHead>رقم الأمر</TableHead>
                  <TableHead>المورد</TableHead>
                  <TableHead>تاريخ الإصدار</TableHead>
                  <TableHead>الإجمالي</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>الدفع</TableHead>
                  <TableHead className="text-left">الإجراءات</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOrders.map((po) => (
                  <TableRow key={po.id} data-testid={`po-row-${po.id}`}>
                    <TableCell className="font-medium text-slate-900">
                      {po.orderNumber}
                    </TableCell>
                    <TableCell>
                      <div>{po.supplierName}</div>
                      {po.warehouseName && (
                        <div className="text-xs text-slate-500 mt-0.5">
                          المستودع: {po.warehouseName}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{po.issueDate}</TableCell>
                    <TableCell className="font-bold">
                      {formatCurrency(po.total)}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-bold ${
                          statusColors[po.status]
                        }`}
                      >
                        {statusLabels[po.status] || po.status}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span
                        className={`text-xs font-bold ${
                          po.paymentStatus === 'paid'
                            ? 'text-emerald-600'
                            : po.paymentStatus === 'partial'
                            ? 'text-amber-600'
                            : 'text-slate-500'
                        }`}
                      >
                        {paymentStatusLabels[po.paymentStatus] || po.paymentStatus}
                      </span>
                    </TableCell>
                    <TableCell className="text-left">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50"
                          onClick={() => setViewingOrder(po)}
                          title="عرض التفاصيل"
                          data-testid={`po-btn-view-${po.id}`}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        {(po.status === 'draft' || po.status === 'sent') && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-slate-500 hover:text-slate-900"
                            onClick={() => openEdit(po)}
                            title="تعديل"
                            data-testid={`po-btn-edit-${po.id}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                        )}
                        {(po.status === 'sent' || po.status === 'partial') && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-8 gap-1.5 text-emerald-600 border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700"
                            onClick={() => openReceive(po)}
                            title="استلام"
                            data-testid={`po-btn-receive-${po.id}`}
                          >
                            <PackageCheck className="h-3.5 w-3.5" />
                            <span className="hidden sm:inline">استلام</span>
                          </Button>
                        )}
                        {(po.status === 'draft' || po.status === 'sent') && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-amber-500 hover:bg-amber-50 hover:text-amber-700"
                            onClick={() => cancelOrder(po.id)}
                            title="إلغاء"
                            data-testid={`po-btn-cancel-${po.id}`}
                          >
                            <Ban className="h-4 w-4" />
                          </Button>
                        )}
                        {po.status === 'draft' && (
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-rose-500 hover:bg-rose-50 hover:text-rose-700"
                            onClick={() => {
                              if (confirm('هل أنت متأكد من حذف أمر الشراء؟')) {
                                void purchaseOrdersCrud.remove(po.id);
                              }
                            }}
                            title="حذف"
                            data-testid={`po-btn-delete-${po.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {!filteredOrders.length && (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="h-32 text-center text-slate-500"
                    >
                      لا توجد أوامر شراء مسجلة في هذا التصنيف.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* CREATE / EDIT DIALOG */}
      <Dialog
        open={open}
        onOpenChange={(isOpen) => {
          setOpen(isOpen);
          if (!isOpen) resetForm();
        }}
      >
        <DialogContent
          className="max-w-4xl max-h-[90vh] overflow-y-auto"
          dir="rtl"
        >
          <DialogHeader>
            <DialogTitle className="text-xl">
              {editingId ? 'تعديل أمر الشراء' : 'إنشاء أمر شراء جديد'}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={submit} className="flex flex-col gap-6 py-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-2 lg:col-span-1">
                <Label>رقم الأمر</Label>
                <Input
                  value={editingId ? form.orderNumber : 'يُولّد تلقائياً'}
                  readOnly
                  className="bg-slate-100 text-slate-500"
                  data-testid="po-input-ordernumber"
                />
              </div>
              <div className="space-y-2 lg:col-span-2">
                <Label>المورد</Label>
                <div className="flex gap-2">
                  <select
                    className="flex h-9 w-1/3 rounded-md border border-input bg-background px-3 text-sm"
                    value={form.supplierId}
                    onChange={(e) => handleSupplierSelect(e.target.value)}
                  >
                    <option value="">تحديد مورد...</option>
                    {suppliersCrud.data.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                  <Input
                    required
                    className="w-2/3 h-9"
                    placeholder="اسم المورد"
                    value={form.supplierName}
                    onChange={(e) =>
                      setForm({ ...form, supplierName: e.target.value })
                    }
                    data-testid="po-input-supplier-name"
                  />
                </div>
              </div>
              <div className="space-y-2 lg:col-span-1">
                <Label>المستودع الوجهة</Label>
                <select
                  required
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.warehouseId}
                  onChange={(e) =>
                    setForm({ ...form, warehouseId: e.target.value })
                  }
                  data-testid="po-select-warehouse"
                >
                  <option value="">تحديد المستودع...</option>
                  {warehousesCrud.data.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2 lg:col-span-1">
                <Label>الحالة</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.status}
                  onChange={(e) =>
                    setForm({ ...form, status: e.target.value as 'draft' | 'sent' })
                  }
                >
                  <option value="draft">مسودة</option>
                  <option value="sent">مرسل</option>
                </select>
              </div>
              <div className="space-y-2 lg:col-span-1">
                <Label>طريقة الدفع</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={form.paymentMethod}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      paymentMethod: e.target.value as 'cash' | 'credit',
                    })
                  }
                >
                  <option value="cash">نقدي / فوري</option>
                  <option value="credit">آجل</option>
                </select>
              </div>
              <div className="space-y-2 lg:col-span-1">
                <Label>تاريخ الإصدار</Label>
                <Input
                  required
                  type="date"
                  value={form.issueDate}
                  onChange={(e) =>
                    setForm({ ...form, issueDate: e.target.value })
                  }
                  data-testid="po-input-issue-date"
                />
              </div>
              <div className="space-y-2 lg:col-span-1">
                <Label>تاريخ الاستحقاق (أجل)</Label>
                <Input
                  type="date"
                  disabled={form.paymentMethod !== 'credit'}
                  value={form.dueDate}
                  onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
                  data-testid="po-input-due-date"
                />
              </div>
              <div className="space-y-2 lg:col-span-1">
                <Label>تاريخ الاستلام المتوقع</Label>
                <Input
                  type="date"
                  value={form.expectedDate}
                  onChange={(e) =>
                    setForm({ ...form, expectedDate: e.target.value })
                  }
                  data-testid="po-input-expected-date"
                />
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="font-bold text-slate-900">الأصناف المطلوبة</h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setItems([...items, defaultItem()])}
                >
                  <Plus className="mr-2 h-4 w-4" /> إضافة صنف
                </Button>
              </div>
              <div className="space-y-3">
                {items.map((item, index) => (
                  <div
                    key={index}
                    className="grid grid-cols-12 gap-2 items-end border-b border-slate-200 pb-4 last:border-0 last:pb-0"
                  >
                    <div className="col-span-12 sm:col-span-4 space-y-1">
                      <Label className="text-xs">المنتج / الوصف</Label>
                      <select
                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm mb-1"
                        value={item.productId || ''}
                        onChange={(e) =>
                          handleProductSelect(index, e.target.value)
                        }
                      >
                        <option value="">اختيار منتج...</option>
                        {productsCrud.data.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      <Input
                        required
                        className="h-9"
                        placeholder="اسم المنتج"
                        value={item.productName}
                        onChange={(e) =>
                          updateItem(index, 'productName', e.target.value)
                        }
                        data-testid={`po-item-name-${index}`}
                      />
                    </div>
                    <div className="col-span-4 sm:col-span-2 space-y-1">
                      <Label className="text-xs">الكمية</Label>
                      <Input
                        required
                        type="number"
                        min="0.01"
                        step="any"
                        className="h-9"
                        value={item.quantity || ''}
                        onChange={(e) =>
                          updateItem(index, 'quantity', e.target.value)
                        }
                        data-testid={`po-item-qty-${index}`}
                      />
                    </div>
                    <div className="col-span-4 sm:col-span-2 space-y-1">
                      <Label className="text-xs">التكلفة (الوحدة)</Label>
                      <Input
                        required
                        type="number"
                        min="0"
                        step="any"
                        className="h-9"
                        value={item.unitCost || ''}
                        onChange={(e) =>
                          updateItem(index, 'unitCost', e.target.value)
                        }
                        data-testid={`po-item-cost-${index}`}
                      />
                    </div>
                    <div className="col-span-4 sm:col-span-2 space-y-1">
                      <Label className="text-xs">الضريبة %</Label>
                      <Input
                        type="number"
                        min="0"
                        step="any"
                        className="h-9"
                        value={item.vatRate ?? ''}
                        onChange={(e) =>
                          updateItem(index, 'vatRate', e.target.value)
                        }
                        data-testid={`po-item-vat-${index}`}
                      />
                    </div>
                    <div className="col-span-10 sm:col-span-1 space-y-1">
                      <Label className="text-xs text-slate-500">الإجمالي</Label>
                      <div className="h-9 flex items-center px-1 font-bold text-sm bg-slate-100 rounded-md truncate">
                        {formatCurrency(item.total)}
                      </div>
                    </div>
                    <div className="col-span-2 sm:col-span-1 flex justify-center pb-0.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-rose-500 h-9 w-9 hover:bg-rose-100"
                        onClick={() => {
                          if (items.length > 1)
                            setItems(items.filter((_, i) => i !== index));
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label>ملاحظات أمر الشراء</Label>
                <textarea
                  className="flex min-h-[120px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  placeholder="ملاحظات المورد، الشروط، تفاصيل الشحن..."
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                />
              </div>
              <div className="rounded-xl bg-indigo-950 p-5 text-white space-y-3">
                <div className="flex justify-between text-sm text-indigo-200/80">
                  <span>المجموع الفرعي</span>
                  <span>{formatCurrency(totals.subtotal)}</span>
                </div>
                <div className="flex justify-between text-sm text-indigo-200/80">
                  <span>إجمالي الضريبة</span>
                  <span>{formatCurrency(totals.vat)}</span>
                </div>
                <div className="flex justify-between text-lg font-bold border-t border-indigo-800 pt-3">
                  <span>الإجمالي الكلي</span>
                  <span>{formatCurrency(totals.total)}</span>
                </div>
              </div>
            </div>

            <DialogFooter className="gap-2 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                إلغاء
              </Button>
              <Button
                type="submit"
                className="bg-indigo-600 hover:bg-indigo-700"
                disabled={submitting || items.length === 0}
                data-testid="po-btn-submit-save"
              >
                {submitting ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  'حفظ أمر الشراء'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* DETAILS DIALOG */}
      <Dialog
        open={!!viewingOrder}
        onOpenChange={(isOpen) => !isOpen && setViewingOrder(null)}
      >
        <DialogContent
          className="max-w-4xl max-h-[90vh] overflow-y-auto"
          dir="rtl"
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl font-black text-slate-900">
              <ReceiptText className="h-6 w-6 text-indigo-600" />
              أمر شراء {viewingOrder?.orderNumber}
            </DialogTitle>
          </DialogHeader>
          {viewingOrder && (
            <div className="space-y-6 py-2">
               <div className="flex flex-col gap-2 border-b border-slate-100 pb-4 sm:flex-row sm:justify-end">
                 <Button
                   type="button"
                   variant="outline"
                   className="w-full gap-2 border-indigo-200 text-indigo-700 hover:bg-indigo-50 sm:w-auto"
                   onClick={() => void printOrder(viewingOrder)}
                   disabled={printingOrderId === viewingOrder.id}
                   data-testid={`po-btn-print-${viewingOrder.id}`}
                 >
                   {printingOrderId === viewingOrder.id ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
                   {printingOrderId === viewingOrder.id ? 'جارٍ تجهيز المستند...' : 'طباعة / حفظ PDF'}
                 </Button>
                 <Button
                   type="button"
                   variant="outline"
                   className="w-full gap-2 sm:w-auto"
                   onClick={() => void shareOrder(viewingOrder)}
                   disabled={sharingOrderId === viewingOrder.id}
                   data-testid={`po-btn-share-${viewingOrder.id}`}
                 >
                   {sharingOrderId === viewingOrder.id ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Share2 className="h-4 w-4" />}
                   {sharingOrderId === viewingOrder.id ? 'جارٍ التحضير...' : 'مشاركة مع المورد'}
                 </Button>
               </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-slate-50 p-5 rounded-2xl border border-slate-100 shadow-sm">
                <div>
                  <div className="text-xs text-slate-500 mb-1">المورد</div>
                  <div className="font-bold text-slate-900">
                    {viewingOrder.supplierName}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 mb-1">المستودع</div>
                  <div className="font-bold text-slate-900">
                    {viewingOrder.warehouseName || '-'}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 mb-1">تاريخ الإصدار</div>
                  <div className="font-bold text-slate-900">
                    {viewingOrder.issueDate}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500 mb-1">الحالة</div>
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${
                      statusColors[viewingOrder.status]
                    }`}
                  >
                    {statusLabels[viewingOrder.status] || viewingOrder.status}
                  </span>
                </div>
                <div>
                  <div className="text-xs text-slate-500 mb-1">الدفع</div>
                  <div className="font-medium text-slate-900">
                    {paymentStatusLabels[viewingOrder.paymentStatus] ||
                      viewingOrder.paymentStatus}
                  </div>
                </div>
                {viewingOrder.expectedDate && (
                  <div>
                    <div className="text-xs text-slate-500 mb-1">الاستلام المتوقع</div>
                    <div className="font-medium text-slate-900">
                      {viewingOrder.expectedDate}
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <h3 className="font-bold text-lg text-slate-900 px-1">
                  الأصناف المطلوبة
                </h3>
                <div className="rounded-2xl border border-slate-200 overflow-hidden bg-white shadow-sm">
                  <div className="overflow-x-auto">
                    <Table className="min-w-[600px]">
                      <TableHeader className="bg-slate-50/50">
                        <TableRow>
                          <TableHead>المنتج</TableHead>
                          <TableHead>التكلفة</TableHead>
                          <TableHead>الكمية المطلوبة</TableHead>
                          <TableHead>المستلم</TableHead>
                          <TableHead>المتبقي</TableHead>
                          <TableHead>الإجمالي</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {viewingOrder.items.map((item, i) => (
                          <TableRow key={i}>
                            <TableCell className="font-medium text-slate-900">
                              {itemDisplayName(item)}
                            </TableCell>
                            <TableCell>{formatCurrency(itemDisplayUnitCost(item))}</TableCell>
                            <TableCell>{Number(item.quantity) || 0}</TableCell>
                            <TableCell className="text-emerald-600 font-bold">
                              {Number(item.receivedQuantity) || 0}
                            </TableCell>
                            <TableCell className="text-rose-500 font-bold">
                              {Math.max(0, (Number(item.quantity) || 0) - (Number(item.receivedQuantity) || 0))}
                            </TableCell>
                            <TableCell className="font-bold">
                              {formatCurrency(itemDisplayTotal(item))}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </div>

              <div className="flex justify-end">
                <div className="w-full sm:w-1/2 md:w-1/3 rounded-2xl bg-slate-900 p-5 text-white space-y-3 shadow-lg">
                  <div className="flex justify-between text-sm text-slate-300">
                    <span>المجموع الفرعي</span>
                    <span>{formatCurrency(viewingOrder.subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-sm text-slate-300">
                    <span>الضريبة</span>
                    <span>{formatCurrency(viewingOrder.vat)}</span>
                  </div>
                  <div className="flex justify-between text-lg font-bold border-t border-slate-700 pt-3">
                    <span>الإجمالي الكلي</span>
                    <span>{formatCurrency(viewingOrder.total)}</span>
                  </div>
                </div>
              </div>

              {viewingOrder.notes && (
                <div className="rounded-xl bg-amber-50/50 p-4 border border-amber-100 text-amber-900 text-sm whitespace-pre-wrap leading-relaxed">
                  <span className="font-bold block mb-1">ملاحظات:</span>
                  {viewingOrder.notes}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* RECEIVE DIALOG */}
      <Dialog
        open={!!receiveOrder}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setReceiveOrder(null);
            setReceiptOperationId('');
          }
        }}
      >
        <DialogContent
          className="max-w-2xl max-h-[90vh] overflow-y-auto"
          dir="rtl"
        >
          <DialogHeader>
            <DialogTitle>استلام أمر الشراء {receiveOrder?.orderNumber}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitReceive} className="space-y-6 py-4">
            <div className="space-y-2">
              <Label>تاريخ الاستلام</Label>
              <Input
                required
                type="date"
                value={receiptDate}
                onChange={(e) => setReceiptDate(e.target.value)}
                data-testid="po-input-receipt-date"
              />
            </div>
            <div className="space-y-3">
              <div className="flex justify-between items-center px-1">
                <Label>تحديد الكميات المستلمة</Label>
              </div>
              <div className="rounded-xl border border-slate-200 p-2 sm:p-4 space-y-3 bg-slate-50">
                {receiveItems.map((item, index) => (
                  <div
                    key={item.productId}
                    className="flex items-center gap-2 sm:gap-4 border-b border-slate-200 pb-3 last:border-0 last:pb-0"
                  >
                    <div className="flex-1">
                      <p className="text-sm font-bold text-slate-900">
                        {item.productName}
                      </p>
                      <p className="text-xs text-slate-500">
                        الكمية المتبقية للاستلام: {item.max}
                      </p>
                    </div>
                    <div className="w-24 sm:w-32">
                      <Input
                        type="number"
                        min="0"
                        max={item.max}
                        step="any"
                        value={item.quantity === 0 ? '' : item.quantity}
                        placeholder="0"
                        onChange={(e) => {
                          const val = Math.max(
                            0,
                            Math.min(item.max, Number(e.target.value) || 0)
                          );
                          const newI = [...receiveItems];
                          newI[index].quantity = val;
                          setReceiveItems(newI);
                        }}
                        data-testid={`po-receive-qty-${index}`}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setReceiveOrder(null)}
              >
                إلغاء
              </Button>
              <Button
                type="submit"
                disabled={
                  submitting || receiveItems.every((i) => i.quantity === 0)
                }
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                data-testid="po-btn-submit-receive"
              >
                {submitting ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  'تأكيد الاستلام'
                )}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
