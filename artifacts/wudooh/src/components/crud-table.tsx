import React, { useState } from 'react';
import { useCrud } from '@/hooks/use-crud';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { LoaderCircle, Edit, Trash2, Plus, AlertCircle, ImagePlus, Sparkles } from 'lucide-react';

export type FieldDef = {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'select';
  options?: { label: string; value: string | number }[];
  required?: boolean;
};

interface CrudTableProps {
  table: string;
  title: string;
  fields: FieldDef[];
  readOnly?: boolean;
}

const receiptCategories = ['إيجار', 'رواتب', 'مشتريات', 'مرافق', 'تسويق', 'نقل', 'صيانة', 'أخرى'] as const;
const supportedReceiptMediaTypes = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const receiptParseError = 'تعذر قراءة بيانات الإيصال، حاول بصورة أوضح.';

type ReceiptExtraction = {
  description: string;
  amount: number | '';
  date: string;
  category: string;
  vendor: string;
};

function parseReceiptExtraction(rawExtraction: string): ReceiptExtraction {
  const normalized = rawExtraction
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    throw new Error(receiptParseError);
  }
  if (!parsed || typeof parsed !== 'object') throw new Error(receiptParseError);

  const candidate = parsed as Record<string, unknown>;
  const amount = candidate.amount === null
    ? ''
    : typeof candidate.amount === 'number' && Number.isFinite(candidate.amount) && candidate.amount >= 0
      ? candidate.amount
      : '';
  const date = typeof candidate.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(candidate.date) ? candidate.date : '';
  const category = typeof candidate.category === 'string' && receiptCategories.includes(candidate.category as typeof receiptCategories[number])
    ? candidate.category
    : '';

  return {
    description: typeof candidate.description === 'string' ? candidate.description.trim() : '',
    amount,
    date,
    category,
    vendor: typeof candidate.vendor === 'string' ? candidate.vendor.trim() : '',
  };
}

