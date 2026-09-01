import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Building2, CheckCircle2, Eye, EyeOff, FlaskConical, LoaderCircle, LockKeyhole, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type Invitation = {
  workspaceName: string;
  ownerName: string;
  email: string;
  expiresAt: string;
};

const passwordPolicyMessage = '8 أحرف على الأقل، مع حرف كبير وصغير ورقم ورمز خاص.';
const isStrongPassword = (value: string) =>
  value.length >= 8
  && /[A-Z]/.test(value)
  && /[a-z]/.test(value)
  && /[0-9]/.test(value)
  && /[^A-Za-z0-9\s]/.test(value);

export default function TestWorkspaceInvite() {
  const token = useMemo(() => new URLSearchParams(window.location.search).get('token')?.trim() ?? '', []);
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'invalid' | 'accepted'>('loading');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    document.title = 'قبول دعوة مساحة الاختبار | ترصيد';
    let active = true;
    const load = async () => {
      try {
        const response = await fetch(`/api/auth/test-workspace-invitations/status?token=${encodeURIComponent(token)}`, {
          credentials: 'include',
          cache: 'no-store',
        });
        const payload = await response.json().catch(() => ({})) as { invitation?: Invitation; error?: string };
        if (!active) return;
        if (!response.ok || !payload.invitation) {
          setError(payload.error ?? 'دعوة مساحة الاختبار غير صالحة أو انتهت.');
          setState('invalid');
          return;
        }
        setInvitation(payload.invitation);
        setState('ready');
      } catch {
        if (active) {
          setError('تعذر التحقق من الدعوة حالياً. حاول مرة أخرى.');
          setState('invalid');
        }
      }
    };
    void load();
    return () => { active = false; };
  }, [token]);

  const acceptInvitation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isStrongPassword(password)) {
      setError(`كلمة المرور يجب أن تحتوي على ${passwordPolicyMessage}`);
      return;
    }
    if (password !== confirmation) {
      setError('تأكيد كلمة المرور غير مطابق.');
      return;
    }
    setIsSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/auth/test-workspace-invitations/accept', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });
      const payload = await response.json().catch(() => ({})) as { user?: unknown; error?: string };
      if (!response.ok || !payload.user) throw new Error(payload.error ?? 'تعذر قبول الدعوة.');
      setState('accepted');
      window.setTimeout(() => {
        const base = import.meta.env.BASE_URL.replace(/\/$/, '');
        window.location.assign(`${base}/manager`);
      }, 900);
    } catch (acceptError) {
      setError(acceptError instanceof Error ? acceptError.message : 'تعذر قبول الدعوة.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-[#0A1328] px-4 py-10" dir="rtl" data-testid="page-test-workspace-invite">
      <section className="w-full max-w-lg overflow-hidden rounded-3xl border border-white/10 bg-white shadow-2xl">
        <header className="bg-gradient-to-l from-teal-600 to-[#0D47D9] px-6 py-8 text-white sm:px-8">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/20 bg-white/10">
            <FlaskConical className="h-6 w-6" />
          </span>
          <h1 className="mt-5 text-2xl font-black">تجهيز مساحة الاختبار</h1>
          <p className="mt-2 text-sm leading-7 text-teal-50">اقبل الدعوة واختر كلمة مرورك. رابط البريد هو إثبات ملكية البريد ولا يُستخدم إلا مرة واحدة.</p>
        </header>

        <div className="p-6 sm:p-8">
          {state === 'loading' && (
            <div className="py-10 text-center text-sm font-medium text-slate-500">
              <LoaderCircle className="mx-auto mb-3 h-7 w-7 animate-spin text-teal-700" />
              جارٍ التحقق من الدعوة...
            </div>
          )}

          {state === 'invalid' && (
            <div className="py-6 text-center" role="alert">
              <ShieldCheck className="mx-auto h-11 w-11 text-rose-500" />
              <h2 className="mt-4 text-xl font-black text-slate-900">تعذر استخدام الدعوة</h2>
              <p className="mt-2 text-sm leading-7 text-slate-600" data-testid="error-test-workspace-invite">{error}</p>
              <p className="mt-4 text-xs leading-6 text-slate-500">اطلب من الإدارة العليا إنشاء دعوة جديدة إذا انتهت صلاحية الرابط.</p>
            </div>
          )}

          {state === 'accepted' && (
            <div className="py-8 text-center" role="status" data-testid="status-test-workspace-invite-accepted">
              <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" />
              <h2 className="mt-4 text-xl font-black text-slate-900">تم تفعيل مساحة الاختبار</h2>
              <p className="mt-2 text-sm text-slate-600">سيتم نقلك إلى لوحة المنشأة الآن.</p>
            </div>
          )}

          {state === 'ready' && invitation && (
            <form onSubmit={acceptInvitation} className="space-y-5" noValidate>
              <div className="rounded-2xl border border-teal-200 bg-teal-50 p-4">
                <div className="flex items-start gap-3">
                  <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-teal-700" />
                  <div>
                    <p className="font-black text-slate-900" data-testid="text-invited-workspace-name">{invitation.workspaceName}</p>
                    <p className="mt-1 text-sm text-slate-600">{invitation.ownerName}</p>
                    <p className="mt-1 text-xs text-slate-500" dir="ltr">{invitation.email}</p>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="test-workspace-password">كلمة المرور</Label>
                <div className="relative">
                  <LockKeyhole className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-slate-400" />
                  <Input
                    id="test-workspace-password"
                    type={showPassword ? 'text' : 'password'}
                    dir="ltr"
                    value={password}
                    onChange={(event) => { setPassword(event.target.value); setError(''); }}
                    className="px-10 text-left"
                    autoComplete="new-password"
                    data-testid="input-test-workspace-password"
                  />
                  <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute left-3 top-2.5 text-slate-400 hover:text-slate-700" aria-label={showPassword ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}>
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="text-xs text-slate-500">{passwordPolicyMessage}</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="test-workspace-password-confirmation">تأكيد كلمة المرور</Label>
                <Input
                  id="test-workspace-password-confirmation"
                  type={showPassword ? 'text' : 'password'}
                  dir="ltr"
                  value={confirmation}
                  onChange={(event) => { setConfirmation(event.target.value); setError(''); }}
                  className="text-left"
                  autoComplete="new-password"
                  data-testid="input-test-workspace-password-confirmation"
                />
              </div>

              {error && <p className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm font-medium text-rose-800" role="alert" data-testid="error-test-workspace-invite">{error}</p>}

              <Button type="submit" className="h-11 w-full bg-teal-700 text-white hover:bg-teal-800" disabled={isSubmitting} data-testid="button-accept-test-workspace-invite">
                {isSubmitting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                {isSubmitting ? 'جارٍ التفعيل...' : 'تفعيل المساحة والدخول'}
              </Button>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}