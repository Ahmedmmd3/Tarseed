import { CrudTable } from '@/components/crud-table';
import { UsersRound, ChevronRight } from 'lucide-react';
import { Link } from 'wouter';

export default function HR() {
  return (
    <div className="flex flex-col gap-6" data-testid="page-hr">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/dashboard" className="mb-2 inline-flex items-center gap-1.5 text-sm font-bold text-slate-500 transition hover:text-slate-900">
            <ChevronRight className="h-4 w-4" /> لوحة التحكم
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-black text-slate-900 sm:text-3xl">
            <UsersRound className="h-8 w-8 text-rose-600" />
            الموارد البشرية
          </h1>
        </div>
      </div>
      <CrudTable
        table="employees"
        title="الموظفين"
        fields={[
          { key: 'name', label: 'الاسم', required: true },
          { key: 'position', label: 'المسمى الوظيفي' },
          { key: 'department', label: 'القسم' },
          { key: 'salary', label: 'الراتب', type: 'number' },
        ]}
      />
    </div>
  );
}
