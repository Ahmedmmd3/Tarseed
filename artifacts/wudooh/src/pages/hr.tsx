import { useEffect, useState } from 'react';
import { utils, writeFile } from 'xlsx';
import { ChevronRight, Download, FileCheck2, Plus, UsersRound, WalletCards } from 'lucide-react';
import { Link } from 'wouter';
import { CrudTable, type FieldDef } from '@/components/crud-table';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCrud } from '@/hooks/use-crud';
import { useStore } from '@/context/store';
import { useToast } from '@/hooks/use-toast';

const moneyFormatter = new Intl.NumberFormat('ar-SA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const monthFormatter = new Intl.DateTimeFormat('ar-SA', { month: 'long', year: 'numeric' });

function money(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function employeeSalary(employee: Record<string, unknown>): number {
  return money(employee.basicSalary === '' || employee.basicSalary == null ? employee.salary : employee.basicSalary)
    + money(employee.housingAllowance)
    + money(employee.transportAllowance)
    + money(employee.otherAllowances);
}

function isActiveEmployee(employee: Record<string, unknown>): boolean {
  return employee.status !== 'suspended' && employee.status !== 'terminated' && employee.status !== 'inactive';
}

function Badge({ children, tone = 'slate' }: { children: React.ReactNode; tone?: 'green' | 'orange' | 'red' | 'slate' }) {
  const tones = {
    green: 'bg-emerald-100 text-emerald-800',
    orange: 'bg-amber-100 text-amber-800',
    red: 'bg-rose-100 text-rose-800',
    slate: 'bg-slate-100 text-slate-700',
  };
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${tones[tone]}`}>{children}</span>;
}

const employeeFields: FieldDef[] = [
  { key: 'employeeCode', label: 'رقم الموظف', showInTable: false },
  { key: 'name', label: 'الاسم الكامل', required: true },
  { key: 'nationalId', label: 'رقم الهوية', showInTable: false },
  { key: 'phone', label: 'رقم الهاتف', showInTable: false },
  { key: 'email', label: 'البريد الإلكتروني', showInTable: false },
  { key: 'gender', label: 'الجنس', type: 'select', showInTable: false, options: [{ value: 'male', label: 'ذكر' }, { value: 'female', label: 'أنثى' }] },
  { key: 'birthDate', label: 'تاريخ الميلاد', type: 'date', showInTable: false },
  { key: 'nationality', label: 'الجنسية', showInTable: false },
  { key: 'address', label: 'العنوان', showInTable: false },
  { key: 'department', label: 'القسم' },
  { key: 'position', label: 'المسمى الوظيفي' },
  { key: 'hireDate', label: 'تاريخ التعيين', type: 'date', showInTable: false },
  {
    key: 'contractType', label: 'نوع العقد', type: 'select', showInTable: false,
    options: [{ value: 'permanent', label: 'دائم' }, { value: 'temporary', label: 'مؤقت' }, { value: 'seasonal', label: 'موسمي' }, { value: 'remote', label: 'عن بُعد' }],
  },
  { key: 'basicSalary', label: 'الراتب الأساسي', type: 'number', showInTable: false },
  { key: 'housingAllowance', label: 'بدل السكن', type: 'number', showInTable: false },
  { key: 'transportAllowance', label: 'بدل المواصلات', type: 'number', showInTable: false },
  { key: 'otherAllowances', label: 'بدلات أخرى', type: 'number', showInTable: false },
  { key: 'paymentMethod', label: 'طريقة الدفع', type: 'select', showInTable: false, options: [{ value: 'cash', label: 'نقداً' }, { value: 'bank', label: 'تحويل بنكي' }] },
  { key: 'bankName', label: 'اسم البنك', showInTable: false },
  { key: 'iban', label: 'رقم الآيبان (IBAN)', showInTable: false },
  { key: 'notes', label: 'ملاحظات', type: 'textarea', showInTable: false },
  { key: 'totalSalary', label: 'إجمالي الراتب', type: 'number', disabled: true, renderCell: (_value, item) => moneyFormatter.format(employeeSalary(item)), },
  {
    key: 'status', label: 'الحالة', type: 'select', defaultValue: 'active',
    options: [{ value: 'active', label: 'نشط' }, { value: 'suspended', label: 'موقف' }, { value: 'terminated', label: 'منتهية الخدمة' }],
    renderCell: (value) => <Badge tone={!value || value === 'active' ? 'green' : value === 'suspended' ? 'orange' : 'red'}>{!value || value === 'active' ? 'نشط' : value === 'suspended' ? 'موقف' : 'منتهية الخدمة'}</Badge>,
  },
];

const leaveFields = (options: FieldDef['options']): FieldDef[] => [
  { key: 'employeeId', label: 'الموظف', type: 'searchable-select', required: true, options },
  { key: 'leaveType', label: 'نوع الإجازة', type: 'select', options: [{ value: 'annual', label: 'سنوية' }, { value: 'sick', label: 'مرضية' }, { value: 'emergency', label: 'طارئة' }, { value: 'unpaid', label: 'بدون راتب' }] },
  { key: 'startDate', label: 'من تاريخ', type: 'date', required: true },
  { key: 'endDate', label: 'إلى تاريخ', type: 'date', required: true },
  { key: 'days', label: 'عدد الأيام', type: 'number', disabled: true },
  {
    key: 'status', label: 'الحالة', type: 'select', defaultValue: 'pending',
    options: [{ value: 'pending', label: 'قيد المراجعة' }, { value: 'approved', label: 'موافق' }, { value: 'rejected', label: 'مرفوض' }],
    renderCell: (value) => <Badge tone={value === 'approved' ? 'green' : value === 'rejected' ? 'red' : 'orange'}>{value === 'approved' ? 'موافق' : value === 'rejected' ? 'مرفوض' : 'قيد المراجعة'}</Badge>,
  },
  { key: 'notes', label: 'سبب الإجازة', type: 'textarea' },
];

function LeavePanel() {
  const employees = useCrud<any>('employees');
  const employeeOptions = employees.data.map((employee) => ({ value: employee.id, label: `${employee.name}${employee.employeeCode ? ` — ${employee.employeeCode}` : ''}` }));
  return (
    <CrudTable
      table="leaveRequests"
      title="طلبات الإجازات"
      fields={leaveFields(employeeOptions)}
    />
  );
}

function PayrollPanel() {
  const { currentUser } = useStore();
  const { toast } = useToast();
  const employees = useCrud<any>('employees');
  const runs = useCrud<any>('payrollRuns');
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [isCreating, setIsCreating] = useState(false);
  const activeEmployees = employees.data.filter(isActiveEmployee);
  const selectedRun = runs.data.find((run) => Number(run.month) === month && Number(run.year) === year);
  const canCreatePayroll = Boolean(currentUser && (currentUser.roleId === 'owner'
    || (currentUser.permissions.hr === true && currentUser.permissions.accounting === true)));
  const branches = useCrud<any>('branches', canCreatePayroll);
  const activeBranches = branches.data.filter((branch) => branch.status === 'active');
  const [branchId, setBranchId] = useState<number | ''>(currentUser?.defaultBranchId ?? '');
  const payrollEmployees = selectedRun && Array.isArray(selectedRun.employeeLines)
    ? selectedRun.employeeLines
    : activeEmployees;
  const total = selectedRun ? money(selectedRun.totalAmount) : activeEmployees.reduce((sum, employee) => sum + employeeSalary(employee), 0);

  useEffect(() => {
    if (currentUser?.defaultBranchId && activeBranches.some((branch) => Number(branch.id) === Number(currentUser.defaultBranchId))) {
      setBranchId(Number(currentUser.defaultBranchId));
    } else if (activeBranches.length === 1) {
      setBranchId(Number(activeBranches[0].id));
    } else if (branchId !== '' && !activeBranches.some((branch) => Number(branch.id) === Number(branchId))) {
      setBranchId('');
    }
  }, [activeBranches, branchId, currentUser?.defaultBranchId]);

  const createRun = async () => {
    if (!currentUser || isCreating) return;
    setIsCreating(true);
    try {
      const response = await fetch('/api/hr/payroll-runs', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          'X-Wudooh-Data-Generation': String(currentUser.dataGeneration),
          'Idempotency-Key': `PAYROLL-${year}-${month}`,
        },
        body: JSON.stringify({ month, year, ...(branchId === '' ? {} : { branchId }) }),
      });
      const payload = await response.json().catch(() => ({})) as { run?: any; replayed?: boolean; error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'تعذر إنشاء مسير الرواتب.');
      toast({ title: payload.replayed ? 'المسير موجود مسبقاً' : 'تم إنشاء مسير الشهر' });
      await runs.load();
    } catch (error) {
      toast({ title: 'تعذر إنشاء المسير', description: error instanceof Error ? error.message : 'حدث خطأ غير متوقع.', variant: 'destructive' });
    } finally {
      setIsCreating(false);
    }
  };

  const exportPayroll = () => {
    const rows = payrollEmployees.map((employee: any) => ({
      'رقم الموظف': employee.employeeCode ?? employee.id,
      'اسم الموظف': employee.name,
      'اسم البنك': employee.paymentMethod === 'cash' ? 'الصندوق' : employee.bankName ?? '',
      'رقم الآيبان': employee.paymentMethod === 'cash' ? '' : employee.iban ?? '',
      'طريقة الدفع': employee.paymentMethod === 'cash' ? 'نقداً' : 'تحويل بنكي',
      'المبلغ': selectedRun ? money(employee.totalAmount) : employeeSalary(employee),
      'العملة': 'SAR',
    }));
    const worksheet = utils.json_to_sheet(rows);
    worksheet['!cols'] = [{ wch: 16 }, { wch: 28 }, { wch: 22 }, { wch: 28 }, { wch: 16 }, { wch: 16 }, { wch: 10 }];
    const workbook = utils.book_new();
    utils.book_append_sheet(workbook, worksheet, 'Bank Payroll');
    writeFile(workbook, `مسير_رواتب_${year}_${String(month).padStart(2, '0')}.xlsx`);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-100 bg-white p-4 shadow-sm sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm font-bold text-slate-700">الشهر<select value={month} onChange={(event) => setMonth(Number(event.target.value))} className="mt-1 block h-10 rounded-lg border border-slate-200 px-3">{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{monthFormatter.format(new Date(year, index, 1)).split(' ')[0]}</option>)}</select></label>
          <label className="text-sm font-bold text-slate-700">السنة<input type="number" value={year} onChange={(event) => setYear(Number(event.target.value))} className="mt-1 block h-10 w-28 rounded-lg border border-slate-200 px-3" /></label>
          {activeBranches.length > 0 && <label className="text-sm font-bold text-slate-700">الفرع<select value={branchId} onChange={(event) => setBranchId(event.target.value ? Number(event.target.value) : '')} className="mt-1 block h-10 min-w-40 rounded-lg border border-slate-200 px-3"><option value="">اختر الفرع</option>{activeBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={exportPayroll} className="gap-2"><Download className="h-4 w-4" />تصدير Excel</Button>
          {canCreatePayroll
            ? <Button type="button" onClick={() => void createRun()} disabled={isCreating || Boolean(selectedRun) || (activeBranches.length > 0 && branchId === '')} className="gap-2 bg-teal-600 hover:bg-teal-700"><Plus className="h-4 w-4" />{isCreating ? 'جارٍ الإنشاء...' : 'إنشاء مسير الشهر'}</Button>
            : <p className="max-w-xs text-xs font-bold text-amber-700">إنشاء المسير والقيد يتطلب صلاحية المحاسبة بالإضافة إلى الموارد البشرية.</p>}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryBox label={selectedRun ? 'موظفو المسير' : 'الموظفون النشطون'} value={payrollEmployees.length.toLocaleString('ar-SA')} icon={UsersRound} />
        <SummaryBox label="إجمالي الرواتب" value={moneyFormatter.format(total)} icon={WalletCards} />
        <SummaryBox label="حالة المسير" value={selectedRun ? 'تم الصرف ✅' : 'لم يُنشأ'} icon={FileCheck2} />
      </div>
      <div className="overflow-x-auto rounded-2xl border border-slate-100 bg-white shadow-sm">
        <Table className="min-w-[720px]"><TableHeader><TableRow><TableHead>الاسم</TableHead><TableHead>الراتب الأساسي</TableHead><TableHead>البدلات</TableHead><TableHead>الإجمالي</TableHead><TableHead>طريقة الدفع</TableHead><TableHead>الحالة</TableHead></TableRow></TableHeader><TableBody>
          {payrollEmployees.map((employee: any) => {
            const basic = money(employee.basicSalary === '' || employee.basicSalary == null ? employee.salary : employee.basicSalary);
            const rowTotal = selectedRun ? money(employee.totalAmount) : employeeSalary(employee);
            const allowances = rowTotal - basic;
            return <TableRow key={employee.employeeId ?? employee.id}><TableCell className="font-bold">{employee.name}</TableCell><TableCell>{moneyFormatter.format(basic)}</TableCell><TableCell>{moneyFormatter.format(allowances)}</TableCell><TableCell className="font-bold">{moneyFormatter.format(rowTotal)}</TableCell><TableCell>{employee.paymentMethod === 'cash' ? 'نقداً' : 'تحويل بنكي'}</TableCell><TableCell><Badge tone={selectedRun ? 'green' : 'orange'}>{selectedRun ? 'تم الصرف' : 'معلّق'}</Badge></TableCell></TableRow>;
          })}
          <TableRow><TableCell colSpan={3} className="text-left font-black">الإجمالي</TableCell><TableCell className="font-black">{moneyFormatter.format(total)}</TableCell><TableCell colSpan={2} /></TableRow>
        </TableBody></Table>
      </div>
      {selectedRun?.journalId && <Link href="/accounts" className="inline-flex items-center gap-2 text-sm font-bold text-teal-700">عرض القيد المحاسبي #{selectedRun.journalId} <ChevronRight className="h-4 w-4" /></Link>}
    </div>
  );
}

function SummaryBox({ label, value, icon: Icon }: { label: string; value: string; icon: typeof UsersRound }) {
  return <div className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm"><div className="flex items-center gap-2 text-sm font-bold text-slate-500"><Icon className="h-4 w-4 text-teal-600" />{label}</div><p className="mt-2 text-xl font-black text-slate-900">{value}</p></div>;
}

export default function HR() {
  const [tab, setTab] = useState<'employees' | 'payroll' | 'leaves'>('employees');
  return (
    <div className="flex flex-col gap-6" data-testid="page-hr" dir="rtl">
      <div className="flex items-center justify-between"><div><Link href="/dashboard" className="mb-2 inline-flex items-center gap-1.5 text-sm font-bold text-slate-500 transition hover:text-slate-900"><ChevronRight className="h-4 w-4" /> لوحة التحكم</Link><h1 className="flex items-center gap-2 text-2xl font-black text-slate-900 sm:text-3xl"><UsersRound className="h-8 w-8 text-rose-600" />الموارد البشرية</h1></div></div>
      <nav className="flex flex-wrap gap-2 rounded-2xl border border-slate-100 bg-white p-2 shadow-sm" aria-label="تبويبات الموارد البشرية">
        {([['employees', 'الموظفون'], ['payroll', 'مسير الرواتب'], ['leaves', 'الإجازات']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => setTab(value)} className={`rounded-xl px-5 py-2.5 text-sm font-bold transition ${tab === value ? 'bg-teal-600 text-white shadow' : 'text-slate-600 hover:bg-slate-50'}`}>{label}</button>)}
      </nav>
      {tab === 'employees' && <CrudTable table="employees" title="الموظفون" fields={employeeFields} />}
      {tab === 'payroll' && <PayrollPanel />}
      {tab === 'leaves' && <LeavePanel />}
    </div>
  );
}