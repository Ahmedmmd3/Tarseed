import { CrudTable } from '@/components/crud-table';
import { Truck, ChevronRight } from 'lucide-react';
import { Link } from 'wouter';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

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
          <TabsTrigger value="orders">أوامر الشراء</TabsTrigger>
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
          <CrudTable
            table="purchaseOrders"
            title="أوامر الشراء"
            fields={[
              { key: 'orderNumber', label: 'رقم الأمر', required: true },
              { key: 'supplierName', label: 'المورد' },
              { key: 'date', label: 'التاريخ', type: 'date' },
              { key: 'total', label: 'الإجمالي', type: 'number' },
              { key: 'status', label: 'الحالة', type: 'select', options: [
                { label: 'قيد الانتظار', value: 'pending' },
                { label: 'مكتمل', value: 'completed' },
                { label: 'ملغي', value: 'cancelled' },
              ] },
            ]}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
