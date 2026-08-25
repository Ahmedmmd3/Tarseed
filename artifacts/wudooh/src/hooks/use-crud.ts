import { useState, useCallback, useEffect } from 'react';
import { useStore } from '@/context/store';
import { useToast } from '@/hooks/use-toast';

export function useCrud<T extends { id: number | string }>(table: string) {
  const { currentUser } = useStore();
  const { toast } = useToast();
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const getHeaders = useCallback(() => {
    if (!currentUser) throw new Error('غير مصرح');
    return {
      'Content-Type': 'application/json',
      'X-Wudooh-Data-Generation': String(currentUser.dataGeneration),
    };
  }, [currentUser]);

  const handleResponse = async (res: Response) => {
    const payload = res.status === 204
      ? {}
      : await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 409 && payload.error?.includes('تغيّرت بيانات المنشأة')) {
        window.dispatchEvent(new Event('wudooh:stale-data-generation'));
      }
      throw new Error(payload.error || 'حدث خطأ غير متوقع');
    }
    return payload;
  };

  const load = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/data/${table}`, { credentials: 'include', headers: getHeaders() });
      const payload = await handleResponse(res);
      setData(payload.records || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [table, currentUser, getHeaders]);

  useEffect(() => {
    load();
  }, [load]);

  const create = async (payload: any) => {
    try {
      const res = await fetch(`/api/data/${table}`, {
        method: 'POST',
        credentials: 'include',
        headers: getHeaders(),
        body: JSON.stringify(payload),
      });
      await handleResponse(res);
      await load();
      toast({ title: 'تمت الإضافة بنجاح' });
      return true;
    } catch (e: any) {
      toast({ title: 'حدث خطأ', description: e.message, variant: 'destructive' });
      return false;
    }
  };

  const update = async (id: string | number, payload: any) => {
    try {
      const res = await fetch(`/api/data/${table}/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: getHeaders(),
        body: JSON.stringify(payload),
      });
      await handleResponse(res);
      await load();
      toast({ title: 'تم التحديث بنجاح' });
      return true;
    } catch (e: any) {
      toast({ title: 'حدث خطأ', description: e.message, variant: 'destructive' });
      return false;
    }
  };

  const remove = async (id: string | number) => {
    try {
      const res = await fetch(`/api/data/${table}/${id}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: getHeaders(),
      });
      await handleResponse(res);
      await load();
      toast({ title: 'تم الحذف بنجاح' });
      return true;
    } catch (e: any) {
      toast({ title: 'حدث خطأ', description: e.message, variant: 'destructive' });
      return false;
    }
  };

  return { data, loading, error, load, create, update, remove };
}
