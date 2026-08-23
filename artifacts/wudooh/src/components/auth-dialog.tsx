import { FormEvent, useEffect, useState } from 'react';
import { ArrowLeft, Building2, Eye, EyeOff, LoaderCircle, LockKeyhole, Mail } from 'lucide-react';
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

type AuthMode = 'login' | 'register';

type AuthDialogProps = {
  open: boolean;
  mode: AuthMode;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
};

type AuthForm = {
  projectName: string;
  name: string;
  email: string;
  password: string;
};

const emptyForm: AuthForm = {
  projectName: '',
  name: '',
  email: '',
  password: '',
};

const fallbackErrors: Record<AuthMode, string> = {
  login: 'تعذر تسجيل الدخول. تحقق من البيانات وحاول مرة أخرى.',
  register: 'تعذر إنشاء المنشأة. تحقق من البيانات وحاول مرة أخرى.',
};

export function AuthDialog({ open, mode: initialMode, onOpenChange, onSuccess }: AuthDialogProps) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [form, setForm] = useState<AuthForm>(emptyForm);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [screen, setScreen] = useState<'credentials' | 'recovery'>('credentials');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryMessage, setRecoveryMessage] = useState('');

  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setError('');
    setShowPassword(false);
    setScreen('credentials');
    setRecoveryEmail('');
    setRecoveryMessage('');
  }, [initialMode, open]);

  const updateField = (field: keyof AuthForm, value: string) => {
    setForm((current) => ({ ...current, [field]: value }));
    if (error) setError('');
  };

  const selectMode = (nextMode: AuthMode) => {
    setMode(nextMode);
    setError('');
  };

  const validate = (): string | null => {
    if (mode === 'register' && !form.projectName.trim()) {
      return 'أدخل اسم المنشأة.';
    }
    if (mode === 'register' && !form.name.trim()) {
      return 'أدخل اسمك لنتعرف عليك كمالك المنشأة.';
    }
    if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      return 'أدخل بريداً إلكترونياً صحيحاً.';
    }
    if (form.password.length < 8) {
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
      const endpoint = mode === 'register' ? '/api/auth/register' : '/api/auth/login';
      const body = mode === 'register'
        ? {
            projectName: form.projectName.trim(),
            name: form.name.trim(),
            email: form.email.trim(),
            password: form.password,
          }
        : {
            email: form.email.trim(),
            password: form.password,
          };
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({})) as { user?: unknown; error?: string };
      if (!response.ok || !payload.user) {
        throw new Error(payload.error || fallbackErrors[mode]);
      }
      setForm(emptyForm);
      onOpenChange(false);
      onSuccess();
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : fallbackErrors[mode]);
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
      <DialogContent className="max-w-md overflow-hidden border-slate-200 p-0" dir="rtl">
        <div className="bg-[#001738] px-6 pb-6 pt-8 text-white">
          <DialogHeader className="text-right sm:text-right">
            <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-teal-400/15 text-teal-300">
              <Building2 className="h-5 w-5" aria-hidden="true" />
            </div>
            <DialogTitle className="text-2xl text-white">
              {screen === 'recovery' ? 'استعادة كلمة المرور' : mode === 'register' ? 'أنشئ سجل منشأتك' : 'مرحباً بعودتك'}
            </DialogTitle>
            <DialogDescription className="mt-2 text-slate-300">
              {screen === 'recovery'
                ? 'أدخل بريد حسابك وسنرسل لك رابطاً آمناً لاختيار كلمة مرور جديدة.'
                : mode === 'register'
                ? 'ابدأ بسجل محاسبي مشترك لفريقك، ويمكنك دعوة الأعضاء لاحقاً.'
                : 'سجّل الدخول للوصول إلى بيانات منشأتك من أي جهاز.'}
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="p-6">
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
          ) : (
            <>
          <div className="mb-6 grid grid-cols-2 rounded-lg bg-slate-100 p-1" role="tablist" aria-label="نوع العملية">
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
                      placeholder="مثال: مؤسسة وضوح التجارية"
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
              </>
            )}

            <div className="space-y-2">
              <Label htmlFor="auth-email">البريد الإلكتروني</Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
                <Input
                  id="auth-email"
                  type="email"
                  dir="ltr"
                  value={form.email}
                  onChange={(event) => updateField('email', event.target.value)}
                  className="pr-9 text-left"
                  placeholder="name@company.com"
                  autoComplete="email"
                  aria-invalid={Boolean(error)}
                  data-testid="input-auth-email"
                />
              </div>
            </div>

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
                  placeholder="٨ أحرف على الأقل"
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
              {mode === 'register' && <p className="text-xs text-slate-500">استخدم ٨ أحرف أو أكثر لحماية سجل منشأتك.</p>}
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
              {isSubmitting ? 'جارٍ التحقق...' : mode === 'register' ? 'إنشاء المنشأة والبدء' : 'دخول إلى لوحة التحكم'}
            </Button>
          </form>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
