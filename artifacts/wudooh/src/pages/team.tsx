import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Download, KeyRound, LoaderCircle, Mail, Pencil, Plus, ShieldCheck, Upload, UserRound, UserRoundX, UsersRound } from 'lucide-react';
import { useStore, type SharedUser } from '@/context/store';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type PermissionKey = 'dashboard' | 'sales' | 'accounting' | 'inventory' | 'hr' | 'operations' | 'reports';
type RoleId = 'sales' | 'accountant' | 'inventory' | 'hr' | 'manager' | 'custom';
type LocationScope = 'all' | 'selected' | 'none';
type MemberStatus = 'active' | 'inactive';

type TeamMember = SharedUser;
type Warehouse = { id: number; name: string; type?: string; status?: string };

type MemberForm = {
  name: string;
  email: string;
  password: string;
  roleId: RoleId;
  status: MemberStatus;
  permissions: Record<PermissionKey, boolean>;
  locationScope: LocationScope;
  warehouseIds: number[];
};

const PERMISSIONS: Array<{ key: PermissionKey; label: string; description: string }> = [
  { key: 'dashboard', label: 'نظرة عامة', description: 'عرض ملخص أداء المنشأة' },
  { key: 'sales', label: 'المبيعات', description: 'إدارة المبيعات والفواتير والعملاء' },
  { key: 'accounting', label: 'المحاسبة', description: 'الحسابات والقيود والذمم' },
  { key: 'inventory', label: 'المخزون', description: 'المنتجات والمستودعات وحركات المخزون' },
  { key: 'hr', label: 'الموارد البشرية', description: 'بيانات الموظفين والموارد البشرية' },
  { key: 'operations', label: 'العمليات', description: 'إدارة المشاريع والعمليات' },
  { key: 'reports', label: 'التقارير', description: 'عرض التقارير والتحليلات' },
];

const ROLE_LABELS: Record<RoleId, string> = {
  sales: 'موظف مبيعات',
  accountant: 'محاسب',
  inventory: 'مسؤول مخزون',
  hr: 'موارد بشرية',
  manager: 'مدير',
  custom: 'مخصص',
};

const ROLE_PRESETS: Record<Exclude<RoleId, 'custom'>, PermissionKey[]> = {
  sales: ['dashboard', 'sales'],
  accountant: ['dashboard', 'accounting', 'reports'],
  inventory: ['dashboard', 'inventory'],
  hr: ['dashboard', 'hr'],
  manager: PERMISSIONS.map(({ key }) => key),
};

const emptyPermissions = (): Record<PermissionKey, boolean> =>
  Object.fromEntries(PERMISSIONS.map(({ key }) => [key, false])) as Record<PermissionKey, boolean>;

const createEmptyForm = (): MemberForm => ({
  name: '',
  email: '',
  password: '',
  roleId: 'sales',
  status: 'active',
  permissions: { ...emptyPermissions(), dashboard: true, sales: true },
  locationScope: 'all',
  warehouseIds: [],
});

