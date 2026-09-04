import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useStore } from '@/context/store';
import { useToast } from '@/hooks/use-toast';
import { todayLocalDate } from '@/lib/date';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter, DialogClose } from '@/components/ui/dialog';
import { CheckSquare, Upload, CloudOff, AlertTriangle, LoaderCircle, CheckCircle, Calculator, Info, Play, Plus, X } from 'lucide-react';

type ReconSession = {
  id: number;
  accountId: number;
  status: 'open' | 'approved';
  statementDate: string;
  statementBalance: number;
  warehouseId?: number | null;
  createdAt?: string;
};

type ReconStatementLine = {
  id: number;
  date: string;
  reference: string;
  amount: number;
  description: string;
  status: 'unmatched' | 'matched';
  matchMethod?: 'automatic' | 'manual';
  unmatchedReason?: string;
  manualReason?: string;
  journalId?: number;
};

type ReconLedgerMovement = {
  id: number;
  date: string;
  reference: string;
  description: string;
  amount: number;
  matchedStatementLineId?: number;
};

type ReconData = {
  session: ReconSession;
  statementLines: ReconStatementLine[];
  ledgerMovements: ReconLedgerMovement[];
  period: { from: string | null; to: string };
  bookBalance: number;
};

export function ReconciliationReport() {
  const { connectionMode, accounts, journals, currentUser } = useStore();
  const { toast } = useToast();
  
  const [accountId, setAccountId] = useState<string>('');
  const year = new Date().getFullYear();
  const [fromDate, setFromDate] = useState(`${year}-01-01`);
  const [statementDate, setStatementDate] = useState(todayLocalDate());
  
  const [sessions, setSessions] = useState<ReconSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [data, setData] = useState<ReconData | null>(null);
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const [csvInput, setCsvInput] = useState('');
  const [statementBalance, setStatementBalance] = useState<string>('');
  const [warehouseId, setWarehouseId] = useState<string>('');
  
  // Diff Journal State
  const [isDiffOpen, setIsDiffOpen] = useState(false);
  const [diffType, setDiffType] = useState<'bankFee' | 'interest' | 'cashVariance'>('bankFee');
  const [diffAccountId, setDiffAccountId] = useState('');
  const [diffAmount, setDiffAmount] = useState('');
  
  // Manual Match State
  const [manualMatchTarget, setManualMatchTarget] = useState<number | null>(null);
  const [manualMatchReason, setManualMatchReason] = useState('');

  const targetAccounts = accounts.filter(a => a.code === '1000' || a.code === '1100');
  const needsWarehouseSelection = currentUser?.locationScope !== 'all';
  const allowedWarehouses = currentUser?.warehouseIds || [];

  const fetchSessions = useCallback(async () => {
    if (connectionMode !== 'remote') return;
    try {
      const res = await fetch('/api/accounting/reconciliations', { credentials: 'include' });
      if (res.ok) {
        const json = await res.json();
        setSessions(json.sessions as ReconSession[]);
      }
    } catch (e) {
      // ignore
    }
  }, [connectionMode]);

  useEffect(() => {
    void fetchSessions();
  }, [fetchSessions]);

  const loadSession = useCallback(async (id: number) => {
    if (connectionMode !== 'remote') return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/accounting/reconciliations/${id}?from=${fromDate}`, { credentials: 'include' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'تعذر تحميل الجلسة.');
      setData(json as ReconData);
      setCurrentSessionId(String(id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'خطأ غير معروف');
    } finally {
      setLoading(false);
    }
  }, [connectionMode, fromDate]);

  const handleCreateSession = async () => {
    if (connectionMode !== 'remote') {
      toast({ title: 'غير متاح', description: 'لا يمكن إنشاء جلسة تسوية بدون اتصال بالخادم.', variant: 'destructive' });
      return;
    }
    if (!accountId || !statementBalance) {
      toast({ title: 'خطأ', description: 'يرجى تحديد الحساب والرصيد الفعلي.', variant: 'destructive' });
      return;
    }
    if (needsWarehouseSelection && !warehouseId) {
      toast({ title: 'خطأ', description: 'يرجى تحديد المستودع.', variant: 'destructive' });
      return;
    }
    
    // Parse CSV: Date, Reference, Amount, Description
    const lines = [];
    if (csvInput.trim()) {
      const rows = csvInput.trim().split('\n');
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row.trim()) continue;
        const cols = row.split(',').map(c => c.trim());
        if (cols.length < 3) {
          toast({ title: 'خطأ في الاستيراد', description: `السطر ${i + 1} يفتقر للأعمدة المطلوبة.`, variant: 'destructive' });
          return;
        }
        const date = cols[0];
        const reference = cols[1];
        const amount = parseFloat(cols[2]);
        const description = cols[3] || '';
        
        if (isNaN(amount)) {
          toast({ title: 'خطأ في الاستيراد', description: `المبلغ غير صالح في السطر ${i + 1}.`, variant: 'destructive' });
          return;
        }
        lines.push({ date, reference, amount, description });
      }
    }

    setLoading(true);
    try {
      const idempotencyKey = crypto.randomUUID();
      const res = await fetch('/api/accounting/reconciliations', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          accountId: Number(accountId),
          statementDate,
          statementBalance: parseFloat(statementBalance),
          lines,
          ...(warehouseId ? { warehouseId: parseInt(warehouseId) } : {})
        })
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'تعذر إنشاء الجلسة.');
      toast({ title: 'نجاح', description: 'تم إنشاء جلسة التسوية بنجاح.' });
      setCsvInput('');
      void fetchSessions();
      void loadSession(json.session.id);
    } catch (e) {
      toast({ title: 'خطأ', description: e instanceof Error ? e.message : 'حدث خطأ', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleAutoMatch = async () => {
    if (!currentSessionId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/accounting/reconciliations/${currentSessionId}/auto-match`, {
        method: 'POST',
        credentials: 'include'
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'تعذر تنفيذ المطابقة الآلية.');
      toast({ title: 'تمت العملية', description: 'اكتملت المطابقة الآلية.' });
      void loadSession(Number(currentSessionId));
    } catch (e) {
      toast({ title: 'خطأ', description: e instanceof Error ? e.message : 'حدث خطأ', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleManualMatch = async (statementLineId: number, journalId: number) => {
    if (!currentSessionId) return;
    if (!manualMatchReason.trim()) {
      toast({ title: 'خطأ', description: 'يرجى إدخال سبب المطابقة اليدوية.', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/accounting/reconciliations/${currentSessionId}/matches`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ statementLineId, journalId, reason: manualMatchReason })
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'تعذر المطابقة.');
      }
      setManualMatchTarget(null);
      setManualMatchReason('');
      toast({ title: 'تمت العملية', description: 'تمت المطابقة اليدوية بنجاح.' });
      void loadSession(Number(currentSessionId));
    } catch (e) {
      toast({ title: 'خطأ', description: e instanceof Error ? e.message : 'حدث خطأ', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleAdjustment = async () => {
    if (!currentSessionId) return;
    if (!diffAccountId || !diffAmount) {
      toast({ title: 'خطأ', description: 'يرجى تعبئة الحساب والمبلغ.', variant: 'destructive' });
      return;
    }
    setLoading(true);
    try {
      const idempotencyKey = crypto.randomUUID();
      const res = await fetch(`/api/accounting/reconciliations/${currentSessionId}/adjustments`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          type: diffType,
          amount: parseFloat(diffAmount),
          date: statementDate,
          offsetAccountId: Number(diffAccountId)
        })
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'تعذر تسجيل التسوية.');
      
      setIsDiffOpen(false);
      setDiffAmount('');
      toast({ title: 'تمت العملية', description: 'تم تسجيل حركة التسوية بنجاح. يرجى مطابقتها يدوياً أو آلياً.' });
      void loadSession(Number(currentSessionId));
    } catch (e) {
      toast({ title: 'خطأ', description: e instanceof Error ? e.message : 'حدث خطأ', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const handleApprove = async () => {
    if (!currentSessionId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/accounting/reconciliations/${currentSessionId}/approve`, {
        method: 'POST',
        credentials: 'include'
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'تعذر اعتماد الجلسة.');
      toast({ title: 'تمت العملية', description: 'تم اعتماد التسوية بنجاح.' });
      void loadSession(Number(currentSessionId));
      void fetchSessions();
    } catch (e) {
      toast({ title: 'خطأ', description: e instanceof Error ? e.message : 'حدث خطأ', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('ar-SA', { minimumFractionDigits: 2 }).format(amount);
  };

  const renderDashboardOrSession = () => {
    if (connectionMode !== 'remote') {
      return (
        <Card className="p-12 text-center border-slate-200">
          <CloudOff className="h-12 w-12 text-slate-300 mx-auto mb-4" />
          <h3 className="text-xl font-bold text-slate-700 mb-2">جلسات التسوية تتطلب اتصالاً بالخادم</h3>
          <p className="text-slate-500">لا يمكنك إنشاء أو اعتماد جلسة تسوية في وضع العمل المحلي للحفاظ على سلامة القيود.</p>
        </Card>
      );
    }

    if (currentSessionId && data) {
      return renderSessionView();
    }

    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-1 space-y-6">
          <Card className="border-slate-200 shadow-sm">
            <div className="bg-slate-50 border-b border-slate-200 p-4">
              <h3 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
                <Plus className="h-4 w-4 text-primary" />
                إنشاء جلسة تسوية جديدة
              </h3>
            </div>
            <CardContent className="p-4 space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-slate-600">الحساب</label>
                <Select value={accountId} onValueChange={setAccountId}>
                  <SelectTrigger className="bg-white">
                    <SelectValue placeholder="اختر الحساب" />
                  </SelectTrigger>
                  <SelectContent>
                    {targetAccounts.map(acc => (
                      <SelectItem key={acc.id} value={acc.id}>{acc.name} ({acc.code})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              
              {needsWarehouseSelection && (
                <div className="space-y-1.5">
                  <label className="text-sm font-semibold text-slate-600">المستودع (إلزامي)</label>
                  <Select value={warehouseId} onValueChange={setWarehouseId}>
                    <SelectTrigger className="bg-white">
                      <SelectValue placeholder="اختر المستودع" />
                    </SelectTrigger>
                    <SelectContent>
                      {allowedWarehouses.map(id => (
                        <SelectItem key={id} value={String(id)}>مستودع {id}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-slate-600">تاريخ الكشف</label>
                <Input type="date" value={statementDate} onChange={e => setStatementDate(e.target.value)} />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-semibold text-slate-600">رصيد الكشف الفعلي</label>
                <Input type="number" value={statementBalance} onChange={e => setStatementBalance(e.target.value)} placeholder="0.00" />
              </div>

              <div className="space-y-1.5 pt-2">
                <label className="text-sm font-semibold text-slate-600">استيراد حركات الكشف (اختياري)</label>
                <p className="text-xs text-slate-500 mb-2">صيغة CSV: التاريخ، المرجع، المبلغ، الوصف</p>
                <Textarea 
                  placeholder="2023-10-01, REF-01, 5000, إيداع نقدي&#10;2023-10-05, REF-02, -15, رسوم حوالة" 
                  value={csvInput}
                  onChange={(e) => setCsvInput(e.target.value)}
                  className="h-32 text-left"
                  dir="ltr"
                />
              </div>

              <Button onClick={handleCreateSession} disabled={loading} className="w-full">
                {loading ? <LoaderCircle className="animate-spin h-4 w-4 ml-2" /> : <Play className="h-4 w-4 ml-2" />}
                بدء التسوية
              </Button>
            </CardContent>
          </Card>
        </div>
        
        <div className="lg:col-span-2">
          <Card className="border-slate-200 shadow-sm">
            <div className="bg-slate-50 border-b border-slate-200 p-4">
              <h3 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
                <CheckSquare className="h-4 w-4 text-primary" />
                الجلسات السابقة (المسودة والمعتمدة)
              </h3>
            </div>
            <div className="p-0">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead>رقم الجلسة</TableHead>
                    <TableHead>الحساب</TableHead>
                    <TableHead>التاريخ</TableHead>
                    <TableHead>الرصيد</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessions.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-12 text-slate-500">لا توجد جلسات تسوية سابقة.</TableCell>
                    </TableRow>
                  ) : sessions.map(s => {
                    const acc = accounts.find(a => String(a.id) === String(s.accountId));
                    return (
                      <TableRow key={s.id}>
                        <TableCell className="font-mono text-sm">{s.id}</TableCell>
                        <TableCell>{acc?.name || s.accountId}</TableCell>
                        <TableCell className="font-mono">{s.statementDate}</TableCell>
                        <TableCell className="font-mono font-medium" dir="ltr">{formatCurrency(s.statementBalance)}</TableCell>
                        <TableCell>
                          {s.status === 'approved' ? (
                            <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200">معتمدة</Badge>
                          ) : (
                            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">مسودة</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button variant="outline" size="sm" onClick={() => loadSession(s.id)}>عرض / متابعة</Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </Card>
        </div>
      </div>
    );
  };

  const renderSessionView = () => {
    if (!data) return null;
    
    const isApproved = data.session.status === 'approved';
    const difference = data.session.statementBalance - data.bookBalance;

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 bg-slate-50 p-4 rounded-lg border border-slate-200">
          <div>
            <h2 className="text-lg font-bold flex items-center gap-2">
              تسوية حساب {accounts.find(a => String(a.id) === String(data.session.accountId))?.name}
              {isApproved && <Badge className="bg-emerald-100 text-emerald-800">معتمدة</Badge>}
            </h2>
            <div className="text-sm text-slate-500 mt-1 flex flex-wrap gap-x-4 gap-y-1">
              <p>تاريخ الكشف: {data.session.statementDate}</p>
              <p>رصيد الكشف: <span className="font-mono">{formatCurrency(data.session.statementBalance)}</span></p>
              <p>رصيد الدفاتر: <span className="font-mono">{formatCurrency(data.bookBalance)}</span></p>
              <p>الفرق: <span className={`font-mono font-bold ${Math.abs(difference) > 0.01 ? 'text-rose-600' : 'text-emerald-600'}`} dir="ltr">{formatCurrency(difference)}</span></p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-600 block">عرض القيود من</label>
              <div className="flex items-center gap-2">
                <Input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="h-8 text-sm" />
                <Button size="sm" variant="outline" onClick={() => loadSession(data.session.id)}>تحديث</Button>
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={() => { setCurrentSessionId(null); setData(null); }} title="إغلاق"><X className="h-5 w-5" /></Button>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Statement Lines */}
          <Card className="border-slate-200 shadow-sm flex flex-col h-[600px]">
            <div className="bg-slate-50 border-b border-slate-200 p-4 flex justify-between items-center">
              <h3 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
                <Upload className="h-4 w-4 text-primary" />
                كشف الحساب المستورد
              </h3>
              {!isApproved && (
                <Button size="sm" variant="secondary" onClick={handleAutoMatch} disabled={loading}>
                  <Calculator className="h-4 w-4 ml-2" /> مطابقة آلية
                </Button>
              )}
            </div>
            <CardContent className="p-0 flex-1 overflow-y-auto">
              <Table>
                <TableHeader className="bg-slate-50/50 sticky top-0 z-10">
                  <TableRow>
                    <TableHead>التاريخ / المرجع</TableHead>
                    <TableHead>البيان</TableHead>
                    <TableHead className="text-left">المبلغ</TableHead>
                    <TableHead>الحالة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.statementLines.length === 0 ? (
                    <TableRow><TableCell colSpan={4} className="text-center py-8 text-slate-500">لا توجد حركات في الكشف المستورد.</TableCell></TableRow>
                  ) : data.statementLines.map(line => (
                    <TableRow key={line.id} className={line.status !== 'unmatched' ? 'bg-emerald-50/30' : ''}>
                      <TableCell>
                        <div className="font-mono text-sm">{line.date}</div>
                        <div className="text-xs text-slate-500 font-mono">{line.reference}</div>
                      </TableCell>
                      <TableCell className="text-xs max-w-[150px] truncate" title={line.description}>{line.description}</TableCell>
                      <TableCell className="text-left font-mono font-medium" dir="ltr">{formatCurrency(line.amount)}</TableCell>
                      <TableCell>
                        {line.status === 'matched' && line.matchMethod === 'automatic' && <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200" title="مطابق آلياً">آلي</Badge>}
                        {line.status === 'matched' && line.matchMethod === 'manual' && <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200" title={line.manualReason}>يدوي</Badge>}
                        {line.status === 'unmatched' && (
                          <div className="flex flex-col gap-1 items-start">
                            <Badge variant="outline" className="bg-slate-100 text-slate-500" title={line.unmatchedReason}>غير مطابق</Badge>
                            {!isApproved && (
                              <Dialog open={manualMatchTarget === line.id} onOpenChange={(open) => !open ? setManualMatchTarget(null) : setManualMatchTarget(line.id)}>
                                <DialogTrigger asChild>
                                  <Button variant="outline" size="sm" className="h-6 text-[10px] px-2">يدوي</Button>
                                </DialogTrigger>
                                <DialogContent className="max-w-3xl max-h-[80vh] flex flex-col">
                                  <DialogHeader><DialogTitle>اختر حركة الدفاتر للمطابقة</DialogTitle></DialogHeader>
                                  <div className="bg-slate-50 p-3 rounded border border-slate-100 text-sm mb-2">
                                    <p>كشف: <span className="font-bold">{line.description}</span> بمبلغ <span className="font-mono" dir="ltr">{formatCurrency(line.amount)}</span> ({line.date})</p>
                                  </div>
                                  <div className="mb-2">
                                    <Input placeholder="سبب المطابقة اليدوية (إلزامي)" value={manualMatchReason} onChange={e => setManualMatchReason(e.target.value)} />
                                  </div>
                                  <div className="flex-1 overflow-y-auto border border-slate-200 rounded">
                                    <Table>
                                      <TableHeader className="bg-slate-50 sticky top-0"><TableRow><TableHead>التاريخ</TableHead><TableHead>البيان</TableHead><TableHead>المبلغ</TableHead><TableHead></TableHead></TableRow></TableHeader>
                                      <TableBody>
                                        {data.ledgerMovements.filter(l => !l.matchedStatementLineId).map(ll => (
                                          <TableRow key={ll.id} className="hover:bg-slate-50">
                                            <TableCell className="font-mono text-sm">{ll.date}</TableCell>
                                            <TableCell className="text-xs">{ll.description}</TableCell>
                                            <TableCell className="font-mono" dir="ltr">{formatCurrency(ll.amount)}</TableCell>
                                            <TableCell><Button size="sm" disabled={!manualMatchReason.trim()} onClick={() => handleManualMatch(line.id, ll.id)}>ربط</Button></TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </div>
                                </DialogContent>
                              </Dialog>
                            )}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Ledger Lines */}
          <Card className="border-slate-200 shadow-sm flex flex-col h-[600px]">
            <div className="bg-slate-50 border-b border-slate-200 p-4">
              <h3 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
                <Calculator className="h-4 w-4 text-primary" />
                حركات الدفاتر (النظام) للفترة
              </h3>
            </div>
            <CardContent className="p-0 flex-1 overflow-y-auto">
              <Table>
                <TableHeader className="bg-slate-50/50 sticky top-0">
                  <TableRow>
                    <TableHead>التاريخ</TableHead>
                    <TableHead>البيان</TableHead>
                    <TableHead className="text-left">المبلغ</TableHead>
                    <TableHead>المطابقة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.ledgerMovements.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-12 text-slate-500">لا توجد حركات في هذه الفترة.</TableCell>
                    </TableRow>
                  ) : data.ledgerMovements.map(line => (
                    <TableRow key={line.id} className={line.matchedStatementLineId ? 'bg-emerald-50/30' : ''}>
                      <TableCell className="font-mono text-sm">{line.date}</TableCell>
                      <TableCell className="text-xs">{line.description}</TableCell>
                      <TableCell className="text-left font-mono font-medium" dir="ltr">{formatCurrency(line.amount)}</TableCell>
                      <TableCell>
                        {line.matchedStatementLineId ? (
                          <CheckCircle className="h-4 w-4 text-emerald-500" />
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        {!isApproved && (
          <div className="flex flex-wrap items-center justify-between gap-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
            <Dialog open={isDiffOpen} onOpenChange={setIsDiffOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" className="text-amber-700 border-amber-200 bg-amber-50 hover:bg-amber-100">
                  تسجيل تسوية (عمولات/فروقات)
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader><DialogTitle>تسجيل قيد تسوية</DialogTitle></DialogHeader>
                <div className="space-y-4 py-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">نوع التسوية</label>
                    <Select value={diffType} onValueChange={(val: any) => setDiffType(val)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="bankFee">رسوم بنكية</SelectItem>
                        <SelectItem value="interest">فوائد</SelectItem>
                        <SelectItem value="cashVariance">فروقات جرد</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">حساب التسوية (المقابل)</label>
                    <Select value={diffAccountId} onValueChange={setDiffAccountId}>
                      <SelectTrigger><SelectValue placeholder="اختر الحساب المقابل" /></SelectTrigger>
                      <SelectContent>
                        {accounts.filter(a => a.type === 'expense' || a.type === 'revenue').map(a => (
                          <SelectItem key={a.id} value={a.id}>{a.name} ({a.code})</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">المبلغ</label>
                    <Input type="number" value={diffAmount} onChange={e => setDiffAmount(e.target.value)} placeholder="0.00 (سالب للخصم، موجب للإضافة)" />
                  </div>
                </div>
                <DialogFooter>
                  <DialogClose asChild><Button variant="outline">إلغاء</Button></DialogClose>
                  <Button onClick={handleAdjustment} disabled={loading}>حفظ</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <Button onClick={handleApprove} className="px-8" disabled={loading} data-testid="button-approve-recon">
               {loading ? <LoaderCircle className="animate-spin ml-2 h-4 w-4" /> : <CheckSquare className="ml-2 h-4 w-4" />}
               اعتماد التسوية
            </Button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
      {error && (
        <Card className="p-4 border-red-200 bg-red-50 text-red-800 flex items-center gap-3 mb-4">
          <AlertTriangle className="h-6 w-6" />
          <p className="font-bold">{error}</p>
        </Card>
      )}
      
      {renderDashboardOrSession()}
    </div>
  );
}
