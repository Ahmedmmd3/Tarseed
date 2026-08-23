import React, { useEffect, useState } from 'react';
import { 
  ArrowLeft, 
  BarChart3, 
  Box, 
  Briefcase, 
  CheckCircle2, 
  ChevronLeft, 
  Globe2, 
  LineChart, 
  ShieldCheck, 
  Smartphone, 
  Users, 
  Zap 
} from 'lucide-react';
import { AuthDialog } from '@/components/auth-dialog';

const asset = (name: string) => `${import.meta.env.BASE_URL}${name}`;

export default function Landing() {
  const [scrolled, setScrolled] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');

  const openAuth = (mode: 'login' | 'register') => {
    setAuthMode(mode);
    setAuthOpen(true);
  };

  const openDashboard = () => {
    window.location.assign(`${import.meta.env.BASE_URL}dashboard`);
  };

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans selection:bg-primary/20 selection:text-primary" dir="rtl">
      {/* Navigation */}
      <nav className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 border-b ${scrolled ? 'bg-white/90 backdrop-blur-md border-slate-200 shadow-sm py-4' : 'bg-transparent border-transparent py-6'}`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {/* Real Logo integration */}
            <img src={asset('logo.png')} alt="شعار ترصيد" className="h-10 w-auto object-contain" width="132" height="48" />
          </div>
          
          <div className="hidden md:flex items-center gap-8 font-medium text-sm text-slate-600">
            <a href="#features" className="hover:text-primary transition-colors">المميزات</a>
            <a href="#modules" className="hover:text-primary transition-colors">الحلول المتكاملة</a>
            <a href="#features" className="hover:text-primary transition-colors">لماذا ترصيد</a>
          </div>

          <div className="flex items-center gap-4">
            <button type="button" onClick={() => openAuth('login')} className="hidden md:block text-sm font-medium hover:text-primary transition-colors" data-testid="button-open-login">
              تسجيل الدخول
            </button>
            <button type="button" onClick={() => openAuth('login')} className="inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2 group" data-testid="button-open-dashboard">
              لوحة التحكم
              <ArrowLeft className="ms-2 h-4 w-4 group-hover:-translate-x-1 transition-transform" />
            </button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative pt-32 pb-20 md:pt-48 md:pb-32 overflow-hidden">
        <div className="absolute inset-0 bg-[#001738] z-0">
          <div className="absolute inset-0 bg-gradient-to-br from-[#001738] via-[#00204a] to-primary/20 opacity-90"></div>
          {/* We will use the generated background if available */}
          <div className="absolute inset-0 opacity-20 bg-cover bg-center mix-blend-overlay" style={{ backgroundImage: `url(${asset('features-bg.png')})` }}></div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="grid lg:grid-cols-2 gap-12 lg:gap-8 items-center">
            <div className="text-white space-y-8 animate-in slide-in-from-bottom-8 duration-700">
              <div className="inline-flex items-center rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-sm font-medium text-primary-foreground backdrop-blur-sm">
                <span className="flex h-2 w-2 rounded-full bg-teal-400 me-2 animate-pulse"></span>
                الإصدار الجديد متاح الآن
              </div>
              <h1 className="text-5xl md:text-6xl lg:text-7xl font-bold leading-[1.15] tracking-tight">
                نظام التشغيل المتكامل <br/>
                <span className="text-transparent bg-clip-text bg-gradient-to-l from-teal-300 to-primary">لشركتك الطموحة</span>
              </h1>
              <p className="text-lg md:text-xl text-slate-300 max-w-2xl leading-relaxed">
                ترصيد يجمع المبيعات، المشتريات، المخزون، المحاسبة، والموارد البشرية في منصة واحدة قوية. صُمم للمؤسسات التي تبحث عن تحكم كامل ونمو مستدام بلمسة احترافية.
              </p>
              
              <div className="flex flex-col sm:flex-row items-center gap-4 pt-4">
                <button type="button" onClick={() => openAuth('register')} className="w-full sm:w-auto inline-flex items-center justify-center rounded-md text-base font-medium transition-all bg-primary text-primary-foreground hover:bg-teal-500 hover:shadow-lg hover:shadow-primary/25 h-12 px-8" data-testid="button-hero-register">
                  ابدأ تجربتك المجانية
                </button>
                <a href="#modules" className="w-full sm:w-auto inline-flex items-center justify-center rounded-md text-base font-medium transition-colors bg-white/10 text-white hover:bg-white/20 backdrop-blur-sm border border-white/10 h-12 px-8">
                  استكشف الحلول
                </a>
              </div>
            </div>

            <div className="relative animate-in slide-in-from-bottom-12 duration-1000 delay-150 fill-mode-both">
              <div className="absolute inset-0 bg-gradient-to-tr from-primary to-[#00204a] rounded-2xl blur-3xl opacity-30 animate-pulse"></div>
                <img 
                src={asset('hero-abstract-ar-minimal.png')}
                alt="واجهة ترصيد لإدارة أعمال الشركة" 
                width="1024"
                height="768"
                className="relative rounded-2xl shadow-2xl border border-white/10"
              />
              
              {/* Floating UI Elements */}
              <div className="absolute -left-6 top-10 bg-white rounded-xl shadow-xl p-4 border border-slate-100 flex items-center gap-4 animate-in slide-in-from-right-8 duration-700 delay-500 fill-mode-both">
                <div className="h-10 w-10 rounded-full bg-green-100 flex items-center justify-center">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                </div>
                <div>
                  <p className="text-xs text-slate-500 font-medium">صافي الأرباح</p>
                  <p className="text-lg font-bold text-slate-900">+١٢٤,٥٠٠ ر.س</p>
                </div>
              </div>

              <div className="absolute -right-4 bottom-12 bg-white rounded-xl shadow-xl p-4 border border-slate-100 flex flex-col gap-2 animate-in slide-in-from-left-8 duration-700 delay-700 fill-mode-both">
                <p className="text-xs text-slate-500 font-medium">المبيعات الأسبوعية</p>
                <div className="flex items-end gap-1 h-8">
                  {[40, 70, 45, 90, 60, 100, 80].map((h, i) => (
                    <div key={i} className="w-2 bg-primary rounded-t-sm" style={{ height: `${h}%` }}></div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Trust Section */}
      <section className="py-12 border-b border-slate-200 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <p className="text-sm font-semibold text-slate-500 uppercase tracking-widest mb-8">
            منصة واحدة تجمع عمليات أعمالك اليومية
          </p>
          <div className="flex flex-wrap justify-center items-center gap-12 opacity-50 grayscale hover:grayscale-0 transition-all duration-500">
            <div className="flex items-center gap-2 font-bold text-2xl"><Box className="h-8 w-8" /> المبيعات</div>
            <div className="flex items-center gap-2 font-bold text-2xl"><Zap className="h-8 w-8" /> العمليات</div>
            <div className="flex items-center gap-2 font-bold text-2xl"><Globe2 className="h-8 w-8" /> الفروع</div>
            <div className="flex items-center gap-2 font-bold text-2xl"><Briefcase className="h-8 w-8" /> الفريق</div>
          </div>
        </div>
      </section>

      {/* Bento Grid - Modules */}
      <section id="modules" className="py-24 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16">
            <h2 className="text-3xl md:text-4xl font-bold text-slate-900 mb-4">
              كل ما تحتاجه لإدارة أعمالك، في مكان واحد
            </h2>
            <p className="text-lg text-slate-600">
              تخلص من التشتت بين الأنظمة المختلفة. ترصيد يوفر لك منظومة متكاملة تعمل بتناغم تام لرفع كفاءة شركتك.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Big Card - Accounting */}
            <div className="md:col-span-2 bg-white rounded-3xl p-8 border border-slate-200 shadow-sm hover:shadow-md transition-shadow group overflow-hidden relative">
              <div className="absolute top-0 left-0 w-32 h-32 bg-primary/5 rounded-br-full -z-0 group-hover:scale-150 transition-transform duration-700"></div>
              <div className="relative z-10">
                <div className="h-12 w-12 bg-[#00204a] text-white rounded-xl flex items-center justify-center mb-6">
                  <LineChart className="h-6 w-6" />
                </div>
                <h3 className="text-2xl font-bold text-slate-900 mb-3">محاسبة مالية متقدمة</h3>
                <p className="text-slate-600 max-w-md mb-6 leading-relaxed">
                  نظام محاسبي دقيق متوافق مع معايير IFRS. يشمل دليل الحسابات، القيود اليومية الآلية، الأصول الثابتة، والتقارير المالية اللحظية لقرارات أسرع وأدق.
                </p>
                <ul className="space-y-3">
                  {['شجرة حسابات مرنة تدعم مراكز التكلفة', 'تقارير الأرباح والخسائر والميزانية العمومية', 'تتبع دقيق للذمم الدائنة والمدينة'].map((feature, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm text-slate-700 font-medium">
                      <CheckCircle2 className="h-4 w-4 text-primary flex-shrink-0" />
                      {feature}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Small Card - Inventory */}
            <div className="bg-[#00204a] rounded-3xl p-8 border border-[#001738] text-white shadow-sm hover:shadow-md transition-shadow group relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
              <div className="relative z-10">
                <div className="h-12 w-12 bg-white/10 rounded-xl flex items-center justify-center mb-6 backdrop-blur-sm">
                  <Box className="h-6 w-6 text-teal-400" />
                </div>
                <h3 className="text-xl font-bold mb-3">إدارة المخزون والعمليات</h3>
                <p className="text-slate-300 text-sm leading-relaxed mb-6">
                  تحكم كامل في المستودعات والفروع. تتبع الكميات، الجرد الدوري، ونقاط إعادة الطلب بشكل آلي لتجنب نفاد الكميات.
                </p>
                <div className="mt-auto">
                  <button type="button" onClick={() => openAuth('login')} className="text-teal-400 text-sm font-medium hover:text-teal-300 flex items-center gap-1 group-hover:gap-2 transition-all" data-testid="button-module-login">
                    اكتشف المزيد <ChevronLeft className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Small Card - Sales/CRM */}
            <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
              <div className="h-12 w-12 bg-primary/10 text-primary rounded-xl flex items-center justify-center mb-6">
                <Users className="h-6 w-6" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-3">المبيعات وعلاقات العملاء</h3>
              <p className="text-slate-600 text-sm leading-relaxed mb-6">
                إدارة دورة المبيعات كاملة من عروض الأسعار وحتى الفوترة، مع سجل متكامل لكل عميل لتعزيز الولاء والمبيعات.
              </p>
            </div>

            {/* Small Card - HR */}
            <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
              <div className="h-12 w-12 bg-primary/10 text-primary rounded-xl flex items-center justify-center mb-6">
                <Briefcase className="h-6 w-6" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-3">الموارد البشرية والرواتب</h3>
              <p className="text-slate-600 text-sm leading-relaxed mb-6">
                هيكلة الموظفين، إدارة الحضور والانصراف، وحساب الرواتب والبدلات بضغطة زر واحدة بنهاية كل شهر.
              </p>
            </div>

            {/* Small Card - POS */}
            <div className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
              <div className="h-12 w-12 bg-primary/10 text-primary rounded-xl flex items-center justify-center mb-6">
                <Smartphone className="h-6 w-6" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-3">نقاط البيع (POS)</h3>
              <p className="text-slate-600 text-sm leading-relaxed mb-6">
                واجهة بيع سريعة وسلسة للمعارض، تعمل أوفلاين وتتزامن تلقائياً مع المخزون والمحاسبة عند الاتصال.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Why Choose Us */}
      <section id="features" className="py-24 bg-white overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div className="relative">
              <div className="absolute -inset-4 bg-primary/5 rounded-3xl transform rotate-3"></div>
              <div className="relative bg-slate-900 rounded-2xl p-8 text-white shadow-2xl overflow-hidden">
                <div className="absolute top-0 right-0 p-32 bg-primary/20 rounded-full blur-3xl -mr-16 -mt-16"></div>
                <div className="relative z-10">
                  <h3 className="text-2xl font-bold mb-6">سرعة وموثوقية في الأداء</h3>
                  <div className="space-y-6">
                    <div className="flex gap-4">
                      <div className="h-10 w-10 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                        <ShieldCheck className="h-5 w-5 text-teal-400" />
                      </div>
                      <div>
                        <h4 className="font-semibold text-lg">أمان بيانات بمستوى بنكي</h4>
                        <p className="text-slate-400 text-sm mt-1">تشفير متقدم لكل حركة مالية بنظام صلاحيات صارم يضمن بقاء بياناتك بأمان تام.</p>
                      </div>
                    </div>
                    <div className="flex gap-4">
                      <div className="h-10 w-10 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                        <Zap className="h-5 w-5 text-teal-400" />
                      </div>
                      <div>
                        <h4 className="font-semibold text-lg">أداء فائق مع حجم بيانات ضخم</h4>
                        <p className="text-slate-400 text-sm mt-1">لا بطء في نهاية السنة المالية. صُمم النظام لمعالجة آلاف الحركات في ثوانٍ.</p>
                      </div>
                    </div>
                    <div className="flex gap-4">
                      <div className="h-10 w-10 rounded-lg bg-white/10 flex items-center justify-center flex-shrink-0">
                        <BarChart3 className="h-5 w-5 text-teal-400" />
                      </div>
                      <div>
                        <h4 className="font-semibold text-lg">تقارير لحظية دقيقة</h4>
                        <p className="text-slate-400 text-sm mt-1">اعرف موقفك المالي والمخزوني وأرباحك في أي لحظة وبدون الحاجة لإجراءات إقفال معقدة.</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h2 className="text-3xl md:text-4xl font-bold text-slate-900 mb-6">
                لماذا تختار <span className="text-primary">ترصيد</span>؟
              </h2>
              <p className="text-lg text-slate-600 mb-8 leading-relaxed">
                في عالم الأعمال المتسارع، الاعتماد على أنظمة تقليدية أو مفككة يعيق نموك. ترصيد يأتيك كشريك تقني متكامل، يفهم لغتك واحتياجاتك المحلية مع معايير عالمية.
              </p>
              
              <ul className="space-y-4 mb-8">
                {['دعم فني استثنائي متواجد على مدار الساعة', 'واجهة مستخدم عصرية تناسب جميع الأجهزة', 'توافق كامل مع متطلبات هيئة الزكاة والضريبة والجمارك (الفاتورة الإلكترونية)'].map((point, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                    </div>
                    <span className="text-slate-700 font-medium">{point}</span>
                  </li>
                ))}
              </ul>
              
              <button type="button" onClick={() => openAuth('register')} className="inline-flex flex-col sm:flex-row items-center justify-center rounded-md text-base font-medium transition-colors bg-slate-900 text-white hover:bg-slate-800 h-12 px-8" data-testid="button-features-register">
                انضم لآلاف الشركات الناجحة
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="py-24 bg-[#001738] relative overflow-hidden">
          <div className="absolute inset-0 bg-cover bg-center opacity-10" style={{ backgroundImage: `url(${asset('features-bg.png')})` }}></div>
        <div className="absolute inset-0 bg-gradient-to-t from-[#001738] to-transparent"></div>
        
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center">
          <h2 className="text-4xl md:text-5xl font-bold text-white mb-6">
            مستعد للارتقاء بإدارة أعمالك؟
          </h2>
          <p className="text-xl text-slate-300 mb-10 max-w-2xl mx-auto">
            احصل على تحكم كامل، قلل التكاليف، وزد إنتاجية فريقك اليوم. تجربة متكاملة تبدأ بخطوة بسيطة.
          </p>
          <div className="flex flex-col sm:flex-row justify-center gap-4">
            <button type="button" onClick={() => openAuth('login')} className="inline-flex items-center justify-center rounded-md text-base font-bold transition-all bg-primary text-primary-foreground hover:bg-teal-500 hover:shadow-lg h-14 px-10" data-testid="button-cta-login">
              دخول مجاني للنظام
              <ArrowLeft className="ms-2 h-5 w-5" />
            </button>
            <a href="#features" className="inline-flex items-center justify-center rounded-md text-base font-bold transition-colors border border-white/20 text-white hover:bg-white/10 h-14 px-10">
              تعرّف على المزايا
            </a>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-slate-900 border-t border-slate-800 pt-16 pb-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-8 mb-12">
            <div className="col-span-2 lg:col-span-2">
              <img src={asset('logo.png')} alt="شعار ترصيد" className="h-10 w-auto object-contain brightness-0 invert mb-6" width="132" height="48" />
              <p className="text-slate-400 text-sm leading-relaxed max-w-sm mb-6">
                برنامج محاسبي متكامل وإدارة موارد المؤسسات السحابي الأسرع نمواً. مصمم خصيصاً للشركات التي تبحث عن الكفاءة والنمو.
              </p>
            </div>
            
            <div>
              <h4 className="text-white font-semibold mb-4">المنتج</h4>
              <ul className="space-y-3">
                 <li><a href="#modules" className="text-slate-400 hover:text-primary transition-colors text-sm">المحاسبة والمالية</a></li>
                 <li><a href="#modules" className="text-slate-400 hover:text-primary transition-colors text-sm">المبيعات والمخزون</a></li>
                 <li><a href="#modules" className="text-slate-400 hover:text-primary transition-colors text-sm">الموارد البشرية</a></li>
                 <li><a href="#modules" className="text-slate-400 hover:text-primary transition-colors text-sm">نقاط البيع</a></li>
              </ul>
            </div>
            
            <div>
              <h4 className="text-white font-semibold mb-4">الشركة</h4>
              <ul className="space-y-3">
                 <li><a href="#features" className="text-slate-400 hover:text-primary transition-colors text-sm">لماذا ترصيد</a></li>
                 <li><a href="#modules" className="text-slate-400 hover:text-primary transition-colors text-sm">الحلول المتكاملة</a></li>
                 <li><a href="#features" className="text-slate-400 hover:text-primary transition-colors text-sm">الأمان والأداء</a></li>
                 <li><a href="#modules" className="text-slate-400 hover:text-primary transition-colors text-sm">استكشف المنصة</a></li>
              </ul>
            </div>

            <div>
              <h4 className="text-white font-semibold mb-4">المصادر</h4>
              <ul className="space-y-3">
                 <li><a href="#features" className="text-slate-400 hover:text-primary transition-colors text-sm">مركز المساعدة</a></li>
                 <li><a href="#modules" className="text-slate-400 hover:text-primary transition-colors text-sm">دليل المنصة</a></li>
                 <li><a href="#modules" className="text-slate-400 hover:text-primary transition-colors text-sm">العمليات والمشاريع</a></li>
                 <li><a href="#features" className="text-slate-400 hover:text-primary transition-colors text-sm">الفاتورة الإلكترونية</a></li>
              </ul>
            </div>
          </div>
          
          <div className="border-t border-slate-800 pt-8 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-slate-500 text-sm">
              © {new Date().getFullYear()} ترصيد. جميع الحقوق محفوظة.
            </p>
            <div className="flex gap-4">
               <a href="https://x.com" target="_blank" rel="noreferrer" aria-label="منصة X" className="text-slate-500 hover:text-white transition-colors"><span className="sr-only">منصة X</span>
                <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8.29 20.251c7.547 0 11.675-6.253 11.675-11.675 0-.178 0-.355-.012-.53A8.348 8.348 0 0022 5.92a8.19 8.19 0 01-2.357.646 4.118 4.118 0 001.804-2.27 8.224 8.224 0 01-2.605.996 4.107 4.107 0 00-6.993 3.743 11.65 11.65 0 01-8.457-4.287 4.106 4.106 0 001.27 5.477A4.072 4.072 0 012.8 9.713v.052a4.105 4.105 0 003.292 4.022 4.095 4.095 0 01-1.853.07 4.108 4.108 0 003.834 2.85A8.233 8.233 0 012 18.407a11.616 11.616 0 006.29 1.84" />
                </svg>
              </a>
               <a href="https://www.linkedin.com" target="_blank" rel="noreferrer" aria-label="LinkedIn" className="text-slate-500 hover:text-white transition-colors"><span className="sr-only">LinkedIn</span>
                <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                  <path fillRule="evenodd" d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z" clipRule="evenodd" />
                </svg>
              </a>
            </div>
          </div>
        </div>
      </footer>
      <AuthDialog open={authOpen} mode={authMode} onOpenChange={setAuthOpen} onSuccess={openDashboard} />
    </div>
  );
}