'use client';

import { useState } from 'react';

interface Report {
  id: string;
  title: string;
  description: string;
  type: 'exam' | 'student' | 'department' | 'overall';
  generatedDate: string;
  status: 'ready' | 'generating' | 'error';
  fileSize: string;
  downloadCount: number;
}

export default function ReportsPage() {
  const [reports, setReports] = useState<Report[]>([
    {
      id: '1',
      title: 'تقرير نتائج الفصل الدراسي الأول 2025',
      description: 'تقرير شامل لنتائج جميع الطلبة في الفصل الدراسي الأول',
      type: 'overall',
      generatedDate: '2025-01-25',
      status: 'ready',
      fileSize: '2.5 MB',
      downloadCount: 15
    },
    {
      id: '2',
      title: 'تقرير امتحانات قسم علوم الحاسوب',
      description: 'تقرير مفصل عن امتحانات ونتائج طلبة قسم علوم الحاسوب',
      type: 'department',
      generatedDate: '2025-01-23',
      status: 'ready',
      fileSize: '1.8 MB',
      downloadCount: 8
    },
    {
      id: '3',
      title: 'تقرير الطلبة المتفوقين',
      description: 'قائمة بالطلبة الحاصلين على درجات ممتازة',
      type: 'student',
      generatedDate: '2025-01-20',
      status: 'ready',
      fileSize: '850 KB',
      downloadCount: 12
    },
    {
      id: '4',
      title: 'تقرير امتحان البرمجة المتقدمة',
      description: 'تحليل مفصل لنتائج امتحان البرمجة المتقدمة',
      type: 'exam',
      generatedDate: '2025-01-18',
      status: 'ready',
      fileSize: '1.2 MB',
      downloadCount: 5
    }
  ]);

  const [selectedType, setSelectedType] = useState('all');
  const [isGenerating, setIsGenerating] = useState(false);

  const filteredReports = reports.filter(report => 
    selectedType === 'all' || report.type === selectedType
  );

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'exam':
        return 'bg-blue-100 text-blue-800';
      case 'student':
        return 'bg-green-100 text-green-800';
      case 'department':
        return 'bg-purple-100 text-purple-800';
      case 'overall':
        return 'bg-indigo-100 text-indigo-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getTypeText = (type: string) => {
    switch (type) {
      case 'exam':
        return 'امتحان';
      case 'student':
        return 'طالب';
      case 'department':
        return 'قسم';
      case 'overall':
        return 'شامل';
      default:
        return 'غير محدد';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ready':
        return 'bg-green-100 text-green-800';
      case 'generating':
        return 'bg-yellow-100 text-yellow-800';
      case 'error':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'ready':
        return 'جاهز';
      case 'generating':
        return 'جاري التوليد';
      case 'error':
        return 'خطأ';
      default:
        return 'غير محدد';
    }
  };

  const handleGenerateReport = async (type: string) => {
    setIsGenerating(true);
    
    // محاكاة توليد التقرير
    setTimeout(() => {
      const newReport: Report = {
        id: Date.now().toString(),
        title: `تقرير جديد - ${new Date().toLocaleDateString('ar-SA')}`,
        description: `تقرير تم توليده تلقائياً من نوع ${getTypeText(type)}`,
        type: type as any,
        generatedDate: new Date().toISOString().split('T')[0],
        status: 'ready',
        fileSize: '1.5 MB',
        downloadCount: 0
      };
      
      setReports(prev => [newReport, ...prev]);
      setIsGenerating(false);
    }, 3000);
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">التقارير والإحصائيات</h1>
        <p className="text-gray-600">توليد وعرض التقارير المفصلة عن الامتحانات والنتائج</p>
      </div>

      {/* Quick Generate */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">توليد تقرير سريع</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <button
            onClick={() => handleGenerateReport('overall')}
            disabled={isGenerating}
            className="bg-indigo-600 text-white px-4 py-3 rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            تقرير شامل
          </button>
          <button
            onClick={() => handleGenerateReport('department')}
            disabled={isGenerating}
            className="bg-purple-600 text-white px-4 py-3 rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            تقرير الأقسام
          </button>
          <button
            onClick={() => handleGenerateReport('student')}
            disabled={isGenerating}
            className="bg-green-600 text-white px-4 py-3 rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            تقرير الطلبة
          </button>
          <button
            onClick={() => handleGenerateReport('exam')}
            disabled={isGenerating}
            className="bg-blue-600 text-white px-4 py-3 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            تقرير الامتحانات
          </button>
        </div>
        
        {isGenerating && (
          <div className="mt-4 flex items-center space-x-2 space-x-reverse text-blue-600">
            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600"></div>
            <span className="text-sm">جاري توليد التقرير...</span>
          </div>
        )}
      </div>

      {/* Filter */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex items-center space-x-4 space-x-reverse">
          <label className="text-sm font-medium text-gray-700">نوع التقرير:</label>
          <select
            value={selectedType}
            onChange={(e) => setSelectedType(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="all">جميع الأنواع</option>
            <option value="overall">شامل</option>
            <option value="department">قسم</option>
            <option value="student">طالب</option>
            <option value="exam">امتحان</option>
          </select>
        </div>
      </div>

      {/* Reports List */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">التقارير المتاحة ({filteredReports.length})</h2>
        </div>
        
        {filteredReports.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">لا توجد تقارير</h3>
            <p className="text-gray-600">لم يتم العثور على تقارير تطابق المعايير المحددة</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {filteredReports.map((report) => (
              <div key={report.id} className="p-6 hover:bg-gray-50">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 space-x-reverse mb-2">
                      <h3 className="text-lg font-semibold text-gray-900">{report.title}</h3>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getTypeColor(report.type)}`}>
                        {getTypeText(report.type)}
                      </span>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(report.status)}`}>
                        {getStatusText(report.status)}
                      </span>
                    </div>
                    
                    <p className="text-gray-600 mb-3">{report.description}</p>
                    
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm text-gray-500">
                      <div>
                        <span className="font-medium">تاريخ التوليد:</span> {report.generatedDate}
                      </div>
                      <div>
                        <span className="font-medium">حجم الملف:</span> {report.fileSize}
                      </div>
                      <div>
                        <span className="font-medium">عدد التحميلات:</span> {report.downloadCount}
                      </div>
                      <div>
                        <span className="font-medium">الحالة:</span> {getStatusText(report.status)}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-2 space-x-reverse">
                    {report.status === 'ready' && (
                      <>
                        <button className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
                          تحميل
                        </button>
                        <button className="text-green-600 hover:text-green-800 text-sm font-medium">
                          معاينة
                        </button>
                      </>
                    )}
                    {report.status === 'generating' && (
                      <div className="flex items-center space-x-2 space-x-reverse text-yellow-600">
                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-yellow-600"></div>
                        <span className="text-sm">جاري التوليد...</span>
                      </div>
                    )}
                    {report.status === 'error' && (
                      <button className="text-red-600 hover:text-red-800 text-sm font-medium">
                        إعادة المحاولة
                      </button>
                    )}
                    <button className="text-gray-600 hover:text-gray-800 text-sm font-medium">
                      حذف
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
