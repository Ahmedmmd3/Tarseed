import { FormEvent, useEffect, useState } from 'react';
import { ArrowLeft, Building2, Eye, EyeOff, LoaderCircle, LockKeyhole, Mail, RefreshCw, ShieldCheck, Smartphone, UserRoundCog } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

type AuthMode = 'login' | 'register' | 'admin';

type AuthDialogProps = {
  open: boolean;
  mode: AuthMode;
  onOpenChange: (open: boolean) => void;
  onSuccess: (destination?: string) => void;
};

type AuthForm = {
  projectName: string;
  name: string;
  email: string;
  phone: string;
  username: string;
  password: string;
};

const emptyForm: AuthForm = {
  projectName: '',
  name: '',
  email: '',
  phone: '',
  username: '',
  password: '',
};

const fallbackErrors: Record<AuthMode, string> = {
  login: 'تعذر تسجيل الدخول. تحقق من البيانات وحاول مرة أخرى.',
  register: 'تعذر إنشاء المنشأة. تحقق من البيانات وحاول مرة أخرى.',
  admin: 'تعذر دخول الإدارة العليا. تحقق من البيانات وحاول مرة أخرى.',
};
const remoteSessionHintCookie = 'wudooh_remote_session';
const passwordPolicyMessage = '8 أحرف على الأقل، مع حرف كبير وصغير ورقم ورمز خاص.';
const isStrongPassword = (value: string) =>
  value.length >= 8
  && /[A-Z]/.test(value)
  && /[a-z]/.test(value)
  && /[0-9]/.test(value)
  && /[^A-Za-z0-9\s]/.test(value);

