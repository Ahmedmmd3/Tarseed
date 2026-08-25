import { CrudTable } from '@/components/crud-table';
import { BriefcaseBusiness, ChevronRight } from 'lucide-react';
import { Link } from 'wouter';

export default function Operations() {
  return (
    <div className="flex flex-col gap-6" data-testid="page-operations">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/dashboard" className="mb-2 inline-flex items-center gap-1.5 text-sm font-bold text-slate-500 transition hover:text-slate-900">
            <ChevronRight className="h-4 w-4" /> لوحة التحكم
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-black text-slate-900 sm:text-3xl">
            <BriefcaseBusiness className="h-8 w-8 text-orange-600" />
            العمليات والمشاريع
          </h1>
        </div>
      </div>
      <CrudTable
        table="projects"
        title="المشاريع"
        fields={[
          { key: 'name', label: 'اسم المشروع', required: true },
          { key: 'client', label: 'العميل' },
          { key: 'status', label: 'الحالة', type: 'select', options: [
            { label: 'جاري', value: 'active' },
            { label: 'مكتمل', value: 'completed' },
            { label: 'معلق', value: 'suspended' },
          ] },
          { key: 'budget', label: 'الميزانية', type: 'number' },
        ]}
      />
    </div>
  );
}
