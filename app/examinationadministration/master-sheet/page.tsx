'use client';

import React, { useEffect, useState, useCallback, useMemo } from 'react';

interface SystemStatus {
  code: string;
  name: string;
  studentCount: number;
  firstSemesterSubjectsCount: number;
  secondSemesterSubjectsCount: number;
  gradesCount: number;
  totalPossibleGrades: number;
  completionPercentage: number;
  status: 'completed' | 'in_progress' | 'not_started';
  hasData: boolean;
  error?: string;
}

interface MasterSheetData {
  students: any[];
  firstSemesterSubjects: any[];
  secondSemesterSubjects: any[];
  grades: Record<string, Record<string, any>>;
  academic_year: string;
}

const SYSTEMS = [
  { code: 'dentalindustry', name: 'تقنيات صناعة الأسنان' },
  { code: 'anesthesia', name: 'تقنيات التخدير' },
  { code: 'xrays', name: 'تقنيات الأشعة' },
  { code: 'construction', name: 'تقنيات البناء والاستشارات' },
  { code: 'oil', name: 'تقنيات النفط والغاز' },
  { code: 'physics', name: 'تقنيات الفيزياء الصحية' },
  { code: 'optics', name: 'تقنيات البصريات' },
  { code: 'health', name: 'تقنيات صحة المجتمع' },
  { code: 'emergency', name: 'تقنيات طب الطوارئ' },
  { code: 'therapy', name: 'تقنيات العلاج الطبيعي' },
  { code: 'cyber', name: 'تقنيات الأمن السيبراني' },
];

