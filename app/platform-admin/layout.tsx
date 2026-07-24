'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';

interface User {
  id: string;
  username: string;
  full_name?: string;
}

const PUBLIC_PATHS = new Set(['/platform-admin', '/platform-admin/login']);

export default function PlatformAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [denied, setDenied] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const isPublic = PUBLIC_PATHS.has(pathname);

  useEffect(() => {
    if (isPublic) {
      setLoading(false);
      return;
    }

    const checkAuth = async () => {
      try {
        const response = await fetch('/api/auth/me', { credentials: 'include' });
        const result = await response.json();

        if (!result.success) {
          router.replace('/platform-admin');
          return;
        }

        if (result.is_platform_admin !== true) {
          setDenied(true);
          return;
        }

        setUser(result.user);
      } catch {
        router.replace('/platform-admin');
      } finally {
        setLoading(false);
      }
    };

    void checkAuth();
  }, [router, isPublic]);

  async function handleLogout() {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch {
      // ignore
    }
    router.push('/platform-admin');
  }

  if (isPublic) {
    return <>{children}</>;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center" dir="rtl">
        <p className="text-slate-600 text-sm">جارٍ التحقق من الصلاحيات…</p>
      </div>
    );
  }

  if (denied) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center p-6" dir="rtl">
        <div className="bg-white border border-red-200 rounded-xl p-6 max-w-md text-center">
          <h1 className="text-lg font-semibold text-red-800 mb-2">غير مصرّح</h1>
          <p className="text-sm text-slate-600 mb-4">
            هذه البوابة مخصّصة لحساب السوبر أدمن فقط، ومنفصلة عن أنظمة العمل.
          </p>
          <button
            type="button"
            onClick={() => router.push('/platform-admin')}
            className="bg-slate-800 text-white text-sm px-4 py-2 rounded-lg"
          >
            تسجيل دخول السوبر أدمن
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100" dir="rtl">
      <header className="bg-slate-900 text-white">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs text-slate-400 mb-0.5">سوبر أدمن</p>
            <h1 className="text-lg font-semibold tracking-tight">بوابة إدارة المنصة</h1>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-slate-300">{user?.full_name || user?.username}</span>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="text-slate-300 hover:text-white underline-offset-2 hover:underline"
            >
              خروج
            </button>
          </div>
        </div>
        <nav className="border-t border-slate-700">
          <div className="max-w-6xl mx-auto px-4 flex gap-1">
            <Link
              href="/platform-admin/systems"
              className={`px-4 py-2.5 text-sm border-b-2 transition-colors ${
                pathname.startsWith('/platform-admin/systems')
                  ? 'border-amber-400 text-white'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              كلمات مرور الأنظمة
            </Link>
          </div>
        </nav>
      </header>

      <main className="max-w-6xl mx-auto">{children}</main>
    </div>
  );
}
