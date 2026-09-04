import React, { useEffect, useState, useMemo } from 'react';
import { ShoppingCart, ChevronRight, Store, ArrowLeftRight, CheckCircle2, AlertCircle, Clock, LoaderCircle, ReceiptText, RefreshCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from 'wouter';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CrudTable } from '@/components/crud-table';
import { useCrud } from '@/hooks/use-crud';
import { useSalesReturns, type SalesReturn } from '@/hooks/use-sales-returns';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatLocalDate } from '@/lib/date';
import { useToast } from '@/hooks/use-toast';

export type InvoiceItem = {
  productId: number;
  name: string;
  sku: string;
  quantity: number;
  unitPriceExVat: number;
  vatRate: number;
  lineNet: number;
  vatAmount: number;
  lineGross: number;
  total?: number;
};

export type Invoice = {
  id: number;
  number: string;
  issueDate: string;
  customerName: string;
  warehouseId: number;
  paymentMethod: string;
  status: string;
  items: InvoiceItem[];
  subtotal: number;
  tax: number;
  total: number;
  eInvoiceStatus: string;
};

function formatCurrency(amount: number) {
  return new Intl.NumberFormat('ar-SA', { style: 'currency', currency: 'SAR' }).format(amount);
}

function StatusBadge({ status }: { status: string }) {
  if (status === 'paid') return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700 ring-1 ring-inset ring-emerald-600/20"><CheckCircle2 className="h-3 w-3" /> مسددة</span>;
  if (status === 'unpaid') return <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-1 text-xs font-bold text-rose-700 ring-1 ring-inset ring-rose-600/20"><Clock className="h-3 w-3" /> غير مسددة</span>;
  if (status === 'partial') return <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-xs font-bold text-amber-700 ring-1 ring-inset ring-amber-600/20"><AlertCircle className="h-3 w-3" /> مسددة جزئياً</span>;
  if (status === 'draft') return <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700 ring-1 ring-inset ring-slate-600/20">مسودة</span>;
  return <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700 ring-1 ring-inset ring-slate-600/20">{status}</span>;
}

