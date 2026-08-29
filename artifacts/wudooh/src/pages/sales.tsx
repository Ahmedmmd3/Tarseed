import { CrudTable } from '@/components/crud-table';
import { ShoppingCart, ChevronRight, Store } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from 'wouter';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function Sales() {
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
      
      <Tabs defaultValue="customers" className="w-full">
        <div className="mb-6 overflow-x-auto pb-1">
          <TabsList className="flex h-auto w-max min-w-full justify-start md:w-[500px] md:min-w-0">
            <TabsTrigger value="customers" className="min-h-11 shrink-0 px-4">العملاء</TabsTrigger>
            <TabsTrigger value="invoices" className="min-h-11 shrink-0 px-4">فواتير المبيعات</TabsTrigger>
            <TabsTrigger value="sales" className="min-h-11 shrink-0 px-4">المبيعات المسجلة</TabsTrigger>
          </TabsList>
        </div>
        
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
        
        <TabsContent value="invoices">
          <div className="mb-4 flex flex-col items-stretch justify-between gap-3 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-900 sm:flex-row sm:items-center">
            <span>تُنشأ فواتير البيع المؤثرة في المخزون من مسار نقطة البيع الذري.</span>
            <Link href="/pos">
              <Button size="sm" className="h-11 w-full gap-2 bg-blue-700 hover:bg-blue-800 sm:h-auto sm:w-auto"><Store className="h-4 w-4" />فتح نقطة البيع</Button>
            </Link>
          </div>
          <CrudTable
            table="invoices"
            title="فواتير المبيعات"
            fields={[
              { key: 'number', label: 'رقم الفاتورة' },
              { key: 'customerName', label: 'العميل' },
              { key: 'issueDate', label: 'التاريخ', type: 'date' },
              { key: 'total', label: 'الإجمالي', type: 'number' },
              { key: 'status', label: 'الحالة', type: 'select', options: [
                { label: 'مسددة', value: 'paid' },
                { label: 'غير مسددة', value: 'unpaid' },
                { label: 'مسددة جزئياً', value: 'partial' },
              ] },
            ]}
            readOnly
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
    </div>
  );
}
