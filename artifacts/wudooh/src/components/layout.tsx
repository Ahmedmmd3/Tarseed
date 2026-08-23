import React, { ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { LayoutDashboard, Book, FileText, Wallet, BarChart3, Menu, X, Cloud, CloudOff, LoaderCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useStore } from '@/context/store';

export function AppLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const { connectionMode, canRetrySharedConnection, retrySharedConnection } = useStore();
  const logoSrc = `${import.meta.env.BASE_URL}logo.png`;

  const navigation = [
    { name: 'نظرة عامة', href: '/dashboard', icon: LayoutDashboard },
    { name: 'دليل الحسابات', href: '/accounts', icon: Book },
    { name: 'القيود اليومية', href: '/journals', icon: FileText },
    { name: 'الذمم والمستحقات', href: '/receivables', icon: Wallet },
    { name: 'التقارير', href: '/reports', icon: BarChart3 },
  ];

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col md:flex-row font-sans text-gray-900" dir="rtl">
      {/* Mobile header */}
      <div className="md:hidden flex items-center justify-between bg-white border-b border-gray-200 p-4">
         <img src={logoSrc} alt="شعار ترصيد" className="h-8 w-auto object-contain" width="96" height="36" />
        <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(!sidebarOpen)} data-testid="button-menu">
          {sidebarOpen ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </Button>
      </div>

      {/* Sidebar */}
      <aside className={`
        ${sidebarOpen ? 'block' : 'hidden'} 
        md:block w-full md:w-64 bg-white border-l border-gray-200 flex-shrink-0
        transition-all duration-200 ease-in-out
      `}>
        <div className="h-full flex flex-col">
          <div className="p-6 hidden md:block">
             <img src={logoSrc} alt="شعار ترصيد" className="h-10 w-auto object-contain" width="132" height="48" />
          </div>
          <nav className="flex-1 px-4 py-4 space-y-1">
            {navigation.map((item) => {
              const isActive = location === item.href;
              return (
                <Link key={item.name} href={item.href} data-testid={`link-${item.href.replace('/', '') || 'home'}`}>
                  <div className={`
                    flex items-center gap-3 px-3 py-3 rounded-md text-sm font-medium cursor-pointer transition-colors
                    ${isActive 
                      ? 'bg-primary/10 text-primary' 
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                    }
                  `}>
                    <item.icon className={`h-5 w-5 ${isActive ? 'text-primary' : 'text-gray-400'}`} />
                    {item.name}
                  </div>
                </Link>
              );
            })}
          </nav>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-x-hidden overflow-y-auto">
        <div className="max-w-7xl mx-auto p-4 md:p-8">
           <ConnectionStatus
             mode={connectionMode}
             canRetrySharedConnection={canRetrySharedConnection}
             onRetry={() => void retrySharedConnection()}
           />
          {children}
        </div>
      </main>
    </div>
  );
}

function ConnectionStatus({
  mode,
  canRetrySharedConnection,
  onRetry,
}: {
  mode: 'loading' | 'remote' | 'local';
  canRetrySharedConnection: boolean;
  onRetry: () => void;
}) {
  if (mode === 'loading') {
    return (
      <div
        className="mb-6 flex items-start gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-slate-600 shadow-sm"
        role="status"
        aria-live="polite"
        data-testid="connection-status-loading"
      >
        <LoaderCircle className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-slate-500" aria-hidden="true" />
        <div>
          <p className="font-semibold">جارٍ التحقق من مصدر البيانات</p>
          <p className="mt-1 text-sm">نحاول الاتصال بسجل المنشأة المشترك قبل عرض البيانات.</p>
        </div>
      </div>
    );
  }

  if (mode === 'remote') {
    return (
      <div
        className="mb-6 flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-900 shadow-sm"
        role="status"
        aria-live="polite"
        data-testid="connection-status-remote"
      >
        <Cloud className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" aria-hidden="true" />
        <div>
          <p className="font-semibold">متصل بسجل المنشأة المشترك</p>
          <p className="mt-1 text-sm text-emerald-800">التغييرات محفوظة في الخدمة المشتركة وتظهر للأجهزة وأعضاء الفريق المصرح لهم.</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="mb-6 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950 shadow-sm"
      role="alert"
      aria-live="polite"
      data-testid="connection-status-local"
    >
      <CloudOff className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />
      <div className="flex-1">
        <p className="font-semibold">{canRetrySharedConnection ? 'تعذر الوصول إلى السجل المشترك' : 'وضع البيانات المحلي'}</p>
        <p className="mt-1 text-sm text-amber-900">
          {canRetrySharedConnection
            ? 'نعرض الآن البيانات المحفوظة في هذا المتصفح فقط. لن تتم مزامنة التغييرات حتى إعادة الاتصال بالسجل المشترك.'
            : 'التغييرات محفوظة في هذا المتصفح فقط، ولن تظهر على الأجهزة أو لأعضاء الفريق. سجّل الدخول للاتصال بسجل المنشأة المشترك.'}
        </p>
      </div>
      {canRetrySharedConnection && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="border-amber-300 bg-white text-amber-950 hover:bg-amber-100"
          onClick={onRetry}
          data-testid="button-retry-shared-connection"
        >
          إعادة الاتصال
        </Button>
      )}
    </div>
  );
}