export default function Sales() {
  const { data: invoicesData, loading: invoicesLoading, load: loadInvoices } = useCrud<Invoice>('invoices');
  const { data: returnsData, loading: returnsLoading, load: loadReturns, create: createReturn } = useSalesReturns();

  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [returnDrawerOpen, setReturnDrawerOpen] = useState(false);

  const [selectedReturn, setSelectedReturn] = useState<SalesReturn | null>(null);

  const openInvoiceDetails = (invoice: Invoice) => {
    setSelectedInvoice(invoice);
  };

  return (
    <div className="flex flex-col gap-6" data-testid="page-sales">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/dashboard" className="mb-2 inline-flex items-center gap-1.5 text-sm font-bold text-slate-500 transition hover:text-slate-900">
            <ChevronRight className="h-4 w-4" /> لوحة التحكم
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-black text-slate-900 sm:text-3xl">
            <ShoppingCart className="h-8 w-8 text-blue-600" />
            المبيعات والعملاء
          </h1>
        </div>
      </div>

      <Tabs defaultValue="invoices" className="w-full">
        <div className="mb-6 overflow-x-auto pb-1">
          <TabsList className="flex h-auto w-max min-w-full justify-start md:w-[600px] md:min-w-0">
            <TabsTrigger value="invoices" className="min-h-11 shrink-0 px-4">فواتير المبيعات</TabsTrigger>
            <TabsTrigger value="returns" className="min-h-11 shrink-0 px-4">المرتجعات</TabsTrigger>
            <TabsTrigger value="customers" className="min-h-11 shrink-0 px-4">العملاء</TabsTrigger>
            <TabsTrigger value="sales" className="min-h-11 shrink-0 px-4">المبيعات المسجلة</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="invoices">
          <div className="mb-4 flex flex-col items-stretch justify-between gap-3 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900 sm:flex-row sm:items-center">
            <span>تُنشأ فواتير البيع المؤثرة في المخزون من مسار نقطة البيع الذري.</span>
            <Link href="/pos">
              <Button size="sm" className="h-11 w-full gap-2 bg-blue-700 hover:bg-blue-800 sm:h-auto sm:w-auto"><Store className="h-4 w-4" />فتح نقطة البيع</Button>
            </Link>
          </div>

          <div className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/50 hover:bg-slate-50/50">
                  <TableHead>رقم الفاتورة</TableHead>
                  <TableHead>العميل</TableHead>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>الإجمالي</TableHead>
                  <TableHead>الحالة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoicesLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center">
                      <LoaderCircle className="mx-auto h-6 w-6 animate-spin text-blue-600" />
                    </TableCell>
                  </TableRow>
                ) : invoicesData.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-slate-500">لا توجد فواتير</TableCell>
                  </TableRow>
                ) : (
                  invoicesData.map((inv) => (
                    <TableRow key={inv.id} className="cursor-pointer transition-colors hover:bg-slate-50" onClick={() => openInvoiceDetails(inv)}>
                      <TableCell className="font-medium text-blue-700">{inv.number}</TableCell>
                      <TableCell>{inv.customerName}</TableCell>
                      <TableCell>{inv.issueDate}</TableCell>
                      <TableCell className="font-bold">{formatCurrency(inv.total)}</TableCell>
                      <TableCell><StatusBadge status={inv.status} /></TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="returns">
          <div className="rounded-2xl border border-slate-100 bg-white shadow-sm overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/50 hover:bg-slate-50/50">
                  <TableHead>رقم المرتجع</TableHead>
                  <TableHead>الفاتورة الأصلية</TableHead>
                  <TableHead>التاريخ</TableHead>
                  <TableHead>الإجمالي</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>السبب</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {returnsLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center">
                      <LoaderCircle className="mx-auto h-6 w-6 animate-spin text-blue-600" />
                    </TableCell>
                  </TableRow>
                ) : returnsData.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-slate-500">لا توجد مرتجعات مسجلة</TableCell>
                  </TableRow>
                ) : (
                  returnsData.map((ret) => (
                    <TableRow key={ret.id} className="cursor-pointer transition-colors hover:bg-slate-50" onClick={() => setSelectedReturn(ret)}>
                      <TableCell className="font-medium text-rose-700">{ret.number}</TableCell>
                      <TableCell className="text-slate-500">{ret.originalInvoiceNumber}</TableCell>
                      <TableCell>{ret.date}</TableCell>
                      <TableCell className="font-bold text-rose-700">{formatCurrency(ret.total)}</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 text-xs font-bold text-slate-700">{ret.refundStatus === 'refunded' ? 'مسترجع' : ret.refundStatus === 'pending' ? 'معلق' : ret.refundStatus || 'مسجل'}</span>
                      </TableCell>
                      <TableCell>{ret.reason || '-'}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="customers">
          <CrudTable
            table="customers"
            title="إدارة العملاء"
            fields={[
              { key: 'name', label: 'اسم العميل', required: true },
              { key: 'phone', label: 'رقم الهاتف' },
              { key: 'email', label: 'البريد الإلكتروني' },
              { key: 'company', label: 'الشركة' },
            ]}
          />
        </TabsContent>

        <TabsContent value="sales">
          <CrudTable
            table="sales"
            title="المبيعات المسجلة"
            fields={[
              { key: 'invoiceId', label: 'رقم الفاتورة' },
              { key: 'productId', label: 'المنتج' },
              { key: 'customerName', label: 'العميل' },
              { key: 'issueDate', label: 'التاريخ', type: 'date' },
              { key: 'quantity', label: 'الكمية', type: 'number' },
              { key: 'total', label: 'الإجمالي', type: 'number' },
            ]}
            readOnly
          />
        </TabsContent>
      </Tabs>

      {/* Invoice Details Sheet */}
      <Sheet open={Boolean(selectedInvoice) && !returnDrawerOpen} onOpenChange={(open) => !open && setSelectedInvoice(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto" dir="rtl">
          {selectedInvoice && (
            <div className="flex flex-col gap-6">
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2 text-2xl font-black">
                  <ReceiptText className="h-6 w-6 text-blue-600" />
                  تفاصيل الفاتورة {selectedInvoice.number}
                </SheetTitle>
                <SheetDescription>
                  فاتورة {selectedInvoice.customerName} بتاريخ {selectedInvoice.issueDate}
                </SheetDescription>
              </SheetHeader>

              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                  <div>
                    <p className="text-slate-500">حالة الفاتورة</p>
                    <div className="mt-1"><StatusBadge status={selectedInvoice.status} /></div>
                  </div>
                  <div>
                    <p className="text-slate-500">الإجمالي</p>
                    <p className="mt-1 font-black text-slate-900">{formatCurrency(selectedInvoice.total)}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">الضريبة</p>
                    <p className="mt-1 font-semibold text-slate-900">{formatCurrency(selectedInvoice.tax)}</p>
                  </div>
                  <div>
                    <p className="text-slate-500">طريقة الدفع</p>
                    <p className="mt-1 font-semibold text-slate-900">{selectedInvoice.paymentMethod || 'غير محدد'}</p>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="mb-3 text-lg font-bold text-slate-900">الأصناف</h3>
                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <Table>
                    <TableHeader className="bg-slate-50">
                      <TableRow>
                        <TableHead>المنتج</TableHead>
                        <TableHead className="text-center">الكمية</TableHead>
                        <TableHead className="text-left">السعر (بدون ضريبة)</TableHead>
                        <TableHead className="text-left">الإجمالي</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedInvoice.items?.map((item, idx) => (
                        <TableRow key={idx}>
                          <TableCell>
                            <p className="font-semibold">{item.name}</p>
                            <p className="text-xs text-slate-500">{item.sku}</p>
                          </TableCell>
                          <TableCell className="text-center">{item.quantity}</TableCell>
                          <TableCell className="text-left">{formatCurrency(item.unitPriceExVat)}</TableCell>
                          <TableCell className="text-left font-bold">{formatCurrency(item.lineGross)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <div className="mt-4 flex justify-end gap-3 border-t border-slate-100 pt-6">
                <Button variant="outline" onClick={() => setSelectedInvoice(null)}>إغلاق</Button>
                <Button className="gap-2 bg-rose-600 hover:bg-rose-700 text-white" onClick={() => setReturnDrawerOpen(true)}>
                  <RefreshCcw className="h-4 w-4" />
                  إنشاء مرتجع
                </Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* Create Return Dialog/Drawer */}
      <CreateReturnDrawer
        invoice={selectedInvoice}
        returns={returnsData}
        open={returnDrawerOpen}
        onOpenChange={(open) => {
          setReturnDrawerOpen(open);
          if (!open) {
            // we don't close selected invoice automatically unless submitted
          }
        }}
        onSuccess={() => {
          setReturnDrawerOpen(false);
          setSelectedInvoice(null);
          loadInvoices();
          loadReturns();
        }}
        createReturn={createReturn}
      />

      {/* Return Details Sheet */}
      <Sheet open={Boolean(selectedReturn)} onOpenChange={(open) => !open && setSelectedReturn(null)}>
        <SheetContent className="w-full sm:max-w-2xl overflow-y-auto" dir="rtl">
          {selectedReturn && (
            <div className="flex flex-col gap-6">
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2 text-2xl font-black text-rose-700">
                  <RefreshCcw className="h-6 w-6" />
                  تفاصيل المرتجع {selectedReturn.number}
                </SheetTitle>
                <SheetDescription>
                  مرتبط بالفاتورة الأصلية: {selectedReturn.originalInvoiceNumber}
                </SheetDescription>
              </SheetHeader>

              <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
                <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                  <div>
                    <p className="text-rose-800/70">التاريخ</p>
                    <p className="mt-1 font-semibold text-rose-950">{selectedReturn.date}</p>
                  </div>
                  <div>
                    <p className="text-rose-800/70">الإجمالي المرتجع</p>
                    <p className="mt-1 font-black text-rose-950">{formatCurrency(selectedReturn.total)}</p>
                  </div>
                  <div>
                    <p className="text-rose-800/70">الحالة</p>
                    <p className="mt-1 font-semibold text-rose-950">{selectedReturn.refundStatus === 'refunded' ? 'مسترجع' : selectedReturn.refundStatus === 'pending' ? 'معلق' : selectedReturn.refundStatus || 'مسجل'}</p>
                  </div>
                  <div>
                    <p className="text-rose-800/70">طريقة الاسترجاع</p>
                    <p className="mt-1 font-semibold text-rose-950">{selectedReturn.refundMethod || '-'}</p>
                  </div>
                  <div className="col-span-2 sm:col-span-4">
                    <p className="text-rose-800/70">السبب</p>
                    <p className="mt-1 font-semibold text-rose-950">{selectedReturn.reason || 'لم يذكر'}</p>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="mb-3 text-lg font-bold text-slate-900">الأصناف المرتجعة</h3>
                <div className="rounded-xl border border-slate-200 overflow-hidden">
                  <Table>
                    <TableHeader className="bg-slate-50">
                      <TableRow>
                        <TableHead>المنتج</TableHead>
                        <TableHead className="text-center">الكمية المرتجعة</TableHead>
                        <TableHead className="text-left">الإجمالي</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedReturn.items?.map((item, idx) => (
                        <TableRow key={idx}>
                          <TableCell>
                            <p className="font-semibold">{item.name}</p>
                            <p className="text-xs text-slate-500">{item.sku}</p>
                          </TableCell>
                          <TableCell className="text-center font-bold text-rose-600">{item.quantity}</TableCell>
                          <TableCell className="text-left font-bold">{formatCurrency(item.lineGross)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function CreateReturnDrawer({
  invoice,
  returns,
  open,
  onOpenChange,
  onSuccess,
  createReturn
}: {
  invoice: Invoice | null;
  returns: SalesReturn[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  createReturn: ReturnType<typeof useSalesReturns>['create'];
}) {
  const { toast } = useToast();
  const [reason, setReason] = useState('');
  const [returnDate, setReturnDate] = useState(() => formatLocalDate());
  const [returnQuantities, setReturnQuantities] = useState<Record<number, number>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const clientOpIdRef = React.useRef<string>('');

  useEffect(() => {
    if (open) {
      setReason('');
      setReturnDate(formatLocalDate());
      setReturnQuantities({});
      clientOpIdRef.current = `return-${invoice?.id || 0}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    }
  }, [open, invoice]);

  // Calculate previously returned quantities for this invoice
  const returnedQuantitiesByProduct = useMemo(() => {
    const qtys: Record<number, number> = {};
    if (!invoice) return qtys;
    const invoiceReturns = returns.filter(r => r.originalInvoiceId === invoice.id);
    for (const r of invoiceReturns) {
      for (const item of r.items) {
        qtys[item.productId] = (qtys[item.productId] || 0) + item.quantity;
      }
    }
    return qtys;
  }, [invoice, returns]);

  if (!invoice) return null;

  const handleQuantityChange = (productId: number, val: string, maxRemaining: number) => {
    const num = parseInt(val, 10);
    if (isNaN(num) || num < 0) {
      setReturnQuantities(prev => ({ ...prev, [productId]: 0 }));
      return;
    }
    if (num > maxRemaining) {
      setReturnQuantities(prev => ({ ...prev, [productId]: maxRemaining }));
      return;
    }
    setReturnQuantities(prev => ({ ...prev, [productId]: num }));
  };

  const setAllToMax = () => {
    const qtys: Record<number, number> = {};
    invoice.items.forEach(item => {
      const returned = returnedQuantitiesByProduct[item.productId] || 0;
      const remaining = Math.max(0, item.quantity - returned);
      if (remaining > 0) qtys[item.productId] = remaining;
    });
    setReturnQuantities(qtys);
  };

  const totalReturnItemsCount = Object.values(returnQuantities).reduce((a, b) => a + b, 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (totalReturnItemsCount === 0) {
      toast({ title: 'يجب اختيار صنف واحد على الأقل للترجيع', variant: 'destructive' });
      return;
    }

    setIsSubmitting(true);

    const items = Object.entries(returnQuantities)
      .filter(([_, qty]) => qty > 0)
      .map(([productId, qty]) => ({
        productId: Number(productId),
        quantity: qty
      }));

    const res = await createReturn({
      invoiceId: invoice.id,
      returnDate,
      reason,
      items,
      clientOperationId: clientOpIdRef.current
    });

    setIsSubmitting(false);
    if (res.success) {
      onSuccess();
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-3xl overflow-y-auto" dir="rtl">
        <SheetHeader className="mb-6">
          <SheetTitle className="flex items-center gap-2 text-2xl font-black text-rose-700">
            <ArrowLeftRight className="h-6 w-6" />
            إنشاء مرتجع لفاتورة {invoice.number}
          </SheetTitle>
          <SheetDescription>
            حدد الكميات المرتجعة، وسبب الاسترجاع. يتم التأثير على المخزون والحسابات تلقائياً.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSubmit} className="flex flex-col gap-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>تاريخ المرتجع</Label>
              <Input
                type="date"
                value={returnDate}
                onChange={(e) => setReturnDate(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>سبب المرتجع</Label>
              <Input
                placeholder="مثال: عيب مصنعي، أو بناءً على طلب العميل"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                required
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-lg font-bold text-slate-900">الأصناف</h3>
              <Button type="button" variant="outline" size="sm" onClick={setAllToMax}>
                إرجاع الكل
              </Button>
            </div>

            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead>المنتج</TableHead>
                    <TableHead className="text-center">المباع</TableHead>
                    <TableHead className="text-center">مرتجع سابقاً</TableHead>
                    <TableHead className="text-center">المتبقي</TableHead>
                    <TableHead className="text-center w-[120px]">الكمية المرتجعة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoice.items?.map((item) => {
                    const previouslyReturned = returnedQuantitiesByProduct[item.productId] || 0;
                    const remaining = Math.max(0, item.quantity - previouslyReturned);
                    const currentReturnQty = returnQuantities[item.productId] || 0;

                    return (
                      <TableRow key={item.productId} className={remaining === 0 ? "opacity-50" : ""}>
                        <TableCell>
                          <p className="font-semibold">{item.name}</p>
                        </TableCell>
                        <TableCell className="text-center">{item.quantity}</TableCell>
                        <TableCell className="text-center">{previouslyReturned}</TableCell>
                        <TableCell className="text-center font-bold">{remaining}</TableCell>
                        <TableCell className="text-center">
                          <Input
                            type="number"
                            min="0"
                             step="1"
                            max={remaining}
                            className="h-8 text-center"
                            disabled={remaining === 0}
                            value={currentReturnQty || ''}
                            onChange={(e) => handleQuantityChange(item.productId, e.target.value, remaining)}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>

          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 mt-2 flex gap-3">
            <AlertCircle className="h-5 w-5 shrink-0 text-amber-600" />
            <p>سيتم إرجاع <strong>{totalReturnItemsCount}</strong> أصناف إلى المخزن المحدد، وسيتم تسجيل قيود المحاسبة الخاصة بالمرتجعات فور الحفظ.</p>
          </div>

          <div className="flex justify-end gap-3 border-t border-slate-100 pt-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              إلغاء
            </Button>
            <Button type="submit" className="bg-rose-600 hover:bg-rose-700 text-white min-w-[120px]" disabled={isSubmitting || totalReturnItemsCount === 0 || !reason.trim()}>
              {isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : 'تأكيد المرتجع'}
            </Button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}