function ReceiptExtractionDialog({
  open,
  onOpenChange,
  onExtracted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onExtracted: (extraction: ReceiptExtraction) => void;
}) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [imageDataUrl, setImageDataUrl] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [error, setError] = useState('');

  const reset = () => {
    setSelectedFile(null);
    setPreview('');
    setImageDataUrl('');
    setError('');
    setIsExtracting(false);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    onOpenChange(nextOpen);
    if (!nextOpen) reset();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setError('');
    if (!file.type.startsWith('image/') || !supportedReceiptMediaTypes.has(file.type)) {
      setError('يرجى اختيار صورة بصيغة JPG أو PNG أو GIF أو WebP.');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError('حجم الصورة كبير جداً. اختر صورة أصغر من 8 ميجابايت.');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      setSelectedFile(file);
      setPreview(dataUrl);
      setImageDataUrl(dataUrl);
    };
    reader.onerror = () => setError('تعذر قراءة الصورة. حاول اختيارها مرة أخرى.');
    reader.readAsDataURL(file);
  };

  const handleExtract = async () => {
    if (!selectedFile || !imageDataUrl || isExtracting) return;
    const separatorIndex = imageDataUrl.indexOf(',');
    const image = separatorIndex >= 0 ? imageDataUrl.slice(separatorIndex + 1) : imageDataUrl;
    setIsExtracting(true);
    setError('');
    try {
      const response = await fetch('/api/assistant/receipt-expense', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image, mediaType: selectedFile.type }),
      });
      const payload = await response.json().catch(() => ({})) as { extracted?: string; error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'تعذر استخراج بيانات الإيصال حالياً.');
      if (!payload.extracted) throw new Error(receiptParseError);
      const extraction = parseReceiptExtraction(payload.extracted);
      onExtracted(extraction);
      handleOpenChange(false);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : receiptParseError);
    } finally {
      setIsExtracting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>إضافة مصروف بصورة الإيصال</DialogTitle>
          <DialogDescription>ارفع صورة واضحة للإيصال وسيتم استخراج بيانات المصروف لمراجعتها قبل الحفظ.</DialogDescription>
        </DialogHeader>
        <div className="space-y-5 py-3">
          <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4">
            <label htmlFor="receipt-image-upload" className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-6 text-center transition hover:border-teal-400 hover:bg-teal-50">
              <ImagePlus className="h-8 w-8 text-teal-600" aria-hidden="true" />
              <span className="text-sm font-bold text-slate-800">رفع صورة الإيصال</span>
              <span className="text-xs text-slate-500">JPG أو PNG أو GIF أو WebP</span>
              <input id="receipt-image-upload" type="file" accept="image/*" className="sr-only" onChange={handleFileChange} data-testid="input-receipt-image" />
            </label>
          </div>
          {preview && (
            <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
              <img src={preview} alt="معاينة الإيصال" className="h-20 w-20 rounded-lg object-cover" data-testid="receipt-image-preview" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-800">{selectedFile?.name}</p>
                <p className="mt-1 text-xs text-slate-500">الصورة جاهزة للاستخراج</p>
              </div>
            </div>
          )}
          {error && <div role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>إلغاء</Button>
            <Button type="button" onClick={() => void handleExtract()} disabled={!imageDataUrl || isExtracting} className="gap-2 bg-teal-600 hover:bg-teal-700" data-testid="button-extract-receipt">
              {isExtracting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {isExtracting ? 'جارٍ استخراج البيانات...' : 'استخرج البيانات'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CrudTable({ table, title, fields, readOnly = false }: CrudTableProps) {
  const { data, loading, error, create, update, remove, load } = useCrud<any>(table);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | number | null>(null);
  const [formData, setFormData] = useState<any>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [receiptDialogOpen, setReceiptDialogOpen] = useState(false);
  const isExpenseTable = table === 'expenses';

  const handleOpen = (item?: any) => {
    if (item) {
      setEditingId(item.id);
      setFormData(Object.fromEntries(fields.map((field) => [field.key, item[field.key] ?? ''])));
    } else {
      setEditingId(null);
      setFormData({});
    }
    setOpen(true);
  };

  const handleReceiptExtracted = (extraction: ReceiptExtraction) => {
    setEditingId(null);
    setFormData({
      ...Object.fromEntries(fields.map((field) => [field.key, ''])),
      ...extraction,
    });
    setOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    let success = false;
    if (editingId) {
      success = await update(editingId, formData);
    } else {
      success = await create(formData);
    }
    setIsSubmitting(false);
    if (success) {
      setOpen(false);
    }
  };

  const handleDelete = async (id: string | number) => {
    if (window.confirm('هل أنت متأكد من الحذف؟')) {
      await remove(id);
    }
  };

  if (loading && data.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center rounded-2xl border border-slate-100 bg-white">
        <LoaderCircle className="h-6 w-6 animate-spin text-teal-600" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
        <h2 className="text-xl font-bold text-slate-900">{title}</h2>
        {!readOnly && (
          <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 sm:flex sm:flex-wrap sm:items-center sm:justify-end">
            {isExpenseTable && (
              <ReceiptExtractionDialog
                open={receiptDialogOpen}
                onOpenChange={setReceiptDialogOpen}
                onExtracted={handleReceiptExtracted}
              />
            )}
            {isExpenseTable && (
              <Button type="button" variant="outline" onClick={() => setReceiptDialogOpen(true)} className="h-11 gap-2 border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 hover:text-blue-800" data-testid="button-add-expense-receipt">
                <ImagePlus className="h-4 w-4" /> إضافة بصورة الإيصال
              </Button>
            )}
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button onClick={() => handleOpen()} className="h-11 w-full gap-2 bg-teal-600 hover:bg-teal-700 sm:w-auto" data-testid={`button-add-${table}`}>
                  <Plus className="h-4 w-4" /> إضافة
                </Button>
              </DialogTrigger>
              <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] rounded-2xl p-5 sm:w-full sm:p-6">
                <DialogHeader>
                  <DialogTitle>{editingId ? 'تعديل' : 'إضافة'} {title}</DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="flex flex-col gap-4 py-4">
                  {fields.map((f) => (
                    <div key={f.key} className="flex flex-col gap-2">
                      <Label htmlFor={f.key}>{f.label}</Label>
                      {f.type === 'select' ? (
                        <select
                          id={f.key}
                          required={f.required}
                          className="flex h-10 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                          value={formData[f.key] || ''}
                          onChange={(e) => setFormData({ ...formData, [f.key]: e.target.value })}
                        >
                          <option value="">اختر {f.label}</option>
                          {f.options?.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              {opt.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Input
                          id={f.key}
                          type={f.type || 'text'}
                          required={f.required}
                          value={formData[f.key] || ''}
                          onChange={(e) =>
                            setFormData({
                              ...formData,
                              [f.key]: f.type === 'number' ? Number(e.target.value) : e.target.value,
                            })
                          }
                        />
                      )}
                    </div>
                  ))}
                  <div className="mt-4 flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                      إلغاء
                    </Button>
                    <Button type="submit" disabled={isSubmitting} className="bg-teal-600 hover:bg-teal-700">
                      {isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : 'حفظ'}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-700">
          <AlertCircle className="h-5 w-5" />
          <p className="text-sm font-medium">{error}</p>
          <Button variant="outline" size="sm" className="mr-auto" onClick={load}>إعادة المحاولة</Button>
        </div>
      )}

      <div className="rounded-2xl border border-slate-100 bg-white shadow-sm">
        <Table className={fields.length >= 4 ? 'min-w-[720px]' : 'min-w-[520px]'}>
          <TableHeader>
            <TableRow>
              {fields.map((f) => (
                <TableHead key={f.key}>{f.label}</TableHead>
              ))}
              {!readOnly && <TableHead className="w-[100px]">الإجراءات</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((item) => (
              <TableRow key={item.id}>
                {fields.map((f) => (
                  <TableCell key={f.key}>
                    {f.type === 'select'
                      ? f.options?.find((o) => String(o.value) === String(item[f.key]))?.label || item[f.key]
                      : item[f.key]}
                  </TableCell>
                ))}
                {!readOnly && (
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" size="icon" onClick={() => handleOpen(item)} aria-label="تعديل">
                        <Edit className="h-4 w-4 text-slate-500" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelete(item.id)} aria-label="حذف">
                        <Trash2 className="h-4 w-4 text-rose-500" />
                      </Button>
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
            {data.length === 0 && !loading && (
              <TableRow>
                <TableCell colSpan={fields.length + (readOnly ? 0 : 1)} className="h-24 text-center text-slate-500">
                  لا توجد بيانات
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
