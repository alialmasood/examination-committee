'use client';

import { useEffect } from 'react';

export default function RegisterSW() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const register = async () => {
      try {
        // فرض تحديث الـ SW القديم الذي كان يكسر طلبات API
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.update().catch(() => undefined)));

        const registration = await navigator.serviceWorker.register('/sw.js', {
          updateViaCache: 'none',
        });
        console.log('✅ Service Worker registered:', registration.scope);
      } catch (error) {
        console.error('❌ Service Worker registration failed:', error);
      }
    };

    if (document.readyState === 'complete') {
      void register();
    } else {
      window.addEventListener('load', () => void register(), { once: true });
    }
  }, []);

  return null;
}
