import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, FileText, LoaderCircle, Paperclip, Trash2, UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useStore } from '@/context/store';
import { useToast } from '@/hooks/use-toast';

type Attachment = { id: string | number; fileName?: string; name?: string; originalName?: string; size?: number; mimeType?: string; createdAt?: string };

export function AttachmentsPanel({ tableName, recordId }: { tableName: string; recordId: string | number | null | undefined }) {
  const { currentUser } = useStore();
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState<string | number | null>(null);

  const load = useCallback(async () => {
    if (recordId === null || recordId === undefined) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/attachments/${encodeURIComponent(tableName)}/${encodeURIComponent(String(recordId))}`, {
        credentials: 'include',
        headers: currentUser ? { 'X-Wudooh-Data-Generation': String(currentUser.dataGeneration) } : undefined,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? 'تعذر تحميل المرفقات.');
      setItems(Array.isArray(payload) ? payload : payload.attachments ?? payload.records ?? []);
    } catch (error) {
      toast({ title: 'تعذر تحميل المرفقات', description: error instanceof Error ? error.message : undefined, variant: 'destructive' });
    } finally { setLoading(false); }
  }, [currentUser, recordId, tableName, toast]);

  useEffect(() => { void load(); }, [load]);

  const upload = async (file: File) => {
    if (recordId === null || recordId === undefined || uploading) return;
    setUploading(true);
    const body = new FormData();
    body.set('tableName', tableName);
    body.set('recordId', String(recordId));
    body.set('file', file);
    body.set('clientOperationId', crypto.randomUUID());
    try {
      const response = await fetch(`/api/attachments/${encodeURIComponent(tableName)}/${encodeURIComponent(String(recordId))}`, {
        method: 'POST',
        credentials: 'include',
        headers: currentUser ? {
          'X-Wudooh-Data-Generation': String(currentUser.dataGeneration),
          'Idempotency-Key': body.get('clientOperationId') as string,
        } : undefined,
        body,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? 'تعذر رفع الملف.');
      toast({ title: 'تم رفع المرفق' });
      await load();
    } catch (error) {
      toast({ title: 'تعذر رفع المرفق', description: error instanceof Error ? error.message : undefined, variant: 'destructive' });
    } finally { setUploading(false); }
  };

  const remove = async (id: string | number) => {
    if (!window.confirm('هل تريد حذف هذا المرفق؟')) return;
    setRemoving(id);
    try {
      const response = await fetch(`/api/attachments/${encodeURIComponent(String(id))}`, { method: 'DELETE', credentials: 'include', headers: currentUser ? { 'X-Wudooh-Data-Generation': String(currentUser.dataGeneration) } : undefined });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? 'تعذر حذف المرفق.');
      setItems(current => current.filter(item => item.id !== id));
      toast({ title: 'تم حذف المرفق' });
    } catch (error) {
      toast({ title: 'تعذر حذف المرفق', description: error instanceof Error ? error.message : undefined, variant: 'destructive' });
    } finally { setRemoving(null); }
  };

  if (recordId === null || recordId === undefined) return <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">احفظ السجل أولاً لإضافة المرفقات.</p>;
  return <section dir="rtl" className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4">
    <div className="flex items-center justify-between gap-3">
      <div className="flex items-center gap-2 font-bold text-slate-800"><Paperclip className="h-4 w-4 text-teal-600" /> المرفقات</div>
      <input ref={inputRef} type="file" className="sr-only" onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file); e.currentTarget.value = ''; }} data-testid={`input-attachment-${tableName}-${recordId}`} />
      <Button type="button" size="sm" variant="outline" disabled={uploading} onClick={() => inputRef.current?.click()} data-testid={`button-upload-attachment-${tableName}-${recordId}`}>
        {uploading ? <LoaderCircle className="ml-1 h-4 w-4 animate-spin" /> : <UploadCloud className="ml-1 h-4 w-4" />} رفع ملف
      </Button>
    </div>
    {loading ? <div className="flex items-center gap-2 py-2 text-sm text-slate-500"><LoaderCircle className="h-4 w-4 animate-spin" /> جارٍ تحميل المرفقات...</div>
      : items.length === 0 ? <p className="py-2 text-sm text-slate-500">لا توجد مرفقات لهذا السجل.</p>
        : <ul className="space-y-2">{items.map(item => <li key={item.id} className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2">
          <FileText className="h-4 w-4 shrink-0 text-slate-500" /><span className="min-w-0 flex-1 truncate text-sm font-medium">{item.fileName ?? item.originalName ?? item.name ?? 'ملف مرفق'}</span>
          <a href={`/api/attachments/${encodeURIComponent(String(item.id))}/download`} className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-slate-100" aria-label="تنزيل المرفق" data-testid={`link-download-attachment-${item.id}`}><Download className="h-4 w-4" /></a>
          <Button type="button" variant="ghost" size="icon" disabled={removing === item.id} onClick={() => void remove(item.id)} aria-label="حذف المرفق" data-testid={`button-delete-attachment-${item.id}`}>{removing === item.id ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4 text-rose-600" />}</Button>
        </li>)}</ul>}
  </section>;
}