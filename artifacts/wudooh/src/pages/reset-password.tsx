import { FormEvent, useMemo, useState } from 'react';
import { ArrowLeft, CheckCircle2, Eye, EyeOff, KeyRound, LoaderCircle, LockKeyhole } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const landingPath = `${import.meta.env.BASE_URL}`;
const passwordPolicyMessage = 'استخدم 8 أحرف على الأقل تشمل حرفاً كبيراً وصغيراً ورقماً ورمزاً خاصاً.';
const strongPassword = (value: string) =>
  value.length >= 8
  && /[A-Z]/.test(value)
  && /[a-z]/.test(value)
  && /[0-9]/.test(value)
  && /[^A-Za-z0-9\s]/.test(value);

export default function ResetPassword() {
  const token = useMemo(() => new URLSearchParams(window.location.search).get('token')?.trim() ?? '', []);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token) {
      setError('رابط الاستعادة غير مكتمل. اطلب رابطاً جديداً من صفحة تسجيل الدخول.');
      return;
    }
    if (!strongPassword(password)) {
      setError(passwordPolicyMessage);
      return;
    }
    if (password !== confirmation) {
      setError('كلمتا المرور غير متطابقتين.');
      return;
    }

    setError('');
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/auth/password-reset/confirm', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const payload = await response.json().catch(() => ({})) as { message?: string; error?: string };
      if (!response.ok) throw new Error(payload.error ?? 'تعذر تحديث كلمة المرور.');
      setMessage(payload.message ?? 'تم تحديث كلمة المرور.');
      setPassword('');
      setConfirmation('');
    } catch (submissionError) {
      setError(submissionError instanceof Error ? submissionError.message : 'تعذر تحديث كلمة المرور.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10" dir="rtl">
      <Card className="w-full max-w-md overflow-hidden border-slate-200 shadow-lg">
      <CardHeader className="bg-[#0A1328] px-6 py-8 text-right text-white">
          <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-teal-400/15 text-teal-300">
            <KeyRound className="h-5 w-5" aria-hidden="true" />
          </div>
          <CardTitle className="text-2xl text-white">اختيار كلمة مرور جديدة</CardTitle>
          <CardDescription className="mt-2 text-slate-300">
            اختر كلمة مرور قوية لحماية سجل منشأتك.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-6">
          {message ? (
            <div className="space-y-5 text-center">
              <CheckCircle2 className="mx-auto h-11 w-11 text-emerald-600" aria-hidden="true" />
              <p className="font-semibold text-slate-900">{message}</p>
              <p className="text-sm text-slate-500">تم تسجيل خروج أي جلسات سابقة. سجّل الدخول بكلمة المرور الجديدة.</p>
              <Button asChild className="w-full">
                <a href={landingPath} data-testid="link-return-login">العودة إلى تسجيل الدخول</a>
              </Button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="reset-password">كلمة المرور الجديدة</Label>
                <div className="relative">
                  <LockKeyhole className="pointer-events-none absolute right-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden="true" />
                  <Input
                    id="reset-password"
                    type={showPassword ? 'text' : 'password'}
                    dir="ltr"
                    value={password}
                    onChange={(event) => { setPassword(event.target.value); if (error) setError(''); }}
                    className="px-10 text-left"
                    autoComplete="new-password"
                    placeholder="Abcd123!"
                    data-testid="input-reset-password"
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
                <p className="text-xs text-slate-500">{passwordPolicyMessage}</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="reset-password-confirmation">تأكيد كلمة المرور</Label>
                <Input
                  id="reset-password-confirmation"
                  type={showPassword ? 'text' : 'password'}
                  dir="ltr"
                  value={confirmation}
                  onChange={(event) => { setConfirmation(event.target.value); if (error) setError(''); }}
                  className="text-left"
                  autoComplete="new-password"
                  data-testid="input-reset-password-confirmation"
                />
              </div>
              {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-800" role="alert">{error}</p>}
              <Button type="submit" className="h-11 w-full text-base" disabled={isSubmitting} data-testid="button-confirm-password-reset">
                {isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <ArrowLeft className="h-4 w-4" aria-hidden="true" />}
                {isSubmitting ? 'جارٍ الحفظ...' : 'حفظ كلمة المرور الجديدة'}
              </Button>
              <a href={landingPath} className="block text-center text-sm font-semibold text-primary hover:underline">العودة إلى صفحة الدخول</a>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}