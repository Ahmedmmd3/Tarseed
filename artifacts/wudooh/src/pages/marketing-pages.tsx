import { useEffect, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  BarChart3,
  BookOpen,
  Boxes,
  Building2,
  Check,
  CheckCircle2,
  ChevronLeft,
  CircleHelp,
  FileCheck2,
  Gauge,
  Headphones,
  LockKeyhole,
  Menu,
  Network,
  PackageCheck,
  ReceiptText,
  Scale,
  ServerCog,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Users,
  X,
  Zap,
} from 'lucide-react';
import { AuthDialog } from '@/components/auth-dialog';

const asset = (name: string) => `${import.meta.env.BASE_URL}${name}`;
const route = (path: string) => `${import.meta.env.BASE_URL.replace(/\/$/, '')}${path}`;

type MarketingShellProps = {
  children: ReactNode;
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
};

const navItems = [
  { label: 'المميزات', href: '/features' },
  { label: 'الحلول', href: '/solutions' },
  { label: 'الخطط', href: '/pricing' },
  { label: 'لماذا ترصيد', href: '/why-tarseed' },
  { label: 'الأمان والأداء', href: '/security-performance' },
];

function MarketingShell({ children, eyebrow, title, description, actions }: MarketingShellProps) {
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [menuOpen, setMenuOpen] = useState(false);

  const openAuth = (mode: 'login' | 'register') => {
    setAuthMode(mode);
    setAuthOpen(true);
    setMenuOpen(false);
  };

  return (
    <div dir="rtl" className="min-h-screen bg-[#f6f9fc] font-sans text-slate-900">
      <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl">
        <div className="mx-auto flex h-[76px] max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <a href={route('/')} className="flex items-center gap-3" aria-label="العودة إلى الصفحة الرئيسية"><BrandMark /></a>
          <nav className="hidden items-center gap-7 text-sm font-semibold text-slate-600 lg:flex" aria-label="التنقل الرئيسي">
            {navItems.map((item) => (
              <a key={item.href} href={route(item.href)} className="transition-colors hover:text-primary">{item.label}</a>
            ))}
          </nav>
          <div className="hidden items-center gap-3 sm:flex">
            <button type="button" onClick={() => openAuth('login')} className="px-3 py-2 text-sm font-semibold text-slate-600 transition-colors hover:text-primary">
              تسجيل الدخول
            </button>
            <button type="button" onClick={() => openAuth('register')} className="inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-white shadow-lg shadow-primary/20 transition hover:-translate-y-0.5 hover:bg-teal-600">
              ابدأ تجربتك المجانية
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <button type="button" className="rounded-lg p-2 text-slate-700 sm:hidden" aria-label={menuOpen ? 'إغلاق القائمة' : 'فتح القائمة'} onClick={() => setMenuOpen((open) => !open)}>
            {menuOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
        {menuOpen && (
          <div className="border-t border-slate-100 bg-white px-4 py-4 sm:hidden">
            <nav className="grid gap-1" aria-label="قائمة الجوال">
              {navItems.map((item) => (
                <a key={item.href} href={route(item.href)} onClick={() => setMenuOpen(false)} className="rounded-lg px-3 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">{item.label}</a>
              ))}
              <button type="button" onClick={() => openAuth('login')} className="mt-2 rounded-lg bg-slate-900 px-3 py-3 text-sm font-bold text-white">تسجيل الدخول</button>
              <button type="button" onClick={() => openAuth('register')} className="rounded-lg bg-primary px-3 py-3 text-sm font-bold text-white">ابدأ تجربتك المجانية</button>
            </nav>
          </div>
        )}
      </header>

      <main>
        <section className="relative overflow-hidden bg-[#061d40] px-4 pb-20 pt-16 text-white sm:px-6 lg:pb-24 lg:pt-24">
          <div className="absolute inset-0 opacity-30" style={{ backgroundImage: `url(${asset('features-bg.png')})`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(28,198,180,0.2),transparent_34%),linear-gradient(120deg,#061d40_15%,#092f58_100%)]" />
          <div className="relative mx-auto max-w-5xl text-center">
            {eyebrow && <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-teal-300/20 bg-teal-300/10 px-4 py-2 text-sm font-semibold text-teal-100"><Sparkles className="h-4 w-4 text-teal-300" />{eyebrow}</div>}
            <h1 className="text-4xl font-black leading-tight tracking-tight sm:text-5xl lg:text-6xl">{title}</h1>
            <p className="mx-auto mt-6 max-w-3xl text-base leading-8 text-slate-300 sm:text-lg">{description}</p>
            <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">{actions}</div>
          </div>
        </section>
        {children}
      </main>

      <MarketingFooter onRegister={() => openAuth('register')} />
      <AuthDialog open={authOpen} mode={authMode} onOpenChange={setAuthOpen} onSuccess={() => window.location.assign(route('/manager'))} />
    </div>
  );
}

function MarketingFooter({ onRegister }: { onRegister: () => void }) {
  const productLinks = [
    ['المحاسبة والمالية', '/products/accounting'],
    ['المبيعات والمخزون', '/products/sales'],
    ['الموارد البشرية', '/products/hr'],
    ['نقاط البيع', '/products/pos'],
  ];
  const companyLinks = [
    ['لماذا ترصيد', '/why-tarseed'],
    ['الحلول المتكاملة', '/solutions'],
    ['الأمان والأداء', '/security-performance'],
    ['الخطط', '/pricing'],
  ];
  const resourceLinks = [
    ['مركز المساعدة', '/resources/help'],
    ['دليل المنصة', '/resources/guide'],
    ['العمليات والمشاريع', '/resources/operations'],
    ['الفاتورة الإلكترونية', '/resources/e-invoicing'],
  ];
  return (
    <footer className="bg-[#06152f] px-4 pb-8 pt-16 text-slate-300 sm:px-6">
      <div className="mx-auto max-w-7xl">
        <div className="grid gap-12 border-b border-white/10 pb-12 md:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-3"><BrandMark light /><span className="text-lg font-black text-white">ترصيد</span></div>
            <p className="mt-5 max-w-sm text-sm leading-7 text-slate-400">ترصيد منصة عربية لإدارة أعمالك من المبيعات والمخزون إلى المحاسبة والموارد البشرية، بوضوح يساعدك على النمو.</p>
            <button type="button" onClick={onRegister} className="mt-6 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-white transition hover:bg-teal-600">ابدأ الآن <ArrowLeft className="h-4 w-4" /></button>
          </div>
          <FooterColumn title="المنتج" links={productLinks} />
          <FooterColumn title="الشركة" links={companyLinks} />
          <FooterColumn title="المصادر" links={resourceLinks} />
        </div>
        <div className="flex flex-col gap-3 pt-6 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} ترصيد. جميع الحقوق محفوظة.</span>
          <span>منصة واحدة لقرارات أوضح.</span>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: string[][] }) {
  return (
    <div>
      <h2 className="mb-4 text-sm font-bold text-white">{title}</h2>
      <ul className="space-y-3">
        {links.map(([label, href]) => <li key={href}><a href={route(href)} className="text-sm text-slate-400 transition-colors hover:text-teal-300">{label}</a></li>)}
      </ul>
    </div>
  );
}

function SectionHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <p className="text-sm font-bold text-primary">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">{title}</h2>
      <p className="mt-4 text-base leading-8 text-slate-500">{description}</p>
    </div>
  );
}

function ActionButtons({ secondary = '/solutions' }: { secondary?: string }) {
  return (
    <>
      <a href={route('/')} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-primary px-6 text-sm font-bold text-white shadow-lg shadow-primary/20 transition hover:bg-teal-600">استكشف ترصيد <ArrowLeft className="h-4 w-4" /></a>
      <a href={route(secondary)} className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/5 px-6 text-sm font-bold text-white transition hover:bg-white/10">تعرّف أكثر <ChevronLeft className="h-4 w-4" /></a>
    </>
  );
}

export function WhyTarseed() {
  const reasons = [
    { icon: Network, title: 'صورة واحدة لأعمالك', text: 'اربط المبيعات والمخزون والمحاسبة في تدفق واحد، لتصل إلى المعلومة الصحيحة قبل اتخاذ القرار.' },
    { icon: Scale, title: 'مصمم لبيئتك المحلية', text: 'تجربة عربية واضحة تدعم احتياجات المنشآت في المنطقة والعمليات اليومية لفريقك.' },
    { icon: Headphones, title: 'ينمو مع فريقك', text: 'ابدأ بما تحتاجه اليوم، ثم وسّع الوحدات والمواقع والصلاحيات مع نمو أعمالك.' },
    { icon: Sparkles, title: 'وضوح بلا تعقيد', text: 'واجهات عملية وتقارير مفهومة تقلل الوقت الضائع بين الجداول والأنظمة المتفرقة.' },
  ];
  return (
    <MarketingShell eyebrow="قرار أوضح يبدأ من منصة واحدة" title="لماذا تختار ترصيد؟" description="لأن إدارة العمل لا تحتاج نظاماً أكثر تعقيداً، بل تحتاج صورة أوضح، تدفقاً أسرع، وفريقاً يعمل على نفس البيانات." actions={<ActionButtons secondary="/security-performance" />}>
      <section className="px-4 py-20 sm:px-6 lg:py-28">
        <SectionHeading eyebrow="قيمة عملية كل يوم" title="ترصيد يحول البيانات إلى قرارات" description="صممنا التجربة حول ما يحتاجه صاحب المنشأة والفريق: سرعة الوصول، وضوح المسؤوليات، وثقة في الأرقام." />
        <div className="mx-auto mt-14 grid max-w-6xl gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {reasons.map(({ icon: Icon, title, text }) => <InfoCard key={title} icon={<Icon className="h-6 w-6" />} title={title} text={text} />)}
        </div>
      </section>
      <section className="bg-white px-4 py-20 sm:px-6 lg:py-24">
        <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2">
          <div>
            <p className="text-sm font-bold text-primary">من واقع يومك</p>
            <h2 className="mt-3 text-3xl font-black text-slate-900 sm:text-4xl">قلل التشتت وركز على النمو</h2>
            <p className="mt-5 text-base leading-8 text-slate-500">بدلاً من التنقل بين ملفات وأنظمة لا تتحدث معاً، يمنحك ترصيد مساحة عمل موحدة تُظهر ما يحدث الآن وما يحتاج إلى انتباهك.</p>
            <ul className="mt-7 grid gap-4">
              {['معلومات مترابطة بين كل الوحدات', 'صلاحيات واضحة لكل عضو وموقع', 'تقارير تساعدك على التحرك لا مجرد العرض'].map((item) => <li key={item} className="flex items-center gap-3 text-sm font-semibold text-slate-700"><CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />{item}</li>)}
            </ul>
          </div>
          <div className="relative overflow-hidden rounded-3xl bg-[#071d3d] p-5 shadow-2xl shadow-slate-300/50">
            <img src={asset('hero-abstract-ar-minimal.png')} alt="لوحة تحكم ترصيد" className="w-full rounded-2xl border border-white/10" />
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}

export function Solutions() {
  const solutions = [
    { icon: ShoppingCart, title: 'التجزئة والمتاجر', text: 'مبيعات أسرع، مخزون محدث، وتقارير تساعدك على معرفة الأصناف والفروع الأكثر أداءً.', href: '/products/pos' },
    { icon: Building2, title: 'الشركات متعددة الفروع', text: 'وحّد الصورة المالية والتشغيلية مع صلاحيات ونطاقات واضحة لكل فرع ومستودع.', href: '/products/accounting' },
    { icon: BriefcaseIcon, title: 'الخدمات والمشاريع', text: 'تابع المصروفات والعملاء والعمليات من بداية المشروع حتى قياس الربحية.', href: '/resources/operations' },
    { icon: Users, title: 'المنشآت التي تكبر', text: 'ابدأ بخطوات بسيطة وأضف المبيعات والموارد البشرية والتقارير وقتما تحتاج.', href: '/products/hr' },
  ];
  return (
    <MarketingShell eyebrow="حل يناسب طريقة عملك" title="حلول متكاملة لكل منشأة واحتياج" description="لا توجد منشأتان تعملان بالطريقة نفسها. اختر نقطة البداية التي تناسبك، واجمع وحدات ترصيد حول عملياتك بدلاً من تغييرها." actions={<ActionButtons secondary="/pricing" />}>
      <section className="px-4 py-20 sm:px-6 lg:py-28">
        <SectionHeading eyebrow="اختر مسارك" title="من احتياجك اليوم إلى خطتك القادمة" description="حلول مرنة تساعدك على تنظيم العمل الآن، مع مساحة للتوسع عندما تكبر المبيعات والفروع والفريق." />
        <div className="mx-auto mt-14 grid max-w-6xl gap-5 md:grid-cols-2">
          {solutions.map(({ icon: Icon, title, text, href }) => <a key={title} href={route(href)} className="group rounded-3xl border border-slate-200 bg-white p-7 shadow-sm transition hover:-translate-y-1 hover:border-primary/40 hover:shadow-xl hover:shadow-primary/10"><div className="flex items-start justify-between"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Icon className="h-6 w-6" /></div><ArrowLeft className="h-5 w-5 text-slate-300 transition group-hover:-translate-x-1 group-hover:text-primary" /></div><h3 className="mt-6 text-xl font-black text-slate-900">{title}</h3><p className="mt-3 text-sm leading-7 text-slate-500">{text}</p><span className="mt-6 inline-flex text-sm font-bold text-primary">اكتشف الحل <ChevronLeft className="ms-1 h-4 w-4" /></span></a>)}
        </div>
      </section>
      <PlansPreview />
    </MarketingShell>
  );
}

function PlansPreview() {
  const plans = [
    { name: 'الأساس', label: 'للبداية المنظمة', text: 'لأصحاب المنشآت الذين يريدون ترتيب المبيعات والحسابات في مكان واحد.', items: ['المحاسبة والقيود', 'العملاء والذمم', 'التقارير الأساسية'] },
    { name: 'النمو', label: 'للفريق المتوسع', text: 'لمنشآت تجمع بين المبيعات والمخزون وتحتاج رؤية أفضل للفروع.', items: ['كل ما في الأساس', 'المبيعات والمخزون', 'الصلاحيات والمواقع'] },
    { name: 'المؤسسات', label: 'للتشغيل المتكامل', text: 'للفرق متعددة الوحدات التي تحتاج عمليات مترابطة وتحكماً أوسع.', items: ['كل ما في النمو', 'الموارد البشرية والعمليات', 'تخصيص حسب الاحتياج'] },
  ];
  return (
    <section className="bg-[#eef7f6] px-4 py-20 sm:px-6 lg:py-24">
      <SectionHeading eyebrow="خطط مرنة" title="ادفع مقابل ما تحتاجه فعلاً" description="تبدأ كل منشأة من مستوى مختلف. استكشف المسار المناسب لك، وتواصل معنا إذا كان احتياجك يتطلب إعداداً خاصاً." />
      <div className="mx-auto mt-14 grid max-w-6xl gap-5 lg:grid-cols-3">
        {plans.map((plan, index) => <div key={plan.name} className={`relative rounded-3xl border bg-white p-7 ${index === 1 ? 'border-primary shadow-xl shadow-primary/10' : 'border-slate-200'}`}>{index === 1 && <span className="absolute -top-3 right-6 rounded-full bg-primary px-3 py-1 text-xs font-bold text-white">الأكثر اختياراً</span>}<p className="text-sm font-bold text-primary">{plan.label}</p><h3 className="mt-2 text-2xl font-black">{plan.name}</h3><p className="mt-3 min-h-14 text-sm leading-7 text-slate-500">{plan.text}</p><ul className="mt-6 space-y-3 border-t border-slate-100 pt-6">{plan.items.map((item) => <li key={item} className="flex items-center gap-2 text-sm font-semibold text-slate-700"><Check className="h-4 w-4 text-primary" />{item}</li>)}</ul><a href={route('/pricing')} className="mt-7 flex h-11 items-center justify-center rounded-xl border border-slate-200 text-sm font-bold text-slate-700 transition hover:border-primary hover:text-primary">عرض تفاصيل الخطط</a></div>)}
      </div>
    </section>
  );
}

export function SecurityPerformance() {
  const security = [
    { icon: LockKeyhole, title: 'جلسات آمنة', text: 'حماية الجلسات وإلغاء الجلسات القديمة بعد تغيير كلمة المرور.' },
    { icon: ShieldCheck, title: 'صلاحيات دقيقة', text: 'تحكم في الوحدات والأدوار ونطاق المواقع لكل عضو في الفريق.' },
    { icon: FileCheck2, title: 'سجل تدقيق', text: 'تتبع العمليات الإدارية الحساسة لتعرف ماذا حدث ومتى.' },
  ];
  const performance = [
    { icon: Zap, title: 'استجابة سريعة', text: 'تجربة عملية تقلل عدد الخطوات وتبقي المعلومات الأقرب إليك.' },
    { icon: ServerCog, title: 'بيانات مترابطة', text: 'تحديثات متسقة بين المبيعات والمخزون والحسابات دون تكرار يدوي.' },
    { icon: Network, title: 'استمرارية العمل', text: 'طابور مزامنة يحافظ على العمليات المحلية عند انقطاع الاتصال.' },
    { icon: BarChart3, title: 'تقارير لحظية', text: 'حوّل الأرقام المتجددة إلى مؤشرات واضحة تساعدك على التصرف.' },
  ];
  return (
    <MarketingShell eyebrow="ثقة في كل عملية" title="الأمان والأداء جزء من المنتج" description="نحمي بيانات عملك ونصمم التجربة لتبقى سريعة وواضحة، من أول عملية بيع إلى أكبر تقرير مالي." actions={<ActionButtons secondary="/features" />}>
      <FeatureRows title="الأمان الذي يطمئن فريقك" description="الأمان ليس إعداداً مخفياً؛ هو طبقات عملية تظهر في طريقة الدخول، إدارة الصلاحيات، وحماية البيانات." items={security} tone="navy" />
      <FeatureRows title="أداء يساعدك على الإنجاز" description="كل ثانية وكل خطوة مهمة في يوم العمل. لذلك نركز على ترابط البيانات وسرعة الوصول واستمرار العمل." items={performance} tone="mint" reversed />
    </MarketingShell>
  );
}

function FeatureRows({ title, description, items, tone, reversed = false }: { title: string; description: string; items: Array<{ icon: typeof ShieldCheck; title: string; text: string }>; tone: 'navy' | 'mint'; reversed?: boolean }) {
  return (
    <section className={`px-4 py-20 sm:px-6 lg:py-24 ${tone === 'navy' ? 'bg-white' : 'bg-[#eef7f6]'}`}>
      <div className={`mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-2 ${reversed ? 'lg:[&>*:first-child]:order-2' : ''}`}>
        <div><p className="text-sm font-bold text-primary">تفاصيل تهمك</p><h2 className="mt-3 text-3xl font-black text-slate-900 sm:text-4xl">{title}</h2><p className="mt-5 max-w-xl text-base leading-8 text-slate-500">{description}</p></div>
        <div className="grid gap-4 sm:grid-cols-2">{items.map(({ icon: Icon, title: itemTitle, text }) => <div key={itemTitle} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary"><Icon className="h-5 w-5" /></div><h3 className="mt-4 font-black text-slate-900">{itemTitle}</h3><p className="mt-2 text-sm leading-6 text-slate-500">{text}</p></div>)}</div>
      </div>
    </section>
  );
}

export function Features() {
  const features = [
    { icon: ReceiptText, title: 'المحاسبة والمالية', text: 'حسابات، قيود، ذمم وتقارير مالية في دورة واضحة.', href: '/products/accounting' },
    { icon: ShoppingCart, title: 'المبيعات والعملاء', text: 'تابع رحلة البيع وعلاقة العميل من مكان واحد.', href: '/products/sales' },
    { icon: Boxes, title: 'المخزون والفروع', text: 'أرصدة وحركات وتحويلات أكثر دقة بين المواقع.', href: '/products/sales' },
    { icon: Users, title: 'الموارد البشرية', text: 'نظّم بيانات الفريق ووسّع عملياتك بثقة.', href: '/products/hr' },
    { icon: Gauge, title: 'نقاط البيع', text: 'تجربة بيع سريعة متصلة بالمخزون والمحاسبة.', href: '/products/pos' },
    { icon: Network, title: 'العمليات والمشاريع', text: 'اربط المصروفات والمهام ومخرجات العمل.', href: '/resources/operations' },
  ];
  return (
    <MarketingShell eyebrow="كل ما تحتاجه في مساحة واحدة" title="مميزات صممت لتعمل معاً" description="ترصيد لا يضيف أدوات منفصلة فقط؛ بل يربط العمليات التي يعتمد بعضها على بعض حتى تصبح الصورة أسهل والفريق أسرع." actions={<ActionButtons secondary="/solutions" />}>
      <section className="px-4 py-20 sm:px-6 lg:py-28">
        <div className="mx-auto grid max-w-6xl gap-5 sm:grid-cols-2 lg:grid-cols-3">{features.map(({ icon: Icon, title, text, href }) => <a key={title} href={route(href)} className="group rounded-3xl border border-slate-200 bg-white p-7 shadow-sm transition hover:-translate-y-1 hover:border-primary/40 hover:shadow-xl hover:shadow-primary/10"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#e9f8f6] text-primary"><Icon className="h-6 w-6" /></div><h2 className="mt-6 text-xl font-black">{title}</h2><p className="mt-3 text-sm leading-7 text-slate-500">{text}</p><span className="mt-6 inline-flex items-center text-sm font-bold text-primary">اعرف المزيد <ChevronLeft className="ms-1 h-4 w-4 transition group-hover:-translate-x-1" /></span></a>)}</div>
      </section>
    </MarketingShell>
  );
}

export function Pricing() {
  return (
    <MarketingShell eyebrow="اختر ما يناسب مرحلتك" title="خطط مرنة لنمو أكثر وضوحاً" description="ابدأ بالوحدات التي تحتاجها الآن، وتوسع مع ترصيد كلما كبر فريقك وعملياتك. نساعدك على اختيار المسار المناسب دون تعقيد." actions={<ActionButtons secondary="/solutions" />}>
      <PlansPreview />
      <section className="px-4 py-20 sm:px-6 lg:py-24"><div className="mx-auto max-w-4xl rounded-3xl bg-[#061d40] px-6 py-12 text-center text-white sm:px-12"><Building2 className="mx-auto h-8 w-8 text-teal-300" /><h2 className="mt-5 text-3xl font-black">احتياجك مختلف؟ نبني المسار معك</h2><p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-slate-300">للمنشآت متعددة الفروع أو العمليات الخاصة، تواصل معنا لنحدد الوحدات والصلاحيات والتجهيز الذي يناسبك.</p><a href={route('/')} className="mt-7 inline-flex h-11 items-center gap-2 rounded-xl bg-primary px-5 text-sm font-bold text-white hover:bg-teal-600">ابدأ محادثة حول احتياجك <ArrowLeft className="h-4 w-4" /></a></div></section>
    </MarketingShell>
  );
}

type ProductConfig = { title: string; description: string; icon: typeof ReceiptText; points: string[]; accent: string };
const productConfigs: Record<string, ProductConfig> = {
  accounting: { title: 'المحاسبة والمالية', description: 'حوّل الأرقام اليومية إلى صورة مالية مفهومة تساعدك على إدارة السيولة والالتزامات والنمو.', icon: ReceiptText, accent: 'الحسابات التي تثق بها', points: ['دليل حسابات وقيود يومية منظمة', 'ذمم العملاء والموردين مع متابعة الاستحقاقات', 'تقارير مالية تساعدك على قراءة الأداء', 'إقفال الفترات وحماية القيود المرحّلة'] },
  sales: { title: 'المبيعات والمخزون', description: 'اربط البيع بالمخزون والمحاسبة حتى تعرف ما بيع، وما تبقى، وما يحتاج إلى قرار.', icon: ShoppingCart, accent: 'من الطلب إلى الرصيد', points: ['إدارة دورة المبيعات والعملاء', 'أرصدة المواقع والتحويلات بين الفروع', 'تحديثات متسقة بين المبيعات والمخزون', 'متابعة المنتجات والحركات والتسويات'] },
  hr: { title: 'الموارد البشرية', description: 'ابنِ أساساً منظماً لفريقك وبياناته مع مساحة لتطوير عمليات الموارد البشرية.', icon: Users, accent: 'فريق أوضح، عمل أسهل', points: ['ملفات أعضاء الفريق والصلاحيات', 'أدوار ونطاقات وصول حسب المسؤولية', 'بيانات منظمة تدعم نمو المنشأة', 'تجربة عربية واضحة للإدارة اليومية'] },
  pos: { title: 'نقاط البيع', description: 'امنح فريق المبيعات تجربة سريعة ومتناسقة مع المخزون والمحاسبة، في الفرع أو من أي جهاز.', icon: Gauge, accent: 'سرعة عند نقطة البيع', points: ['واجهة بيع بسيطة وسريعة', 'ربط مباشر بالمخزون والفروع', 'تدفق أوضح من البيع حتى القيد', 'استمرارية العمل مع المزامنة عند عودة الاتصال'] },
};

export function ProductPage({ product }: { product: keyof typeof productConfigs }) {
  const config = productConfigs[product];
  const Icon = config.icon;
  return (
    <MarketingShell eyebrow={config.accent} title={config.title} description={config.description} actions={<ActionButtons secondary="/features" />}>
      <section className="px-4 py-20 sm:px-6 lg:py-28"><div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[0.8fr_1.2fr]"><div className="rounded-3xl bg-[#061d40] p-8 text-white"><Icon className="h-9 w-9 text-teal-300" /><h2 className="mt-7 text-3xl font-black">وحدة تعمل مع بقية عملك</h2><p className="mt-4 text-sm leading-7 text-slate-300">القيمة لا تأتي من الوحدة وحدها، بل من اتصالها ببقية الصورة داخل ترصيد.</p></div><div><p className="text-sm font-bold text-primary">ماذا تحصل عليه؟</p><h2 className="mt-3 text-3xl font-black">أدوات عملية بدون تشتت</h2><div className="mt-8 grid gap-4 sm:grid-cols-2">{config.points.map((point) => <div key={point} className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-white p-5"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-primary" /><span className="text-sm font-semibold leading-6 text-slate-700">{point}</span></div>)}</div></div></div></section>
      <section className="bg-white px-4 py-16 text-center sm:px-6"><h2 className="text-3xl font-black">جاهز لترتيب هذه العملية؟</h2><p className="mt-3 text-slate-500">ابدأ بتجربة ترصيد، ثم أضف ما تحتاجه عندما تكون جاهزاً.</p></section>
    </MarketingShell>
  );
}

export function ResourcePage({ kind }: { kind: 'help' | 'guide' | 'operations' | 'e-invoicing' }) {
  const data = {
    help: { icon: CircleHelp, title: 'مركز المساعدة', description: 'إجابات واضحة تساعد فريقك على البدء واستخدام ترصيد بثقة.', items: ['البدء وإنشاء المنشأة', 'إدارة الحسابات والصلاحيات', 'المزامنة والنسخ الاحتياطي', 'حل المشكلات الشائعة'] },
    guide: { icon: BookOpen, title: 'دليل المنصة', description: 'مسار تعلّم عملي للتعرف على الوحدات وبناء طريقة عمل مناسبة لمنشأتك.', items: ['جولة في لوحة التحكم', 'إعداد الحسابات والمواقع', 'ربط المبيعات بالمخزون', 'قراءة التقارير والمؤشرات'] },
    operations: { icon: Network, title: 'العمليات والمشاريع', description: 'نظّم المشاريع والمصروفات والمهام المرتبطة بها في صورة واحدة.', items: ['تخطيط المشاريع', 'المصروفات والتكاليف', 'متابعة الإنجاز', 'قياس الربحية'] },
    'e-invoicing': { icon: FileCheck2, title: 'الفاتورة الإلكترونية', description: 'جهّز دورة فواتير أكثر تنظيماً مع بيانات مرتبطة بالحسابات والعملاء.', items: ['بيانات العميل والفاتورة', 'تدفق البيع والتحصيل', 'ترحيل أوضح للحسابات', 'تقارير ومتابعة الاستحقاقات'] },
  }[kind];
  const Icon = data.icon;
  return (
    <MarketingShell eyebrow="مصادر ترصيد" title={data.title} description={data.description} actions={<ActionButtons secondary="/features" />}>
      <section className="px-4 py-20 sm:px-6 lg:py-28"><div className="mx-auto max-w-4xl"><div className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-primary/10 text-primary"><Icon className="h-8 w-8" /></div><h2 className="mt-8 text-center text-3xl font-black">مساحة أوضح لتبدأ بسرعة</h2><div className="mt-10 grid gap-4 sm:grid-cols-2">{data.items.map((item, index) => <div key={item} className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#e9f8f6] text-sm font-black text-primary">{index + 1}</span><span className="text-sm font-bold text-slate-700">{item}</span></div>)}</div></div></section>
    </MarketingShell>
  );
}

function InfoCard({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">{icon}</div><h3 className="mt-5 text-lg font-black">{title}</h3><p className="mt-3 text-sm leading-7 text-slate-500">{text}</p></div>;
}

function BriefcaseIcon(props: React.ComponentProps<typeof Building2>) {
  return <Building2 {...props} />;
}

function BrandMark({ light = false }: { light?: boolean }) {
  return <div className={`relative h-11 w-11 shrink-0 overflow-hidden ${light ? 'brightness-0 invert' : ''}`}><img src={asset('logo-transparent.png')} alt="شعار ترصيد" className="absolute max-w-none" style={{ width: '115px', right: '-34px', top: '-22px' }} /></div>;
}

export default MarketingShell;