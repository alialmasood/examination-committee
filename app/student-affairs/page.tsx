'use client';

import { useState, useEffect } from 'react';

interface DepartmentStats {
  id: string;
  name: string;
  total: number;
  years: {
    first: number;
    second: number;
    third: number;
    fourth: number;
  };
}

const DEPARTMENTS = [
  { id: 'anesthesia', name: 'تقنيات التخدير', color: 'blue' },
  { id: 'radiology', name: 'تقنيات الأشعة', color: 'green' },
  { id: 'dental', name: 'تقنيات صناعة الأسنان', color: 'orange' },
  { id: 'construction', name: 'هندسة تقنيات البناء والانشاءات', color: 'purple' },
  { id: 'oil-gas', name: 'تقنيات هندسة النفط والغاز', color: 'red' },
  { id: 'health-physics', name: 'تقنيات الفيزياء الصحية', color: 'indigo' },
  { id: 'optics', name: 'تقنيات البصريات', color: 'teal' },
  { id: 'community-health', name: 'تقنيات صحة المجتمع', color: 'pink' },
  { id: 'emergency-medicine', name: 'تقنيات طب الطوارئ', color: 'yellow' },
  { id: 'physical-therapy', name: 'تقنيات العلاج الطبيعي', color: 'cyan' },
  { id: 'cybersecurity', name: 'هندسة تقنيات الامن السيبراني والحوسبة السحابية', color: 'gray' },
  { id: 'law', name: 'القانون', color: 'slate' }
];

