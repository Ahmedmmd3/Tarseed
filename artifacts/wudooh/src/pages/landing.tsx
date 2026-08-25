import { useEffect, useState } from 'react';
import { ArrowLeft, BarChart3, Boxes, Building2, CheckCircle2, ChevronLeft, Gauge, LockKeyhole, Menu, Network, ReceiptText, ShieldCheck, ShoppingCart, Users, X, Zap } from 'lucide-react';
import { AuthDialog } from '@/components/auth-dialog';

const asset = (name: string) => `${import.meta.env.BASE_URL}${name}`;
const route = (path: string) => `${import.meta.env.BASE_URL.replace(/\/$/, '')}${path}`;

export default function Landing() {
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const openAuth = (mode: 'login' | 'register') => { setAuthMode(mode); setAuthOpen(true); setMenuOpen(false); };

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div dir="rtl" className="min-h-screen bg-[#f6f9fc] font-sans text-slate-900">
      <header className={`fixed inset-x-0 top-0 z-50 border-b transition-all ${scrolled ? 'border-slate-200/80 bg-white/90 shadow-sm backdrop-blur-xl' : 'border-white/10 bg-[#061d40]/90 backdrop-blur-md'}`}>
        <div className="mx-auto flex h-[76px] max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <a href={route('/')} aria-label="الرئيسية"><BrandMark /></a>
          <nav className={`hidden items-center gap-7 text-sm font-semibold lg:flex ${scrolled ? 'text-slate-600' : 'text-slate-200'}`} aria-label="التنقل الرئيسي">
            <a href={route('/features')} className="transition hover:text-primary">المميزات</a>
            <a href={route('/solutions')} className="transition hover:text-primary">الحلول المتكاملة</a>
            <a href={route('/why-tarseed')} className="transition hover:text-primary">لماذا ترصيد</a>
            <a href={route('/security-performance')} className="transition hover:text-primary">الأمان والأداء</a>
          </nav>
          <div className="hidden items-center gap-3 sm:flex">
            <button type="button" onClick={() => openAuth('login')} className={`px-3 py-2 text-sm font-semibold transition hover:text-primary ${scrolled ? 'text-slate-600' : 'text-white'}`}>تسجيل الدخول</button>
            <button type="button" onClick={() => openAuth('register')} className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-white shadow-lg shadow-primary/20 transition hover:-translate-y-0.5 hover:bg-teal-600">ابدأ تجربتك المجانية <ArrowLeft className="h-4 w-4" /></button>
          </div>
          <button type="button" className={`rounded-lg p-2 sm:hidden ${scrolled ? 'text-slate-700' : 'text-white'}`} aria-label={menuOpen ? 'إغلاق القائمة' : 'فتح القائمة'} onClick={() => setMenuOpen((open) => !open)}>{menuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}</button>
        </div>
        {menuOpen && <div className="border-t border-slate-100 bg-white px-4 py-4 sm:hidden"><nav className="grid gap-1">{[['المميزات', '/features'], ['الحلول المتكاملة', '/solutions'], ['لماذا ترصيد', '/why-tarseed'], ['الأمان والأداء', '/security-performance'], ['الخطط', '/pricing']].map(([label, href]) => <a key={href} href={route(href)} className="rounded-lg px-3 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">{label}</a>)}<button type="button" onClick={() => openAuth('register')} className="mt-2 rounded-lg bg-primary px-3 py-3 text-sm font-bold text-white">ابدأ تجربتك المجانية</button></nav></div>}
      </header>

      <main>
        <section className="relative overflow-hidden bg-[#061d40] px-4 pb-20 pt-36 text-white sm:px-6 lg:pb-28 lg:pt-48">
          <div className="absolute inset-0 opacity-30" style={{ backgroundImage: `url(${asset('features-bg.png')})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(28,198,180,0.2),transparent_32%),linear-gradient(120deg,#061d40,#092e57)]" />
          <div className="relative mx-auto grid max-w-7xl items-center gap-14 lg:grid-cols-[1fr_0.9fr]">
            <div className="max-w-2xl">
              <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-teal-200/20 bg-teal-200/10 px-4 py-2 text-sm font-semibold text-teal-100"><span className="h-2 w-2 rounded-full bg-teal-300" />الإصدار الجديد متاح الآن</div>
              <h1 className="text-5xl font-black leading-[1.12] tracking-tight sm:text-6xl lg:text-7xl">وضوح أكبر.<br /><span className="text-teal-300">نمو أسرع.</span></h1>
              <p className="mt-7 max-w-xl text-lg leading-9 text-slate-300">ترصيد يجمع المحاسبة، المبيعات، المشتريات، المخزون والموارد البشرية في منصة عربية واحدة تساعدك على إدارة عملك بثقة.</p>
              <div className="mt-9 flex flex-col gap-3 sm:flex-row"><button type="button" onClick={() => openAuth('register')} className="inline-flex h-13 items-center justify-center gap-2 rounded-xl bg-primary px-7 py-3.5 text-sm font-bold text-white shadow-xl shadow-primary/20 transition hover:bg-teal-500">ابدأ تجربتك المجانية <ArrowLeft className="h-4 w-4" /></button><a href={route('/solutions')} className="inline-flex h-13 items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/5 px-7 py-3.5 text-sm font-bold text-white transition hover:bg-white/10">استكشف الحلول <ChevronLeft className="h-4 w-4" /></a></div>
              <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-sm text-slate-300"><span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-teal-300" />تجربة سهلة</span><span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-teal-300" />بيانات مترابطة</span><span className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-teal-300" />صلاحيات واضحة</span></div>
            </div>
            <div className="relative mx-auto w-full max-w-xl">
              <div className="absolute -inset-5 rounded-[2.5rem] bg-teal-300/10 blur-2xl" />
              <div className="relative overflow-hidden rounded-[2rem] border border-white/15 bg-white/10 p-3 shadow-2xl"><img src={asset('hero-abstract-ar-minimal.png')} alt="لوحة تحكم ترصيد" className="w-full rounded-2xl" width="1024" height="1024" /></div>
              <div className="absolute -bottom-5 -right-5 rounded-2xl border border-white/15 bg-[#0b315d]/95 px-5 py-4 shadow-xl"><p className="text-xs text-slate-300">صافي الأرباح</p><p className="mt-1 text-2xl font-black text-teal-300">+ ١٢,٥٠٠ ر.س</p></div>
            </div>
          </div>
        </section>

        <section className="bg-white px-4 py-20 sm:px-6 lg:py-28">
          <div className="mx-auto max-w-3xl text-center"><p className="text-sm font-bold text-primary">كل ما تحتاجه في مكان واحد</p><h2 className="mt-3 text-3xl font-black sm:text-4xl">نظام واحد يربط كل تفاصيل عملك</h2><p className="mt-4 text-base leading-8 text-slate-500">من أول عملية بيع إلى آخر تقرير مالي، ترصيد يربط المعلومات التي يعتمد بعضها على بعض.</p></div>
          <div className="mx-auto mt-14 grid max-w-6xl gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {[['المحاسبة والمالية', 'حسابات وقيود وتقارير تساعدك على فهم الصورة المالية.', ReceiptText, '/products/accounting'], ['المبيعات والمخزون', 'تابع البيع والأرصدة والحركات بين المواقع بوضوح.', ShoppingCart, '/products/sales'], ['الموارد البشرية', 'نظّم بيانات فريقك وصلاحياته مع نمو منشأتك.', Users, '/products/hr'], ['الأمان والأداء', 'طبقات حماية وتجربة سريعة تحافظ على استمرارية العمل.', ShieldCheck, '/security-performance']].map(([title, text, Icon, href]) => <a key={title as string} href={route(href as string)} className="group rounded-3xl border border-slate-200 bg-slate-50 p-6 transition hover:-translate-y-1 hover:border-primary/40 hover:bg-white hover:shadow-xl hover:shadow-primary/10"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Icon className="h-6 w-6" /></div><h3 className="mt-5 text-lg font-black">{title as string}</h3><p className="mt-3 text-sm leading-7 text-slate-500">{text as string}</p><span className="mt-5 inline-flex items-center text-sm font-bold text-primary">اعرف المزيد <ChevronLeft className="ms-1 h-4 w-4 transition group-hover:-translate-x-1" /></span></a>)}
          </div>
        </section>

        <section className="bg-[#eef7f6] px-4 py-20 sm:px-6 lg:py-28">
          <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2"><div><p className="text-sm font-bold text-primary">لماذا ترصيد؟</p><h2 className="mt-3 text-3xl font-black sm:text-4xl">قراراتك تبدأ من صورة واضحة</h2><p className="mt-5 text-base leading-8 text-slate-500">ترصيد ليس مجموعة أدوات منفصلة. هو مساحة عمل واحدة تجمع فريقك وبياناتك وعملياتك حتى تعرف أين تقف وإلى أين تتجه.</p><ul className="mt-7 grid gap-4">{[['أمان وصلاحيات تناسب فريقك', LockKeyhole], ['أداء سريع ومزامنة موثوقة', Zap], ['حلول تتوسع مع احتياجات منشأتك', Network]].map(([text, Icon]) => <li key={text as string} className="flex items-center gap-3 text-sm font-bold text-slate-700"><Icon className="h-5 w-5 text-primary" />{text as string}</li>)}</ul><a href={route('/why-tarseed')} className="mt-8 inline-flex items-center gap-2 text-sm font-bold text-primary">اكتشف لماذا ترصيد <ArrowLeft className="h-4 w-4" /></a></div><div className="rounded-3xl bg-[#061d40] p-5 shadow-2xl"><img src={asset('hero-abstract-ar-minimal.png')} alt="تقارير ولوحة تحكم ترصيد" className="rounded-2xl border border-white/10" /></div></div>
        </section>

        <section className="bg-[#061d40] px-4 py-20 text-center text-white sm:px-6 lg:py-24"><div className="mx-auto max-w-3xl"><p className="text-sm font-bold text-teal-300">ابدأ بخطوة بسيطة</p><h2 className="mt-4 text-3xl font-black sm:text-5xl">جاهز لإدارة أوضح؟</h2><p className="mt-5 text-base leading-8 text-slate-300">اختر الحل المناسب لمنشأتك، وابدأ تجربتك مع منصة صممت للنمو.</p><div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row"><button type="button" onClick={() => openAuth('register')} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-primary px-7 text-sm font-bold text-white hover:bg-teal-500">ابدأ تجربتك المجانية <ArrowLeft className="h-4 w-4" /></button><a href={route('/pricing')} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-white/20 px-7 text-sm font-bold text-white hover:bg-white/10">شاهد الخطط <ChevronLeft className="h-4 w-4" /></a></div></div></section>
      </main>

      <footer className="bg-[#04142d] px-4 pb-8 pt-14 text-slate-300 sm:px-6"><div className="mx-auto max-w-7xl"><div className="grid gap-10 border-b border-white/10 pb-12 md:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]"><div><div className="flex items-center gap-3"><BrandMark light /><span className="text-lg font-black text-white">ترصيد</span></div><p className="mt-5 max-w-sm text-sm leading-7 text-slate-400">منصة عربية متكاملة تساعدك على إدارة أعمالك بوضوح وثقة.</p></div><FooterColumn title="المنتج" links={[['المميزات', '/features'], ['المحاسبة والمالية', '/products/accounting'], ['المبيعات والمخزون', '/products/sales'], ['نقاط البيع', '/products/pos']]} /><FooterColumn title="الشركة" links={[['لماذا ترصيد', '/why-tarseed'], ['الحلول المتكاملة', '/solutions'], ['الخطط', '/pricing'], ['الأمان والأداء', '/security-performance']]} /><FooterColumn title="المصادر" links={[['مركز المساعدة', '/resources/help'], ['دليل المنصة', '/resources/guide'], ['العمليات والمشاريع', '/resources/operations'], ['الفاتورة الإلكترونية', '/resources/e-invoicing']]} /></div><p className="pt-6 text-xs text-slate-500">© {new Date().getFullYear()} ترصيد. جميع الحقوق محفوظة.</p></div></footer>
      <AuthDialog open={authOpen} mode={authMode} onOpenChange={setAuthOpen} onSuccess={() => window.location.assign(route('/manager'))} />
    </div>
  );
}

function FooterColumn({ title, links }: { title: string; links: string[][] }) {
  return <div><h2 className="mb-4 text-sm font-bold text-white">{title}</h2><ul className="space-y-3">{links.map(([label, href]) => <li key={href}><a href={route(href)} className="text-sm text-slate-400 transition hover:text-teal-300">{label}</a></li>)}</ul></div>;
}

function BrandMark({ light = false }: { light?: boolean }) {
  return <div className={`relative h-11 w-11 shrink-0 overflow-hidden ${light ? 'brightness-0 invert' : ''}`}><img src={asset('logo-transparent.png')} alt="شعار ترصيد" className="absolute max-w-none" style={{ width: '115px', right: '-34px', top: '-22px' }} /></div>;
}