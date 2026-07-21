/**
 * Utility functions for automatic token refresh and authenticated fetch
 */

let refreshTokenPromise: Promise<boolean> | null = null;
let lastRefreshTime = 0;
const REFRESH_INTERVAL = 15 * 60 * 1000; // 15 دقيقة - تجديد كل 15 دقيقة
const REFRESH_BEFORE_EXPIRY = 5 * 60 * 1000; // 5 دقائق قبل انتهاء الصلاحية

/**
 * تجديد access token تلقائياً
 */
async function refreshAccessToken(): Promise<boolean> {
  // تجنب طلبات متعددة في نفس الوقت
  if (refreshTokenPromise) {
    return refreshTokenPromise;
  }

  refreshTokenPromise = (async () => {
    try {
      const response = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include'
      });

      const data = await response.json();

      if (response.ok && data.success) {
        lastRefreshTime = Date.now();
        return true;
      }

      return false;
    } catch (error) {
      console.error('خطأ في تجديد access token:', error);
      return false;
    } finally {
      refreshTokenPromise = null;
    }
  })();

  return refreshTokenPromise;
}

/**
 * Fetch مع تجديد تلقائي للـ token
 */
export async function fetchWithAuth(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  // التحقق من الحاجة لتجديد الـ token قبل انتهاء الصلاحية
  const now = Date.now();
  const timeSinceLastRefresh = now - lastRefreshTime;
  
  // إذا مر أكثر من 15 دقيقة، قم بتجديد الـ token تلقائياً
  if (timeSinceLastRefresh > REFRESH_INTERVAL) {
    await refreshAccessToken();
  }

  // تنفيذ الطلب الأصلي
  let response = await fetch(url, {
    ...options,
    credentials: 'include'
  });

  // إذا كان الطلب فشل بسبب انتهاء صلاحية الـ token (401)، حاول تجديده
  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    
    if (refreshed) {
      // إعادة المحاولة بعد التجديد
      response = await fetch(url, {
        ...options,
        credentials: 'include'
      });
      
      // إذا فشل مرة أخرى، ربما المشكلة ليست في الـ token
      if (response.status === 401) {
        if (typeof window !== 'undefined') {
          window.location.href = '/teachers-portal';
        }
        throw new Error('انتهت جلسة العمل. يرجى تسجيل الدخول مرة أخرى.');
      }
    } else {
      // إذا فشل التجديد، أعد redirect إلى صفحة تسجيل الدخول
      if (typeof window !== 'undefined') {
        window.location.href = '/teachers-portal';
      }
      throw new Error('انتهت جلسة العمل. يرجى تسجيل الدخول مرة أخرى.');
    }
  }

  return response;
}

/**
 * بدء تجديد الـ token تلقائياً في الخلفية
 */
export function startAutoRefresh(): () => void {
  if (typeof window === 'undefined') {
    return () => {}; // لا شيء في server-side
  }

  // تجديد فوري عند بدء الصفحة
  refreshAccessToken();

  // تجديد كل 15 دقيقة (قبل انتهاء الـ token الذي يستمر 20 دقيقة)
  const interval = setInterval(() => {
    refreshAccessToken();
  }, REFRESH_INTERVAL);

  // تجديد عند العودة إلى الصفحة (إذا مر أكثر من 5 دقائق)
  const handleVisibilityChange = () => {
    if (!document.hidden) {
      const now = Date.now();
      if (now - lastRefreshTime > REFRESH_BEFORE_EXPIRY) {
        refreshAccessToken();
      }
    }
  };

  // تجديد عند تحميل الصفحة (focus)
  const handleFocus = () => {
    const now = Date.now();
    if (now - lastRefreshTime > REFRESH_BEFORE_EXPIRY) {
      refreshAccessToken();
    }
  };

  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('focus', handleFocus);

  // إرجاع دالة لإيقاف التجديد
  return () => {
    clearInterval(interval);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.removeEventListener('focus', handleFocus);
  };
}

/**
 * التحقق من صلاحية الـ token وجلبه
 */
export async function checkAndRefreshToken(): Promise<boolean> {
  try {
    const response = await fetch('/api/auth/me', {
      credentials: 'include'
    });

    if (response.status === 401) {
      return await refreshAccessToken();
    }

    return response.ok;
  } catch (error) {
    console.error('خطأ في التحقق من الـ token:', error);
    return false;
  }
}

