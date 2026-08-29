import { useState } from 'react';
import { Download, FileUp, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useStore } from '@/context/store';
import { useToast } from '@/hooks/use-toast';

type PreviewError = string | { message?: string };
type TransferPreview = {
  previewId: string;
  rowCount: number;
  valid: boolean;
  errors: PreviewError[];
};

type TransferDialogProps = {
  tableName: string;
  title: string;
  onImported?: () => void | Promise<void>;
  importEnabled?: boolean;
};

export function TransferDialog({ tableName, title, onImported, importEnabled = true }: TransferDialogProps) {
  const { currentUser } = useStore();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<'csv' | 'json'>('csv');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<TransferPreview | null>(null);
  const [commitOperationId, setCommitOperationId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const generationHeaders: Record<string, string> = currentUser
    ? { 'X-Wudooh-Data-Generation': String(currentUser.dataGeneration) }
    : {};

  const exportData = async () => {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/data-transfer/export', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...generationHeaders },
        body: JSON.stringify({ tableName, format }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error ?? 'تعذر تصدير البيانات.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${tableName}.${format}`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر تصدير البيانات.');
    } finally {
      setBusy(false);
    }
  };

  const inspect = async () => {
    if (!file) return;
    setBusy(true);
    setError('');
    const body = new FormData();
    body.set('file', file);
    body.set('tableName', tableName);
    body.set('format', format);
    try {
      const response = await fetch('/api/data-transfer/preview', {
        method: 'POST',
        credentials: 'include',
        headers: generationHeaders,
        body,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? 'تعذر التحقق من الملف.');
      setPreview(payload as TransferPreview);
      setCommitOperationId(crypto.randomUUID());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر التحقق من الملف.');
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!preview?.previewId) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/data-transfer/commit', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...generationHeaders },
        body: JSON.stringify({
          previewId: preview.previewId,
          clientOperationId: commitOperationId,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? 'تعذر استيراد البيانات.');
      await onImported?.();
      toast({
        title: 'تم استيراد البيانات بنجاح',
        description: `تمت إضافة ${payload.imported ?? 0} سجل.`,
      });
      setOpen(false);
      setFile(null);
      setPreview(null);
      setCommitOperationId('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'تعذر استيراد البيانات.');
    } finally {
      setBusy(false);
    }
  };

  const errors = preview?.errors ?? [];

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="gap-2" data-testid={`button-transfer-${tableName}`}>
          <FileUp className="h-4 w-4" />
          {importEnabled ? 'استيراد / تصدير' : 'تصدير'}
        </Button>
      </DialogTrigger>
      <DialogContent dir="rtl" className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{importEnabled ? 'استيراد وتصدير' : 'تصدير'} {title}</DialogTitle>
          <DialogDescription>
            {importEnabled
              ? 'راجع نتائج التحقق قبل تنفيذ الاستيراد الذري.'
              : 'التصدير متاح، بينما تُنشأ هذه المستندات من شاشتها المتخصصة لحماية المخزون والقيود المحاسبية.'}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex gap-2">
            <Button type="button" variant={format === 'csv' ? 'default' : 'outline'} onClick={() => setFormat('csv')}>CSV</Button>
            <Button type="button" variant={format === 'json' ? 'default' : 'outline'} onClick={() => setFormat('json')}>JSON</Button>
            <Button type="button" className="mr-auto gap-1" variant="outline" disabled={busy} onClick={() => void exportData()} data-testid={`button-export-${tableName}`}>
              <Download className="h-4 w-4" />
              تصدير
            </Button>
          </div>
          {importEnabled && <input
            type="file"
            accept={format === 'csv' ? '.csv,text/csv' : '.json,application/json'}
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setPreview(null);
              setCommitOperationId('');
            }}
            data-testid={`input-import-${tableName}`}
          />}
          {importEnabled && file && (
            <Button type="button" disabled={busy} onClick={() => void inspect()}>
              {busy && <LoaderCircle className="ml-2 h-4 w-4 animate-spin" />}
              تحقق من الملف
            </Button>
          )}
          {errors.length > 0 && (
            <div role="alert" className="max-h-48 overflow-y-auto rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
              {errors.map((item, index) => (
                <p key={index}>{typeof item === 'string' ? item : item.message ?? JSON.stringify(item)}</p>
              ))}
            </div>
          )}
          {preview && errors.length === 0 && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              الملف صالح للمراجعة. {preview.rowCount} سجل جاهز للاستيراد.
            </div>
          )}
          {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
          {importEnabled && <div className="flex justify-end">
            <Button
              type="button"
              disabled={busy || !preview?.previewId || preview.valid === false || errors.length > 0}
              onClick={() => void commit()}
              data-testid={`button-commit-import-${tableName}`}
            >
              {busy && <LoaderCircle className="ml-2 h-4 w-4 animate-spin" />}
              اعتماد الاستيراد
            </Button>
          </div>}
        </div>
      </DialogContent>
    </Dialog>
  );
}