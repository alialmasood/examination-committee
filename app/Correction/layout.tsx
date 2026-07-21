"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";

const SYSTEM_SETTINGS_KEY = "correction_system_settings_v1";

const navItems = [
  { href: "/Correction/user", label: "لوحة المستخدم" },
  { href: "/Correction/students", label: "ادخال الطلبة" },
  { href: "/Correction/subjects", label: "ادخال المواد الدراسية" },
  { href: "/Correction/export-sheet", label: "تصدير شيت امتحان" },
  { href: "/Correction/answer-key", label: "مفتاح الإجابة النموذجية" },
  { href: "/Correction/composed-exams", label: "الامتحانات المكونة" },
  { href: "/Correction/calibration", label: "المعايرة" },
  { href: "/Correction/test", label: "تصحيح الامتحان" },
  { href: "/Correction/batches", label: "الوجبات المحفوظة" },
];

export default function CorrectionLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [showCalibrationTab, setShowCalibrationTab] = useState(true);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const bareShell =
    pathname === "/Correction" || (pathname != null && pathname.startsWith("/Correction/sheet-scan"));

  useEffect(() => {
    const loadLocalSettings = () => {
      try {
        const raw = localStorage.getItem(SYSTEM_SETTINGS_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as { showCalibrationTab?: boolean };
        if (typeof parsed.showCalibrationTab === "boolean") {
          setShowCalibrationTab(parsed.showCalibrationTab);
        }
      } catch {
        // ignore local storage parse issues
      }
    };
    loadLocalSettings();

    const onSettingsChanged = () => loadLocalSettings();
    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key === SYSTEM_SETTINGS_KEY) {
        loadLocalSettings();
      }
    };
    window.addEventListener("correction-settings-changed", onSettingsChanged);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("correction-settings-changed", onSettingsChanged);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    const onDocClick = (event: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const hideScrollbar =
    "[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:h-0 [&::-webkit-scrollbar]:w-0";
  const visibleNavItems = showCalibrationTab ? navItems : navItems.filter((item) => item.href !== "/Correction/calibration");

  if (bareShell) return <>{children}</>;

  return (
    <div className="h-screen overflow-hidden bg-slate-100 print:h-auto print:min-h-0 print:overflow-visible">
      <aside className="fixed inset-y-0 start-0 z-40 flex w-72 flex-col border-e border-slate-200 bg-slate-900 text-white print:hidden">
        <div className="shrink-0 border-b border-slate-700 px-6 py-5">
          <h2 className="text-lg font-bold">نظام التصحيح الالكتروني</h2>
          <p className="mt-1 text-sm text-slate-300">كلية الشرق التقنية التخصصية</p>
        </div>
        <nav className={`min-h-0 flex-1 overflow-y-auto px-4 py-5 ${hideScrollbar}`}>
          <ul className="space-y-2">
            {visibleNavItems.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`block rounded-lg px-4 py-3 text-right text-sm font-medium transition ${
                    pathname === item.href ? "bg-blue-700 text-white" : "text-slate-100 hover:bg-slate-800"
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      <section className="ms-72 flex h-full min-h-0 flex-col print:ms-0 print:h-auto print:min-h-0">
        <header className="flex h-20 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6 shadow-sm print:hidden">
          <h1 className="text-xl font-bold text-slate-800">نظام التصحيح الإلكتروني</h1>
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              onClick={() => setMenuOpen((prev) => !prev)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              مدير النظام
            </button>
            {menuOpen ? (
              <div className="absolute left-0 z-50 mt-2 w-44 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
                <Link
                  href="/Correction/system"
                  onClick={() => setMenuOpen(false)}
                  className="block px-4 py-2 text-right text-sm text-slate-700 hover:bg-slate-50"
                >
                  الإعدادات
                </Link>
              </div>
            ) : null}
          </div>
        </header>
        <div
          className={`min-h-0 flex-1 overflow-y-auto overflow-x-hidden print:h-auto print:min-h-0 print:overflow-visible ${hideScrollbar}`}
        >
          {children}
        </div>
      </section>
    </div>
  );
}
