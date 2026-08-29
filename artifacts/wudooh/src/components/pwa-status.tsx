import { useEffect, useState } from 'react';
import { Download, WifiOff, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const iosInstallDismissedKey = 'wudooh-pwa-ios-install-dismissed';

export function PwaStatus() {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showIosHelp, setShowIosHelp] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia('(display-mode: standalone)').matches
      || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    setIsStandalone(standalone);
    setIsIos(ios);
    if (ios && !standalone && localStorage.getItem(iosInstallDismissedKey) !== '1') {
      setShowIosHelp(true);
    }

    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstallPrompt(null);
      setIsStandalone(true);
    };

    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const dismissIosHelp = () => {
    setShowIosHelp(false);
    localStorage.setItem(iosInstallDismissedKey, '1');
  };

  const install = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === 'accepted') setInstallPrompt(null);
  };

  return (
    <>
      {!isOnline && (
        <div
          className="fixed inset-x-0 top-0 z-[110] border-b border-amber-300 bg-amber-50 px-4 pb-3 pt-[max(env(safe-area-inset-top),0.75rem)] text-amber-950 shadow-sm"
          role="status"
          aria-live="polite"
          dir="rtl"
        >
          <div className="mx-auto flex max-w-3xl items-center justify-center gap-2 text-center text-xs font-bold sm:text-sm">
            <WifiOff className="h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
            أنت غير متصل حالياً. يمكنك تصفح الواجهة المخزنة، ويلزم الاتصال لتحميل البيانات أو إتمام العمليات.
          </div>
        </div>
      )}

      {!isStandalone && installPrompt && isOnline && (
        <div
          className="fixed bottom-4 left-4 right-4 z-[90] mx-auto max-w-md rounded-2xl border border-teal-200 bg-white p-4 shadow-2xl shadow-slate-950/20"
          role="dialog"
          aria-label="تثبيت ترصيد"
          dir="rtl"
        >
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700">
              <Download className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-black text-slate-900">ثبّت ترصيد على جهازك</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">افتحه بسرعة من الشاشة الرئيسية كتطبيق مستقل.</p>
            </div>
            <button type="button" onClick={() => setInstallPrompt(null)} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="إغلاق">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <Button type="button" onClick={() => void install()} className="mt-3 h-11 w-full gap-2 bg-teal-700 text-sm font-black hover:bg-teal-800">
            <Download className="h-4 w-4" aria-hidden="true" /> تثبيت التطبيق
          </Button>
        </div>
      )}

      {!isStandalone && isIos && showIosHelp && (
        <div
          className="fixed bottom-4 left-4 right-4 z-[90] mx-auto max-w-md rounded-2xl border border-blue-200 bg-white p-4 shadow-2xl shadow-slate-950/20"
          role="dialog"
          aria-label="طريقة تثبيت ترصيد على iPhone"
          dir="rtl"
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-black text-slate-900">أضف ترصيد إلى الشاشة الرئيسية</p>
              <p className="mt-1 text-xs leading-6 text-slate-500">من Safari اضغط زر المشاركة، ثم اختر «إضافة إلى الشاشة الرئيسية» للوصول السريع.</p>
            </div>
            <button type="button" onClick={dismissIosHelp} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="إغلاق">
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <Button type="button" variant="outline" onClick={dismissIosHelp} className="mt-3 h-10 w-full text-sm font-bold">
            فهمت
          </Button>
        </div>
      )}
    </>
  );
}