export default function StudentAffairsPage() {
  const [totalStudents, setTotalStudents] = useState<number>(0);
  const [activeStudents, setActiveStudents] = useState<number>(0);
  const [firstYearStudents, setFirstYearStudents] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [departmentsStats, setDepartmentsStats] = useState<DepartmentStats[]>([]);
  const [departmentsLoading, setDepartmentsLoading] = useState(true);
  const [academicStatusStats, setAcademicStatusStats] = useState<Record<string, number>>({});
  const [statusLoading, setStatusLoading] = useState(true);
  const [admissionChannelStats, setAdmissionChannelStats] = useState<Record<string, number>>({});
  const [channelsLoading, setChannelsLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const [studentsResponse, departmentsResponse] = await Promise.all([
          fetch('/api/students/stats'),
          fetch('/api/departments/stats')
        ]);
        
        const studentsData = await studentsResponse.json();
        const departmentsData = await departmentsResponse.json();
        
        if (studentsData.success && studentsData.data) {
          setTotalStudents(studentsData.data.total);
          setActiveStudents(studentsData.data.active);
          setFirstYearStudents(studentsData.data.firstYear || 0);
          
          // جلب إحصائيات الحالات الأكاديمية
          if (studentsData.data.academicStatuses) {
            setAcademicStatusStats(studentsData.data.academicStatuses);
          }
          
          // جلب إحصائيات قنوات القبول
          if (studentsData.data.admissionChannels) {
            setAdmissionChannelStats(studentsData.data.admissionChannels);
          }
        }
        
        if (departmentsData.success && departmentsData.data) {
          setDepartmentsStats(departmentsData.data);
        }
      } catch (error) {
        console.error('خطأ في جلب الإحصائيات:', error);
      } finally {
        setLoading(false);
        setDepartmentsLoading(false);
        setStatusLoading(false);
        setChannelsLoading(false);
      }
    };

    fetchStats();
  }, []);

  return (
    <div className="space-y-8">
      {/* إحصائيات الطلبة */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* إجمالي الطلبة */}
        <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-2xl shadow-lg border border-blue-200/50 p-6 hover:shadow-xl transition-all duration-300">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-3xl font-bold text-blue-700">
                {loading ? '...' : totalStudents.toLocaleString()}
              </p>
              <p className="text-blue-600 font-semibold">إجمالي الطلبة</p>
            </div>
            <div className="w-16 h-16 bg-blue-500/20 rounded-2xl flex items-center justify-center">
              <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
              </svg>
            </div>
          </div>
        </div>

        {/* الطلبة النشطون */}
        <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-2xl shadow-lg border border-green-200/50 p-6 hover:shadow-xl transition-all duration-300">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-3xl font-bold text-green-700">
                {loading ? '...' : activeStudents.toLocaleString()}
              </p>
              <p className="text-green-600 font-semibold">طلبة نشطون</p>
            </div>
            <div className="w-16 h-16 bg-green-500/20 rounded-2xl flex items-center justify-center">
              <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
        </div>

                 {/* الطلبة الجدد */}
         <div className="bg-gradient-to-br from-orange-50 to-orange-100 rounded-2xl shadow-lg border border-orange-200/50 p-6 hover:shadow-xl transition-all duration-300">
           <div className="flex items-center justify-between">
             <div>
               <p className="text-3xl font-bold text-orange-700">
                 {loading ? '...' : firstYearStudents.toLocaleString()}
               </p>
               <p className="text-orange-600 font-semibold">طلبة جدد</p>
             </div>
             <div className="w-16 h-16 bg-orange-500/20 rounded-2xl flex items-center justify-center">
               <svg className="w-8 h-8 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
               </svg>
             </div>
           </div>
         </div>

        {/* الطلبة المتخرجون */}
        <div className="bg-gradient-to-br from-purple-50 to-purple-100 rounded-2xl shadow-lg border border-purple-200/50 p-6 hover:shadow-xl transition-all duration-300">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-3xl font-bold text-purple-700">0</p>
              <p className="text-purple-600 font-semibold">متخرجون</p>
            </div>
            <div className="w-16 h-16 bg-purple-500/20 rounded-2xl flex items-center justify-center">
              <svg className="w-8 h-8 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* إحصائيات القبول والنتائج والتخرج */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* معدلات القبول */}
        <div className="bg-white/90 backdrop-blur-lg rounded-2xl shadow-lg border border-white/40 p-6">
          <div className="text-center">
            <div className="w-16 h-16 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-gray-800 mb-2">معدلات القبول</h3>
            <p className="text-3xl font-bold text-blue-600 mb-2">69.5%</p>
            <p className="text-gray-600 text-sm">نسبة القبول للعام الحالي</p>
          </div>
        </div>

        {/* معدلات النجاح */}
        <div className="bg-white/90 backdrop-blur-lg rounded-2xl shadow-lg border border-white/40 p-6">
          <div className="text-center">
            <div className="w-16 h-16 bg-green-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-gray-800 mb-2">معدلات النجاح</h3>
            <p className="text-3xl font-bold text-green-600 mb-2">92.3%</p>
            <p className="text-gray-600 text-sm">نسبة النجاح في الامتحانات</p>
          </div>
        </div>

                 {/* معدلات التخرج */}
         <div className="bg-white/90 backdrop-blur-lg rounded-2xl shadow-lg border border-white/40 p-6">
           <div className="text-center">
             <div className="w-16 h-16 bg-purple-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
               <svg className="w-8 h-8 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
               </svg>
             </div>
             <h3 className="text-xl font-bold text-gray-800 mb-2">معدلات التخرج</h3>
             <p className="text-3xl font-bold text-purple-600 mb-2">0%</p>
             <p className="text-gray-600 text-sm">نسبة التخرج من إجمالي المسجلين</p>
           </div>
         </div>
      </div>

      {/* الأقسام الأكاديمية */}
      <div className="space-y-6">
        <div className="text-center">
          <h2 className="text-3xl font-bold text-gray-800 mb-2">الأقسام الأكاديمية</h2>
          <p className="text-gray-600">إحصائيات مختصرة عن الطلبة في كل قسم</p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {DEPARTMENTS.map((dept) => {
            const stats = departmentsStats.find(s => s.id === dept.id);
            const colorClasses = {
              blue: 'from-blue-50 to-blue-100 border-blue-200/50 bg-blue-500/20 text-blue-600 text-blue-800 text-blue-700',
              green: 'from-green-50 to-green-100 border-green-200/50 bg-green-500/20 text-green-600 text-green-800 text-green-700',
              orange: 'from-orange-50 to-orange-100 border-orange-200/50 bg-orange-500/20 text-orange-600 text-orange-800 text-orange-700',
              purple: 'from-purple-50 to-purple-100 border-purple-200/50 bg-purple-500/20 text-purple-600 text-purple-800 text-purple-700',
              red: 'from-red-50 to-red-100 border-red-200/50 bg-red-500/20 text-red-600 text-red-800 text-red-700',
              indigo: 'from-indigo-50 to-indigo-100 border-indigo-200/50 bg-indigo-500/20 text-indigo-600 text-indigo-800 text-indigo-700',
              teal: 'from-teal-50 to-teal-100 border-teal-200/50 bg-teal-500/20 text-teal-600 text-teal-800 text-teal-700',
              pink: 'from-pink-50 to-pink-100 border-pink-200/50 bg-pink-500/20 text-pink-600 text-pink-800 text-pink-700',
              yellow: 'from-yellow-50 to-yellow-100 border-yellow-200/50 bg-yellow-500/20 text-yellow-600 text-yellow-800 text-yellow-700',
              cyan: 'from-cyan-50 to-cyan-100 border-cyan-200/50 bg-cyan-500/20 text-cyan-600 text-cyan-800 text-cyan-700',
              gray: 'from-gray-50 to-gray-100 border-gray-200/50 bg-gray-500/20 text-gray-600 text-gray-800 text-gray-700',
              slate: 'from-slate-50 to-slate-100 border-slate-200/50 bg-slate-500/20 text-slate-600 text-slate-800 text-slate-700'
            };
            const colors = colorClasses[dept.color as keyof typeof colorClasses].split(' ');
            
            return (
              <div key={dept.id} className={`bg-gradient-to-br ${colors[0]} ${colors[1]} rounded-2xl shadow-lg border ${colors[2]} p-6 hover:shadow-xl transition-all duration-300 cursor-pointer group`}>
                <div className="text-center">
                  <div className={`w-16 h-16 ${colors[3]} rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform duration-300`}>
                    <svg className={`w-8 h-8 ${colors[4]}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                    </svg>
                  </div>
                  <h3 className={`text-lg font-bold ${colors[5]} mb-2`}>{dept.name}</h3>
                  <div className="space-y-1">
                    <div className={`text-2xl font-bold ${colors[6]}`}>
                      {departmentsLoading ? '...' : (stats?.total || 0)}
                    </div>
                    <p className={`${colors[4]} text-xs`}>إجمالي الطلبة</p>
                    <div className={`flex justify-between text-xs ${colors[4]}`}>
                      <span>المرحلة الأولى: {stats?.years.first || 0}</span>
                      <span>المرحلة الثانية: {stats?.years.second || 0}</span>
                    </div>
                    <div className={`flex justify-between text-xs ${colors[4]}`}>
                      <span>المرحلة الثالثة: {stats?.years.third || 0}</span>
                      <span>المرحلة الرابعة: {stats?.years.fourth || 0}</span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* قنوات القبول */}
      <div className="space-y-6">
        <div className="text-center">
          <h2 className="text-3xl font-bold text-gray-800 mb-2">قنوات القبول</h2>
          <p className="text-gray-600">إحصائيات المسجلين حسب قناة القبول</p>
        </div>
        
        <div className="flex flex-wrap gap-3 justify-center">
          {[
            { key: 'general', name: 'القناة العامة' },
            { key: 'martyrs', name: 'قناة ذوي الشهداء' },
            { key: 'social_care', name: 'قناة الرعاية الاجتماعية' },
            { key: 'special_needs', name: 'قناة ذوي الهمم' },
            { key: 'political_prisoners', name: 'قناة السجناء السياسيين' },
            { key: 'top_students', name: 'تخفيض الاوائل' },
            { key: 'siblings_married', name: 'تخفيض الاخوة والمتزوجين' },
            { key: 'health_ministry', name: 'تخفيض موظفي وزارة الصحة' },
            { key: 'minister_directive', name: 'تخفيض توجيهات معالي الوزير' },
            { key: 'dean_approval', name: 'تخفيض موافقة السيد العميد' },
            { key: 'faculty_children', name: 'تخفيض ابناء الهيئة التدريسية' }
          ].map((channel, index) => {
            const count = channelsLoading ? 0 : (admissionChannelStats[channel.key] || 0);
            return (
              <div
                key={index}
                className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-full px-6 py-3 shadow-md border border-indigo-200/50 hover:shadow-lg hover:scale-105 transition-all duration-300 flex items-center gap-3"
              >
                <span className="text-gray-800 font-semibold text-sm whitespace-nowrap">{channel.name}</span>
                <span className="bg-indigo-500 text-white rounded-full px-3 py-1 text-xs font-bold min-w-[2rem] text-center">
                  {channelsLoading ? '...' : count.toLocaleString()}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* حالات الطالب */}
      <div className="space-y-6">
        <div className="text-center">
          <h2 className="text-3xl font-bold text-gray-800 mb-2">حالات الطالب</h2>
          <p className="text-gray-600">إحصائيات الطلبة حسب الحالة الأكاديمية</p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[
            { name: 'مستمر', count: academicStatusStats['مستمر'] || 0, color: 'green' },
            { name: 'مرقن بسبب الغياب', count: academicStatusStats['مرقن بسبب الغياب'] || 0, color: 'orange' },
            { name: 'مرقن بسبب عدم تسليم وثيقة الإعدادية', count: academicStatusStats['مرقن بسبب عدم تسليم وثيقة الإعدادية'] || 0, color: 'orange' },
            { name: 'مرقن بسبب الوفاة', count: academicStatusStats['مرقن بسبب الوفاة'] || 0, color: 'red' },
            { name: 'مرقن بسبب الرسوب سنتين', count: academicStatusStats['مرقن بسبب الرسوب سنتين'] || 0, color: 'orange' },
            { name: 'مرقن بسبب الرسوب بمواد التحميل', count: academicStatusStats['مرقن بسبب الرسوب بمواد التحميل'] || 0, color: 'orange' },
            { name: 'راسب بسبب الغياب', count: academicStatusStats['راسب بسبب الغياب'] || 0, color: 'red' },
            { name: 'راسب بسبب عقوبة انضباطية', count: academicStatusStats['راسب بسبب عقوبة انضباطية'] || 0, color: 'red' },
            { name: 'راسب بالمواد الدراسية', count: academicStatusStats['راسب بالمواد الدراسية'] || 0, color: 'red' },
            { name: 'محمل من المرحلة السابقة', count: academicStatusStats['محمل من المرحلة السابقة'] || 0, color: 'yellow' },
            { name: 'مؤجّل', count: academicStatusStats['مؤجّل'] || 0, color: 'blue' },
            { name: 'حالات أخرى', count: academicStatusStats['حالات أخرى'] || 0, color: 'gray' }
          ].map((status, index) => {
            const colorClasses = {
              green: 'from-green-50 to-green-100 border-green-200/50 text-green-700 bg-green-500/20',
              orange: 'from-orange-50 to-orange-100 border-orange-200/50 text-orange-700 bg-orange-500/20',
              red: 'from-red-50 to-red-100 border-red-200/50 text-red-700 bg-red-500/20',
              yellow: 'from-yellow-50 to-yellow-100 border-yellow-200/50 text-yellow-700 bg-yellow-500/20',
              blue: 'from-blue-50 to-blue-100 border-blue-200/50 text-blue-700 bg-blue-500/20',
              gray: 'from-gray-50 to-gray-100 border-gray-200/50 text-gray-700 bg-gray-500/20'
            };
            const colors = colorClasses[status.color as keyof typeof colorClasses].split(' ');
            
            return (
              <div
                key={index}
                className={`bg-gradient-to-br ${colors[0]} ${colors[1]} rounded-xl shadow-md border ${colors[2]} p-4 hover:shadow-lg transition-all duration-300`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className={`w-10 h-10 ${colors[4]} rounded-lg flex items-center justify-center`}>
                    <svg className={`w-5 h-5 ${colors[3]}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  </div>
                  <span className={`text-2xl font-bold ${colors[3]}`}>
                    {statusLoading ? '...' : status.count.toLocaleString()}
                  </span>
                </div>
                <p className={`text-sm font-semibold ${colors[3]} line-clamp-2`}>
                  {status.name}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* بطاقات مختصرة لأهم الأقسام */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                   {/* التسجيل والقبول */}
          <div className="bg-gradient-to-br from-blue-50 to-indigo-100 rounded-2xl shadow-lg border border-blue-200/50 p-6 hover:shadow-xl transition-all duration-300 cursor-pointer group">
            <div className="text-center">
              <div className="w-16 h-16 bg-blue-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform duration-300">
                <svg className="w-8 h-8 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
                </svg>
              </div>
              <h3 className="text-xl font-bold text-blue-800 mb-2">التسجيل والقبول</h3>
              <p className="text-blue-600 text-sm mb-3">إدارة عمليات التسجيل والقبول</p>
              <div className="text-2xl font-bold text-blue-700">
                {loading ? '...' : firstYearStudents.toLocaleString()}
              </div>
              <p className="text-blue-600 text-xs">طلبة جدد</p>
            </div>
          </div>

        {/* النتائج والدرجات */}
        <div className="bg-gradient-to-br from-green-50 to-emerald-100 rounded-2xl shadow-lg border border-green-200/50 p-6 hover:shadow-xl transition-all duration-300 cursor-pointer group">
          <div className="text-center">
            <div className="w-16 h-16 bg-green-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform duration-300">
              <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
              </svg>
            </div>
            <h3 className="text-xl font-bold text-green-800 mb-2">النتائج والدرجات</h3>
            <p className="text-green-600 text-sm mb-3">إدارة الدرجات والنتائج</p>
            <div className="text-2xl font-bold text-green-700">92.3%</div>
            <p className="text-green-600 text-xs">معدل النجاح</p>
          </div>
        </div>

                 {/* الوثائق والشهادات */}
         <div className="bg-gradient-to-br from-purple-50 to-violet-100 rounded-2xl shadow-lg border border-purple-200/50 p-6 hover:shadow-xl transition-all duration-300 cursor-pointer group">
           <div className="text-center">
             <div className="w-16 h-16 bg-purple-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform duration-300">
               <svg className="w-8 h-8 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
               </svg>
             </div>
             <h3 className="text-xl font-bold text-purple-800 mb-2">الوثائق والشهادات</h3>
             <p className="text-purple-600 text-sm mb-3">إصدار وإدارة الوثائق</p>
             <div className="text-2xl font-bold text-purple-700">0</div>
             <p className="text-purple-600 text-xs">شهادة صادرة</p>
           </div>
         </div>
      </div>
    </div>
  );
}