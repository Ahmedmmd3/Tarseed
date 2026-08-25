import React, { useState } from 'react';
import { useCrud } from '@/hooks/use-crud';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { LoaderCircle, Edit, Trash2, Plus, AlertCircle } from 'lucide-react';

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

export function CrudTable({ table, title, fields, readOnly = false }: CrudTableProps) {
  const { data, loading, error, create, update, remove, load } = useCrud<any>(table);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | number | null>(null);
  const [formData, setFormData] = useState<any>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

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
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-slate-900">{title}</h2>
        {!readOnly && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button onClick={() => handleOpen()} className="gap-2 bg-teal-600 hover:bg-teal-700" data-testid={`button-add-${table}`}>
                <Plus className="h-4 w-4" /> إضافة
              </Button>
            </DialogTrigger>
            <DialogContent>
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
        <Table>
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
