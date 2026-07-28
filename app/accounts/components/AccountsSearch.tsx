'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

type SearchResultType =
  | 'student'
  | 'payroll_person'
  | 'supplier'
  | 'journal_entry'
  | 'cash_box'
  | 'cash_voucher'
  | 'bank'
  | 'bank_account'
  | 'fixed_asset'
  | 'chart_account';

type SearchResult = {
  id: string;
  title: string;
  description: string;
  type: SearchResultType;
  url: string;
};

const TYPE_LABEL: Record<SearchResultType, string> = {
  student: 'طالب',
  payroll_person: 'كادر رواتب',
  supplier: 'مورد',
  journal_entry: 'قيد',
  cash_box: 'صندوق',
  cash_voucher: 'سند صندوق',
  bank: 'مصرف',
  bank_account: 'حساب مصرفي',
  fixed_asset: 'أصل ثابت',
  chart_account: 'دليل حسابات',
};

function TypeIcon({ type }: { type: SearchResultType }) {
  const common = 'w-4 h-4';
  switch (type) {
    case 'student':
      return (
        <svg className={common} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
        </svg>
      );
    case 'payroll_person':
      return (
        <svg className={common} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      );
    case 'supplier':
      return (
        <svg className={common} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
      );
    case 'journal_entry':
      return (
        <svg className={common} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      );
    case 'cash_box':
    case 'cash_voucher':
      return (
        <svg className={common} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
        </svg>
      );
    case 'bank':
    case 'bank_account':
      return (
        <svg className={common} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
        </svg>
      );
    case 'fixed_asset':
      return (
        <svg className={common} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
      );
    default:
      return (
        <svg className={common} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      );
  }
}

export default function AccountsSearch() {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [error, setError] = useState('');

  const close = useCallback(() => {
    setOpen(false);
    setSelectedIndex(0);
  }, []);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        close();
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [close]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      setError('');
      return;
    }

    setLoading(true);
    setError('');
    const timeoutId = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/accounts/search?q=${encodeURIComponent(q)}`,
          { credentials: 'include', cache: 'no-store' }
        );
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body.success === false) {
          setResults([]);
          setError(body.message || body.error || 'تعذر تنفيذ البحث');
          return;
        }
        const list = Array.isArray(body.results)
          ? body.results
          : Array.isArray(body.data?.results)
            ? body.data.results
            : [];
        setResults(list);
        setSelectedIndex(0);
        setOpen(true);
      } catch {
        setResults([]);
        setError('تعذر الاتصال بالخادم');
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [query]);

  function goTo(result: SearchResult) {
    router.push(result.url);
    setQuery('');
    setResults([]);
    close();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      close();
      return;
    }
    if (!open || results.length === 0) {
      if (e.key === 'Enter' && query.trim().length >= 2) {
        setOpen(true);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = results[selectedIndex];
      if (item) goTo(item);
    }
  }

  const showPanel =
    open && (query.trim().length >= 2 || loading || !!error || results.length > 0);

  return (
    <div ref={rootRef} className="relative w-full max-w-md hidden lg:block">
      <div className="relative">
        <div className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
          <svg
            className="h-5 w-5 text-gray-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (e.target.value.trim().length >= 2) setOpen(true);
          }}
          onFocus={() => {
            if (query.trim().length >= 2) setOpen(true);
          }}
          onKeyDown={onKeyDown}
          placeholder="البحث في النظام..."
          className="block w-full pr-10 pl-3 py-2 border border-gray-300 rounded-md leading-5 bg-white placeholder-gray-500 focus:outline-none focus:placeholder-gray-400 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 text-right text-sm text-gray-900"
          aria-label="البحث في نظام الحسابات"
          aria-expanded={showPanel}
          aria-controls="accounts-global-search-results"
          autoComplete="off"
        />
        {loading && (
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        )}
      </div>

      {showPanel && (
        <div
          id="accounts-global-search-results"
          className="absolute top-full mt-1.5 right-0 left-0 z-50 rounded-lg border border-gray-200 bg-white shadow-xl overflow-hidden"
          role="listbox"
        >
          <div className="max-h-96 overflow-y-auto">
            {error ? (
              <div className="px-4 py-6 text-center text-sm text-red-700">{error}</div>
            ) : query.trim().length < 2 ? (
              <div className="px-4 py-5 text-center text-sm text-gray-500">
                اكتب حرفين على الأقل للبحث
              </div>
            ) : loading && results.length === 0 ? (
              <div className="px-4 py-5 text-center text-sm text-gray-500">
                جاري البحث…
              </div>
            ) : results.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-gray-500">
                <p className="font-medium text-gray-700">لا توجد نتائج</p>
                <p className="mt-1 text-xs">
                  جرّب الاسم، الرقم الجامعي، رمز المورد، رقم القيد أو السند…
                </p>
              </div>
            ) : (
              results.map((result, index) => {
                const active = index === selectedIndex;
                return (
                  <button
                    key={result.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onMouseEnter={() => setSelectedIndex(index)}
                    onClick={() => goTo(result)}
                    className={`w-full flex items-start gap-3 px-3 py-2.5 text-right transition-colors ${
                      active
                        ? 'bg-red-50 border-r-4 border-red-800'
                        : 'hover:bg-gray-50 border-r-4 border-transparent'
                    }`}
                  >
                    <div
                      className={`mt-0.5 w-8 h-8 rounded-md flex items-center justify-center shrink-0 ${
                        active
                          ? 'bg-red-100 text-red-900'
                          : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      <TypeIcon type={result.type} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-gray-900 truncate">
                          {result.title}
                        </p>
                        <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                          {TYPE_LABEL[result.type] || 'نتيجة'}
                        </span>
                      </div>
                      {result.description ? (
                        <p className="mt-0.5 text-xs text-gray-500 line-clamp-2">
                          {result.description}
                        </p>
                      ) : null}
                    </div>
                  </button>
                );
              })
            )}
          </div>
          {results.length > 0 && (
            <div className="border-t border-gray-100 px-3 py-1.5 text-[10px] text-gray-400 text-center">
              ↑↓ للتنقل · Enter للفتح · Esc للإغلاق
            </div>
          )}
        </div>
      )}
    </div>
  );
}