export default function CentralMasterSheetPage() {
  const [systemsStatus, setSystemsStatus] = useState<SystemStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [academicYear, setAcademicYear] = useState('2025-2026');
  const [academicYears, setAcademicYears] = useState<string[]>(['2025-2026']);
  const [stage, setStage] = useState<string>('first');
  const [studyType, setStudyType] = useState<string>('morning');
  const [selectedSystem, setSelectedSystem] = useState<string | null>(null);
  const [masterSheetData, setMasterSheetData] = useState<MasterSheetData | null>(null);
  const [loadingMasterSheet, setLoadingMasterSheet] = useState(false);

  // جلب قائمة الأعوام الدراسية
  useEffect(() => {
    const fetchAcademicYears = async () => {
      try {
        const response = await fetch('/api/academic-years');
        const data = await response.json();
        if (data.success && data.data && data.data.length > 0) {
          setAcademicYears(data.data);
          if (!academicYear || !data.data.includes(academicYear)) {
            setAcademicYear(data.data[0]);
          }
        }
      } catch (error) {
        console.error('خطأ في جلب الأعوام الدراسية:', error);
      }
    };
    fetchAcademicYears();
  }, [academicYear]);

  // جلب حالة جميع الأنظمة
  const fetchSystemsStatus = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({
        academicYear,
        ...(stage && { stage }),
        ...(studyType && { studyType })
      });
      const res = await fetch(`/api/examinationadministration/systems-status?${params}`);
      const result = await res.json();
      if (result.success) {
        setSystemsStatus(result.systems);
      } else {
        setError(result.error || 'خطأ في جلب البيانات');
      }
    } catch (err) {
      setError('خطأ في الاتصال بالخادم');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [academicYear, stage, studyType]);

  useEffect(() => {
    fetchSystemsStatus();
  }, [fetchSystemsStatus]);

  // جلب بيانات الماستر شيت لقسم محدد
  const fetchMasterSheetForSystem = useCallback(async (systemCode: string) => {
    try {
      setLoadingMasterSheet(true);
      setError(null);
      const params = new URLSearchParams({
        academicYear,
        stage,
        studyType
      });
      const res = await fetch(`/api/master-sheet/${systemCode}?${params}`);
      const result = await res.json();
      if (result.success) {
        setMasterSheetData(result);
      } else {
        setError(result.error || 'خطأ في جلب بيانات الماستر شيت');
        setMasterSheetData(null);
      }
    } catch (err) {
      setError('خطأ في الاتصال بالخادم');
      setMasterSheetData(null);
      console.error(err);
    } finally {
      setLoadingMasterSheet(false);
    }
  }, [academicYear, stage, studyType]);

  // عند اختيار نظام، جلب بيانات الماستر شيت
  useEffect(() => {
    if (selectedSystem) {
      fetchMasterSheetForSystem(selectedSystem);
    } else {
      setMasterSheetData(null);
    }
  }, [selectedSystem, fetchMasterSheetForSystem]);

  // إحصائيات عامة
  const overallStats = useMemo(() => {
    const totalStudents = systemsStatus.reduce((sum, sys) => sum + (sys.studentCount || 0), 0);
    const completedSystems = systemsStatus.filter(sys => sys.status === 'completed').length;
    const inProgressSystems = systemsStatus.filter(sys => sys.status === 'in_progress').length;
    const notStartedSystems = systemsStatus.filter(sys => sys.status === 'not_started').length;
    const totalSubjects = systemsStatus.reduce((sum, sys) => 
      sum + (sys.firstSemesterSubjectsCount || 0) + (sys.secondSemesterSubjectsCount || 0), 0
    );

    return {
      totalStudents,
      completedSystems,
      inProgressSystems,
      notStartedSystems,
      totalSubjects,
      totalSystems: systemsStatus.length
    };
  }, [systemsStatus]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return (
          <span className="px-3 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800 border border-green-300">
            ✓ مكتمل
          </span>
        );
      case 'in_progress':
        return (
          <span className="px-3 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800 border border-yellow-300">
            🔄 قيد التنفيذ
          </span>
        );
      case 'not_started':
        return (
          <span className="px-3 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800 border border-red-300">
            ✗ لم يبدأ
          </span>
        );
      default:
        return null;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-50 border-green-200';
      case 'in_progress':
        return 'bg-yellow-50 border-yellow-200';
      case 'not_started':
        return 'bg-red-50 border-red-200';
      default:
        return 'bg-gray-50 border-gray-200';
    }
  };

  return (
    <div className="p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">الماستر شيت المركزي</h1>
          <p className="text-gray-600">مراقبة وتدقيق الماستر شيت لجميع الأقسام</p>
        </div>

        {/* Filters */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                العام الدراسي
              </label>
              <select
                value={academicYear}
                onChange={(e) => setAcademicYear(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                {academicYears.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                المرحلة
              </label>
              <select
                value={stage}
                onChange={(e) => setStage(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                <option value="first">الأولى</option>
                <option value="second">الثانية</option>
                <option value="third">الثالثة</option>
                <option value="fourth">الرابعة</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                نوع الدراسة
              </label>
              <select
                value={studyType}
                onChange={(e) => setStudyType(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                <option value="morning">صباحي</option>
                <option value="evening">مسائي</option>
              </select>
            </div>

            <div className="flex items-end">
              <button
                onClick={() => {
                  setSelectedSystem(null);
                  fetchSystemsStatus();
                }}
                className="w-full px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
              >
                تحديث البيانات
              </button>
            </div>
          </div>
        </div>

        {/* Overall Statistics */}
        {!loading && !error && (
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
            <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-lg shadow-md border border-blue-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-blue-600 mb-1">إجمالي الأقسام</p>
                  <p className="text-2xl font-bold text-blue-900">{overallStats.totalSystems}</p>
                </div>
                <div className="bg-blue-200 rounded-full p-3">
                  <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                  </svg>
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg shadow-md border border-green-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-green-600 mb-1">مكتمل</p>
                  <p className="text-2xl font-bold text-green-900">{overallStats.completedSystems}</p>
                </div>
                <div className="bg-green-200 rounded-full p-3">
                  <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-br from-yellow-50 to-yellow-100 rounded-lg shadow-md border border-yellow-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-yellow-600 mb-1">قيد التنفيذ</p>
                  <p className="text-2xl font-bold text-yellow-900">{overallStats.inProgressSystems}</p>
                </div>
                <div className="bg-yellow-200 rounded-full p-3">
                  <svg className="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-br from-red-50 to-red-100 rounded-lg shadow-md border border-red-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-red-600 mb-1">لم يبدأ</p>
                  <p className="text-2xl font-bold text-red-900">{overallStats.notStartedSystems}</p>
                </div>
                <div className="bg-red-200 rounded-full p-3">
                  <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-lg shadow-md border border-purple-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-purple-600 mb-1">إجمالي الطلاب</p>
                  <p className="text-2xl font-bold text-purple-900">{overallStats.totalStudents}</p>
                </div>
                <div className="bg-purple-200 rounded-full p-3">
                  <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-3-3h-4a3 3 0 00-3 3v2h5zM9 10a3 3 0 100-6 3 3 0 000 6zM21 10a3 3 0 100-6 3 3 0 000 6zM7 20H2v-2a3 3 0 013-3h4a3 3 0 013 3v2h-5z" />
                  </svg>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">جاري تحميل حالة الأنظمة...</p>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <p className="text-red-800">{error}</p>
          </div>
        )}

        {/* Systems Grid */}
        {!loading && !error && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden mb-6">
            <div className="px-6 py-4 border-b border-gray-200">
              <h2 className="text-xl font-bold text-gray-900">حالة الأقسام</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-6">
              {systemsStatus.map((system) => (
                <div
                  key={system.code}
                  onClick={() => setSelectedSystem(system.code)}
                  className={`cursor-pointer rounded-lg border-2 p-4 transition-all hover:shadow-lg ${
                    selectedSystem === system.code
                      ? 'border-red-500 shadow-lg'
                      : getStatusColor(system.status)
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <h3 className="text-lg font-bold text-gray-900">{system.name}</h3>
                    {getStatusBadge(system.status)}
                  </div>
                  
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-gray-600">عدد الطلاب:</span>
                      <span className="font-semibold text-gray-900">{system.studentCount || 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">مواد الفصل الأول:</span>
                      <span className="font-semibold text-gray-900">{system.firstSemesterSubjectsCount || 0}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-600">مواد الفصل الثاني:</span>
                      <span className="font-semibold text-gray-900">{system.secondSemesterSubjectsCount || 0}</span>
                    </div>
                    <div className="mt-3 pt-3 border-t border-gray-200">
                      <div className="flex justify-between items-center">
                        <span className="text-gray-600">نسبة الاكتمال:</span>
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-2 bg-gray-200 rounded-full overflow-hidden">
                            <div
                              className={`h-full transition-all ${
                                system.status === 'completed'
                                  ? 'bg-green-500'
                                  : system.status === 'in_progress'
                                  ? 'bg-yellow-500'
                                  : 'bg-red-500'
                              }`}
                              style={{ width: `${system.completionPercentage || 0}%` }}
                            ></div>
                          </div>
                          <span className="font-semibold text-gray-900 text-xs">
                            {system.completionPercentage || 0}%
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {system.error && (
                    <div className="mt-3 pt-3 border-t border-red-200">
                      <p className="text-xs text-red-600">{system.error}</p>
                    </div>
                  )}

                  {!system.hasData && (
                    <div className="mt-3 pt-3 border-t border-gray-200">
                      <p className="text-xs text-gray-500">لا توجد بيانات متاحة</p>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Selected System Master Sheet */}
        {selectedSystem && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-gray-900">
                الماستر شيت - {systemsStatus.find(s => s.code === selectedSystem)?.name}
              </h2>
              <button
                onClick={() => {
                  setSelectedSystem(null);
                  setMasterSheetData(null);
                }}
                className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
              >
                إغلاق
              </button>
            </div>

            {loadingMasterSheet ? (
              <div className="text-center py-12">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600 mx-auto"></div>
                <p className="mt-4 text-gray-600">جاري تحميل بيانات الماستر شيت...</p>
              </div>
            ) : masterSheetData ? (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-4 mb-4">
                  <div className="bg-blue-50 p-3 rounded">
                    <p className="text-sm text-gray-600">عدد الطلاب</p>
                    <p className="text-2xl font-bold text-blue-600">{masterSheetData.students?.length || 0}</p>
                  </div>
                  <div className="bg-green-50 p-3 rounded">
                    <p className="text-sm text-gray-600">مواد الفصل الأول</p>
                    <p className="text-2xl font-bold text-green-600">
                      {masterSheetData.firstSemesterSubjects?.length || 0}
                    </p>
                  </div>
                  <div className="bg-purple-50 p-3 rounded">
                    <p className="text-sm text-gray-600">مواد الفصل الثاني</p>
                    <p className="text-2xl font-bold text-purple-600">
                      {masterSheetData.secondSemesterSubjects?.length || 0}
                    </p>
                  </div>
                </div>

                <div className="bg-gray-50 p-4 rounded">
                  <p className="text-sm text-gray-600">
                    البيانات معروضة بشكل مختصر. للعرض الكامل يمكنك الانتقال إلى نظام القسم مباشرة.
                  </p>
                  <a
                    href={`/${selectedSystem}/master-sheet?academicYear=${academicYear}&stage=${stage}&studyType=${studyType}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-block px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700"
                  >
                    فتح في نافذة جديدة
                  </a>
                </div>
              </div>
            ) : (
              <div className="text-center py-12">
                <p className="text-gray-600">لا توجد بيانات متاحة</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}