import { useState, useEffect } from 'react';
import { Link } from 'wouter';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import {
  BookOpen, Rocket, ShieldCheck, Database, RefreshCw, Lock, ArrowLeft,
  LayoutDashboard, Store, ShoppingCart, Boxes, Truck, ReceiptText, Book,
  Wallet, BarChart3, FileBadge, UsersRound, BriefcaseBusiness, Activity, CheckCircle2,
  Lightbulb, AlertCircle
} from 'lucide-react';

export default function Guide() {
  const [activeSection, setActiveSection] = useState('intro');

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visibleSections = entries.filter(entry => entry.isIntersecting);
        if (visibleSections.length > 0) {
          // Sort by ratio of intersection to determine the most visible one
          visibleSections.sort((a, b) => b.intersectionRatio - a.intersectionRatio);
          setActiveSection(visibleSections[0].target.id);
        }
      },
      { rootMargin: '-100px 0px -40% 0px', threshold: [0, 0.25, 0.5, 0.75, 1] }
    );

    const sections = document.querySelectorAll('section[id]');
    sections.forEach((section) => observer.observe(section));

    return () => {
      sections.forEach((section) => observer.unobserve(section));
    };
  }, []);

  const scrollToSection = (id: string) => {
    const element = document.getElementById(id);
    if (element) {
      const y = element.getBoundingClientRect().top + window.scrollY - 80; // offset for sticky header if any
      window.scrollTo({ top: y, behavior: 'smooth' });
    }
  };

  const navItems = [
    { id: 'intro', label: 'مقدمة عن ترصيد', icon: BookOpen },
    { id: 'setup', label: 'رحلة البدء والاستخدام', icon: Rocket },
    { id: 'modules', label: 'وحدات النظام', icon: LayoutDashboard },
    { id: 'offline', label: 'العمل دون اتصال', icon: RefreshCw },
    { id: 'permissions', label: 'إدارة الصلاحيات', icon: ShieldCheck },
    { id: 'closing', label: 'إقفال الفترات', icon: Lock },
    { id: 'demo-data', label: 'البيانات التجريبية', icon: Database },
    { id: 'tips', label: 'نصائح عملية', icon: Lightbulb },
    { id: 'faq', label: 'الأسئلة الشائعة', icon: AlertCircle },
  ];

  const modules = [
    { id: 'dashboard', name: 'لوحة التحكم', icon: LayoutDashboard, href: '/dashboard', desc: 'نظرة عامة على أعمالك، المؤشرات المالية، وملخص أداء المنشأة.' },
    { id: 'pos', name: 'نقطة البيع', icon: Store, href: '/pos', desc: 'واجهة مخصصة للكاشير لتسجيل المبيعات اليومية بسرعة مع دعم للمزامنة دون اتصال.' },
    { id: 'sales', name: 'المبيعات والعملاء', icon: ShoppingCart, href: '/sales', desc: 'إدارة ملفات العملاء ومراجعة فواتير المبيعات والمبيعات المسجلة.' },
    { id: 'inventory', name: 'المخزون والمنتجات', icon: Boxes, href: '/inventory', desc: 'تعريف الأصناف، تتبع الكميات، وتسويات المخزون.' },
    { id: 'purchases', name: 'المشتريات والموردون', icon: Truck, href: '/purchases', desc: 'تسجيل فواتير الموردين ومتابعة التكاليف لتحديث المخزون والمحاسبة.' },
    { id: 'accounts', name: 'دليل الحسابات', icon: Book, href: '/accounts', desc: 'شجرة الحسابات المالية وأرصدتها الحالية، لتصنيف إيراداتك ومصروفاتك.' },
    { id: 'journals', name: 'القيود اليومية', icon: ReceiptText, href: '/journals', desc: 'الحركات المالية المباشرة وتلك المرحّلة آلياً من الوحدات الأخرى.' },
    { id: 'receivables', name: 'الذمم والمستحقات', icon: Wallet, href: '/receivables', desc: 'تتبع ما للمنشأة (تحصيل) وما عليها (دفع) مع تسجيل الدفعات.' },
    { id: 'expenses', name: 'المصاريف', icon: ReceiptText, href: '/expenses', desc: 'إدارة وتوثيق المصاريف التشغيلية وفواتير الخدمات.' },
    { id: 'reports', name: 'التقارير المالية', icon: BarChart3, href: '/reports', desc: 'مؤشرات الأداء، قائمة الدخل، الميزانية العمومية، وكشف الحساب.' },
    { id: 'einvoicing', name: 'الفوترة الإلكترونية', icon: FileBadge, href: '/e-invoicing', desc: 'مراجعة ورفع الفواتير لتتوافق مع متطلبات هيئة الزكاة والضريبة والجمارك.' },
    { id: 'hr', name: 'الموارد البشرية', icon: UsersRound, href: '/hr', desc: 'تنظيم سجلات الموظفين والمسميات والأقسام والرواتب.' },
    { id: 'operations', name: 'العمليات والمشاريع', icon: BriefcaseBusiness, href: '/operations', desc: 'تتبع المشاريع، تكاليفها، ونطاق إنجازها.' },
    { id: 'team', name: 'إدارة الفريق', icon: UsersRound, href: '/team', desc: 'إضافة المستخدمين وتعيين الأدوار والصلاحيات الخاصة بكل عضو.' },
    { id: 'operations-log', name: 'سجل العمليات', icon: Activity, href: '/operations-log', desc: 'تتبع الحركات الهامة داخل النظام وتدقيق التغييرات.' },
  ];

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-8">
        <h1 className="text-3xl font-black text-white sm:text-4xl">دليل استخدام ترصيد</h1>
        <p className="mt-3 text-base text-slate-300">دليلك الشامل لتعظيم الاستفادة من المنصة، من إعداد الحساب حتى العمليات المتقدمة.</p>
      </div>

      <div className="sticky top-0 z-10 mb-8 overflow-x-auto rounded-2xl border border-white/10 bg-[#0a2a4d]/95 p-2 shadow-lg backdrop-blur lg:hidden">
        <nav className="flex min-w-max gap-1" aria-label="فهرس الدليل على الجوال">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => scrollToSection(item.id)}
                className={`inline-flex min-h-10 items-center gap-2 rounded-xl px-3 text-xs font-bold transition-colors ${
                  isActive ? 'bg-teal-400 text-[#061d40]' : 'text-slate-300 hover:bg-white/10 hover:text-white'
                }`}
              >
                <Icon className={`h-4 w-4 ${isActive ? 'text-[#061d40]' : 'text-teal-200'}`} />
                {item.label}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="flex flex-col items-start gap-10 lg:flex-row">
        {/* Navigation Sidebar */}
        <aside className="sticky top-24 hidden w-64 shrink-0 rounded-3xl border border-white/10 bg-white/5 p-5 shadow-sm lg:block backdrop-blur-xl">
          <p className="mb-4 text-xs font-bold text-teal-200">محتويات الدليل</p>
          <nav className="flex flex-col gap-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeSection === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => scrollToSection(item.id)}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${
                    isActive ? 'bg-teal-400 text-[#061d40]' : 'text-slate-300 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <Icon className={`h-4 w-4 ${isActive ? 'text-[#061d40]' : 'text-teal-200'}`} />
                  {item.label}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* Content */}
        <main className="min-w-0 flex-1 space-y-16 pb-20">
          <section id="intro" className="scroll-mt-24 space-y-5">
            <div className="flex items-center gap-3 border-b border-white/10 pb-4 text-white">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-teal-400/20 text-teal-300">
                <BookOpen className="h-6 w-6" />
              </span>
              <h2 className="text-2xl font-black">مقدمة عن ترصيد</h2>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-6 leading-8 text-slate-600 shadow-sm md:p-8">
              <p className="mb-4">
                ترصيد هو نظام سحابي متكامل لإدارة منشأتك. يربط بين المبيعات، المخزون، الحسابات، والعمليات في واجهة واحدة. 
                صُمم ليكون مساحة عمل هادئة وموثوقة، بحيث تبدو الإدارة كأنها مساعدة من زميل خبير يجلس بجوارك، وليس مجرد نظام معقد.
              </p>
              <h3 className="mb-3 mt-8 font-bold text-slate-900">الفوائد الأساسية:</h3>
              <ul className="grid gap-3 sm:grid-cols-2">
                <li className="flex items-start gap-2"><CheckCircle2 className="mt-1 h-5 w-5 shrink-0 text-teal-500" /><span>معلومات مترابطة: فاتورة المبيعات تحدّث المخزون وتقيّد محاسبياً بضغطة واحدة.</span></li>
                <li className="flex items-start gap-2"><CheckCircle2 className="mt-1 h-5 w-5 shrink-0 text-teal-500" /><span>استمرارية العمل: نظام نقطة البيع يعمل حتى عند انقطاع الإنترنت.</span></li>
                <li className="flex items-start gap-2"><CheckCircle2 className="mt-1 h-5 w-5 shrink-0 text-teal-500" /><span>واجهة عربية أصيلة: تصميم يراعي سهولة القراءة وتدفق العمل المحلي.</span></li>
                <li className="flex items-start gap-2"><CheckCircle2 className="mt-1 h-5 w-5 shrink-0 text-teal-500" /><span>نمو مرن: أضف مستخدمين وفروع وصلاحيات حسب حاجتك.</span></li>
              </ul>
            </div>
          </section>

          <section id="setup" className="scroll-mt-24 space-y-5">
            <div className="flex items-center gap-3 border-b border-white/10 pb-4 text-white">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-400/20 text-blue-300">
                <Rocket className="h-6 w-6" />
              </span>
              <h2 className="text-2xl font-black">رحلة البدء والاستخدام اليومي</h2>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
              <div className="relative border-r-2 border-slate-100 py-2">
                <div className="mb-8 relative pr-8">
                  <span className="absolute -right-[17px] top-0 flex h-8 w-8 items-center justify-center rounded-full border-4 border-white bg-blue-100 text-sm font-bold text-blue-700">1</span>
                  <h3 className="font-bold text-slate-900">الخطوة الأولى: تهيئة الأساسيات</h3>
                  <p className="mt-2 text-sm leading-7 text-slate-600">
                    ابدأ بالدخول إلى <Link href="/accounts" className="font-semibold text-teal-600 hover:underline">دليل الحسابات</Link> للتأكد من تصنيفات الإيرادات والمصاريف. 
                    ثم انتقل إلى <Link href="/inventory" className="font-semibold text-teal-600 hover:underline">المخزون والمنتجات</Link> لإضافة أصنافك مع أسعارها وكمياتها الافتتاحية.
                  </p>
                </div>
                <div className="mb-8 relative pr-8">
                  <span className="absolute -right-[17px] top-0 flex h-8 w-8 items-center justify-center rounded-full border-4 border-white bg-blue-100 text-sm font-bold text-blue-700">2</span>
                  <h3 className="font-bold text-slate-900">الخطوة الثانية: تكوين الفريق</h3>
                  <p className="mt-2 text-sm leading-7 text-slate-600">
                    عبر <Link href="/team" className="font-semibold text-teal-600 hover:underline">إدارة الفريق</Link>، قم بدعوة زملائك للمنصة وحدد صلاحية كل منهم (كاشير، محاسب، مشرف مخزون). كل مستخدم سيرى فقط الوحدات المصرح له بها.
                  </p>
                </div>
                <div className="relative pr-8">
                  <span className="absolute -right-[17px] top-0 flex h-8 w-8 items-center justify-center rounded-full border-4 border-white bg-blue-100 text-sm font-bold text-blue-700">3</span>
                  <h3 className="font-bold text-slate-900">الخطوة الثالثة: دورة العمل اليومية</h3>
                  <p className="mt-2 text-sm leading-7 text-slate-600">
                    عند بدء اليوم، يستخدم الكاشير <Link href="/pos" className="font-semibold text-teal-600 hover:underline">نقطة البيع</Link> لتسجيل الطلبات السريعة، أو استخدام <Link href="/sales" className="font-semibold text-teal-600 hover:underline">المبيعات والعملاء</Link> للفواتير الآجلة. 
                    يقوم النظام آلياً بخصم المخزون وتسجيل القيود اليومية وعكسها على التقارير المالية ليكون كل شيء محدّثاً لحظياً.
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section id="modules" className="scroll-mt-24 space-y-5">
            <div className="flex items-center gap-3 border-b border-white/10 pb-4 text-white">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-indigo-400/20 text-indigo-300">
                <LayoutDashboard className="h-6 w-6" />
              </span>
              <h2 className="text-2xl font-black">دليل الوحدات</h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {modules.map((mod) => {
                const Icon = mod.icon;
                return (
                  <Link key={mod.id} href={mod.href} className="group flex flex-col rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-indigo-400 hover:shadow-md">
                    <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-600 transition group-hover:bg-indigo-50 group-hover:text-indigo-600">
                      <Icon className="h-5 w-5" />
                    </div>
                    <h3 className="font-bold text-slate-900">{mod.name}</h3>
                    <p className="mt-2 flex-1 text-xs leading-6 text-slate-500">{mod.desc}</p>
                    <span className="mt-4 inline-flex items-center gap-1 text-[11px] font-bold text-indigo-600 opacity-0 transition-opacity group-hover:opacity-100">
                      استكشف الوحدة <ArrowLeft className="h-3 w-3" />
                    </span>
                  </Link>
                );
              })}
            </div>
          </section>

          <section id="offline" className="scroll-mt-24 space-y-5">
            <div className="flex items-center gap-3 border-b border-white/10 pb-4 text-white">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-400/20 text-amber-300">
                <RefreshCw className="h-6 w-6" />
              </span>
              <h2 className="text-2xl font-black">العمل دون اتصال (المزامنة)</h2>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
              <p className="text-sm leading-7 text-slate-600">
                في حال انقطاع الإنترنت، يمكنك الاستمرار في استخدام الوحدات الأساسية مثل نقطة البيع. سيقوم ترصيد بتخزين حركاتك محلياً في "طابور المزامنة".
              </p>
              <div className="mt-5 rounded-2xl bg-amber-50 p-5">
                <h4 className="font-bold text-amber-900">كيف تتصرف عند انقطاع الاتصال؟</h4>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-amber-800">
                  <li>• لا تقم بإغلاق المتصفح أو تسجيل الخروج.</li>
                  <li>• واصل العمل بشكل طبيعي؛ ستظهر أيقونة تشير إلى وجود حركات غير متزامنة في الشريط العلوي.</li>
                  <li>• بمجرد عودة الاتصال، سيقوم النظام بمزامنة الحركات تلقائياً في الخلفية.</li>
                  <li>• يمكنك الضغط على أيقونة المزامنة لفرض المحاولة مرة أخرى إن استدعى الأمر.</li>
                </ul>
              </div>
            </div>
          </section>

          <section id="permissions" className="scroll-mt-24 space-y-5">
            <div className="flex items-center gap-3 border-b border-white/10 pb-4 text-white">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-violet-400/20 text-violet-300">
                <ShieldCheck className="h-6 w-6" />
              </span>
              <h2 className="text-2xl font-black">إدارة الصلاحيات والفريق</h2>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
              <p className="text-sm leading-7 text-slate-600">
                يتيح لك النظام منح صلاحيات دقيقة لكل مستخدم لحماية بياناتك الحساسة. مالك المنشأة (Owner) لديه وصول كامل لكل الوحدات وسجل العمليات.
              </p>
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <h4 className="font-bold text-slate-800">صلاحيات المبيعات</h4>
                  <p className="mt-2 text-xs leading-6 text-slate-500">تسمح بالوصول إلى نقطة البيع وفواتير العملاء. مثالية للكاشير وموظفي المبيعات.</p>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <h4 className="font-bold text-slate-800">صلاحيات المخزون</h4>
                  <p className="mt-2 text-xs leading-6 text-slate-500">لإدارة الأصناف، الكميات والمشتريات. مخصصة لأمناء المستودعات.</p>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <h4 className="font-bold text-slate-800">صلاحيات المحاسبة</h4>
                  <p className="mt-2 text-xs leading-6 text-slate-500">الاطلاع على الحسابات، المصاريف، الفواتير، والقيود اليومية.</p>
                </div>
                <div className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                  <h4 className="font-bold text-slate-800">صلاحيات التقارير</h4>
                  <p className="mt-2 text-xs leading-6 text-slate-500">عرض التقارير المالية والإدارية الشاملة دون إمكانية التعديل على الإعدادات.</p>
                </div>
              </div>
            </div>
          </section>

          <section id="closing" className="scroll-mt-24 space-y-5">
            <div className="flex items-center gap-3 border-b border-white/10 pb-4 text-white">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-400/20 text-rose-300">
                <Lock className="h-6 w-6" />
              </span>
              <h2 className="text-2xl font-black">إقفال الفترات المحاسبية</h2>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
              <p className="text-sm leading-7 text-slate-600">
                للحفاظ على سلامة بياناتك المالية، يوفر النظام إمكانية "إقفال الفترات". عند تعيين تاريخ إقفال، لا يمكن لأي مستخدم إضافة أو تعديل أو حذف أي حركة مالية (فاتورة، قيد، دفع) تاريخها يسبق تاريخ الإقفال.
              </p>
              <p className="mt-4 text-sm leading-7 text-slate-600">
                 يُفضل استخدام هذه الميزة شهرياً أو سنوياً بعد المراجعة الختامية لضمان عدم تغير الأرصدة المدققة. افتح <Link href="/reports" className="font-semibold text-teal-600 hover:underline">التقارير المالية</Link> لمراجعة الفترة ثم اعتماد الإقفال، مع ضرورة الاتصال بسجل المنشأة المشترك.
              </p>
            </div>
          </section>

          <section id="demo-data" className="scroll-mt-24 space-y-5">
            <div className="flex items-center gap-3 border-b border-white/10 pb-4 text-white">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-400/20 text-emerald-300">
                <Database className="h-6 w-6" />
              </span>
              <h2 className="text-2xl font-black">إدارة البيانات التجريبية</h2>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:p-8">
              <p className="text-sm leading-7 text-slate-600">
                عند تسجيل منشأة جديدة، يضيف النظام بيانات تجريبية (حسابات، عملاء، منتجات، فواتير ومصاريف) لمساعدتك على استكشاف النظام والتدرب عليه.
              </p>
              <div className="mt-5 flex items-start gap-4 rounded-2xl bg-slate-50 p-5">
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />
                <div>
                  <h4 className="font-bold text-slate-800">حذف البيانات التجريبية</h4>
                  <p className="mt-1 text-sm leading-7 text-slate-600">
                    بعد الانتهاء من التدريب واستعدادك لإدخال بياناتك الحقيقية، يمكن لمالك المنشأة فتح <Link href="/manager" className="font-semibold text-teal-600 hover:underline">بوابة مدير المنشأة</Link> واختيار حذف البيانات التجريبية. العملية ذرية ولا تشمل البيانات التي أضفتها بنفسك، لكنها نهائية بالنسبة للسجلات التجريبية؛ راجع التنبيه والتأكد قبل التأكيد.
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section id="tips" className="scroll-mt-24 space-y-5">
            <div className="flex items-center gap-3 border-b border-white/10 pb-4 text-white">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-400/20 text-sky-300">
                <Lightbulb className="h-6 w-6" />
              </span>
              <h2 className="text-2xl font-black">نصائح عملية وإرشادات</h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h4 className="font-bold text-slate-900">ربط الحسابات</h4>
                <p className="mt-2 text-sm leading-6 text-slate-600">احرص على ربط الأصناف والموردين بحسابات التكلفة والإيراد الصحيحة في الدليل لتصدر التقارير آلياً دون تدخل إضافي.</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h4 className="font-bold text-slate-900">الباركود السريع</h4>
                <p className="mt-2 text-sm leading-6 text-slate-600">في نقطة البيع أو الجرد، يمكنك استخدام قارئ الباركود، النظام سيدرج الصنف مباشرة دون الحاجة للضغط على أزرار إضافية.</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h4 className="font-bold text-slate-900">المصاريف النثرية</h4>
                <p className="mt-2 text-sm leading-6 text-slate-600">سجل المصاريف اليومية في وحدتها مع وصف وتصنيف ومورد واضح، واحتفظ بالمستندات وفق سياسة منشأتك للرجوع إليها عند المراجعة.</p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h4 className="font-bold text-slate-900">المراقبة المالية</h4>
                <p className="mt-2 text-sm leading-6 text-slate-600">استخدم "توليد الملخص الأسبوعي" في لوحة التحكم لمعرفة اتجاه الإيرادات وتحديد الشذوذ المالي بسهولة.</p>
              </div>
            </div>
          </section>

          <section id="faq" className="scroll-mt-24 space-y-5">
            <div className="flex items-center gap-3 border-b border-white/10 pb-4 text-white">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-400/20 text-slate-300">
                <AlertCircle className="h-6 w-6" />
              </span>
              <h2 className="text-2xl font-black">الأسئلة الشائعة</h2>
            </div>
            <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
              <Accordion type="single" collapsible className="w-full" dir="rtl">
                <AccordionItem value="item-1">
                  <AccordionTrigger className="text-start font-bold hover:text-teal-700 hover:no-underline">هل أدفع رسوماً إضافية للتحديثات؟</AccordionTrigger>
                  <AccordionContent className="text-sm leading-7 text-slate-600">
                    لا، جميع التحديثات وإضافة الميزات الجديدة ضمن الخطة الخاصة بك تكون مشمولة وتتم تلقائياً دون أي تكلفة إضافية.
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="item-2">
                  <AccordionTrigger className="text-start font-bold hover:text-teal-700 hover:no-underline">كيف أضيف حساباً بنكياً جديداً؟</AccordionTrigger>
                  <AccordionContent className="text-sm leading-7 text-slate-600">
                    يمكنك ذلك من خلال الذهاب إلى <Link href="/accounts" className="text-teal-600 hover:underline">دليل الحسابات</Link>، ثم إنشاء حساب فرعي جديد تحت الأصول المتداولة (النقد وما في حكمه).
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="item-3">
                  <AccordionTrigger className="text-start font-bold hover:text-teal-700 hover:no-underline">ماذا أفعل إن أخطأت في فاتورة تم حفظها؟</AccordionTrigger>
                  <AccordionContent className="text-sm leading-7 text-slate-600">
                    إذا كانت الفاتورة قد أثرت في المخزون أو الحسابات، لا تُعدّلها بطريقة تكسر التسلسل المالي. استخدم مسار "إشعار دائن" من <Link href="/e-invoicing" className="text-teal-600 hover:underline">الفوترة الإلكترونية</Link> لعكس الأثر عند الحاجة، ثم أصدر الفاتورة الصحيحة.
                  </AccordionContent>
                </AccordionItem>
                <AccordionItem value="item-4">
                  <AccordionTrigger className="text-start font-bold hover:text-teal-700 hover:no-underline">هل النظام يدعم تعدد الفروع؟</AccordionTrigger>
                  <AccordionContent className="text-sm leading-7 text-slate-600">
                    نعم، يمكنك تعريف عدة مواقع/مستودعات وربط كل مستخدم أو كاشير بالموقع الخاص به، وتتبع الأرصدة والتحويلات بينها من خلال إدارة المخزون.
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
