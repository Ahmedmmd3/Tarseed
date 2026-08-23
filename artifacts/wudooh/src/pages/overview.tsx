import React from 'react';
import { useStore } from '@/context/store';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowDownRight, ArrowUpRight, DollarSign, Wallet } from 'lucide-react';

export default function Overview() {
  const { accounts, receivables } = useStore();

  const totalRevenue = accounts.filter(a => a.type === 'revenue').reduce((sum, a) => sum + a.balance, 0);
  const totalExpense = accounts.filter(a => a.type === 'expense').reduce((sum, a) => sum + a.balance, 0);
  const netProfit = totalRevenue - totalExpense;

  const totalReceivables = receivables.filter(r => r.type === 'receivable').reduce((sum, r) => sum + (r.amount - r.paid), 0);
  const totalPayables = receivables.filter(r => r.type === 'payable').reduce((sum, r) => sum + (r.amount - r.paid), 0);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ar-SA', { style: 'currency', currency: 'SAR' }).format(amount);
  };

  return (
    <div className="space-y-6" data-testid="page-overview">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">النظرة العامة المالية</h2>
        <p className="text-gray-500 mt-1">ملخص الإقفال المالي والموقف الحالي للمنشأة.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">صافي الربح</CardTitle>
            <DollarSign className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-net-profit">{formatCurrency(netProfit)}</div>
            <p className="text-xs text-gray-500 mt-1">الإيرادات ناقص المصروفات</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">إجمالي الإيرادات</CardTitle>
            <ArrowUpRight className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-revenue">{formatCurrency(totalRevenue)}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">الذمم المدينة (لنا)</CardTitle>
            <Wallet className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-receivables">{formatCurrency(totalReceivables)}</div>
            <p className="text-xs text-gray-500 mt-1">مبالغ مستحقة من العملاء</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-gray-500">الذمم الدائنة (علينا)</CardTitle>
            <ArrowDownRight className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-payables">{formatCurrency(totalPayables)}</div>
            <p className="text-xs text-gray-500 mt-1">مبالغ مستحقة للموردين</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>أعلى المصروفات</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {accounts.filter(a => a.type === 'expense').sort((a, b) => b.balance - a.balance).slice(0, 5).map(acc => (
                <div key={acc.id} className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="font-medium">{acc.name}</span>
                    <span className="text-xs text-gray-500">{acc.code}</span>
                  </div>
                  <span className="font-semibold text-red-600" data-testid={`text-expense-${acc.id}`}>{formatCurrency(acc.balance)}</span>
                </div>
              ))}
              {accounts.filter(a => a.type === 'expense').length === 0 && (
                <div className="text-center text-sm text-gray-500 py-4">لا توجد مصروفات مسجلة</div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>مستحقات قريبة الأجل</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {receivables.filter(r => r.status !== 'paid').sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()).slice(0, 5).map(rec => (
                <div key={rec.id} className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="font-medium">{rec.party}</span>
                    <span className="text-xs text-gray-500">تستحق في {rec.dueDate}</span>
                  </div>
                  <div className="flex flex-col items-end">
                    <span className={`font-semibold ${rec.type === 'receivable' ? 'text-blue-600' : 'text-red-600'}`}>
                      {formatCurrency(rec.amount - rec.paid)}
                    </span>
                    <span className="text-xs text-gray-500">{rec.type === 'receivable' ? 'تحصيل' : 'دفع'}</span>
                  </div>
                </div>
              ))}
              {receivables.filter(r => r.status !== 'paid').length === 0 && (
                <div className="text-center text-sm text-gray-500 py-4">لا توجد مستحقات معلقة</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
