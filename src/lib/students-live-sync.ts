'use client';

import { useEffect, useRef } from 'react';

/** بث تحديثات بيانات الطلبة بين شؤون الطلبة والحسابات */
export const STUDENTS_LIVE_CHANNEL = 'students-live-sync';
const STORAGE_KEY = 'students-live-sync:ping';
const POLL_MS = 12_000;

export type StudentsLiveEventType =
  | 'student-updated'
  | 'students-bulk-updated';

export type StudentsLiveEvent = {
  type: StudentsLiveEventType;
  studentIds?: string[];
  source?: string;
  at: number;
};

type RefreshFn = (opts?: { silent?: boolean }) => void | Promise<void>;

function safeParseEvent(raw: string | null): StudentsLiveEvent | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as StudentsLiveEvent;
    if (!data || typeof data !== 'object' || !data.type) return null;
    return data;
  } catch {
    return null;
  }
}

/** إشعار الصفحات المفتوحة بأن بيانات الطلبة تغيّرت */
export function notifyStudentsLiveUpdate(input: {
  type?: StudentsLiveEventType;
  studentIds?: string[];
  source?: string;
}): void {
  if (typeof window === 'undefined') return;

  const payload: StudentsLiveEvent = {
    type: input.type || 'student-updated',
    studentIds: input.studentIds,
    source: input.source || 'unknown',
    at: Date.now(),
  };

  try {
    const ch = new BroadcastChannel(STUDENTS_LIVE_CHANNEL);
    ch.postMessage(payload);
    ch.close();
  } catch {
    // BroadcastChannel غير متاح
  }

  try {
    // يُطلق storage event في النوافذ الأخرى لنفس الأصل
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // localStorage محظور
  }
}

/**
 * تحديث صامت لصفحة الحسابات عند تعديل الطلبة من شؤون الطلبة،
 * مع استطلاع خفيف عند بقاء التبويب مرئياً.
 */
export function useSilentStudentsRefresh(refresh: RefreshFn, enabled = true) {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    if (!enabled) return;

    const silentRefresh = () => {
      if (document.visibilityState === 'hidden') return;
      void refreshRef.current({ silent: true });
    };

    const timer = window.setInterval(silentRefresh, POLL_MS);

    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(STUDENTS_LIVE_CHANNEL);
      channel.onmessage = (event) => {
        const type = event?.data?.type as StudentsLiveEventType | undefined;
        if (type === 'student-updated' || type === 'students-bulk-updated') {
          void refreshRef.current({ silent: true });
        }
      };
    } catch {
      // BroadcastChannel غير متاح
    }

    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return;
      const data = safeParseEvent(e.newValue);
      if (
        data?.type === 'student-updated' ||
        data?.type === 'students-bulk-updated'
      ) {
        void refreshRef.current({ silent: true });
      }
    };

    const onFocus = () => silentRefresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible') silentRefresh();
    };

    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
      try {
        channel?.close();
      } catch {
        // ignore
      }
    };
  }, [enabled]);
}
