import React, { useState } from 'react';
import { useStore, ReceivableType } from '@/context/store';
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
import { Plus } from 'lucide-react';

export default function Receivables() {
  const { receivables, addReceivable, payReceivable } = useStore();
  const [activeTab, setActiveTab] = useState<ReceivableType>('receivable');
  
  // Add form state
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [party, setParty] = useState('');
  const [reference, setReference] = useState('');
  const [amount, setAmount] = useState('');
  const [dueDate, setDueDate] = useState('');
  
  // Payment form state
  const [payId, setPayId] = useState<string | null>(null);
  const [payAmount, setPayAmount] = useState('');

  const filtered = receivables.filter(r => r.type === activeTab);

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!party || !amount || !dueDate) return;
    
    addReceivable({
      party,
      type: activeTab,
      reference,
      amount: Number(amount),
      dueDate,
      paid: 0,
      status: 'unpaid'
    });
    
    setParty('');
    setReference('');
    setAmount('');
    setDueDate('');
    setIsAddOpen(false);
  };

  const handlePaySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!payId || !payAmount) return;
    
    payReceivable(payId, Number(payAmount));
    setPayId(null);
    setPayAmount('');
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'paid': return <Badge variant="success">مسدد</Badge>;
      case 'partial': return <Badge variant="warning">جزئي</Badge>;
      case 'unpaid': return <Badge variant="destructive">غير مسدد</Badge>;
      default: return null;
    }
  };

  return (
    <div className="space-y-6" data-testid="page-receivables">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">الذمم والمستحقات</h2>
          <p className="text-gray-500 mt-1">متابعة ديون العملاء والتزامات الموردين.</p>
        </div>
        
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-receivable">
              <Plus className="h-4 w-4 ml-2" />
              إضافة فاتورة/مستحق
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>إضافة سجل {activeTab === 'receivable' ? 'مدين (لنا)' : 'دائن (علينا)'}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleAddSubmit} className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="party">اسم {activeTab === 'receivable' ? 'العميل' : 'المورد'}</Label>
                <Input id="party" value={party} onChange={e => setParty(e.target.value)} required data-testid="input-party" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ref">رقم المرجع (الفاتورة)</Label>
                <Input id="ref" value={reference} onChange={e => setReference(e.target.value)} data-testid="input-ref" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="amount">المبلغ الإجمالي</Label>
                  <Input type="number" id="amount" value={amount} onChange={e => setAmount(e.target.value)} required data-testid="input-amount" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="due">تاريخ الاستحقاق</Label>
                  <Input type="date" id="due" value={dueDate} onChange={e => setDueDate(e.target.value)} required data-testid="input-due" />
                </div>
              </div>
              <DialogFooter className="mt-6">
                <DialogClose asChild>
                  <Button type="button" variant="outline">إلغاء</Button>
                </DialogClose>
                <Button type="submit" data-testid="button-submit-receivable">حفظ</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex space-x-1 space-x-reverse border-b">
        <button
          className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'receivable' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          onClick={() => setActiveTab('receivable')}
          data-testid="tab-receivable"
        >
          ذمم مدينة (تحصيل)
        </button>
        <button
          className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${activeTab === 'payable' ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
          onClick={() => setActiveTab('payable')}
          data-testid="tab-payable"
        >
          ذمم دائنة (دفع)
        </button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الجهة</TableHead>
                <TableHead>المرجع</TableHead>
                <TableHead>الاستحقاق</TableHead>
                <TableHead className="text-left">المبلغ</TableHead>
                <TableHead className="text-left">المدفوع</TableHead>
                <TableHead className="text-left">المتبقي</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead className="text-left">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map(rec => {
                const remaining = rec.amount - rec.paid;
                return (
                  <TableRow key={rec.id} data-testid={`row-rec-${rec.id}`}>
                    <TableCell className="font-medium">{rec.party}</TableCell>
                    <TableCell>{rec.reference || '-'}</TableCell>
                    <TableCell>{rec.dueDate}</TableCell>
                    <TableCell className="text-left">{rec.amount}</TableCell>
                    <TableCell className="text-left text-green-600">{rec.paid}</TableCell>
                    <TableCell className="text-left font-bold text-red-600">{remaining}</TableCell>
                    <TableCell>{getStatusBadge(rec.status)}</TableCell>
                    <TableCell className="text-left">
                      {rec.status !== 'paid' && (
                        <Button size="sm" variant="outline" onClick={() => setPayId(rec.id)} data-testid={`button-pay-${rec.id}`}>
                          {activeTab === 'receivable' ? 'قبض' : 'سداد'}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
              {filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="text-center py-8 text-gray-500">
                    لا توجد سجلات.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Payment Dialog */}
      <Dialog open={!!payId} onOpenChange={(open) => !open && setPayId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>تسجيل دفعة</DialogTitle>
          </DialogHeader>
          <form onSubmit={handlePaySubmit} className="space-y-4 py-4">
            {payId && (() => {
              const rec = receivables.find(r => r.id === payId);
              if (!rec) return null;
              return (
                <div className="bg-gray-50 p-4 rounded-md mb-4 text-sm">
                  <div className="flex justify-between mb-1">
                    <span className="text-gray-500">الجهة:</span>
                    <span className="font-medium">{rec.party}</span>
                  </div>
                  <div className="flex justify-between text-lg font-bold mt-2">
                    <span>المبلغ المتبقي:</span>
                    <span className="text-red-600">{rec.amount - rec.paid}</span>
                  </div>
                </div>
              );
            })()}
            <div className="space-y-2">
              <Label htmlFor="payAmount">مبلغ الدفعة</Label>
              <Input type="number" id="payAmount" max={payId ? (receivables.find(r => r.id === payId)?.amount ?? 0) - (receivables.find(r => r.id === payId)?.paid ?? 0) : undefined} value={payAmount} onChange={e => setPayAmount(e.target.value)} required data-testid="input-pay-amount" />
            </div>
            <DialogFooter className="mt-6">
              <DialogClose asChild>
                <Button type="button" variant="outline">إلغاء</Button>
              </DialogClose>
              <Button type="submit" data-testid="button-submit-payment">حفظ الدفعة</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
