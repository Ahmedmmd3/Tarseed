import { CrudTable } from '@/components/crud-table';
import { ChevronRight, ReceiptText } from 'lucide-react';
import { Link } from 'wouter';

const expenseCategories = [
  { label: 'إيجار', value: 'إيجار' },
  { label: 'رواتب', value: 'رواتب' },
  { label: 'مشتريات', value: 'مشتريات' },
  { label: 'مرافق', value: 'مرافق' },
  { label: 'تسويق', value: 'تسويق' },
  { label: 'نقل', value: 'نقل' },
  { label: 'صيانة', value: 'صيانة' },
  { label: 'أخرى', value: 'أخرى' },
];

const paymentMethods = [
  { label: 'نقداً', value: 'cash' },
  { label: 'بطاقة', value: 'card' },
  { label: 'تحويل بنكي', value: 'transfer' },
];

export default function Expenses() {
  return (
    <div className="flex flex-col gap-6" data-testid="page-expenses">
      <div>
        <Link href="/dashboard" className="mb-2 inline-flex items-center gap-1.5 text-sm font-bold text-slate-500 transition hover:text-slate-900">
          <ChevronRight className="h-4 w-4" /> لوحة التحكم
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-black text-slate-900 sm:text-3xl">
          <ReceiptText className="h-8 w-8 text-rose-600" />
          المصاريف
        </h1>
      </div>

      <CrudTable
        table="expenses"
        title="المصاريف"
        fields={[
          { key: 'description', label: 'البيان', required: true },
          { key: 'amount', label: 'المبلغ', type: 'number', required: true },
          { key: 'date', label: 'التاريخ', type: 'date', required: true },
          { key: 'category', label: 'التصنيف', type: 'select', options: expenseCategories, required: true },
          { key: 'paymentMethod', label: 'طريقة الدفع', type: 'select', options: paymentMethods, required: true },
          { key: 'vendor', label: 'المورد' },
        ]}
      />
    </div>
  );
}