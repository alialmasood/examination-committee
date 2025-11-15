'use client';

import { useState, useEffect } from 'react';

interface DepartmentStats {
  id: string;
  name: string;
  studentCount: number;
  color: string;
}


export default function AttendancePage() {
  const [departmentStats, setDepartmentStats] = useState<DepartmentStats[]>([]);
  const [loading, setLoading] = useState(true);

  // أقسام الكلية مع الألوان
  const departments = [
    { id: 'anesthesia', name: 'تقنيات التخدير', color: 'blue' },
    { id: 'radiology', name: 'تقنيات الأشعة', color: 'green' },
    { id: 'dental', name: 'تقنيات صناعة الأسنان', color: 'orange' },
    { id: 'construction', name: 'هندسة تقنيات البناء والانشاءات', color: 'purple' },
    { id: 'oil-gas', name: 'تقنيات النفط والغاز', color: 'red' },
    { id: 'health-physics', name: 'تقنيات الفيزياء الصحية', color: 'indigo' },
    { id: 'optics', name: 'تقنيات البصريات', color: 'teal' },
    { id: 'community-health', name: 'تقنيات صحة المجتمع', color: 'pink' },
    { id: 'emergency-medicine', name: 'تقنيات طب الطوارئ', color: 'yellow' },
    { id: 'physical-therapy', name: 'تقنيات العلاج الطبيعي', color: 'cyan' },
    { id: 'cybersecurity', name: 'هندسة تقنيات الامن السيبراني والحوسبة السحابية', color: 'gray' },
    { id: 'law', name: 'القانون', color: 'slate' }
  ];



  // جلب إحصائيات الأقسام
  useEffect(() => {
    const fetchDepartmentStats = async () => {
      try {
        setLoading(true);
        const response = await fetch('/api/departments/stats');
        const data = await response.json();
        
        if (data.success) {
          const stats = data.data.map((dept: { id: string; name: string; total: number }) => ({
            id: dept.id,
            name: dept.name,
            studentCount: dept.total,
            color: departments.find(d => d.id === dept.id)?.color || 'gray'
          }));
          setDepartmentStats(stats);
        }
      } catch (error) {
        console.error('Error fetching department stats:', error);
        // بيانات تجريبية في حالة الخطأ
        setDepartmentStats(departments.map(dept => ({
          ...dept,
          studentCount: Math.floor(Math.random() * 200) + 50
        })));
      } finally {
        setLoading(false);
      }
    };

    fetchDepartmentStats();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <style jsx>{`
        @keyframes slideInFromRight {
          from {
            opacity: 0;
            transform: translateX(100px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
        
        @keyframes slideInFromBottom {
          from {
            opacity: 0;
            transform: translateY(50px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        
        @keyframes pulseGlow {
          0%, 100% {
            box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.4);
          }
          50% {
            box-shadow: 0 0 0 10px rgba(59, 130, 246, 0);
          }
        }
      `}</style>
      <div className="space-y-6">
      {/* عنوان الصفحة */}
      <div className="text-center">
        <h1 className="text-3xl font-bold text-gray-800 mb-2">الحضور والغيابات</h1>
        <p className="text-gray-600">إدارة وتسجيل حضور وغياب الطلبة</p>
      </div>

      {/* أقسام الكلية مع الإحصائيات */}
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800">أقسام الكلية</h2>
        <div className="text-center">
          <div className="text-gray-600 text-sm">
            <span className="text-3xl font-bold text-gray-800">
              {departmentStats.reduce((total, dept) => total + dept.studentCount, 0)}
            </span>
            <span className="mr-2">إجمالي الطلبة المسجلين</span>
          </div>
        </div>
      </div>
      
      {loading ? (
        <div className="flex justify-center items-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <span className="mr-3 text-gray-600">جاري التحميل...</span>
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
          {departmentStats.map((dept) => (
            <div
              key={dept.id}
              onClick={() => window.location.href = `/student-affairs/attendance/${dept.id}`}
              className={`bg-gradient-to-br from-${dept.color}-50 to-${dept.color}-100 rounded-lg p-3 border border-${dept.color}-200/50 hover:shadow-md hover:scale-105 transition-all duration-300 cursor-pointer`}
            >
              <div className="text-center">
                <h3 className={`text-sm font-bold text-${dept.color}-800 mb-2`}>{dept.name}</h3>
                <div className={`text-lg font-bold text-${dept.color}-600`}>{dept.studentCount}</div>
                <div className={`text-xs text-${dept.color}-600`}>طالب مسجل</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* الأقسام الرئيسية */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        
        {/* تسجيل الحضور والغياب اليومي */}
        <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl shadow-lg border border-blue-200/50 p-6 hover:shadow-xl transition-all duration-300 cursor-pointer group">
          <div className="text-center">
            <div className="w-16 h-16 bg-blue-500/20 rounded-xl flex items-center justify-center mx-auto mb-5 group-hover:scale-110 transition-transform duration-300">
              <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-blue-800 mb-3">تسجيل الحضور والغياب اليومي</h2>
            <p className="text-blue-600 text-sm mb-4">تسجيل حضور وغياب الطلبة للجلسات اليومية</p>
            
            {/* معلومات اليوم */}
            <div className="bg-white/60 rounded-lg p-4 border border-blue-200/50 mb-4">
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-blue-700 font-semibold">التاريخ</span>
                  <span className="text-blue-800 font-bold">١٤ يناير ٢٠٢٥</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-blue-700 font-semibold">اليوم</span>
                  <span className="text-blue-800 font-bold">الاثنين</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-blue-700 font-semibold">الفترة</span>
                  <span className="text-blue-800 font-bold">صباحية</span>
                </div>
              </div>
            </div>

            {/* إحصائيات سريعة */}
            <div className="bg-white/60 rounded-lg p-4 border border-blue-200/50 mb-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="text-center">
                  <div className="text-green-600 font-bold text-lg">156</div>
                  <div className="text-blue-600">حاضرون</div>
                </div>
                <div className="text-center">
                  <div className="text-red-600 font-bold text-lg">12</div>
                  <div className="text-blue-600">غائبون</div>
                </div>
              </div>
            </div>
            
            <button className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors duration-300 text-sm">
              تسجيل الحضور
            </button>
          </div>
        </div>

        {/* تقارير الغيابات */}
        <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-xl shadow-lg border border-green-200/50 p-6 hover:shadow-xl transition-all duration-300 cursor-pointer group">
          <div className="text-center">
            <div className="w-16 h-16 bg-green-500/20 rounded-xl flex items-center justify-center mx-auto mb-5 group-hover:scale-110 transition-transform duration-300">
              <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-green-800 mb-3">تقارير الغيابات</h2>
            <p className="text-green-600 text-sm mb-4">تقارير مفصلة حسب المرحلة والمادة والتاريخ</p>
            
            {/* خيارات التقرير */}
            <div className="bg-white/60 rounded-lg p-4 border border-green-200/50 mb-4">
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-green-700 font-semibold">التقرير حسب</span>
                  <select className="text-green-800 bg-white border border-green-200 rounded px-2 py-1 text-sm">
                    <option>المرحلة</option>
                    <option>المادة</option>
                    <option>التاريخ</option>
                    <option>الطالب</option>
                  </select>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-green-700 font-semibold">الفترة</span>
                  <select className="text-green-800 bg-white border border-green-200 rounded px-2 py-1 text-sm">
                    <option>هذا الشهر</option>
                    <option>الشهر الماضي</option>
                    <option>هذا الفصل</option>
                    <option>مخصص</option>
                  </select>
                </div>
              </div>
            </div>

            {/* إحصائيات التقرير */}
            <div className="bg-white/60 rounded-lg p-4 border border-green-200/50 mb-4">
              <div className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-green-700">إجمالي الغيابات</span>
                  <span className="text-green-800 font-bold">234</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-green-700">متوسط الغياب</span>
                  <span className="text-green-800 font-bold">12.5%</span>
                </div>
              </div>
            </div>
            
            <button className="w-full bg-green-600 hover:bg-green-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors duration-300 text-sm">
              عرض التقرير
            </button>
          </div>
        </div>

        {/* إشعارات تنبيه للطلبة كثيري الغياب */}
        <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-xl shadow-lg border border-orange-200/50 p-6 hover:shadow-xl transition-all duration-300 cursor-pointer group">
          <div className="text-center">
            <div className="w-16 h-16 bg-orange-500/20 rounded-xl flex items-center justify-center mx-auto mb-5 group-hover:scale-110 transition-transform duration-300">
              <svg className="w-8 h-8 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <h2 className="text-xl font-bold text-orange-800 mb-3">إشعارات التنبيه</h2>
            <p className="text-orange-600 text-sm mb-4">إشعارات تنبيه للطلبة كثيري الغياب</p>
            
            {/* قائمة الطلبة كثيري الغياب */}
            <div className="bg-white/60 rounded-lg p-4 border border-orange-200/50 mb-4">
              <h3 className="text-sm font-bold text-orange-800 mb-3">طلبة كثيرو الغياب</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between items-center">
                  <span className="text-orange-700">أحمد محمد</span>
                  <span className="text-orange-800 font-bold">15 غياب</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-orange-700">فاطمة علي</span>
                  <span className="text-orange-800 font-bold">12 غياب</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-orange-700">محمد حسن</span>
                  <span className="text-orange-800 font-bold">10 غياب</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-orange-700">سارة أحمد</span>
                  <span className="text-orange-800 font-bold">8 غياب</span>
                </div>
              </div>
            </div>

            {/* خيارات الإشعار */}
            <div className="bg-white/60 rounded-lg p-4 border border-orange-200/50 mb-4">
              <h3 className="text-sm font-bold text-orange-800 mb-3">خيارات الإشعار</h3>
              <div className="space-y-2">
                <label className="flex items-center">
                  <input type="checkbox" className="mr-2" defaultChecked />
                  <span className="text-orange-700 text-sm">إشعار عبر الرسائل النصية</span>
                </label>
                <label className="flex items-center">
                  <input type="checkbox" className="mr-2" />
                  <span className="text-orange-700 text-sm">إشعار عبر الإيميل</span>
                </label>
                <label className="flex items-center">
                  <input type="checkbox" className="mr-2" />
                  <span className="text-orange-700 text-sm">إشعار عبر النظام</span>
                </label>
              </div>
            </div>
            
            <button className="w-full bg-orange-600 hover:bg-orange-700 text-white font-semibold py-2 px-4 rounded-lg transition-colors duration-300 text-sm">
              إرسال الإشعارات
            </button>
          </div>
        </div>
      </div>

      {/* إحصائيات إضافية */}
      <div className="bg-gradient-to-r from-gray-50 to-gray-100 rounded-2xl shadow-lg border border-gray-200/50 p-6">
        <h3 className="text-2xl font-bold text-gray-800 mb-6 text-center">إحصائيات الحضور والغياب</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          <div className="text-center">
            <div className="text-3xl font-bold text-blue-600 mb-2">2,634</div>
            <div className="text-gray-600">طلبة نشطون</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-green-600 mb-2">94.2%</div>
            <div className="text-gray-600">نسبة الحضور</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-orange-600 mb-2">156</div>
            <div className="text-gray-600">طلبة كثيرو الغياب</div>
          </div>
          <div className="text-center">
            <div className="text-3xl font-bold text-red-600 mb-2">5.8%</div>
            <div className="text-gray-600">نسبة الغياب</div>
          </div>
        </div>
      </div>

      </div>
    </>
  );
}
