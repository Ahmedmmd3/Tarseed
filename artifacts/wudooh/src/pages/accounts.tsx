import React, { useMemo, useState } from 'react';
import { useStore, Account, AccountType } from '@/context/store';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pencil, Plus, Power, Search, LayoutGrid, CheckCircle2, XCircle, ChevronDown, ChevronLeft } from 'lucide-react';

const TYPE_LABELS: Record<AccountType, string> = {
  asset: 'الأصول',
  liability: 'الخصوم',
  equity: 'حقوق الملكية',
  revenue: 'الإيرادات',
  expense: 'المصروفات',
};

const TYPE_COLORS: Record<AccountType, 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning'> = {
  asset: 'success',
  liability: 'warning',
  equity: 'secondary',
  revenue: 'default',
  expense: 'destructive',
};

const TYPE_ORDER: AccountType[] = ['asset', 'liability', 'equity', 'revenue', 'expense'];

export default function Accounts() {
  const { accounts, journals, addAccount, updateAccount, addOpeningBalance } = useStore();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<AccountType | 'all'>('all');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('asset');
  const [parent, setParent] = useState<string>('');
  const [openingAmount, setOpeningAmount] = useState('');
  const [openingSide, setOpeningSide] = useState<'debit' | 'credit'>('debit');
  const [openingDate, setOpeningDate] = useState(`${new Date().getFullYear()}-01-01`);
  const [counterAccountId, setCounterAccountId] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const filteredAccounts = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ar');
    return accounts.filter((account) => {
      const matchesSearch = !query
        || account.name.toLocaleLowerCase('ar').includes(query)
        || account.code.toLocaleLowerCase('ar').includes(query);
      return matchesSearch && (filterType === 'all' || account.type === filterType);
    });
  }, [accounts, filterType, search]);

  const groupedAccounts = useMemo(() => TYPE_ORDER.map((accountType) => {
    const inType = filteredAccounts.filter((account) => account.type === accountType);
    const included = new Set(inType.map((account) => account.id));
    const children = new Map<string, Account[]>();
    for (const account of inType) {
      const key = account.parent && included.has(account.parent) ? account.parent : '';
      children.set(key, [...(children.get(key) ?? []), account]);
    }
    const rows: Array<{ account: Account; depth: number; hasChildren: boolean }> = [];
    const visit = (key: string, depth: number) => {
      for (const account of (children.get(key) ?? []).sort((left, right) => left.code.localeCompare(right.code, 'en'))) {
        const hasChildren = (children.get(account.id)?.length ?? 0) > 0;
        rows.push({ account, depth, hasChildren });
        if (!collapsed.has(account.id)) visit(account.id, depth + 1);
      }
    };
    visit('', 0);
    return {
    type: accountType,
    rows,
  };
  }).filter((group) => group.rows.length > 0), [collapsed, filteredAccounts]);

  const displayedBalances = useMemo(() => new Map(accounts.map((account) => {
    const journalMovement = journals
      .filter((journal) => journal.status === 'posted')
      .flatMap((journal) => journal.lines)
      .filter((line) => line.accountId === account.id)
      .reduce((sum, line) => sum + line.debit - line.credit, 0);
    return [account.id, Number(account.openingBalance ?? 0) + journalMovement];
  })), [accounts, journals]);

  const resetForm = () => {
    setCode('');
    setName('');
    setType('asset');
    setParent('');
    setOpeningAmount('');
    setOpeningSide('debit');
    setCounterAccountId('');
    setEditingAccount(null);
  };

  const openAddDialog = () => {
    resetForm();
    setIsDialogOpen(true);
  };

  const openEditDialog = (account: Account) => {
    setEditingAccount(account);
    setCode(account.code);
    setName(account.name);
    setType(account.type);
    setParent(account.parent ?? '');
    setIsDialogOpen(true);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const normalizedCode = code.trim();
    const normalizedName = name.trim();
    if (!/^\d{3,10}$/.test(normalizedCode)) {
      toast({ title: 'رقم الحساب غير صحيح', description: 'أدخل رقماً مكوناً من 3 إلى 10 أرقام.', variant: 'destructive' });
      return;
    }
    if (!normalizedName) {
      toast({ title: 'اسم الحساب مطلوب', description: 'أدخل اسماً واضحاً للحساب.', variant: 'destructive' });
      return;
    }
    const duplicate = accounts.some((account) => account.code === normalizedCode && account.id !== editingAccount?.id);
    if (duplicate) {
      toast({ title: 'رقم الحساب مستخدم', description: 'اختر رقماً مختلفاً لتجنب تكرار الحسابات.', variant: 'destructive' });
      return;
    }

    try {
      if (editingAccount) {
        await updateAccount(editingAccount.id, { code: normalizedCode, name: normalizedName, type, parent: parent || null });
        const amount = Number(openingAmount);
        if (amount > 0) {
          await addOpeningBalance({ accountId: editingAccount.id, counterAccountId, amount, side: openingSide, date: openingDate, mode: 'correction' });
        }
        toast({ title: 'تم تحديث الحساب', description: `تم حفظ التعديلات على ${normalizedName}.` });
      } else {
        const created = await addAccount({ code: normalizedCode, name: normalizedName, type, parent: parent || null, openingBalance: 0, balance: 0, status: 'active' });
        const amount = Number(openingAmount);
        if (amount > 0) {
          await addOpeningBalance({ accountId: created.id, counterAccountId, amount, side: openingSide, date: openingDate });
        }
        toast({ title: 'تمت إضافة الحساب', description: `أضيف ${normalizedName} إلى دليل الحسابات.` });
      }
      setIsDialogOpen(false);
      resetForm();
    } catch (error) {
      toast({
        title: editingAccount ? 'تعذر تحديث الحساب' : 'تعذر حفظ الحساب',
        description: error instanceof Error ? error.message : 'تعذر تنفيذ العملية. أعد المحاولة.',
        variant: 'destructive',
      });
    }
  };

  const toggleStatus = async (account: Account) => {
    try {
      await updateAccount(account.id, { status: account.status === 'active' ? 'inactive' : 'active' });
      toast({
        title: account.status === 'active' ? 'تم تعطيل الحساب' : 'تم تنشيط الحساب',
        description: account.status === 'active' ? 'لن يظهر الحساب في القيود الجديدة.' : 'أصبح الحساب متاحاً للاستخدام.',
      });
    } catch (error) {
      toast({
        title: 'تعذر تحديث حالة الحساب',
        description: error instanceof Error ? error.message : 'تعذر تحديث حالة الحساب. أعد المحاولة.',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="space-y-6" data-testid="page-accounts">
      <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-900">دليل الحسابات</h2>
          <p className="mt-1 text-sm text-slate-500">إدارة شجرة الحسابات المحاسبية والأرصدة الافتتاحية للمنشأة.</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={(open) => { setIsDialogOpen(open); if (!open) resetForm(); }}>
          <DialogTrigger asChild>
            <Button onClick={openAddDialog} className="shadow-sm" data-testid="button-add-account">
              <Plus className="ml-2 h-4 w-4" />
              حساب جديد
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-xl">{editingAccount ? 'تعديل الحساب' : 'إضافة حساب جديد'}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-5 py-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="code" className="text-sm font-semibold">رقم الحساب</Label>
                <Input id="code" className="font-mono text-left" dir="ltr" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="1001" required data-testid="input-account-code" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="parent" className="text-sm font-semibold">الحساب الأب</Label>
                <select id="parent" value={parent} onChange={(event) => setParent(event.target.value)} className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm" data-testid="select-account-parent">
                  <option value="">حساب رئيسي</option>
                  {accounts.filter((account) => account.id !== editingAccount?.id && account.status === 'active' && account.type === type).sort((a, b) => a.code.localeCompare(b.code, 'en')).map((account) => (
                    <option key={account.id} value={account.id}>{account.code} — {account.name}</option>
                  ))}
                </select>
              </div>
              {(
                <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <Label className="font-semibold">{editingAccount ? 'تصحيح الرصيد الافتتاحي اختياري' : 'رصيد افتتاحي اختياري'}</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <Input type="number" min="0" step="0.01" value={openingAmount} onChange={(event) => setOpeningAmount(event.target.value)} placeholder="المبلغ" data-testid="input-opening-amount" />
                    <select value={openingSide} onChange={(event) => setOpeningSide(event.target.value as 'debit' | 'credit')} className="h-10 rounded-md border border-input bg-white px-3 text-sm" data-testid="select-opening-side">
                      <option value="debit">مدين</option><option value="credit">دائن</option>
                    </select>
                  </div>
                  <Input type="date" value={openingDate} onChange={(event) => setOpeningDate(event.target.value)} data-testid="input-opening-date" />
                  <select value={counterAccountId} onChange={(event) => setCounterAccountId(event.target.value)} required={Number(openingAmount) > 0} className="h-10 w-full rounded-md border border-input bg-white px-3 text-sm" data-testid="select-opening-counter-account">
                    <option value="">اختر الحساب المقابل</option>
                    {accounts.filter((account) => account.status === 'active').map((account) => <option key={account.id} value={account.id}>{account.code} — {account.name}</option>)}
                  </select>
                  <p className="text-xs text-slate-500">{editingAccount ? 'أدخل الرصيد النهائي المطلوب؛ سيُرحّل قيد بالفرق فقط.' : 'يُنشأ قيد افتتاحي مرحّل ومتوازن. أي تغيير لاحق يتم بقيد تصحيح مستقل.'}</p>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="name" className="text-sm font-semibold">اسم الحساب</Label>
                <Input id="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="مثال: صندوق الرياض" required data-testid="input-account-name" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="type" className="text-sm font-semibold">تصنيف الحساب</Label>
                <div className="relative">
                  <select id="type" value={type} onChange={(event) => setType(event.target.value as AccountType)} className="flex h-10 w-full appearance-none rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50" data-testid="select-account-type">
                    {TYPE_ORDER.map((key) => <option key={key} value={key}>{TYPE_LABELS[key]}</option>)}
                  </select>
                  <LayoutGrid className="absolute left-3 top-3 h-4 w-4 text-slate-400 pointer-events-none" />
                </div>
              </div>
              <DialogFooter className="pt-2">
                <DialogClose asChild><Button type="button" variant="outline">إلغاء</Button></DialogClose>
                <Button type="submit" data-testid="button-submit-account">{editingAccount ? 'حفظ التعديلات' : 'إضافة الحساب'}</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="border-slate-200 shadow-sm overflow-hidden">
        <div className="flex flex-col items-center gap-3 border-b border-slate-100 bg-slate-50/50 p-4 sm:flex-row">
          <div className="relative w-full flex-1 max-w-md">
            <Search className="absolute right-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input placeholder="ابحث برقم أو اسم الحساب..." value={search} onChange={(event) => setSearch(event.target.value)} className="w-full bg-white pl-3 pr-9 shadow-sm" data-testid="input-search-account" />
          </div>
          <div className="relative w-full sm:w-auto">
            <select value={filterType} onChange={(event) => setFilterType(event.target.value as AccountType | 'all')} className="h-9 w-full appearance-none rounded-md border border-input bg-white px-3 pl-8 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:w-40" data-testid="select-filter-type">
              <option value="all">كل التصنيفات</option>
              {TYPE_ORDER.map((key) => <option key={key} value={key}>{TYPE_LABELS[key]}</option>)}
            </select>
            <LayoutGrid className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400 pointer-events-none" />
          </div>
          <Badge variant="secondary" className="shrink-0 font-mono hidden sm:inline-flex">{filteredAccounts.length} حساب</Badge>
        </div>

        <CardContent className="p-0">
          {groupedAccounts.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-16 text-center">
              <div className="rounded-full bg-slate-100 p-3 mb-4">
                <Search className="h-6 w-6 text-slate-400" />
              </div>
              <p className="text-lg font-semibold text-slate-900">لا توجد حسابات مطابقة</p>
              <p className="mt-1 text-sm text-slate-500 max-w-sm">جرّب تغيير كلمات البحث أو الفلتر المستخدم، أو قم بإضافة حساب جديد إلى الدليل.</p>
            </div>
          ) : (
            <div className="space-y-8 p-6">
              {groupedAccounts.map((group) => (
                <section key={group.type} aria-labelledby={`accounts-group-${group.type}`} className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                  <div className="mb-4 flex items-center gap-3">
                    <h3 id={`accounts-group-${group.type}`} className="text-lg font-bold text-slate-900">{TYPE_LABELS[group.type]}</h3>
                    <Badge variant={TYPE_COLORS[group.type]} className="font-mono text-xs">{group.rows.length}</Badge>
                    <div className="h-px flex-1 bg-slate-100"></div>
                  </div>
                  <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
                    <Table>
                      <TableHeader className="bg-slate-50/80">
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="w-32 font-semibold">رقم الحساب</TableHead>
                          <TableHead className="font-semibold">اسم الحساب</TableHead>
                          <TableHead className="text-left font-semibold">الرصيد</TableHead>
                          <TableHead className="w-28 font-semibold">الحالة</TableHead>
                          <TableHead className="w-32 text-left font-semibold">إجراءات</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {group.rows.map(({ account, depth, hasChildren }) => (
                          <TableRow key={account.id} className="group transition-colors hover:bg-slate-50/50" data-testid={`row-account-${account.id}`}>
                            <TableCell className="font-mono text-sm font-medium text-slate-600">{account.code}</TableCell>
                            <TableCell className="font-medium text-slate-900">
                              <div className="flex items-center gap-1" style={{ paddingInlineStart: `${depth * 22}px` }}>
                                {hasChildren ? (
                                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => setCollapsed((current) => {
                                    const next = new Set(current); next.has(account.id) ? next.delete(account.id) : next.add(account.id); return next;
                                  })} aria-label={collapsed.has(account.id) ? 'فتح الحسابات الفرعية' : 'طي الحسابات الفرعية'} data-testid={`button-toggle-tree-${account.id}`}>
                                    {collapsed.has(account.id) ? <ChevronLeft className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                  </Button>
                                ) : <span className="inline-block w-7" />}
                                <span>{account.name}</span>
                              </div>
                            </TableCell>
                            <TableCell className="text-left">
                              <span className="inline-block font-mono text-sm font-semibold tabular-nums tracking-tight" dir="ltr">
                                {new Intl.NumberFormat('ar-SA', { minimumFractionDigits: 2 }).format(displayedBalances.get(account.id) ?? 0)}
                              </span>
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1.5">
                                {account.status === 'active' ? (
                                  <><CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /><span className="text-xs font-medium text-emerald-700">نشط</span></>
                                ) : (
                                  <><XCircle className="h-3.5 w-3.5 text-slate-400" /><span className="text-xs font-medium text-slate-600">موقوف</span></>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-left">
                              <div className="flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity focus-within:opacity-100 sm:opacity-100">
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-primary hover:bg-primary/10" onClick={() => openEditDialog(account)} title="تعديل" data-testid={`button-edit-account-${account.id}`}>
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <Button variant="ghost" size="icon" className={`h-8 w-8 ${account.status === 'active' ? 'text-slate-500 hover:text-amber-600 hover:bg-amber-50' : 'text-slate-500 hover:text-emerald-600 hover:bg-emerald-50'}`} onClick={() => { void toggleStatus(account); }} title={account.status === 'active' ? 'إيقاف' : 'تنشيط'} data-testid={`button-toggle-status-${account.id}`}>
                                  <Power className="h-4 w-4" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </section>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}