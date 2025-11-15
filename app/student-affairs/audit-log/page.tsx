'use client';

import { useState, useEffect } from 'react';
import { formatActionType, formatEntityType } from '@/src/lib/audit-utils';

interface AuditLogEntry {
  id: string;
  user_id: string;
  username: string;
  full_name: string | null;
  action_type: string;
  entity_type: string;
  entity_id: string | null;
  entity_name: string | null;
  description: string;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
}

export default function AuditLogPage() {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 50,
    total: 0,
    total_pages: 0,
  });

  // Filters
  const [filters, setFilters] = useState({
    action_type: '',
    entity_type: '',
    search: '',
    start_date: '',
    end_date: '',
  });

  useEffect(() => {
    fetchLogs();
  }, [pagination.page, filters]);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams({
        page: pagination.page.toString(),
        limit: pagination.limit.toString(),
      });

      if (filters.action_type) {
        params.append('action_type', filters.action_type);
      }
      if (filters.entity_type) {
        params.append('entity_type', filters.entity_type);
      }
      if (filters.search) {
        params.append('search', filters.search);
      }
      if (filters.start_date) {
        params.append('start_date', filters.start_date);
      }
      if (filters.end_date) {
        params.append('end_date', filters.end_date);
      }

      const response = await fetch(`/api/audit-log?${params.toString()}`);
      const result = await response.json();

      if (result.success) {
        setLogs(result.data);
        setPagination(prev => ({
          ...prev,
          total: result.pagination.total,
          total_pages: result.pagination.total_pages,
        }));
      }
    } catch (error) {
      console.error('خطأ في جلب سجل العمليات:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFilterChange = (key: string, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('ar-EG', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getActionColor = (actionType: string) => {
    const colors: Record<string, string> = {
      'create': 'bg-green-100 text-green-800',
      'update': 'bg-blue-100 text-blue-800',
      'delete': 'bg-red-100 text-red-800',
      'complete_registration': 'bg-purple-100 text-purple-800',
      'mark_paid': 'bg-yellow-100 text-yellow-800',
      'print_receipt': 'bg-indigo-100 text-indigo-800',
    };
    return colors[actionType] || 'bg-gray-100 text-gray-800';
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
      {/* Header */}
      <div className="bg-white shadow-lg border-b border-gray-200 mb-6">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">سجل العمليات</h1>
              <p className="mt-2 text-sm text-gray-600">
                تتبع جميع العمليات المهمة التي تم إجراؤها في النظام
              </p>
            </div>
            <button
              onClick={() => window.history.back()}
              className="px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors duration-200"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Filters */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">تصفية النتائج</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            {/* نوع العملية */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                نوع العملية
              </label>
              <select
                value={filters.action_type}
                onChange={(e) => handleFilterChange('action_type', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">الكل</option>
                <option value="create">إضافة</option>
                <option value="update">تعديل</option>
                <option value="delete">حذف</option>
                <option value="complete_registration">إتمام التسجيل</option>
                <option value="mark_paid">تأكيد الدفع</option>
                <option value="print_receipt">طباعة الوصل</option>
              </select>
            </div>

            {/* نوع الكيان */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                نوع الكيان
              </label>
              <select
                value={filters.entity_type}
                onChange={(e) => handleFilterChange('entity_type', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="">الكل</option>
                <option value="student">طالب</option>
                <option value="payment">دفعة</option>
                <option value="grade">درجة</option>
                <option value="document">وثيقة</option>
              </select>
            </div>

            {/* تاريخ البداية */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                من تاريخ
              </label>
              <input
                type="date"
                value={filters.start_date}
                onChange={(e) => handleFilterChange('start_date', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* تاريخ النهاية */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                إلى تاريخ
              </label>
              <input
                type="date"
                value={filters.end_date}
                onChange={(e) => handleFilterChange('end_date', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            {/* البحث */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                بحث
              </label>
              <input
                type="text"
                value={filters.search}
                onChange={(e) => handleFilterChange('search', e.target.value)}
                placeholder="البحث في الوصف..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>
          </div>
        </div>

        {/* Logs Table */}
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          {loading ? (
            <div className="p-12 text-center">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <p className="mt-4 text-gray-600">جاري تحميل السجلات...</p>
            </div>
          ) : logs.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-gray-600">لا توجد سجلات للعرض</p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        التاريخ والوقت
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        المستخدم
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        نوع العملية
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        الكيان
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        الوصف
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        IP Address
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {logs.map((log) => (
                      <tr key={log.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {formatDate(log.created_at)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          <div>
                            <div className="font-medium">{log.full_name || log.username}</div>
                            <div className="text-gray-500 text-xs">{log.username}</div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-2 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${getActionColor(log.action_type)}`}>
                            {formatActionType(log.action_type)}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          <div>
                            <div className="font-medium">{formatEntityType(log.entity_type)}</div>
                            {log.entity_name && (
                              <div className="text-gray-500 text-xs">{log.entity_name}</div>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900">
                          <div className="max-w-md">{log.description}</div>
                          {log.old_values && Object.keys(log.old_values).length > 0 && (
                            <details className="mt-2">
                              <summary className="text-xs text-gray-500 cursor-pointer">
                                عرض القيم القديمة
                              </summary>
                              <pre className="mt-1 text-xs bg-gray-100 p-2 rounded overflow-auto max-h-32">
                                {JSON.stringify(log.old_values, null, 2)}
                              </pre>
                            </details>
                          )}
                          {log.new_values && Object.keys(log.new_values).length > 0 && (
                            <details className="mt-2">
                              <summary className="text-xs text-gray-500 cursor-pointer">
                                عرض القيم الجديدة
                              </summary>
                              <pre className="mt-1 text-xs bg-gray-100 p-2 rounded overflow-auto max-h-32">
                                {JSON.stringify(log.new_values, null, 2)}
                              </pre>
                            </details>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {log.ip_address || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {pagination.total_pages > 1 && (
                <div className="bg-gray-50 px-4 py-3 flex items-center justify-between border-t border-gray-200 sm:px-6">
                  <div className="flex-1 flex justify-between sm:hidden">
                    <button
                      onClick={() => setPagination(prev => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
                      disabled={pagination.page === 1}
                      className="relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      السابق
                    </button>
                    <button
                      onClick={() => setPagination(prev => ({ ...prev, page: Math.min(prev.total_pages, prev.page + 1) }))}
                      disabled={pagination.page === pagination.total_pages}
                      className="ml-3 relative inline-flex items-center px-4 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      التالي
                    </button>
                  </div>
                  <div className="hidden sm:flex-1 sm:flex sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm text-gray-700">
                        عرض <span className="font-medium">{((pagination.page - 1) * pagination.limit) + 1}</span> إلى{' '}
                        <span className="font-medium">
                          {Math.min(pagination.page * pagination.limit, pagination.total)}
                        </span>{' '}
                        من <span className="font-medium">{pagination.total}</span> سجل
                      </p>
                    </div>
                    <div>
                      <nav className="relative z-0 inline-flex rounded-md shadow-sm -space-x-px" aria-label="Pagination">
                        <button
                          onClick={() => setPagination(prev => ({ ...prev, page: Math.max(1, prev.page - 1) }))}
                          disabled={pagination.page === 1}
                          className="relative inline-flex items-center px-2 py-2 rounded-r-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          السابق
                        </button>
                        {Array.from({ length: pagination.total_pages }, (_, i) => i + 1)
                          .filter(page => {
                            // عرض الصفحة الحالية و 2 قبلها و 2 بعدها
                            return Math.abs(page - pagination.page) <= 2;
                          })
                          .map((page) => (
                            <button
                              key={page}
                              onClick={() => setPagination(prev => ({ ...prev, page }))}
                              className={`relative inline-flex items-center px-4 py-2 border text-sm font-medium ${
                                page === pagination.page
                                  ? 'z-10 bg-blue-50 border-blue-500 text-blue-600'
                                  : 'bg-white border-gray-300 text-gray-500 hover:bg-gray-50'
                              }`}
                            >
                              {page}
                            </button>
                          ))}
                        <button
                          onClick={() => setPagination(prev => ({ ...prev, page: Math.min(prev.total_pages, prev.page + 1) }))}
                          disabled={pagination.page === pagination.total_pages}
                          className="relative inline-flex items-center px-2 py-2 rounded-l-md border border-gray-300 bg-white text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          التالي
                        </button>
                      </nav>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

