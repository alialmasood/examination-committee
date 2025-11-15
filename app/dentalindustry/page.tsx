'use client';

export default function DentalIndustryDashboard() {
  return (
    <div className="p-6">
      <div className="max-w-7xl mx-auto">
        {/* Welcome Section */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
          <div className="text-center">
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              مرحباً بك في نظام اللجنة الامتحانية
            </h2>
            <p className="text-gray-600">
              قسم تقنيات صناعة الأسنان - كلية الشرق للعلوم التقنية التخصصية
            </p>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-6">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="w-8 h-8 bg-blue-100 rounded-md flex items-center justify-center">
                  <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
              </div>
              <div className="mr-3">
                <p className="text-sm font-medium text-gray-500">الامتحانات النشطة</p>
                <p className="text-2xl font-semibold text-gray-900">18</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="w-8 h-8 bg-green-100 rounded-md flex items-center justify-center">
                  <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
                  </svg>
                </div>
              </div>
              <div className="mr-3">
                <p className="text-sm font-medium text-gray-500">إجمالي الطلبة</p>
                <p className="text-2xl font-semibold text-gray-900">312</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="w-8 h-8 bg-yellow-100 rounded-md flex items-center justify-center">
                  <svg className="w-5 h-5 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                </div>
              </div>
              <div className="mr-3">
                <p className="text-sm font-medium text-gray-500">النتائج المعلنة</p>
                <p className="text-2xl font-semibold text-gray-900">14</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <div className="w-8 h-8 bg-purple-100 rounded-md flex items-center justify-center">
                  <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
              </div>
              <div className="mr-3">
                <p className="text-sm font-medium text-gray-500">التقارير المنجزة</p>
                <p className="text-2xl font-semibold text-gray-900">22</p>
              </div>
            </div>
          </div>
        </div>

        {/* Recent Activities */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">الامتحانات القادمة</h3>
            </div>
            <div className="p-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium text-gray-900">امتحان مواد الأسنان</p>
                    <p className="text-sm text-gray-500">المرحلة الأولى - الفصل الأول</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-blue-600">20/12/2024</p>
                    <p className="text-xs text-gray-500">09:00 ص</p>
                  </div>
                </div>
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium text-gray-900">امتحان تقنيات التصنيع</p>
                    <p className="text-sm text-gray-500">المرحلة الثانية - الفصل الأول</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-blue-600">24/12/2024</p>
                    <p className="text-xs text-gray-500">10:00 ص</p>
                  </div>
                </div>
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium text-gray-900">امتحان التشريح السني</p>
                    <p className="text-sm text-gray-500">المرحلة الأولى - الفصل الأول</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-blue-600">27/12/2024</p>
                    <p className="text-xs text-gray-500">11:00 ص</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-medium text-gray-900">إحصائيات سريعة</h3>
            </div>
            <div className="p-6">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-500">نسبة النجاح هذا الفصل</span>
                  <span className="text-sm font-bold text-green-600">91.8%</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-500">متوسط الدرجات</span>
                  <span className="text-sm font-bold text-blue-600">84.2</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-500">أعلى درجة</span>
                  <span className="text-sm font-bold text-purple-600">99.1</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-500">أدنى درجة</span>
                  <span className="text-sm font-bold text-red-600">48.7</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-500">عدد الطلبة المتفوقين</span>
                  <span className="text-sm font-bold text-yellow-600">45</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
