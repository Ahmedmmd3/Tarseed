import { useState, useCallback, useEffect } from 'react';
import { useStore } from '@/context/store';
import { useToast } from '@/hooks/use-toast';

export type SalesReturnItem = {
  productId: number;
  name: string;
  sku: string;
  sourceLineIndex?: number;
  quantity: number;
  unitPriceExVat: number;
  lineNet: number;
  vatRate: number;
  vatAmount: number;
  lineGross: number;
};

export type SalesReturn = {
  id: number;
  number: string;
  originalInvoiceId: number;
  originalInvoiceNumber: string;
  warehouseId: number;
  date: string;
  reason: string;
  items: SalesReturnItem[];
  subtotal: number;
  tax: number;
  total: number;
  cogsTotal?: number;
  refundMethod: string;
  refundStatus: string;
  journalEntryId?: number;
  eInvoiceDocumentId?: number;
  eInvoiceStatus?: string;
};

export function useSalesReturns() {
  const { currentUser } = useStore();
  const { toast } = useToast();
  const [data, setData] = useState<SalesReturn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const getHeaders = useCallback(() => {
    if (!currentUser) throw new Error('غير مصرح');
    return {
      'Content-Type': 'application/json',
      'X-Wudooh-Data-Generation': String(currentUser.dataGeneration),
    };
  }, [currentUser]);

  const load = useCallback(async () => {
    if (!currentUser) {
      setData([]);
      setLoading(false);
      setError('');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/inventory/sales-returns`, { credentials: 'include', headers: getHeaders() });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || 'حدث خطأ أثناء جلب المرتجعات');
      }
      const payload = await res.json();
      setData(payload.returns || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [currentUser, getHeaders]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async (payload: {
    invoiceId: number;
    returnDate: string;
    reason: string;
    items: { productId: number; quantity: number }[];
    clientOperationId: string;
  }) => {
    try {
      const res = await fetch(`/api/inventory/sales-returns`, {
        method: 'POST',
        credentials: 'include',
        headers: getHeaders(),
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || 'تعذر إنشاء المرتجع');
      }
      await load();
      toast({
        title: 'تم تسجيل المرتجع بنجاح',
        description: `رقم المرتجع: ${data.salesReturn?.number || 'غير معروف'}`
      });
      return { success: true, salesReturn: data.salesReturn, created: data.created };
    } catch (e: any) {
      toast({ title: 'حدث خطأ', description: e.message, variant: 'destructive' });
      return { success: false, error: e.message };
    }
  };

  return { data, loading, error, load, create };
}
