import { useState, useEffect } from 'react';
import { useStore } from '@/context/store';
import { Link } from 'wouter';
import {
  FileBadge,
  ChevronRight,
  Settings,
  FileText,
  AlertCircle,
  CheckCircle2,
  RefreshCw,
  Download,
  Send,
  PlusCircle,
  Copy,
  Info
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { useToast } from '@/hooks/use-toast';
import {
  useEInvoicingSetup,
  useUpdateSetup,
  useGenerateCsr,
  useUpdateCredentials,
  useEInvoicingDocuments,
  useSubmitDocument,
  useComplianceCheck,
  useAddDocumentNote,
  type EInvoiceDocument,
  type EGSUnit,
} from '@/hooks/use-e-invoicing';
import { format } from 'date-fns';

const setupSchema = z.object({
  unitName: z.string().min(1, 'مطلوب'),
  deviceSerialNumber: z.string().min(1, 'مطلوب'),
  environment: z.enum(['sandbox', 'production']),
  sellerName: z.string().min(1, 'مطلوب'),
  vatNumber: z.string().min(15, 'رقم ضريبي غير صالح (15 رقم)').max(15, 'رقم ضريبي غير صالح (15 رقم)'),
  commercialRegistrationNumber: z.string().min(10, 'مطلوب (10 أرقام)').max(10, 'مطلوب (10 أرقام)'),
  street: z.string().min(1, 'مطلوب'),
  buildingNumber: z.string().min(1, 'مطلوب'),
  city: z.string().min(1, 'مطلوب'),
  postalCode: z.string().min(5, 'مطلوب (5 أرقام)'),
  countryCode: z.string().min(2, 'مطلوب (حرفين)'),
  vatRate: z.coerce.number().min(0).max(100),
  pricesIncludeVat: z.boolean(),
});

const credentialsSchema = z.object({
  certificatePem: z.string().min(1, 'مطلوب'),
  csid: z.string().min(1, 'مطلوب'),
  secret: z.string().min(1, 'مطلوب'),
  certificateExpiresAt: z.string().optional(),
});

const noteSchema = z.object({
  type: z.enum(['credit_note', 'debit_note']),
  reason: z.string().min(1, 'مطلوب'),
  amount: z.coerce.number().min(0.01, 'يجب أن يكون أكبر من 0'),
  customerVatNumber: z.string().optional(),
});

const documentTypeLabels: Record<EInvoiceDocument['documentType'], string> = {
  simplified: 'فاتورة مبسطة',
  standard: 'فاتورة ضريبية',
  credit_note: 'إشعار دائن',
  debit_note: 'إشعار مدين',
};

const documentStatusLabels: Record<EInvoiceDocument['status'], { label: string; className: string }> = {
  pending_configuration: { label: 'ينتظر إعداد جهة الإصدار', className: 'border-slate-200 bg-slate-100 text-slate-700' },
  pending_credentials: { label: 'ينتظر تفعيل الشهادة', className: 'border-amber-200 bg-amber-50 text-amber-700' },
  pending_compliance: { label: 'ينتظر اعتماد الامتثال', className: 'border-amber-200 bg-amber-50 text-amber-800' },
  pending_submission: { label: 'جاهز للإرسال', className: 'border-blue-200 bg-blue-50 text-blue-700' },
  submitting: { label: 'جارٍ الإرسال', className: 'border-blue-200 bg-blue-50 text-blue-700' },
  submission_unknown: { label: 'نتيجة الإرسال غير مؤكدة', className: 'border-amber-200 bg-amber-50 text-amber-800' },
  reported: { label: 'تم التبليغ', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  cleared: { label: 'تمت الموافقة', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  rejected: { label: 'مرفوض من الهيئة', className: 'border-rose-200 bg-rose-50 text-rose-700' },
};

export default function EInvoicing() {
  const { currentUser } = useStore();
  const isOwner = currentUser?.roleId === 'owner';

  return (
    <div className="flex flex-col gap-6" data-testid="page-e-invoicing">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/dashboard" className="mb-2 inline-flex items-center gap-1.5 text-sm font-bold text-slate-500 transition hover:text-slate-900">
            <ChevronRight className="h-4 w-4" /> لوحة التحكم
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-black text-slate-900 sm:text-3xl">
            <FileBadge className="h-8 w-8 text-indigo-600" />
            الفوترة الإلكترونية (ZATCA)
          </h1>
        </div>
      </div>

      <Tabs defaultValue="documents" className="w-full">
        <TabsList className="mb-6 grid w-full grid-cols-2 md:w-[400px]">
          <TabsTrigger value="documents" className="gap-2">
            <FileText className="h-4 w-4" /> المستندات
          </TabsTrigger>
          {isOwner && (
            <TabsTrigger value="setup" className="gap-2">
              <Settings className="h-4 w-4" /> إعدادات الربط
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="documents">
          <DocumentsTab />
        </TabsContent>

        {isOwner && (
          <TabsContent value="setup">
            <SetupTab />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function DocumentsTab() {
  const { data: documents, isLoading, isError, refetch } = useEInvoicingDocuments();
  const submitDoc = useSubmitDocument();
  const complianceCheck = useComplianceCheck();
  const { currentUser } = useStore();
  const { toast } = useToast();
  const isOwner = currentUser?.roleId === 'owner';

  const handleSubmit = async (id: number) => {
    try {
      await submitDoc.mutateAsync(id);
      toast({ title: 'تم الإرسال', description: 'تم إرسال المستند بنجاح إلى منصة هيئة الزكاة والضريبة والجمارك.' });
    } catch (err: any) {
      toast({ title: 'فشل الإرسال', description: err.message, variant: 'destructive' });
    }
  };

  const downloadXml = (id: number) => {
    window.open(`/api/e-invoicing/documents/${id}/xml`, '_blank');
  };

  const downloadAuthorityXml = (id: number) => {
    window.open(`/api/e-invoicing/documents/${id}/authority-xml`, '_blank');
  };

  const handleComplianceCheck = async (id: number) => {
    try {
      await complianceCheck.mutateAsync(id);
      toast({ title: 'تم اجتياز فحص الامتثال', description: 'تأكدت بيئة Sandbox من المستند، وأصبحت الوحدة جاهزة لمسار الإرسال.' });
    } catch (err: any) {
      toast({ title: 'لم يجتز فحص الامتثال', description: err.message, variant: 'destructive' });
    }
  };

  if (isLoading) {
    return <div className="flex min-h-[300px] items-center justify-center rounded-3xl border border-slate-200 bg-white"><p className="animate-pulse text-sm font-bold text-slate-400">جارٍ تحميل المستندات...</p></div>;
  }

  if (isError) {
    return (
      <div className="flex min-h-[300px] flex-col items-center justify-center gap-4 rounded-3xl border border-rose-200 bg-rose-50 px-6 text-center text-rose-700">
        <AlertCircle className="h-6 w-6" />
        <p>تعذر تحميل المستندات. تأكد من إعدادات الربط.</p>
        <Button variant="outline" onClick={() => refetch()}>إعادة المحاولة</Button>
      </div>
    );
  }

  return (
    <div className="rounded-[28px] border border-slate-200 bg-white shadow-xl shadow-slate-950/5 overflow-hidden">
      <div className="border-b border-slate-100 bg-slate-50/50 p-5 flex items-center justify-between">
        <h2 className="text-lg font-black text-slate-900">أحدث المستندات الإلكترونية</h2>
        <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-2 text-slate-600">
          <RefreshCw className="h-4 w-4" /> تحديث
        </Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-right text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50/80 text-slate-500">
              <th className="px-5 py-4 font-bold">رقم المستند</th>
              <th className="px-5 py-4 font-bold">النوع</th>
              <th className="px-5 py-4 font-bold">التاريخ</th>
              <th className="px-5 py-4 font-bold">الحالة</th>
              <th className="px-5 py-4 font-bold text-center">الإجراءات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {(!documents || documents.length === 0) ? (
              <tr>
                <td colSpan={5} className="px-5 py-12 text-center text-slate-400 font-medium">
                  لا توجد مستندات بعد.
                </td>
              </tr>
            ) : (
              documents.map((doc) => (
                <tr key={doc.id} className="transition-colors hover:bg-slate-50/50">
                  <td className="px-5 py-4 font-semibold text-slate-900">{doc.invoiceNumber}</td>
                  <td className="px-5 py-4">
                    {documentTypeLabels[doc.documentType]}
                  </td>
                  <td className="px-5 py-4 text-slate-500">
                    {format(new Date(doc.issuedAt), 'yyyy-MM-dd HH:mm')}
                  </td>
                  <td className="px-5 py-4">
                    <Badge className={`${documentStatusLabels[doc.status].className} hover:bg-inherit`}>
                      {documentStatusLabels[doc.status].label}
                    </Badge>
                  </td>
                  <td className="px-5 py-4">
                    <div className="flex items-center justify-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="تحميل XML"
                        disabled={!doc.xmlAvailable}
                        onClick={() => downloadXml(doc.id)}
                      >
                        <Download className="h-4 w-4 text-slate-500" />
                      </Button>
                      {doc.authorityXmlAvailable && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="تحميل نسخة الهيئة"
                          onClick={() => downloadAuthorityXml(doc.id)}
                        >
                          <Download className="h-4 w-4 text-emerald-600" />
                        </Button>
                      )}
                      {doc.localValidationError && (
                        <AlertCircle className="h-4 w-4 text-amber-500" aria-label={doc.localValidationError} />
                      )}
                      {isOwner && doc.status === 'pending_compliance' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          title="فحص الامتثال في Sandbox"
                          disabled={complianceCheck.isPending}
                          onClick={() => handleComplianceCheck(doc.id)}
                        >
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        title="إرسال إلى ZATCA"
                        disabled={!['pending_submission', 'rejected'].includes(doc.status) || !doc.xmlAvailable || submitDoc.isPending}
                        onClick={() => handleSubmit(doc.id)}
                      >
                        <Send className={`h-4 w-4 ${(doc.status === 'cleared' || doc.status === 'reported') ? 'text-slate-300' : 'text-indigo-600'}`} />
                      </Button>

                      <IssueNoteDialog document={doc} />
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SetupTab() {
  const { data: setup, isLoading, isError, refetch } = useEInvoicingSetup();

  if (isLoading) {
    return <div className="flex min-h-[300px] items-center justify-center rounded-3xl border border-slate-200 bg-white"><p className="animate-pulse text-sm font-bold text-slate-400">جارٍ تحميل إعدادات الربط...</p></div>;
  }

  if (isError || !setup) {
    return (
      <div className="flex min-h-[300px] flex-col items-center justify-center gap-4 rounded-3xl border border-rose-200 bg-rose-50 px-6 text-center text-rose-700">
        <AlertCircle className="h-6 w-6" />
        <p>تعذر تحميل الإعدادات.</p>
        <Button variant="outline" onClick={() => refetch()}>إعادة المحاولة</Button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
      <div className="lg:col-span-8">
        <div className="rounded-[28px] border border-slate-200 bg-white shadow-xl shadow-slate-950/5 p-6 md:p-8">
          <div className="mb-8 border-b border-slate-100 pb-6">
            <h2 className="text-xl font-black text-slate-900">ملف المنشأة الضريبي</h2>
            <p className="mt-1 text-sm text-slate-500">هذه البيانات ستُستخدم لتوليد المفاتيح (CSR) واعتماد فواتيرك.</p>
          </div>
          <SetupForm initialData={setup} />
        </div>
      </div>
      <div className="lg:col-span-4 space-y-6">
        <StatusCard setup={setup} />
        {setup.configurationComplete && !setup.credentialsReady && (
          <CsrGenerationCard setup={setup} />
        )}
      </div>
    </div>
  );
}

function StatusCard({ setup }: { setup: EGSUnit }) {
  return (
    <div className="rounded-[24px] border border-slate-200 bg-slate-50 p-6">
      <h3 className="font-black text-slate-900 mb-4">حالة الربط</h3>
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          {setup.configurationComplete ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <div className="h-5 w-5 rounded-full border-2 border-slate-300" />}
          <span className={`text-sm font-bold ${setup.configurationComplete ? 'text-emerald-700' : 'text-slate-500'}`}>البيانات الأساسية مكتملة</span>
        </div>
        <div className="flex items-center gap-3">
          {setup.csrReady ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <div className="h-5 w-5 rounded-full border-2 border-slate-300" />}
          <span className={`text-sm font-bold ${setup.csrReady ? 'text-emerald-700' : 'text-slate-500'}`}>مفاتيح التشفير (CSR) مُولّدة</span>
        </div>
        <div className="flex items-center gap-3">
          {setup.credentialsReady ? <CheckCircle2 className="h-5 w-5 text-indigo-500" /> : <div className="h-5 w-5 rounded-full border-2 border-slate-300" />}
          <span className={`text-sm font-bold ${setup.credentialsReady ? 'text-indigo-700' : 'text-slate-500'}`}>بيانات CSID محفوظة للاختبار</span>
        </div>
        <div className="flex items-center gap-3">
          {setup.complianceStatus === 'passed' ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <div className="h-5 w-5 rounded-full border-2 border-slate-300" />}
          <div>
            <span className={`block text-sm font-bold ${setup.complianceStatus === 'passed' ? 'text-emerald-700' : 'text-slate-500'}`}>فحص الامتثال في Sandbox</span>
            {setup.complianceError && <span className="block mt-1 text-xs text-rose-600">{setup.complianceError}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

function CsrGenerationCard({ setup }: { setup: EGSUnit }) {
  const generateCsr = useGenerateCsr();
  const [csrResult, setCsrResult] = useState<string | null>(null);
  const { toast } = useToast();

  const handleGenerate = async () => {
    try {
      const res = await generateCsr.mutateAsync();
      setCsrResult(res.csrPem);
      toast({ title: 'نجاح', description: 'تم إنشاء CSR بنجاح.' });
    } catch (err: any) {
      toast({ title: 'خطأ', description: err.message, variant: 'destructive' });
    }
  };

  const handleCopy = () => {
    if (csrResult) {
      navigator.clipboard.writeText(csrResult);
      toast({ title: 'تم النسخ', description: 'تم نسخ CSR إلى الحافظة.' });
    }
  };

  if (setup.csrReady && !csrResult) {
    return (
      <div className="rounded-[24px] border border-indigo-100 bg-indigo-50 p-6 shadow-sm">
        <h3 className="mb-2 font-black text-indigo-900">تفعيل شهادة الحل</h3>
        <p className="mb-4 text-xs leading-5 text-indigo-700">
          تم إنشاء طلب الشهادة. الصق بيانات CSID والشهادة التي استلمتها من بوابة فاتورة لإكمال الربط.
        </p>
        <CredentialsDialog />
      </div>
    );
  }

  return (
    <div className="rounded-[24px] border border-indigo-100 bg-indigo-50 p-6 shadow-sm">
      <h3 className="font-black text-indigo-900 mb-2">إصدار الشهادة (CSID)</h3>
      <p className="text-xs leading-5 text-indigo-700 mb-4">
        أصدر طلب توقيع الشهادة (CSR) من هنا، ثم الصقه في بوابة هيئة الزكاة (Fatoora) للحصول على مفتاح CSID الخاص بك.
      </p>
      
      {!csrResult ? (
        <Button 
          className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold h-11"
          onClick={handleGenerate}
          disabled={generateCsr.isPending}
        >
          {generateCsr.isPending ? 'جاري التوليد...' : 'توليد CSR'}
        </Button>
      ) : (
        <div className="space-y-4">
          <div className="relative">
            <textarea 
              readOnly 
              value={csrResult} 
              className="w-full h-32 p-3 text-[10px] font-mono rounded-xl border border-indigo-200 bg-white focus:outline-none resize-none"
            />
            <Button size="icon" variant="secondary" className="absolute top-2 left-2 h-7 w-7" onClick={handleCopy}>
              <Copy className="h-3 w-3" />
            </Button>
          </div>
          <CredentialsDialog />
        </div>
      )}
    </div>
  );
}

function CredentialsDialog() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button className="h-11 w-full bg-indigo-600 font-bold text-white hover:bg-indigo-700">
          إدخال بيانات CSID
        </Button>
      </DialogTrigger>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader>
          <DialogTitle>إدخال بيانات اعتماد ZATCA</DialogTitle>
          <DialogDescription>
            أدخل الشهادة والمفتاح السري اللذين حصلت عليهما من بوابة فاتورة.
          </DialogDescription>
        </DialogHeader>
        <CredentialsForm />
      </DialogContent>
    </Dialog>
  );
}

function CredentialsForm() {
  const updateCreds = useUpdateCredentials();
  const { toast } = useToast();
  
  const form = useForm<z.infer<typeof credentialsSchema>>({
    resolver: zodResolver(credentialsSchema),
    defaultValues: {
      certificatePem: '',
      csid: '',
      secret: '',
    }
  });

  const onSubmit = async (values: z.infer<typeof credentialsSchema>) => {
    try {
      await updateCreds.mutateAsync(values);
      toast({ title: 'نجاح', description: 'تم حفظ بيانات الاعتماد بنجاح.' });
    } catch (err: any) {
      toast({ title: 'خطأ', description: err.message, variant: 'destructive' });
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-4">
        <FormField
          control={form.control}
          name="csid"
          render={({ field }) => (
            <FormItem>
              <FormLabel>معرف الشهادة (CSID)</FormLabel>
              <FormControl>
                <Input placeholder="أدخل CSID" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="secret"
          render={({ field }) => (
            <FormItem>
              <FormLabel>المفتاح السري (Secret)</FormLabel>
              <FormControl>
                <Input type="password" placeholder="أدخل المفتاح السري" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="certificatePem"
          render={({ field }) => (
            <FormItem>
              <FormLabel>نص الشهادة (Certificate PEM)</FormLabel>
              <FormControl>
                <textarea 
                  className="flex min-h-[120px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 text-left font-mono" 
                  placeholder="-----BEGIN CERTIFICATE-----..." 
                  dir="ltr"
                  {...field} 
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700 h-11" disabled={updateCreds.isPending}>
          {updateCreds.isPending ? 'جاري الحفظ...' : 'حفظ الاعتماد'}
        </Button>
      </form>
    </Form>
  );
}

function SetupForm({ initialData }: { initialData: EGSUnit }) {
  const updateSetup = useUpdateSetup();
  const { toast } = useToast();

  const form = useForm<z.infer<typeof setupSchema>>({
    resolver: zodResolver(setupSchema),
    defaultValues: {
      unitName: initialData.unitName || '',
      deviceSerialNumber: initialData.deviceSerialNumber || '',
      environment: initialData.environment || 'sandbox',
      sellerName: initialData.sellerName || '',
      vatNumber: initialData.vatNumber || '',
      commercialRegistrationNumber: initialData.commercialRegistrationNumber || '',
      street: initialData.street || '',
      buildingNumber: initialData.buildingNumber || '',
      city: initialData.city || '',
      postalCode: initialData.postalCode || '',
      countryCode: initialData.countryCode || 'SA',
      vatRate: initialData.vatRate !== undefined ? initialData.vatRate : 15,
      pricesIncludeVat: initialData.pricesIncludeVat !== undefined ? initialData.pricesIncludeVat : true,
    }
  });

  const onSubmit = async (values: z.infer<typeof setupSchema>) => {
    try {
      await updateSetup.mutateAsync(values);
      toast({ title: 'نجاح', description: 'تم تحديث بيانات الملف الضريبي بنجاح.' });
    } catch (err: any) {
      toast({ title: 'خطأ', description: err.message, variant: 'destructive' });
    }
  };

  const isReadOnly = initialData.csrReady;

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {isReadOnly && (
          <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4 flex items-start gap-3 text-indigo-800 mb-6">
            <Info className="h-5 w-5 shrink-0 mt-0.5" />
            <p className="text-sm font-medium leading-relaxed">
              الإعدادات مقفلة لأن الملف الضريبي معتمد ومرتبط بهيئة الزكاة. لتعديل البيانات، يجب إلغاء الربط وإصدار شهادة جديدة.
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <FormField
            control={form.control}
            name="sellerName"
            render={({ field }) => (
              <FormItem>
                <FormLabel>اسم المنشأة</FormLabel>
                <FormControl>
                  <Input {...field} disabled={isReadOnly} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="vatNumber"
            render={({ field }) => (
              <FormItem>
                <FormLabel>الرقم الضريبي (VAT)</FormLabel>
                <FormControl>
                  <Input {...field} dir="ltr" className="text-right" disabled={isReadOnly} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="commercialRegistrationNumber"
            render={({ field }) => (
              <FormItem>
                <FormLabel>رقم السجل التجاري (CR)</FormLabel>
                <FormControl>
                  <Input {...field} dir="ltr" className="text-right" disabled={isReadOnly} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="environment"
            render={({ field }) => (
              <FormItem>
                <FormLabel>بيئة العمل</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value} disabled={isReadOnly}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="اختر البيئة" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent dir="rtl">
                    <SelectItem value="sandbox">تجريبية (Sandbox)</SelectItem>
                    <SelectItem value="production">فعلية (Production)</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="border-t border-slate-100 pt-6 mt-6">
          <h3 className="font-bold text-slate-800 mb-4">بيانات الوحدة والجهاز</h3>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <FormField
              control={form.control}
              name="unitName"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>اسم الفرع / الوحدة</FormLabel>
                  <FormControl>
                    <Input {...field} disabled={isReadOnly} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="deviceSerialNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>الرقم التسلسلي للجهاز</FormLabel>
                  <FormControl>
                    <Input {...field} dir="ltr" className="text-right" disabled={isReadOnly} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        <div className="border-t border-slate-100 pt-6 mt-6">
          <h3 className="font-bold text-slate-800 mb-4">العنوان الوطني</h3>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
            <FormField
              control={form.control}
              name="buildingNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>رقم المبنى</FormLabel>
                  <FormControl>
                    <Input {...field} disabled={isReadOnly} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="street"
              render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>اسم الشارع</FormLabel>
                  <FormControl>
                    <Input {...field} disabled={isReadOnly} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="city"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>المدينة</FormLabel>
                  <FormControl>
                    <Input {...field} disabled={isReadOnly} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="postalCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>الرمز البريدي</FormLabel>
                  <FormControl>
                    <Input {...field} disabled={isReadOnly} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="countryCode"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>رمز الدولة</FormLabel>
                  <FormControl>
                    <Input {...field} dir="ltr" className="text-right uppercase" disabled={isReadOnly} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>
        </div>

        {!isReadOnly && (
          <div className="flex justify-end pt-4">
            <Button type="submit" className="bg-indigo-600 hover:bg-indigo-700 h-12 px-8 font-bold" disabled={updateSetup.isPending}>
              {updateSetup.isPending ? 'جاري الحفظ...' : 'حفظ الإعدادات'}
            </Button>
          </div>
        )}
      </form>
    </Form>
  );
}

function IssueNoteDialog({ document }: { document: EInvoiceDocument }) {
  const addNote = useAddDocumentNote();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  const form = useForm<z.infer<typeof noteSchema>>({
    resolver: zodResolver(noteSchema),
    defaultValues: {
      type: 'credit_note',
      reason: '',
      amount: 0,
      customerVatNumber: '',
    }
  });

  const onSubmit = async (values: z.infer<typeof noteSchema>) => {
    try {
      await addNote.mutateAsync({ id: document.id, ...values });
      toast({ title: 'نجاح', description: 'تم إنشاء الإشعار بنجاح.' });
      setOpen(false);
      form.reset();
    } catch (err: any) {
      toast({ title: 'خطأ', description: err.message, variant: 'destructive' });
    }
  };

  // Only invoices can have credit/debit notes applied to them
  if (document.documentType !== 'simplified' && document.documentType !== 'standard') return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" title="إصدار إشعار" className="text-slate-500 hover:text-indigo-600">
          <PlusCircle className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent dir="rtl" className="max-w-md">
        <DialogHeader>
          <DialogTitle>إصدار إشعار للفاتورة {document.invoiceNumber}</DialogTitle>
          <DialogDescription>
            سيتصل هذا الإشعار بالفاتورة المحددة ويرفع إلى ZATCA.
          </DialogDescription>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 mt-4">
            <FormField
              control={form.control}
              name="type"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>نوع الإشعار</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="اختر النوع" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent dir="rtl">
                      <SelectItem value="credit_note">إشعار دائن (تخفيض)</SelectItem>
                      <SelectItem value="debit_note">إشعار مدين (زيادة)</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="amount"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>المبلغ (غير شامل الضريبة)</FormLabel>
                  <FormControl>
                    <Input type="number" step="0.01" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="reason"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>سبب الإصدار</FormLabel>
                  <FormControl>
                    <Input placeholder="مثال: إرجاع بضاعة" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="customerVatNumber"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>الرقم الضريبي للعميل (اختياري)</FormLabel>
                  <FormControl>
                    <Input placeholder="إذا كان العميل مسجلاً في الضريبة" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="pt-4">
              <Button type="submit" className="w-full bg-indigo-600 hover:bg-indigo-700" disabled={addNote.isPending}>
                {addNote.isPending ? 'جاري الإصدار...' : 'إصدار الإشعار'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
