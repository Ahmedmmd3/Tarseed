import React, { useState } from 'react';
import { useStore, JournalLine } from '@/context/store';
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
import { Plus, Trash2 } from 'lucide-react';

export default function Journals() {
  const { journals, accounts, addJournal, postJournal } = useStore();
  const { toast } = useToast();
  const [isAddOpen, setIsAddOpen] = useState(false);

  // Form state
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [description, setDescription] = useState('');
  const [lines, setLines] = useState<Omit<JournalLine, 'id'>[]>([
    { accountId: '', debit: 0, credit: 0 },
    { accountId: '', debit: 0, credit: 0 }
  ]);

  const addLine = () => {
    setLines([...lines, { accountId: '', debit: 0, credit: 0 }]);
  };

  const removeLine = (index: number) => {
    if (lines.length > 2) {
      setLines(lines.filter((_, i) => i !== index));
    }
  };

  const updateLine = (index: number, field: keyof Omit<JournalLine, 'id'>, value: string | number) => {
    const newLines = [...lines];
    newLines[index] = { ...newLines[index], [field]: value };
    setLines(newLines);
  };

  const totalDebit = lines.reduce((sum, l) => sum + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + (Number(l.credit) || 0), 0);
  const isBalanced = totalDebit === totalCredit && totalDebit > 0;
  const canSubmit = isBalanced && description && date && lines.every(l => l.accountId !== '');

  const handleAddSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    try {
      await addJournal({
        date,
        description,
        status: 'draft',
        lines: lines.map((l, i) => ({ ...l, id: `temp-${i}` }))
      });
      setDate(new Date().toISOString().split('T')[0]);
      setDescription('');
      setLines([
        { accountId: '', debit: 0, credit: 0 },
        { accountId: '', debit: 0, credit: 0 }
      ]);
      setIsAddOpen(false);
    } catch (error) {
      toast({
        title: 'تعذر حفظ القيد',
        description: error instanceof Error ? error.message : 'تعذر حفظ القيد. أعد المحاولة.',
        variant: 'destructive',
      });
    }
  };

  const handlePostJournal = async (id: string) => {
    try {
      await postJournal(id);
    } catch (error) {
      toast({
        title: 'تعذر ترحيل القيد',
        description: error instanceof Error ? error.message : 'تعذر ترحيل القيد. أعد المحاولة.',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="space-y-6" data-testid="page-journals">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">القيود اليومية</h2>
          <p className="text-gray-500 mt-1">سجل الحركات المالية المزدوجة.</p>
        </div>
        
        <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-journal">
              <Plus className="h-4 w-4 ml-2" />
              قيد جديد
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>إضافة قيد يومية</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleAddSubmit} className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="date">التاريخ</Label>
                  <Input type="date" id="date" value={date} onChange={e => setDate(e.target.value)} required data-testid="input-journal-date" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="desc">البيان</Label>
                  <Input id="desc" value={description} onChange={e => setDescription(e.target.value)} placeholder="وصف العملية" required data-testid="input-journal-desc" />
                </div>
              </div>

              <div className="mt-6">
                <Label>أسطر القيد</Label>
                <div className="mt-2 border rounded-md overflow-hidden">
                  <Table>
                    <TableHeader className="bg-gray-50">
                      <TableRow>
                        <TableHead>الحساب</TableHead>
                        <TableHead className="w-32">مدين</TableHead>
                        <TableHead className="w-32">دائن</TableHead>
                        <TableHead className="w-12"></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lines.map((line, idx) => (
                        <TableRow key={idx}>
                          <TableCell className="p-2">
                            <select 
                              value={line.accountId}
                              onChange={e => updateLine(idx, 'accountId', e.target.value)}
                              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                              required
                              data-testid={`select-journal-account-${idx}`}
                            >
                              <option value="" disabled>اختر الحساب...</option>
                              {accounts.map(acc => (
                                <option key={acc.id} value={acc.id}>{acc.code} - {acc.name}</option>
                              ))}
                            </select>
                          </TableCell>
                          <TableCell className="p-2">
                            <Input 
                              type="number" 
                              min="0"
                              value={line.debit || ''} 
                              onChange={e => updateLine(idx, 'debit', Number(e.target.value))}
                              disabled={line.credit > 0}
                              data-testid={`input-journal-debit-${idx}`}
                            />
                          </TableCell>
                          <TableCell className="p-2">
                            <Input 
                              type="number" 
                              min="0"
                              value={line.credit || ''} 
                              onChange={e => updateLine(idx, 'credit', Number(e.target.value))}
                              disabled={line.debit > 0}
                              data-testid={`input-journal-credit-${idx}`}
                            />
                          </TableCell>
                          <TableCell className="p-2 text-center">
                            <Button 
                              type="button" 
                              variant="ghost" 
                              size="icon" 
                              onClick={() => removeLine(idx)}
                              disabled={lines.length <= 2}
                              className="text-red-500 hover:text-red-700"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
                <div className="flex justify-between items-center mt-2 px-2">
                  <Button type="button" variant="outline" size="sm" onClick={addLine} data-testid="button-add-line">
                    <Plus className="h-3 w-3 ml-1" /> سطر جديد
                  </Button>
                  <div className="flex gap-4 text-sm font-semibold">
                    <div className={totalDebit !== totalCredit ? 'text-red-500' : 'text-green-600'}>
                      إجمالي مدين: {totalDebit}
                    </div>
                    <div className={totalDebit !== totalCredit ? 'text-red-500' : 'text-green-600'}>
                      إجمالي دائن: {totalCredit}
                    </div>
                  </div>
                </div>
              </div>

              <DialogFooter className="mt-8">
                <DialogClose asChild>
                  <Button type="button" variant="outline">إلغاء</Button>
                </DialogClose>
                <Button type="submit" disabled={!canSubmit} data-testid="button-submit-journal">حفظ القيد</Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="space-y-4">
        {journals.slice().reverse().map(journal => (
          <Card key={journal.id} data-testid={`card-journal-${journal.id}`}>
            <div className="p-4 border-b bg-gray-50/50 flex justify-between items-center">
              <div className="flex items-center gap-4">
                <span className="font-bold text-lg">{journal.number}</span>
                <span className="text-gray-500 text-sm">{journal.date}</span>
                <span className="font-medium">{journal.description}</span>
              </div>
              <div className="flex items-center gap-3">
                <Badge variant={journal.status === 'posted' ? 'success' : 'warning'}>
                  {journal.status === 'posted' ? 'مرحّل' : 'مسودة'}
                </Badge>
                {journal.status === 'draft' && (
                  <Button size="sm" onClick={() => { void handlePostJournal(journal.id); }} data-testid={`button-post-${journal.id}`}>
                    ترحيل القيد
                  </Button>
                )}
              </div>
            </div>
            <div className="p-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>رقم الحساب</TableHead>
                    <TableHead>اسم الحساب</TableHead>
                    <TableHead className="text-left">مدين</TableHead>
                    <TableHead className="text-left">دائن</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {journal.lines.map(line => {
                    const acc = accounts.find(a => a.id === line.accountId);
                    return (
                      <TableRow key={line.id}>
                        <TableCell className="font-mono">{acc?.code}</TableCell>
                        <TableCell>{acc?.name}</TableCell>
                        <TableCell className="text-left font-medium">{line.debit > 0 ? line.debit : '-'}</TableCell>
                        <TableCell className="text-left font-medium">{line.credit > 0 ? line.credit : '-'}</TableCell>
                      </TableRow>
                    );
                  })}
                  <TableRow className="bg-gray-50 font-bold">
                    <TableCell colSpan={2} className="text-left">الإجمالي</TableCell>
                    <TableCell className="text-left">{journal.lines.reduce((s, l) => s + l.debit, 0)}</TableCell>
                    <TableCell className="text-left">{journal.lines.reduce((s, l) => s + l.credit, 0)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </Card>
        ))}
        {journals.length === 0 && (
          <div className="text-center p-8 text-gray-500 border rounded-lg bg-white">
            لا توجد قيود مسجلة.
          </div>
        )}
      </div>
    </div>
  );
}
