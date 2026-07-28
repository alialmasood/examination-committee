'use client';

import { useEffect, useRef } from 'react';

export const STAGE_PROMOTIONS_CHANNEL = 'stage-promotions';
const POLL_MS = 8000;

type RefreshFn = (opts?: { silent?: boolean }) => void | Promise<void>;

/**
 * تحديث صامت دوري + استماع لبث موافقات الحسابات / طلبات الترحيل.
 */
export function useSilentPromotionRefresh(refresh: RefreshFn, enabled = true) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!enabled) return;

    void refreshRef.current({ silent: false });

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      void refreshRef.current({ silent: true });
    }, POLL_MS);

    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(STAGE_PROMOTIONS_CHANNEL);
      channel.onmessage = (event) => {
        const type = event?.data?.type;
        if (
          type === 'promotion-reviewed' ||
          type === 'promotion-request-created'
        ) {
          void refreshRef.current({ silent: true });
        }
      };
    } catch {
      // BroadcastChannel غير متاح
    }

    const onFocus = () => void refreshRef.current({ silent: true });
    window.addEventListener('focus', onFocus);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      try {
        channel?.close();
      } catch {
        // ignore
      }
    };
  }, [enabled]);
}
