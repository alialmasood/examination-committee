'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * صفحة دخول السوبر أدمن — مستقلة عن صفحة دخول أنظمة العمل.
 */
export default function PlatformSuperAdminLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch('/api/auth/me', { credentials: 'include' });
        const body = await res.json().catch(() => ({}));
        if (body.success && body.is_platform_admin) {
          router.replace('/platform-admin/systems');
          return;
        }
      } catch {
        // ignore
      } finally {
        setChecking(false);
      }
    };
    void check();
  }, [router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.success) {
        setError(body.message || 'فشل تسجيل الدخول');
        return;
      }
      if (!body.is_platform_admin) {
        setError('هذا الحساب ليس حساب السوبر أدمن');
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
        return;
      }
      router.replace('/platform-admin/systems');
    } catch {
      setError('تعذر الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  }

  if (checking) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center" dir="rtl">
        <p className="text-slate-400 text-sm">جارٍ التحميل…</p>
      </div>
    );
  }

  return (
    <div
      className="min-h-screen bg-slate-950 flex items-center justify-center p-4"
      dir="rtl"
    >
      <div className="w-full max-w-md bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-xl">
        <p className="text-xs text-amber-400/90 mb-1 tracking-wide">Super Admin</p>
        <h1 className="text-xl font-semibold text-white mb-1">بوابة إدارة المنصة</h1>
        <p className="text-sm text-slate-400 mb-6">
          دخول مخصّص لحساب السوبر أدمن فقط — منفصل عن أنظمة العمل.
        </p>

        <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
          <div>
            <label className="block text-sm text-slate-300 mb-1">اسم المستخدم</label>
            <input
              type="text"
              autoComplete="username"
              className="w-full rounded-lg bg-slate-800 border border-slate-600 text-white px-3 py-2 text-sm"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={loading}
              required
              dir="ltr"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-1">كلمة المرور</label>
            <input
              type="password"
              autoComplete="current-password"
              className="w-full rounded-lg bg-slate-800 border border-slate-600 text-white px-3 py-2 text-sm"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
              required
              dir="ltr"
            />
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-950/40 border border-red-900 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-amber-500 hover:bg-amber-400 text-slate-950 font-medium rounded-lg py-2.5 text-sm disabled:opacity-50"
          >
            {loading ? 'جارٍ الدخول…' : 'دخول السوبر أدمن'}
          </button>
        </form>
      </div>
    </div>
  );
}