export default function Team() {
  const { currentUser } = useStore();
  const { toast } = useToast();
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pageError, setPageError] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<TeamMember | null>(null);
  const [form, setForm] = useState<MemberForm>(createEmptyForm);
  const [formError, setFormError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [isExportingBackup, setIsExportingBackup] = useState(false);
  const [isRestoringBackup, setIsRestoringBackup] = useState(false);
  const [passwordResetConfigured, setPasswordResetConfigured] = useState<boolean | null>(null);
  const backupFileInputRef = useRef<HTMLInputElement>(null);

  const isOwner = currentUser?.roleId === 'owner';

  const loadMembers = async () => {
    setIsLoading(true);
    setPageError('');
    try {
      const [membersResponse, warehousesResponse, resetStatusResponse] = await Promise.all([
        fetch('/api/team/members', { credentials: 'include' }),
        fetch('/api/data/warehouses', { credentials: 'include' }),
        fetch('/api/auth/password-reset/status', { credentials: 'include' }),
      ]);
      const membersPayload = await readPayload<{ members?: TeamMember[]; error?: string }>(membersResponse);
      if (!membersResponse.ok || !Array.isArray(membersPayload.members)) {
        throw new Error(membersPayload.error ?? 'تعذر تحميل أعضاء الفريق.');
      }
      setMembers(membersPayload.members);
      if (warehousesResponse.ok) {
        const warehousesPayload = await readPayload<{ records?: Warehouse[] }>(warehousesResponse);
        setWarehouses((warehousesPayload.records ?? []).filter((warehouse) => warehouse.status !== 'inactive'));
      }
      if (resetStatusResponse.ok) {
        const resetStatusPayload = await readPayload<{ emailDeliveryConfigured?: boolean }>(resetStatusResponse);
        setPasswordResetConfigured(resetStatusPayload.emailDeliveryConfigured === true);
      }
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'تعذر تحميل أعضاء الفريق.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOwner) void loadMembers();
  }, [isOwner]);

  const openCreateDialog = () => {
    setEditingMember(null);
    setForm(createEmptyForm());
    setFormError('');
    setIsDialogOpen(true);
  };

  const openEditDialog = (member: TeamMember) => {
    setEditingMember(member);
    setForm({
      name: member.name,
      email: member.email,
      password: '',
      roleId: (ROLE_LABELS[member.roleId as RoleId] ? member.roleId : 'custom') as RoleId,
      status: member.status === 'inactive' ? 'inactive' : 'active',
      permissions: { ...emptyPermissions(), ...member.permissions },
      locationScope: (['all', 'selected', 'none'].includes(member.locationScope) ? member.locationScope : 'selected') as LocationScope,
      warehouseIds: member.warehouseIds.map(Number),
    });
    setFormError('');
    setIsDialogOpen(true);
  };

  const updateForm = <K extends keyof MemberForm>(field: K, value: MemberForm[K]) => {
    setForm((current) => ({ ...current, [field]: value }));
    setFormError('');
  };

  const updateRole = (roleId: RoleId) => {
    const permissions = emptyPermissions();
    if (roleId !== 'custom') {
      ROLE_PRESETS[roleId].forEach((key) => { permissions[key] = true; });
    }
    setForm((current) => ({ ...current, roleId, permissions }));
    setFormError('');
  };

  const togglePermission = (key: PermissionKey, checked: boolean) => {
    setForm((current) => ({
      ...current,
      roleId: 'custom',
      permissions: { ...current.permissions, [key]: checked },
    }));
    setFormError('');
  };

  const toggleWarehouse = (id: number, checked: boolean) => {
    setForm((current) => ({
      ...current,
      warehouseIds: checked
        ? [...new Set([...current.warehouseIds, id])]
        : current.warehouseIds.filter((warehouseId) => warehouseId !== id),
    }));
    setFormError('');
  };

  const submitMember = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.name.trim() || !form.email.trim()) {
      setFormError('أدخل اسم العضو والبريد الإلكتروني.');
      return;
    }
    if (!editingMember && form.password.length < 8) {
      setFormError('كلمة المرور يجب أن تكون 8 أحرف على الأقل.');
      return;
    }
    if (editingMember && form.password && form.password.length < 8) {
      setFormError('كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل.');
      return;
    }
    if (form.locationScope === 'selected' && form.warehouseIds.length === 0) {
      setFormError('اختر موقعاً واحداً على الأقل أو استخدم نطاق «كل المواقع».');
      return;
    }

    setIsSubmitting(true);
    setFormError('');
    try {
      const response = await fetch(editingMember ? `/api/team/members/${editingMember.id}` : '/api/team/members', {
        method: editingMember ? 'PATCH' : 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim(),
          ...(form.password ? { password: form.password } : {}),
          roleId: form.roleId,
          status: form.status,
          permissions: form.permissions,
          locationScope: form.locationScope,
          warehouseIds: form.locationScope === 'selected' ? form.warehouseIds : [],
        }),
      });
      const payload = await readPayload<{ member?: TeamMember; error?: string }>(response);
      if (!response.ok || !payload.member) {
        throw new Error(payload.error ?? (editingMember ? 'تعذر تحديث بيانات العضو.' : 'تعذر إضافة العضو.'));
      }
      setMembers((current) => editingMember
        ? current.map((member) => member.id === payload.member!.id ? payload.member! : member)
        : [...current, payload.member!]);
      setIsDialogOpen(false);
      toast({
        title: editingMember ? 'تم تحديث العضو' : 'تمت إضافة عضو الفريق',
        description: editingMember ? 'حُفظت بيانات العضو وصلاحياته بنجاح.' : 'يمكن للعضو الآن تسجيل الدخول إلى سجل المنشأة.',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'تعذر حفظ بيانات العضو.';
      setFormError(message);
      toast({ title: 'تعذر إتمام العملية', description: message, variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleMember = async (member: TeamMember) => {
    setTogglingId(member.id);
    try {
      const response = await fetch(`/api/team/members/${member.id}/toggle`, {
        method: 'POST',
        credentials: 'include',
      });
      const payload = await readPayload<{ member?: TeamMember; error?: string }>(response);
      if (!response.ok || !payload.member) throw new Error(payload.error ?? 'تعذر تغيير حالة العضو.');
      setMembers((current) => current.map((item) => item.id === member.id ? payload.member! : item));
      toast({
        title: payload.member.status === 'active' ? 'تم تنشيط العضو' : 'تم إيقاف العضو',
        description: payload.member.status === 'active'
          ? 'استعاد العضو إمكانية الدخول إلى السجل.'
          : 'تم إلغاء جلسات العضو ومنعه من الدخول.',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'تعذر تغيير حالة العضو.';
      toast({ title: 'تعذر تغيير الحالة', description: message, variant: 'destructive' });
    } finally {
      setTogglingId(null);
    }
  };

  const exportBackup = async () => {
    setIsExportingBackup(true);
    try {
      const response = await fetch('/api/backup/export', { credentials: 'include' });
      if (!response.ok) {
        const payload = await readPayload<{ error?: string }>(response);
        throw new Error(payload.error ?? 'تعذر إنشاء النسخة الاحتياطية.');
      }
      const content = await response.text();
      const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = `tarseed-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      toast({ title: 'تم تنزيل النسخة الاحتياطية', description: 'احتفظ بالملف في مكان آمن ولا تشاركه مع غير المخولين.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'تعذر إنشاء النسخة الاحتياطية.';
      toast({ title: 'تعذر التنزيل', description: message, variant: 'destructive' });
    } finally {
      setIsExportingBackup(false);
    }
  };

  const restoreBackup = async (file: File | undefined) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.json')) {
      toast({ title: 'ملف غير صالح', description: 'اختر ملف نسخة احتياطية بصيغة JSON.', variant: 'destructive' });
      return;
    }
    try {
      const backup = JSON.parse(await file.text()) as unknown;
      if (!window.confirm('استعادة النسخة ستستبدل جميع بيانات التشغيل والمحاسبة الحالية لهذه المنشأة. هل تريد المتابعة؟')) {
        return;
      }
      setIsRestoringBackup(true);
      const response = await fetch('/api/backup/restore', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(backup),
      });
      const payload = await readPayload<{ message?: string; error?: string; recordCount?: number }>(response);
      if (!response.ok) throw new Error(payload.error ?? 'تعذرت استعادة النسخة الاحتياطية.');
      toast({
        title: 'تمت استعادة النسخة الاحتياطية',
        description: `تم استعادة ${payload.recordCount ?? 0} سجل. ستُحدَّث الصفحة الآن.`,
      });
      window.setTimeout(() => window.location.reload(), 700);
    } catch (error) {
      const message = error instanceof Error
        ? error.name === 'SyntaxError' ? 'ملف النسخة الاحتياطية ليس JSON صالحاً.' : error.message
        : 'تعذرت استعادة النسخة الاحتياطية.';
      toast({ title: 'تعذرت الاستعادة', description: message, variant: 'destructive' });
    } finally {
      setIsRestoringBackup(false);
      if (backupFileInputRef.current) backupFileInputRef.current.value = '';
    }
  };

  const activeCount = useMemo(() => members.filter((member) => member.status === 'active').length, [members]);

  if (!currentUser) {
    return <AccessMessage title="سجّل الدخول لإدارة الفريق" description="هذه الصفحة مخصصة لمالك المنشأة وإدارة أعضاء السجل المشترك." />;
  }
  if (!isOwner) {
    return <AccessMessage title="لا تملك صلاحية إدارة الفريق" description="يمكن لمالك المنشأة فقط إضافة أعضاء الفريق وتعديل صلاحياتهم." />;
  }

  return (
    <div className="space-y-6" data-testid="page-team">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <UsersRound className="h-5 w-5" aria-hidden="true" />
          </div>
          <h2 className="text-2xl font-bold text-slate-900">أعضاء الفريق</h2>
          <p className="mt-1 text-slate-500">أضف أعضاء إلى سجل {currentUser.projectName} وحدد ما يمكنهم الوصول إليه.</p>
        </div>
        <Button onClick={openCreateDialog} data-testid="button-add-team-member">
          <Plus className="h-4 w-4" />
          إضافة عضو
        </Button>
      </div>

      {pageError && (
        <div className="flex flex-col gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 sm:flex-row sm:items-center sm:justify-between" role="alert" data-testid="team-page-error">
          <span>{pageError}</span>
          <Button type="button" variant="outline" size="sm" onClick={() => void loadMembers()}>إعادة المحاولة</Button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard label="إجمالي الأعضاء" value={members.length} icon={<UsersRound className="h-4 w-4" />} />
        <SummaryCard label="أعضاء نشطون" value={activeCount} icon={<ShieldCheck className="h-4 w-4" />} />
        <SummaryCard label="موقوفون" value={members.length - activeCount} icon={<UserRoundX className="h-4 w-4" />} />
      </div>

      <Card>
        <CardHeader className="border-b border-slate-100">
          <CardTitle className="text-lg">النسخ الاحتياطي والاستعادة</CardTitle>
          <CardDescription>نزّل نسخة من بيانات التشغيل والمحاسبة، واستعدها عند الحاجة. الاستعادة تستبدل البيانات الحالية للمنشأة.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="max-w-xl text-sm leading-6 text-slate-600">لا يتضمن الملف كلمات المرور أو الجلسات. احتفظ به في مكان آمن لأنه يحتوي على بيانات المنشأة.</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => void exportBackup()} disabled={isExportingBackup} data-testid="button-export-backup">
              {isExportingBackup ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
              {isExportingBackup ? 'جارٍ التجهيز...' : 'تنزيل نسخة احتياطية'}
            </Button>
            <input
              ref={backupFileInputRef}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={(event) => void restoreBackup(event.target.files?.[0])}
              data-testid="input-restore-backup"
            />
            <Button type="button" onClick={() => backupFileInputRef.current?.click()} disabled={isRestoringBackup} data-testid="button-restore-backup">
              {isRestoringBackup ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Upload className="h-4 w-4" aria-hidden="true" />}
              {isRestoringBackup ? 'جارٍ الاستعادة...' : 'استعادة نسخة'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b border-slate-100">
          <CardTitle className="text-lg">استعادة كلمة المرور</CardTitle>
          <CardDescription>تُرسل روابط الاستعادة عبر البريد، وتظهر هنا جاهزية الإرسال للإطلاق الفعلي.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-start gap-3 p-5">
          <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${passwordResetConfigured ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
            <KeyRound className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <p className="font-semibold text-slate-900">
              {passwordResetConfigured === true ? 'بريد الاستعادة جاهز للإرسال' : passwordResetConfigured === false ? 'يلزم ضبط بريد إرسال موثق قبل النشر' : 'جارٍ التحقق من إعدادات الإرسال'}
            </p>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              {passwordResetConfigured === true
                ? 'يمكن للمستخدمين طلب رابط آمن لتغيير كلمة المرور.'
                : 'اضبط RESEND_FROM_EMAIL بعنوان موثق في Resend. العنوان التجريبي لا يصلح عادةً لإرسال رسائل حقيقية لجميع العملاء.'}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b border-slate-100">
          <CardTitle className="text-lg">الوصول إلى السجل المشترك</CardTitle>
          <CardDescription>يتشارك الأعضاء البيانات نفسها، وتحدد الصلاحيات الوحدات والمواقع التي تظهر لهم.</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 p-12 text-sm text-slate-500" role="status">
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
              جارٍ تحميل أعضاء الفريق...
            </div>
          ) : members.length === 0 ? (
            <div className="p-12 text-center">
              <UserRound className="mx-auto h-9 w-9 text-slate-300" aria-hidden="true" />
              <p className="mt-3 font-semibold text-slate-700">لم تضف أي عضو بعد</p>
              <p className="mt-1 text-sm text-slate-500">ابدأ بإضافة أول موظف للوصول إلى السجل المشترك.</p>
              <Button className="mt-5" onClick={openCreateDialog}>إضافة أول عضو</Button>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {members.map((member) => (
                <div key={member.id} className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between" data-testid={`team-member-${member.id}`}>
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-slate-100 text-slate-600">
                      <UserRound className="h-5 w-5" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-slate-900">{member.name}</p>
                      <p className="mt-0.5 flex items-center gap-1 truncate text-sm text-slate-500" dir="ltr">
                        <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        {member.email}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{ROLE_LABELS[member.roleId as RoleId] ?? 'مخصص'}</Badge>
                        <Badge variant={member.status === 'active' ? 'success' : 'secondary'}>
                          {member.status === 'active' ? 'نشط' : 'موقوف'}
                        </Badge>
                        <span className="text-xs text-slate-500">{permissionCount(member.permissions)} صلاحيات · {locationLabel(member)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-2 self-end lg:self-center">
                    <Button type="button" variant="outline" size="sm" onClick={() => openEditDialog(member)} data-testid={`button-edit-team-member-${member.id}`}>
                      <Pencil className="h-3.5 w-3.5" />
                      تعديل
                    </Button>
                    <Button
                      type="button"
                      variant={member.status === 'active' ? 'outline' : 'default'}
                      size="sm"
                      disabled={togglingId === member.id}
                      onClick={() => void toggleMember(member)}
                      data-testid={`button-toggle-team-member-${member.id}`}
                    >
                      {togglingId === member.id && <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                      {member.status === 'active' ? 'إيقاف الوصول' : 'تنشيط الوصول'}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-2xl" dir="rtl">
          <DialogHeader>
            <DialogTitle>{editingMember ? 'تعديل عضو الفريق' : 'إضافة عضو إلى السجل المشترك'}</DialogTitle>
            <DialogDescription>
              {editingMember ? 'حدّث بيانات العضو أو صلاحياته. اترك كلمة المرور فارغة للإبقاء عليها.' : 'أنشئ بيانات دخول للعضو وحدد الوحدات والمواقع التي يحتاجها.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitMember} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="team-member-name">اسم العضو</Label>
                <Input id="team-member-name" value={form.name} onChange={(event) => updateForm('name', event.target.value)} placeholder="الاسم الكامل" required data-testid="input-team-member-name" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="team-member-email">البريد الإلكتروني</Label>
                <Input id="team-member-email" type="email" dir="ltr" className="text-left" value={form.email} onChange={(event) => updateForm('email', event.target.value)} placeholder="name@company.com" required data-testid="input-team-member-email" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="team-member-password">{editingMember ? 'كلمة مرور جديدة (اختياري)' : 'كلمة المرور'}</Label>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
                  <Input id="team-member-password" type="password" dir="ltr" className="pr-9 text-left" value={form.password} onChange={(event) => updateForm('password', event.target.value)} placeholder={editingMember ? 'اتركها فارغة دون تغيير' : '٨ أحرف على الأقل'} required={!editingMember} data-testid="input-team-member-password" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="team-member-role">الدور</Label>
                <select id="team-member-role" value={form.roleId} onChange={(event) => updateRole(event.target.value as RoleId)} className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm" data-testid="select-team-member-role">
                  {Object.entries(ROLE_LABELS).map(([roleId, label]) => <option key={roleId} value={roleId}>{label}</option>)}
                </select>
              </div>
            </div>

            {editingMember && (
              <div className="space-y-2">
                <Label htmlFor="team-member-status">حالة الوصول</Label>
                <select id="team-member-status" value={form.status} onChange={(event) => updateForm('status', event.target.value as MemberStatus)} className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm" data-testid="select-team-member-status">
                  <option value="active">نشط — يمكنه تسجيل الدخول</option>
                  <option value="inactive">موقوف — لا يمكنه تسجيل الدخول</option>
                </select>
              </div>
            )}

            <div className="space-y-3">
              <div>
                <Label>صلاحيات الوحدات</Label>
                <p className="mt-1 text-xs text-slate-500">اختر الوحدات التي يحتاجها العضو فقط.</p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {PERMISSIONS.map(({ key, label, description }) => (
                  <label key={key} className="flex cursor-pointer items-start gap-3 rounded-lg border border-slate-200 p-3 transition-colors hover:border-primary/50">
                    <Checkbox checked={form.permissions[key]} onCheckedChange={(checked) => togglePermission(key, checked === true)} data-testid={`checkbox-team-permission-${key}`} />
                    <span>
                      <span className="block text-sm font-semibold text-slate-800">{label}</span>
                      <span className="block text-xs text-slate-500">{description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <Label htmlFor="team-member-location-scope">نطاق المواقع</Label>
                <p className="mt-1 text-xs text-slate-500">حدد الفروع والمستودعات التي يستطيع العضو التعامل معها.</p>
              </div>
              <select id="team-member-location-scope" value={form.locationScope} onChange={(event) => updateForm('locationScope', event.target.value as LocationScope)} className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm" data-testid="select-team-member-location-scope">
                <option value="all">كل المواقع</option>
                <option value="selected">مواقع محددة</option>
                <option value="none">لا مواقع</option>
              </select>
              {form.locationScope === 'selected' && (
                <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2">
                  {warehouses.length === 0 ? (
                    <p className="text-sm text-slate-500 sm:col-span-2">لا توجد مواقع نشطة للاختيار.</p>
                  ) : warehouses.map((warehouse) => (
                    <label key={warehouse.id} className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                      <Checkbox checked={form.warehouseIds.includes(warehouse.id)} onCheckedChange={(checked) => toggleWarehouse(warehouse.id, checked === true)} data-testid={`checkbox-team-warehouse-${warehouse.id}`} />
                      {warehouse.name}
                    </label>
                  ))}
                </div>
              )}
            </div>

            {formError && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800" role="alert" data-testid="team-form-error">{formError}</div>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>إلغاء</Button>
              <Button type="submit" disabled={isSubmitting} data-testid="button-submit-team-member">
                {isSubmitting && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {isSubmitting ? 'جارٍ الحفظ...' : editingMember ? 'حفظ التعديلات' : 'إضافة العضو'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SummaryCard({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-5">
        <div>
          <p className="text-sm text-slate-500">{label}</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
        </div>
        <div className="rounded-lg bg-slate-100 p-2 text-slate-600">{icon}</div>
      </CardContent>
    </Card>
  );
}

function AccessMessage({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-10 text-center shadow-sm" data-testid="team-access-message">
      <ShieldCheck className="mx-auto h-10 w-10 text-slate-300" aria-hidden="true" />
      <h2 className="mt-4 text-xl font-bold text-slate-900">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">{description}</p>
    </div>
  );
}

function permissionCount(permissions: Record<string, boolean>): number {
  return PERMISSIONS.filter(({ key }) => permissions[key] === true).length;
}

function locationLabel(member: TeamMember): string {
  if (member.locationScope === 'all') return 'كل المواقع';
  if (member.locationScope === 'none') return 'لا مواقع';
  return `${member.warehouseIds.length} مواقع محددة`;
}

async function readPayload<T>(response: Response): Promise<T> {
  return response.json().catch(() => ({})) as Promise<T>;
}