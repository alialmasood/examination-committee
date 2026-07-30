'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import {
  ArrowDownTrayIcon,
  DevicePhoneMobileIcon,
  ShareIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

const BRAND = '#1EA886';
const STORAGE_KEY = 'shau_pwa_install_prompt_v1';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

function isMobileViewport(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(max-width: 767px)').matches;
}

function isStandaloneApp(): boolean {
  if (typeof window === 'undefined') return false;
  const mq = window.matchMedia('(display-mode: standalone)').matches;
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return mq || iosStandalone;
}

function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua);
  const iPadOs = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return iOS || iPadOs;
}

/**
 * يطلب تثبيت التطبيق على الشاشة الرئيسية — موبايل فقط.
 * أندرويد: زر تثبيت عبر beforeinstallprompt
 * آيفون: تعليمات الإضافة يدوياً (Share → إلى الشاشة الرئيسية)
 */
export default function PwaInstallPrompt() {
  const [visible, setVisible] = useState(false);
  const [ios, setIos] = useState(false);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    if (!isMobileViewport() || isStandaloneApp()) return;

    try {
      if (localStorage.getItem(STORAGE_KEY) === 'dismissed') return;
    } catch {
      /* ignore */
    }

    setIos(isIosDevice());

    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onBip);

    // إظهار بعد لحظة قصيرة حتى لا يزاحم أول رسم للصفحة
    const t = window.setTimeout(() => {
      if (!isStandaloneApp() && isMobileViewport()) {
        setVisible(true);
      }
    }, 900);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBip);
      window.clearTimeout(t);
    };
  }, []);

  const dismiss = () => {
    setVisible(false);
    try {
      localStorage.setItem(STORAGE_KEY, 'dismissed');
    } catch {
      /* ignore */
    }
  };

  const handleInstall = async () => {
    if (!deferred) return;
    setInstalling(true);
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      setDeferred(null);
      if (choice.outcome === 'accepted') {
        dismiss();
      }
    } catch {
      /* المستخدم أغلق الحوار */
    } finally {
      setInstalling(false);
    }
  };

  if (!visible) return null;

  return (
    <div
      className="md:hidden fixed inset-0 z-[80] flex items-end sm:items-center justify-center"
      dir="rtl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pwa-install-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-slate-950/50 backdrop-blur-[2px]"
        aria-label="إغلاق"
        onClick={dismiss}
      />

      <div className="relative w-full max-w-md mx-0 sm:mx-4 mb-0 sm:mb-6 rounded-t-3xl sm:rounded-3xl bg-white shadow-2xl overflow-hidden">
        {/* شريط علوي بلون الهوية */}
        <div
          className="relative px-5 pt-5 pb-4 text-white overflow-hidden"
          style={{
            background: `linear-gradient(135deg, ${BRAND} 0%, #0f766e 100%)`,
          }}
        >
          <div className="absolute -left-8 -top-10 w-28 h-28 rounded-full bg-white/10" />
          <div className="absolute -right-6 bottom-0 w-20 h-20 rounded-full bg-white/5" />
          <div className="relative flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-12 h-12 rounded-2xl bg-white flex items-center justify-center overflow-hidden shrink-0 shadow-md">
                <Image
                  src="/wasl.png"
                  alt=""
                  width={48}
                  height={48}
                  className="w-full h-full object-contain p-1"
                />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] text-white/75">كلية الشرق</p>
                <h2 id="pwa-install-title" className="text-base font-bold leading-5 mt-0.5">
                  ثبّت النظام على هاتفك
                </h2>
              </div>
            </div>
            <button
              type="button"
              onClick={dismiss}
              className="w-8 h-8 rounded-lg bg-white/15 border border-white/25 flex items-center justify-center shrink-0"
              aria-label="إغلاق"
            >
              <XMarkIcon className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="px-5 py-4 space-y-4">
          <p className="text-sm text-slate-600 leading-6">
            للوصول السريع مثل التطبيقات، يمكنك إضافة النظام إلى الشاشة الرئيسية لهاتفك.
          </p>

          <div className="rounded-2xl bg-slate-50 border border-slate-100 px-3.5 py-3 flex items-start gap-3">
            <DevicePhoneMobileIcon className="w-5 h-5 shrink-0 mt-0.5" style={{ color: BRAND }} />
            <div className="text-xs text-slate-500 leading-5">
              {ios ? (
                <>
                  على الآيفون يتم التثبيت يدوياً من قائمة المشاركة في سفاري — الخطوات أدناه.
                </>
              ) : deferred ? (
                <>اضغط «تثبيت الآن» وسيظهر لك تأكيد النظام لإضافة الأيقونة إلى الشاشة الرئيسية.</>
              ) : (
                <>
                  إذا لم يظهر زر التثبيت تلقائياً، افتح قائمة المتصفح واختر «تثبيت التطبيق» أو
                  «إضافة إلى الشاشة الرئيسية».
                </>
              )}
            </div>
          </div>

          {ios && (
            <ol className="space-y-2.5 text-sm text-slate-700">
              <li className="flex items-start gap-2.5">
                <span
                  className="w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 text-white"
                  style={{ backgroundColor: BRAND }}
                >
                  1
                </span>
                <span className="leading-5 pt-0.5">
                  اضغط زر المشاركة{' '}
                  <ShareIcon className="inline-block w-4 h-4 align-text-bottom text-blue-500" /> في أسفل
                  سفاري
                </span>
              </li>
              <li className="flex items-start gap-2.5">
                <span
                  className="w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 text-white"
                  style={{ backgroundColor: BRAND }}
                >
                  2
                </span>
                <span className="leading-5 pt-0.5">اختر «إضافة إلى الشاشة الرئيسية»</span>
              </li>
              <li className="flex items-start gap-2.5">
                <span
                  className="w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center shrink-0 text-white"
                  style={{ backgroundColor: BRAND }}
                >
                  3
                </span>
                <span className="leading-5 pt-0.5">ثم اضغط «إضافة» للتأكيد</span>
              </li>
            </ol>
          )}

          <div className="flex flex-col gap-2.5 pt-1">
            {!ios && deferred && (
              <button
                type="button"
                onClick={handleInstall}
                disabled={installing}
                className="w-full min-h-12 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-60"
                style={{
                  background: `linear-gradient(135deg, ${BRAND}, #0f766e)`,
                  boxShadow: `0 8px 18px ${BRAND}35`,
                }}
              >
                <ArrowDownTrayIcon className="w-5 h-5" />
                {installing ? 'جاري التثبيت...' : 'تثبيت الآن'}
              </button>
            )}

            {ios && (
              <button
                type="button"
                onClick={dismiss}
                className="w-full min-h-12 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2"
                style={{
                  background: `linear-gradient(135deg, ${BRAND}, #0f766e)`,
                }}
              >
                فهمت، سأثبّته الآن
              </button>
            )}

            <button
              type="button"
              onClick={dismiss}
              className="w-full min-h-11 rounded-xl text-sm font-medium text-slate-600 bg-slate-100 border border-slate-200"
            >
              لاحقاً
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
