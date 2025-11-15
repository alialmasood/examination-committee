'use client';

import { useEffect, useMemo, useState } from 'react';

type DepartmentStats = {
  id: string;
  name: string;
  total: number;
  totalAmount?: number;
  years?: {
    first: number;
    second: number;
    third: number;
    fourth: number;
  };
};

interface SidebarStatsCardProps {
  departmentId?: string | null;
  title?: string;
  showHeader?: boolean;
  className?: string;
}

const numberFormatter = new Intl.NumberFormat('en-US');

export default function SidebarStatsCard({ departmentId = null, title, showHeader = true, className }: SidebarStatsCardProps) {
  const [stats, setStats] = useState<DepartmentStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    let isMounted = true;

    const fetchStats = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch('/api/departments/stats');
        const data = await response.json();

        if (data.success && Array.isArray(data.data)) {
          if (isMounted) {
            setStats(data.data);
          }
        } else if (isMounted) {
          setError('تعذر جلب الإحصائيات');
        }
      } catch (err) {
        if (isMounted) {
          console.error('خطأ في جلب إحصائيات الأقسام:', err);
          setError('خطأ في الاتصال بالخادم');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    fetchStats();

    const interval = setInterval(fetchStats, 60000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  const totals = useMemo(() => {
    if (!stats.length) {
      return {
        totalStudents: 0,
        totalAmount: 0,
      };
    }

    return stats.reduce(
      (acc, dept) => {
        acc.totalStudents += dept.total || 0;
        acc.totalAmount += dept.totalAmount || 0;
        return acc;
      },
      { totalStudents: 0, totalAmount: 0 }
    );
  }, [stats]);

  const departmentStats = useMemo(() => {
    if (!departmentId) return null;
    return stats.find((dept) => dept.id === departmentId);
  }, [departmentId, stats]);

  const leadingDepartments = useMemo(() => {
    if (!stats.length) return [];

    return [...stats]
      .sort((a, b) => (b.total || 0) - (a.total || 0))
      .slice(0, 3);
  }, [stats]);

  const statItems = useMemo(() => {
    const items: Array<{
      title: string;
      value: string;
      description?: string;
    }> = [];

    if (totals.totalStudents > 0) {
      items.push({
        title: 'إجمالي الطلبة المسجلين',
        value: numberFormatter.format(totals.totalStudents),
      });
    }

    if (totals.totalAmount > 0) {
      items.push({
        title: 'إجمالي المبالغ المحصلة',
        value: `${numberFormatter.format(totals.totalAmount)} IQD`,
      });
    }

    if (departmentStats) {
      items.push({
        title: `إجمالي الطلبة - ${departmentStats.name}`,
        value: numberFormatter.format(departmentStats.total || 0),
      });

      if (departmentStats.totalAmount && departmentStats.totalAmount > 0) {
        items.push({
          title: `إجمالي المبالغ - ${departmentStats.name}`,
          value: `${numberFormatter.format(departmentStats.totalAmount)} IQD`,
        });
      }

      if (departmentStats.years) {
        const yearNames: Record<string, string> = {
          first: 'المرحلة الأولى',
          second: 'المرحلة الثانية',
          third: 'المرحلة الثالثة',
          fourth: 'المرحلة الرابعة',
        };

        Object.entries(departmentStats.years).forEach(([key, value]) => {
          if (value && value > 0) {
            items.push({
              title: `${yearNames[key] || key} - ${departmentStats.name}`,
              value: numberFormatter.format(value),
            });
          }
        });
      }
    }

    if (!departmentStats && leadingDepartments.length) {
      leadingDepartments.forEach((dept, index) => {
        items.push({
          title: `المرتبة ${index + 1}: ${dept.name}`,
          value: numberFormatter.format(dept.total || 0),
          description: 'من حيث عدد الطلبة',
        });
      });
    }

    return items;
  }, [totals, departmentStats, leadingDepartments]);

  useEffect(() => {
    if (!statItems.length) {
      setCurrentIndex(0);
      return;
    }

    if (currentIndex >= statItems.length) {
      setCurrentIndex(0);
    }
  }, [statItems, currentIndex]);

  useEffect(() => {
    if (!statItems.length) return;

    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % statItems.length);
    }, 5000);

    return () => clearInterval(interval);
  }, [statItems]);

  return (
    <div className={`mx-2 mb-4 rounded-lg border border-red-200/60 bg-red-900/30 shadow-inner backdrop-blur-sm h-32 ${className ?? 'mt-12'}`}>
      <div className="p-3 space-y-3">
        {showHeader ? (
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-white">
                {title || 'لوحة الإحصائيات'}
              </h3>
            </div>
            <svg className="w-6 h-6 text-red-100/80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M11.25 6.75v4.5h4.5m4.5 0a8.25 8.25 0 11-16.5 0 8.25 8.25 0 0116.5 0z"
              />
            </svg>
          </div>
        ) : null}

        {loading ? (
          <div className="space-y-3 animate-pulse">
            <div className="h-3 bg-red-200/40 rounded" />
            <div className="h-3 bg-red-200/40 rounded w-4/5" />
            <div className="h-3 bg-red-200/40 rounded w-3/5" />
          </div>
        ) : error ? (
          <div className="rounded-md border border-red-300/60 bg-red-900/50 p-3 text-xs text-red-100">
            {error}
          </div>
        ) : statItems.length ? (
          <div className="overflow-hidden h-16">
            <div className="transition-all duration-500 ease-in-out h-full flex flex-col justify-center" key={statItems[currentIndex]?.title}>
              <p className="text-[11px] text-red-100/80">{statItems[currentIndex]?.title}</p>
              {statItems[currentIndex]?.description ? (
                <p className="mt-1 text-[10px] text-red-100/60">{statItems[currentIndex]?.description}</p>
              ) : null}
              <p className="mt-1 text-xl font-bold text-white">
                {statItems[currentIndex]?.value}
              </p>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <span className="text-[10px] text-red-100/60">
                {currentIndex + 1} / {statItems.length}
              </span>
              <div className="flex gap-1">
                {statItems.map((_, idx) => (
                  <span
                    key={idx}
                    className={`h-1 w-3 rounded-full transition-colors ${
                      idx === currentIndex ? 'bg-yellow-300' : 'bg-red-300/40'
                    }`}
                  />
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-[11px] text-red-100/70">
            لا توجد إحصائيات متاحة حالياً.
          </div>
        )}
      </div>
    </div>
  );
}

