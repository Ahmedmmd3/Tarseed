import React, { ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { LayoutDashboard, Book, FileText, Wallet, BarChart3, Menu, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function AppLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [sidebarOpen, setSidebarOpen] = React.useState(false);
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
          {children}
        </div>
      </main>
    </div>
  );
}
