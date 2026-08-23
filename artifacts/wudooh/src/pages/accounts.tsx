import React, { useState } from 'react';
import { useStore, Account, AccountType } from '@/context/store';
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
import { Plus, Search } from 'lucide-react';

const TYPE_LABELS: Record<AccountType, string> = {
  asset: 'أصل',
  liability: 'التزام',
  equity: 'حقوق ملكية',
  revenue: 'إيراد',
  expense: 'مصروف',
};

const TYPE_COLORS: Record<AccountType, 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning'> = {
  asset: 'success',
  liability: 'warning',
  equity: 'secondary',
  revenue: 'default',
  expense: 'destructive',
};

export default function Accounts() {
  const { accounts, addAccount, updateAccount } = useStore();
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<string>('all');
  const [isAddOpen, setIsAddOpen] = useState(false);

  // Form state
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('asset');

  const filteredAccounts = accounts.filter(a => {
    const matchesSearch = a.name.includes(search) || a.code.includes(search);
    const matchesType = filterType === 'all' || a.type === filterType;
    return matchesSearch && matchesType;
  });

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!code || !name) return;
    
    addAccount({
      code,
      name,
      type,
      parent: null,
      balance: 0,
      status: 'active'
    });
    
    setCode('');
    setName('');
    setType('asset');
    setIsAddOpen(false);
  };

  const toggleStatus = (id: string, currentStatus: 'active' | 'inactive') => {
    updateAccount(id, { status: currentStatus === 'active' ? 'inactive' : 'active' });
  };

  return (
    <div className="space-y-6" data-testid="page-accounts">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">دليل الحسابات</h2>
          <p className="text-gray-500 mt-1">إدارة شجرة الحسابات المحاسبية للمنشأة.</p>
        </div>
        
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-account">
              <Plus className="h-4 w-4 ml-2" />
              حساب جديد
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>إضافة حساب جديد</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleAddSubmit} className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="code">رقم الحساب</Label>
                <Input id="code" value={code} onChange={e => setCode(e.target.value)} placeholder="مثال: 1001" required data-testid="input-account-code" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="name">اسم الحساب</Label>
                <Input id="name" value={name} onChange={e => setName(e.target.value)} placeholder="مثال: صندوق الرياض" required data-testid="input-account-name" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="type">نوع الحساب</Label>
                <select 
                  id="type"
                  value={type} 
                  onChange={e => setType(e.target.value as AccountType)}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  data-testid="select-account-type"
                >
                  {Object.entries(TYPE_LABELS).map(([key, label]) => (
                    <option key={key} value={key}>{label}</option>
                  ))}
                </select>
              </div>
              <DialogFooter className="mt-6">
                <DialogClose asChild>
                  <Button type="button" variant="outline">إلغاء</Button>
                </DialogClose>
                <Button type="submit" data-testid="button-submit-account">حفظ الحساب</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="p-4 border-b flex flex-col sm:flex-row gap-4 items-center">
            <div className="relative flex-1 w-full">
              <Search className="absolute right-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="ابحث برقم أو اسم الحساب..." 
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-3 pr-9 w-full"
                data-testid="input-search-account"
              />
            </div>
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm w-full sm:w-auto"
              data-testid="select-filter-type"
            >
              <option value="all">كل الأنواع</option>
              {Object.entries(TYPE_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
          
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>رقم الحساب</TableHead>
                <TableHead>اسم الحساب</TableHead>
                <TableHead>النوع</TableHead>
                <TableHead>الرصيد</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead className="text-left">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAccounts.map((account) => (
                <TableRow key={account.id} data-testid={`row-account-${account.id}`}>
                  <TableCell className="font-mono text-sm">{account.code}</TableCell>
                  <TableCell className="font-medium">{account.name}</TableCell>
                  <TableCell>
                    <Badge variant={TYPE_COLORS[account.type]}>
                      {TYPE_LABELS[account.type]}
                    </Badge>
                  </TableCell>
                  <TableCell dir="ltr" className="text-right font-medium">
                    {new Intl.NumberFormat('ar-SA').format(account.balance)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={account.status === 'active' ? 'outline' : 'secondary'}>
                      {account.status === 'active' ? 'نشط' : 'موقوف'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-left">
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={() => toggleStatus(account.id, account.status)}
                      data-testid={`button-toggle-status-${account.id}`}
                    >
                      {account.status === 'active' ? 'إيقاف' : 'تنشيط'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {filteredAccounts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                    لا توجد حسابات مطابقة للبحث.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