export function AuthDialog({ open, mode: initialMode, onOpenChange, onSuccess }: AuthDialogProps) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [form, setForm] = useState<AuthForm>(emptyForm);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [screen, setScreen] = useState<'credentials' | 'recovery' | 'verification'>('credentials');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const [verificationEmail, setVerificationEmail] = useState('');
  const [verificationPhone, setVerificationPhone] = useState('');
  const [verificationChannel, setVerificationChannel] = useState<'email' | 'phone'>('email');
  const [verificationCode, setVerificationCode] = useState('');
  const [verificationMessage, setVerificationMessage] = useState('');

  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setError('');
    setShowPassword(false);
    setScreen('credentials');
    setRecoveryEmail('');
    setRecoveryMessage('');
    setVerificationEmail('');
    setVerificationPhone('');
    setVerificationChannel('email');
    setVerificationCode('');
    setVerificationMessage('');
  }, [initialMode, open]);

  const updateField = (field: keyof AuthForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    if (error) setError('');
  };

  const selectMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setScreen('credentials');
    setError('');
  };

  const validate = (): string | null => {
    if (mode === 'register' && !form.projectName.trim()) {
      return 'أدخل اسم المنشأة.';
    }
    if (mode === 'register' && !form.name.trim()) {
      return 'أدخل اسمك لنتعرف عليك كمالك المنشأة.';
    }
    if (mode === 'admin' && !/^[a-zA-Z0-9._-]{3,64}$/.test(form.username.trim())) {
      return 'أدخل اسم مستخدم الإدارة العليا الصحيح.';
    }
    if (mode === 'register' && (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim()))) {
      return 'أدخل بريداً إلكترونياً صحيحاً.';
    }
    if (mode === 'register' && !/^(?:\+9665|05|5)\d{8}$/.test(form.phone.replace(/[\s().-]/g, ''))) {
      return 'أدخل رقم جوال صحيحاً، مثل 05xxxxxxxx.';
    }
    if (mode === 'login' && !form.email.trim()) {
      return 'أدخل البريد الإلكتروني أو رقم الجوال.';
    }
    if (mode === 'register' && !isStrongPassword(form.password)) {
      return `كلمة المرور يجب أن تحتوي على ${passwordPolicyMessage}`;
    }
    if (mode !== 'register' && form.password.length < 8) {
      return 'كلمة المرور يجب أن تكون 8 أحرف على الأقل.';
    }
    return null;
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setError('');
    setIsSubmitting(true);
    try {
      const endpoint = mode === 'register'
        ? '/api/auth/register'
        : mode === 'admin'
          ? '/api/platform-auth/login'
          : '/api/auth/login';
      const body = mode === 'register'
        ? {
            projectName: form.projectName.trim(),
            name: form.name.trim(),
            email: form.email.trim(),
            phone: form.phone.trim(),
            password: form.password,
          }
        : mode === 'admin'
          ? {
              username: form.username.trim().toLowerCase(),
              password: form.password,
            }
          : {
            identifier: form.email.trim(),
            password: form.password,
          };
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({})) as {
        user?: unknown;
        admin?: unknown;
        error?: string;
        code?: string;
        email?: string;
        verificationRequired?: boolean;
        phoneVerificationRequired?: boolean;
        emailVerificationRequired?: boolean;
        phone?: string | null;
      };
      if (mode === 'register' && response.ok && payload.verificationRequired) {
        setVerificationEmail(payload.email ?? form.email.trim().toLowerCase());
        setVerificationPhone(payload.phone ?? form.phone.trim());
        setVerificationChannel('email');
        setVerificationCode('');
        setVerificationMessage('أرسلنا رمزاً من 6 أرقام إلى بريدك. أدخله لإكمال إنشاء الحساب.');
        setScreen('verification');
        return;
      }
      if (mode === 'login' && response.status === 403 && payload.code === 'email_verification_required') {
        setVerificationEmail(payload.email ?? form.email.trim().toLowerCase());
        setVerificationCode('');
        setVerificationMessage('حسابك بانتظار تفعيل البريد الإلكتروني.');
        setVerificationChannel('email');
        setScreen('verification');
        return;
      }
      if (mode === 'login' && response.status === 403 && payload.code === 'phone_verification_required') {
        setVerificationEmail(payload.email ?? form.email.trim().toLowerCase());
        setVerificationPhone(payload.phone ?? '');
        setVerificationCode('');
        setVerificationChannel('phone');
        setVerificationMessage('حسابك بانتظار التحقق من ملكية رقم الجوال.');
        setScreen('verification');
        return;
      }
      const authenticated = mode === 'admin' ? payload.admin : payload.user;
      if (!response.ok || !authenticated) {
        throw new Error(payload.error || fallbackErrors[mode]);
      }
      if (mode !== 'admin') {
        document.cookie = `${remoteSessionHintCookie}=1; Max-Age=${14 * 24 * 60 * 60}; Path=/; SameSite=Lax`;
      }
      setForm(emptyForm);
      onOpenChange(false);
      onSuccess(mode === 'admin' ? '/super-admin' : '/manager');
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : fallbackErrors[mode]);
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitVerification = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!/^\d{6}$/.test(verificationCode)) {
      setError('أدخل رمز التفعيل المكوّن من 6 أرقام.');
      return;
    }
    setError('');
    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/auth/${verificationChannel}-verification/verify`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: verificationEmail, code: verificationCode }),
      });
      const payload = await response.json().catch(() => ({})) as {
        user?: unknown;
        error?: string;
        phoneVerificationRequired?: boolean;
        emailVerificationRequired?: boolean;
        phone?: string | null;
        email?: string;
      };
      if (!response.ok) throw new Error(payload.error ?? 'تعذر تفعيل الحساب.');
      if (payload.phoneVerificationRequired) {
        setVerificationChannel('phone');
        setVerificationPhone(payload.phone ?? verificationPhone);
        setVerificationCode('');
        setVerificationMessage('تم تفعيل البريد. أدخل الآن الرمز المرسل إلى جوالك.');
        return;
      }
      if (payload.emailVerificationRequired) {
        setVerificationChannel('email');
        setVerificationEmail(payload.email ?? verificationEmail);
        setVerificationCode('');
        setVerificationMessage('تم توثيق الجوال. أدخل الآن الرمز المرسل إلى بريدك.');
        return;
      }
      if (!payload.user) throw new Error('تعذر تفعيل الحساب.');
      document.cookie = `${remoteSessionHintCookie}=1; Max-Age=${14 * 24 * 60 * 60}; Path=/; SameSite=Lax`;
      setForm(emptyForm);
      setVerificationCode('');
      onOpenChange(false);
      onSuccess('/manager');
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'تعذر تفعيل الحساب.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const resendVerification = async () => {
    setError('');
    setVerificationMessage('');
    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/auth/${verificationChannel}-verification/resend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: verificationEmail }),
      });
      const payload = await response.json().catch(() => ({})) as { message?: string; error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'تعذر إعادة إرسال الرمز.');
      setVerificationMessage(payload.message ?? 'إذا كان الحساب بانتظار التفعيل، فسيصلك رمز جديد.');
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'تعذر إعادة إرسال الرمز.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const submitRecovery = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recoveryEmail.trim())) {
      setError('أدخل بريداً إلكترونياً صحيحاً.');
      return;
    }

    setError('');
    setRecoveryMessage('');
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/auth/password-reset/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: recoveryEmail.trim() }),
      });
      const payload = await response.json().catch(() => ({})) as { message?: string; error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'تعذر إرسال طلب الاستعادة.');
      setRecoveryMessage(payload.message ?? 'تحقق من بريدك الإلكتروني للحصول على رابط الاستعادة.');
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'تعذر إرسال طلب الاستعادة.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-md flex-col overflow-hidden border-slate-200 p-0" dir="rtl">
        <div className="shrink-0 bg-[#001738] px-6 pb-6 pt-8 text-white">
          <DialogHeader className="text-right sm:text-right">
            <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-teal-400/15 text-teal-300">
              <Building2 className="h-5 w-5" aria-hidden="true" />
            </div>
            <DialogTitle className="text-2xl text-white">
               {screen === 'recovery'
                 ? 'استعادة كلمة المرور'
                  : screen === 'verification'
                    ? verificationChannel === 'email' ? 'تفعيل البريد الإلكتروني' : 'توثيق رقم الجوال'
                 : mode === 'register'
                   ? 'أنشئ سجل منشأتك'
                   : mode === 'admin'
                     ? 'دخول الإدارة العليا'
                     : 'مرحباً بعودتك'}
            </DialogTitle>
            <DialogDescription className="mt-2 text-slate-300">
               {screen === 'recovery'
                ? 'أدخل بريد حسابك وسنرسل لك رابطاً آمناً لاختيار كلمة مرور جديدة.'
                 : screen === 'verification'
                    ? `أدخل الرمز المرسل إلى ${verificationChannel === 'email'
                      ? verificationEmail || 'بريدك الإلكتروني'
                      : verificationPhone || 'رقم جوالك'}.`
                 : mode === 'register'
                   ? 'ابدأ بسجل محاسبي مشترك لفريقك، ويمكنك دعوة الأعضاء لاحقاً.'
                   : mode === 'admin'
                     ? 'بوابة خاصة بمالك المنصة لمتابعة المنشآت والاشتراكات.'
                     : 'سجّل الدخول للوصول إلى بيانات منشأتك من أي جهاز.'}
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-6 [-webkit-overflow-scrolling:touch]">
          {screen === 'recovery' ? (
            <form onSubmit={submitRecovery} className="space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="recovery-email">البريد الإلكتروني</Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
                  <Input
                    id="recovery-email"
                    type="email"
                    dir="ltr"
                    value={recoveryEmail}
                    onChange={(event) => { setRecoveryEmail(event.target.value); if (error) setError(''); }}
                    className="pr-9 text-left"
                    placeholder="name@company.com"
                    autoComplete="email"
                    aria-invalid={Boolean(error)}
                    data-testid="input-recovery-email"
                  />
                </div>
              </div>

              {recoveryMessage && (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900" role="status" data-testid="password-recovery-message">
                  {recoveryMessage}
                </div>
              )}
              {error && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800" role="alert" data-testid="auth-error">
                  {error}
                </div>
              )}

              <Button type="submit" className="h-11 w-full bg-primary text-base hover:bg-teal-500" disabled={isSubmitting} data-testid="button-send-password-reset">
                {isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Mail className="h-4 w-4" aria-hidden="true" />}
                {isSubmitting ? 'جارٍ الإرسال...' : 'إرسال رابط الاستعادة'}
              </Button>
              <button
                type="button"
                onClick={() => { setScreen('credentials'); setError(''); setRecoveryMessage(''); }}
                className="w-full text-sm font-semibold text-primary hover:underline"
                data-testid="button-back-to-login"
              >
                العودة إلى تسجيل الدخول
              </button>
            </form>
          ) : screen === 'verification' ? (
            <form onSubmit={submitVerification} className="space-y-4" noValidate>
              <div className="flex justify-center">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-50 text-primary">
                  <ShieldCheck className="h-7 w-7" aria-hidden="true" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="auth-verification-code">رمز التفعيل</Label>
                <Input
                  id="auth-verification-code"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  dir="ltr"
                  maxLength={6}
                  value={verificationCode}
                  onChange={(event) => {
                    setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6));
                    if (error) setError('');
                  }}
                  className="h-14 text-center text-2xl font-bold tracking-[0.45em]"
                  placeholder="000000"
                  autoFocus
                  aria-invalid={Boolean(error)}
                  data-testid={`input-${verificationChannel}-verification-code`}
                />
                <p className="text-center text-xs text-slate-500">الرمز صالح لمدة 10 دقائق ويُستخدم مرة واحدة.</p>
              </div>
              {verificationMessage && (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900" role="status">
                  {verificationMessage}
                </div>
              )}
              {error && (
                <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800" role="alert" data-testid="auth-error">
                  {error}
                </div>
              )}
              <Button type="submit" className="h-11 w-full bg-primary text-base hover:bg-teal-500" disabled={isSubmitting} data-testid={`button-verify-${verificationChannel}`}>
                {isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ShieldCheck className="h-4 w-4" aria-hidden="true" />}
                {isSubmitting ? 'جارٍ التحقق...' : 'تفعيل الحساب والدخول'}
              </Button>
              <button
                type="button"
                onClick={() => void resendVerification()}
                disabled={isSubmitting}
                className="flex w-full items-center justify-center gap-2 text-sm font-semibold text-primary hover:underline disabled:opacity-50"
                data-testid="button-resend-verification"
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                إعادة إرسال الرمز
              </button>
              <button
                type="button"
                onClick={() => { setScreen('credentials'); setMode('login'); setError(''); }}
                className="w-full text-sm font-semibold text-slate-500 hover:text-slate-800"
              >
                العودة إلى تسجيل الدخول
              </button>
            </form>
          ) : (
            <>
           <div className="mb-6 grid grid-cols-3 rounded-lg bg-slate-100 p-1" role="tablist" aria-label="نوع العملية">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'login'}
              onClick={() => selectMode('login')}
              className={`rounded-md px-3 py-2 text-sm font-semibold transition-colors ${mode === 'login' ? 'bg-white text-[#001738] shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
              data-testid="tab-login"
            >
              تسجيل الدخول
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'register'}
              onClick={() => selectMode('register')}
              className={`rounded-md px-3 py-2 text-sm font-semibold transition-colors ${mode === 'register' ? 'bg-white text-[#001738] shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
              data-testid="tab-register"
            >
              إنشاء منشأة
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'admin'}
              onClick={() => selectMode('admin')}
              className={`rounded-md px-2 py-2 text-xs font-semibold transition-colors sm:text-sm ${mode === 'admin' ? 'bg-white text-[#001738] shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}
              data-testid="tab-super-admin"
            >
              الإدارة العليا
            </button>
          </div>

          <form onSubmit={submit} className="space-y-4" noValidate>
            {mode === 'register' && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="auth-project-name">اسم المنشأة</Label>
                  <div className="relative">
                    <Building2 className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
                    <Input
                      id="auth-project-name"
                      value={form.projectName}
                      onChange={(event) => updateField('projectName', event.target.value)}
                      className="pr-9"
                       placeholder="مثال: مؤسسة ترصيد التجارية"
                      autoComplete="organization"
                      data-testid="input-project-name"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="auth-name">اسم المالك</Label>
                  <Input
                    id="auth-name"
                    value={form.name}
                    onChange={(event) => updateField('name', event.target.value)}
                    placeholder="الاسم الكامل"
                    autoComplete="name"
                    data-testid="input-owner-name"
                  />
                </div>
                 <div className="space-y-2">
                   <Label htmlFor="auth-phone">رقم الجوال</Label>
                   <div className="relative">
                     <Smartphone className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
                     <Input
                       id="auth-phone"
                       type="tel"
                       dir="ltr"
                       value={form.phone}
                       onChange={(event) => updateField('phone', event.target.value)}
                       className="pr-9 text-left"
                       placeholder="05xxxxxxxx"
                       autoComplete="tel"
                       data-testid="input-auth-phone"
                     />
                   </div>
                 </div>
              </>
            )}

            {mode === 'admin' ? (
              <div className="space-y-2">
                <Label htmlFor="auth-admin-username">اسم المستخدم</Label>
                <div className="relative">
                  <UserRoundCog className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
                  <Input
                    id="auth-admin-username"
                    dir="ltr"
                    value={form.username}
                    onChange={(event) => updateField('username', event.target.value)}
                    className="pr-9 text-left"
                    placeholder="admin.username"
                    autoComplete="username"
                    aria-invalid={Boolean(error)}
                    data-testid="input-super-admin-username"
                  />
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="auth-email">{mode === 'login' ? 'البريد الإلكتروني أو رقم الجوال' : 'البريد الإلكتروني'}</Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
                  <Input
                    id="auth-email"
                    type={mode === 'register' ? 'email' : 'text'}
                    dir="ltr"
                    value={form.email}
                    onChange={(event) => updateField('email', event.target.value)}
                    className="pr-9 text-left"
                    placeholder={mode === 'login' ? 'name@company.com أو 05xxxxxxxx' : 'name@company.com'}
                    autoComplete="username"
                    aria-invalid={Boolean(error)}
                    data-testid="input-auth-email"
                  />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="auth-password">كلمة المرور</Label>
              <div className="relative">
                <LockKeyhole className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
                <Input
                  id="auth-password"
                  type={showPassword ? 'text' : 'password'}
                  dir="ltr"
                  value={form.password}
                  onChange={(event) => updateField('password', event.target.value)}
                  className="px-10 text-left"
                  placeholder={mode === 'register' ? 'Abcd123!' : 'كلمة المرور'}
                   autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                  aria-invalid={Boolean(error)}
                  data-testid="input-auth-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((visible) => !visible)}
                  className="absolute left-3 top-2 rounded-sm text-slate-400 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                </button>
              </div>
              {mode === 'register' && <p className="text-xs text-slate-500">{passwordPolicyMessage}</p>}
            </div>
             {mode === 'login' && (
              <div className="-mt-1 text-left">
                <button
                  type="button"
                  onClick={() => { setRecoveryEmail(form.email); setError(''); setScreen('recovery'); }}
                  className="text-sm font-semibold text-primary hover:underline"
                  data-testid="button-forgot-password"
                >
                  نسيت كلمة المرور؟
                </button>
              </div>
            )}

            {error && (
              <div
                className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800"
                role="alert"
                data-testid="auth-error"
              >
                {error}
              </div>
            )}

            <Button type="submit" className="h-11 w-full bg-primary text-base hover:bg-teal-500" disabled={isSubmitting} data-testid="button-auth-submit">
              {isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ArrowLeft className="h-4 w-4" aria-hidden="true" />}
               {isSubmitting
                 ? 'جارٍ التحقق...'
                 : mode === 'register'
                   ? 'إنشاء المنشأة والبدء'
                   : mode === 'admin'
                     ? 'دخول بوابة الإدارة العليا'
                     : 'دخول إلى لوحة التحكم'}
            </Button>
          </form>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
