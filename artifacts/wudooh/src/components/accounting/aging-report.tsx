import React, { useState, useEffect, useMemo } from 'react';
import { useStore } from '@/context/store';
import { todayLocalDate } from '@/lib/date';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { CalendarClock, Calculator, CloudOff, AlertTriangle, LoaderCircle } from 'lucide-react';

type AgingCategory = 'notDue' | '1-30' | '31-60' | '61-90' | 'over90';

type AgingItem = {
  id: string;
  type: 'receivable' | 'payable';
  party: string;
  reference: string;
  dueDate: string;
  amount: number;
  paid: number;
  remaining: number;
  status: string;
  bucket: AgingCategory;
};

type AgingResponse = {
  asOf: string;
  type: string;
  items: AgingItem[];
  totals: {
    notDue: number;
    '1-30': number;
    '31-60': number;
    '61-90': number;
    over90: number;
  };
  total: number;
};

type ComputedGroup = {
  items: AgingItem[];
  notDue: number;
  '1-30': number;
  '31-60': number;
  '61-90': number;
  over90: number;
  total: number;
};

export function AgingReport() {
  const { connectionMode, receivables: localReceivables } = useStore();
  const [referenceDate, setReferenceDate] = useState(todayLocalDate());
  const [data, setData] = useState<AgingResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (connectionMode !== 'remote') return;
    let active = true;
    setLoading(true);
    setError(null);
    fetch(`/api/accounting/aging?asOf=${referenceDate}`, { credentials: 'include' })
      .then(res => {
        if (!res.ok) throw new Error('تعذر تحميل تقرير أعمار الذمم من الخادم.');
        return res.json();
      })
      .then(json => {
        if (active) {
          setData(json as AgingResponse);
          setLoading(false);
        }
      })
      .catch(err => {
        if (active) {
          setError(err.message);
          setLoading(false);
        }
      });
    return () => { active = false; };
  }, [connectionMode, referenceDate]);

  const computeGroup = (items: AgingItem[]): ComputedGroup => {
    const summary: ComputedGroup = { items, notDue: 0, '1-30': 0, '31-60': 0, '61-90': 0, over90: 0, total: 0 };
    items.forEach(item => {
      summary[item.bucket] += item.remaining;
      summary.total += item.remaining;
    });
    return summary;
  };

  const localData = useMemo(() => {
    if (connectionMode === 'remote' && data) return null;
    
    const refTime = new Date(referenceDate).getTime();
    
    const items: AgingItem[] = [];
    localReceivables.forEach(item => {
      const remaining = item.amount - item.paid;
      if (remaining <= 0) return;
      
      const dueTime = new Date(item.dueDate).getTime();
      const diffDays = Math.floor((refTime - dueTime) / (1000 * 60 * 60 * 24));
      
      let bucket: AgingCategory = 'notDue';
      if (diffDays > 90) bucket = 'over90';
      else if (diffDays > 60) bucket = '61-90';
      else if (diffDays > 30) bucket = '31-60';
      else if (diffDays > 0) bucket = '1-30';
      
      items.push({
        id: item.id,
        type: item.type,
        party: item.party,
        reference: item.reference,
        dueDate: item.dueDate,
        amount: item.amount,
        paid: item.paid,
        remaining,
        status: item.status,
        bucket
      });
    });

    return {
      asOf: referenceDate,
      type: 'aging',
      items,
      totals: {
        notDue: 0,
        '1-30': 0,
        '31-60': 0,
        '61-90': 0,
        over90: 0,
      },
      total: 0
    } as AgingResponse;
  }, [connectionMode, data, localReceivables, referenceDate]);

  const displayData = (connectionMode === 'remote' && data) ? data : localData;

  const groupedData = useMemo(() => {
    if (!displayData) return null;
    const recs = displayData.items.filter(i => i.type === 'receivable');
    const pays = displayData.items.filter(i => i.type === 'payable');
    return {
      receivables: computeGroup(recs),
      payables: computeGroup(pays)
    };
  }, [displayData]);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ar-SA', { minimumFractionDigits: 2 }).format(amount);
  };

  const renderCategoryBadge = (cat: AgingCategory) => {
    switch (cat) {
      case 'notDue': return <Badge variant="outline" className="bg-slate-100 text-slate-700">غير مستحق</Badge>;
      case '1-30': return <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">1 - 30 يوم</Badge>;
      case '31-60': return <Badge variant="outline" className="bg-orange-50 text-orange-700 border-orange-200">31 - 60 يوم</Badge>;
      case '61-90': return <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">61 - 90 يوم</Badge>;
      case 'over90': return <Badge variant="outline" className="bg-rose-100 text-rose-800 border-rose-300 font-bold">+90 يوم</Badge>;
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      <Card className="border-slate-200 shadow-sm">
        <CardContent className="py-5">
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-5">
            <div className="flex-1 max-w-sm bg-slate-50 p-4 rounded-lg border border-slate-100">
              <div className="flex items-center gap-2 mb-3">
                <Calculator className="h-4 w-4 text-slate-500" />
                <h3 className="text-sm font-bold text-slate-700">تاريخ التقرير المرجعي</h3>
              </div>
              <div className="space-y-1.5">
                <Input type="date" value={referenceDate} onChange={(e) => setReferenceDate(e.target.value)} className="bg-white" data-testid="input-aging-date" />
              </div>
            </div>
            
            {connectionMode === 'local' && (
              <div className="flex items-start gap-2 bg-amber-50 text-amber-800 p-3 rounded border border-amber-100 text-sm font-medium">
                <CloudOff className="h-4 w-4 mt-0.5 shrink-0" />
                <p>يتم عرض التقرير من البيانات المحلية لعدم توفر اتصال بالخادم.</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {loading && !displayData && (
        <Card className="p-12 text-center border-slate-200">
          <LoaderCircle className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
          <p className="text-slate-500 font-medium">جارٍ تحميل تقرير أعمار الذمم...</p>
        </Card>
      )}

      {error && (
        <Card className="p-8 border-red-200 bg-red-50 text-red-800 flex items-center justify-center gap-3">
          <AlertTriangle className="h-6 w-6" />
          <p className="font-bold">{error}</p>
        </Card>
      )}

      {groupedData && (
        <div className="space-y-8">
          {/* Receivables */}
          <Card className="border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-slate-50 border-b border-slate-200 p-4 flex flex-wrap gap-4 justify-between items-center">
              <div>
                <h3 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
                  <CalendarClock className="h-5 w-5 text-primary" />
                  أعمار الذمم المدينة (العملاء)
                </h3>
                <p className="text-sm text-slate-500 mt-1">حسب تاريخ الاستحقاق مقارنة بـ {referenceDate}</p>
              </div>
              <div className="bg-white px-4 py-2 rounded-md border border-slate-200 shadow-sm font-mono font-bold text-lg text-emerald-700">
                الإجمالي: {formatCurrency(groupedData.receivables.total)}
              </div>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-5 divide-y md:divide-y-0 md:divide-x md:divide-x-reverse border-b border-slate-200 bg-white">
              <div className="p-4 text-center space-y-1">
                <p className="text-xs font-semibold text-slate-500">غير مستحق</p>
                <p className="font-mono font-bold text-slate-900">{formatCurrency(groupedData.receivables.notDue)}</p>
              </div>
              <div className="p-4 text-center space-y-1">
                <p className="text-xs font-semibold text-slate-500">1 - 30 يوم</p>
                <p className="font-mono font-bold text-amber-600">{formatCurrency(groupedData.receivables['1-30'])}</p>
              </div>
              <div className="p-4 text-center space-y-1">
                <p className="text-xs font-semibold text-slate-500">31 - 60 يوم</p>
                <p className="font-mono font-bold text-orange-600">{formatCurrency(groupedData.receivables['31-60'])}</p>
              </div>
              <div className="p-4 text-center space-y-1">
                <p className="text-xs font-semibold text-slate-500">61 - 90 يوم</p>
                <p className="font-mono font-bold text-red-600">{formatCurrency(groupedData.receivables['61-90'])}</p>
              </div>
              <div className="p-4 text-center space-y-1 bg-rose-50/50">
                <p className="text-xs font-semibold text-rose-800">+90 يوم</p>
                <p className="font-mono font-bold text-rose-700">{formatCurrency(groupedData.receivables.over90)}</p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-slate-50/50">
                  <TableRow>
                    <TableHead>الجهة</TableHead>
                    <TableHead>المرجع</TableHead>
                    <TableHead>تاريخ الاستحقاق</TableHead>
                    <TableHead className="text-left">المبلغ الأصلي</TableHead>
                    <TableHead className="text-left">المدفوع</TableHead>
                    <TableHead className="text-left">المتبقي</TableHead>
                    <TableHead>التصنيف</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groupedData.receivables.items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-slate-500">لا توجد ذمم مدينة قائمة.</TableCell>
                    </TableRow>
                  ) : groupedData.receivables.items.map(item => (
                    <TableRow key={item.id} className="hover:bg-slate-50/80">
                      <TableCell className="font-bold text-slate-800">{item.party}</TableCell>
                      <TableCell className="text-slate-600">{item.reference || '—'}</TableCell>
                      <TableCell className="font-mono text-sm">{item.dueDate}</TableCell>
                      <TableCell className="text-left font-mono">{formatCurrency(item.amount)}</TableCell>
                      <TableCell className="text-left font-mono text-emerald-600">{formatCurrency(item.paid)}</TableCell>
                      <TableCell className="text-left font-mono font-bold text-slate-900">{formatCurrency(item.remaining)}</TableCell>
                      <TableCell>{renderCategoryBadge(item.bucket)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>

          {/* Payables */}
          <Card className="border-slate-200 shadow-sm overflow-hidden">
            <div className="bg-slate-50 border-b border-slate-200 p-4 flex flex-wrap gap-4 justify-between items-center">
              <div>
                <h3 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
                  <CalendarClock className="h-5 w-5 text-slate-600" />
                  أعمار الذمم الدائنة (الموردين)
                </h3>
                <p className="text-sm text-slate-500 mt-1">حسب تاريخ الاستحقاق مقارنة بـ {referenceDate}</p>
              </div>
              <div className="bg-white px-4 py-2 rounded-md border border-slate-200 shadow-sm font-mono font-bold text-lg text-rose-700">
                الإجمالي: {formatCurrency(groupedData.payables.total)}
              </div>
            </div>
            
            <div className="grid grid-cols-2 md:grid-cols-5 divide-y md:divide-y-0 md:divide-x md:divide-x-reverse border-b border-slate-200 bg-white">
              <div className="p-4 text-center space-y-1">
                <p className="text-xs font-semibold text-slate-500">غير مستحق</p>
                <p className="font-mono font-bold text-slate-900">{formatCurrency(groupedData.payables.notDue)}</p>
              </div>
              <div className="p-4 text-center space-y-1">
                <p className="text-xs font-semibold text-slate-500">1 - 30 يوم</p>
                <p className="font-mono font-bold text-amber-600">{formatCurrency(groupedData.payables['1-30'])}</p>
              </div>
              <div className="p-4 text-center space-y-1">
                <p className="text-xs font-semibold text-slate-500">31 - 60 يوم</p>
                <p className="font-mono font-bold text-orange-600">{formatCurrency(groupedData.payables['31-60'])}</p>
              </div>
              <div className="p-4 text-center space-y-1">
                <p className="text-xs font-semibold text-slate-500">61 - 90 يوم</p>
                <p className="font-mono font-bold text-red-600">{formatCurrency(groupedData.payables['61-90'])}</p>
              </div>
              <div className="p-4 text-center space-y-1 bg-rose-50/50">
                <p className="text-xs font-semibold text-rose-800">+90 يوم</p>
                <p className="font-mono font-bold text-rose-700">{formatCurrency(groupedData.payables.over90)}</p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-slate-50/50">
                  <TableRow>
                    <TableHead>الجهة</TableHead>
                    <TableHead>المرجع</TableHead>
                    <TableHead>تاريخ الاستحقاق</TableHead>
                    <TableHead className="text-left">المبلغ الأصلي</TableHead>
                    <TableHead className="text-left">المدفوع</TableHead>
                    <TableHead className="text-left">المتبقي</TableHead>
                    <TableHead>التصنيف</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groupedData.payables.items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-slate-500">لا توجد ذمم دائنة قائمة.</TableCell>
                    </TableRow>
                  ) : groupedData.payables.items.map(item => (
                    <TableRow key={item.id} className="hover:bg-slate-50/80">
                      <TableCell className="font-bold text-slate-800">{item.party}</TableCell>
                      <TableCell className="text-slate-600">{item.reference || '—'}</TableCell>
                      <TableCell className="font-mono text-sm">{item.dueDate}</TableCell>
                      <TableCell className="text-left font-mono">{formatCurrency(item.amount)}</TableCell>
                      <TableCell className="text-left font-mono text-emerald-600">{formatCurrency(item.paid)}</TableCell>
                      <TableCell className="text-left font-mono font-bold text-slate-900">{formatCurrency(item.remaining)}</TableCell>
                      <TableCell>{renderCategoryBadge(item.bucket)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
