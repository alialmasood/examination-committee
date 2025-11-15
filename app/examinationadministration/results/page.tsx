'use client';

import { useState, useEffect } from 'react';

interface Result {
  id: string;
  studentId: string;
  studentName: string;
  examTitle: string;
  subject: string;
  score: number;
  maxScore: number;
  percentage: number;
  grade: string;
  status: 'pending' | 'approved' | 'rejected';
  examDate: string;
  submittedDate: string;
  department: string;
  semester: string;
}

export default function ResultsPage() {
  const [results, setResults] = useState<Result[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterSubject, setFilterSubject] = useState('all');

  useEffect(() => {
    // محاكاة جلب البيانات
    setTimeout(() => {
      setResults([
        {
          id: '1',
          studentId: '2021001',
          studentName: 'أحمد محمد علي',
          examTitle: 'امتحان البرمجة المتقدمة',
          subject: 'البرمجة المتقدمة',
          score: 85,
          maxScore: 100,
          percentage: 85,
          grade: 'B+',
          status: 'approved',
          examDate: '2025-01-15',
          submittedDate: '2025-01-16',
          department: 'علوم الحاسوب',
          semester: 'المرحلة الثانية'
        },
        {
          id: '2',
          studentId: '2021002',
          studentName: 'فاطمة أحمد حسن',
          examTitle: 'امتحان الرياضيات',
          subject: 'الرياضيات',
          score: 92,
          maxScore: 100,
          percentage: 92,
          grade: 'A',
          status: 'approved',
          examDate: '2025-01-18',
          submittedDate: '2025-01-19',
          department: 'الرياضيات',
          semester: 'المرحلة الأولى'
        },
        {
          id: '3',
          studentId: '2021003',
          studentName: 'محمد عبدالله السعيد',
          examTitle: 'امتحان الفيزياء',
          subject: 'الفيزياء',
          score: 78,
          maxScore: 100,
          percentage: 78,
          grade: 'C+',
          status: 'pending',
          examDate: '2025-01-20',
          submittedDate: '2025-01-21',
          department: 'الفيزياء',
          semester: 'المرحلة الثالثة'
        }
      ]);
      setIsLoading(false);
    }, 1000);
  }, []);

  const filteredResults = results.filter(result => {
    const matchesSearch = result.studentName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         result.studentId.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         result.examTitle.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesStatus = filterStatus === 'all' || result.status === filterStatus;
    const matchesSubject = filterSubject === 'all' || result.subject === filterSubject;
    
    return matchesSearch && matchesStatus && matchesSubject;
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending':
        return 'bg-yellow-100 text-yellow-800';
      case 'approved':
        return 'bg-green-100 text-green-800';
      case 'rejected':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'pending':
        return 'معلق';
      case 'approved':
        return 'معتمد';
      case 'rejected':
        return 'مرفوض';
      default:
        return 'غير محدد';
    }
  };

  const getGradeColor = (grade: string) => {
    if (grade.startsWith('A')) return 'text-green-600';
    if (grade.startsWith('B')) return 'text-blue-600';
    if (grade.startsWith('C')) return 'text-yellow-600';
    if (grade.startsWith('D')) return 'text-orange-600';
    return 'text-red-600';
  };

  const subjects = ['all', 'البرمجة المتقدمة', 'الرياضيات', 'الفيزياء', 'الكيمياء', 'الأحياء'];

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-6"></div>
          <div className="space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="bg-white p-6 rounded-lg shadow">
                <div className="h-4 bg-gray-200 rounded w-3/4 mb-4"></div>
                <div className="h-4 bg-gray-200 rounded w-1/2"></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-8">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">إدارة النتائج</h1>
            <p className="text-gray-600">عرض وإدارة نتائج الامتحانات</p>
          </div>
          <button className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors">
            إدخال نتائج جديدة
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <div className="flex items-center">
            <div className="p-2 bg-blue-100 rounded-lg">
              <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div className="mr-3">
              <p className="text-sm font-medium text-gray-600">إجمالي النتائج</p>
              <p className="text-2xl font-bold text-gray-900">{results.length}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <div className="flex items-center">
            <div className="p-2 bg-yellow-100 rounded-lg">
              <svg className="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.268 19.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <div className="mr-3">
              <p className="text-sm font-medium text-gray-600">معلقة</p>
              <p className="text-2xl font-bold text-gray-900">{results.filter(r => r.status === 'pending').length}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <div className="flex items-center">
            <div className="p-2 bg-green-100 rounded-lg">
              <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <div className="mr-3">
              <p className="text-sm font-medium text-gray-600">معتمدة</p>
              <p className="text-2xl font-bold text-gray-900">{results.filter(r => r.status === 'approved').length}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <div className="flex items-center">
            <div className="p-2 bg-purple-100 rounded-lg">
              <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
            <div className="mr-3">
              <p className="text-sm font-medium text-gray-600">متوسط النتائج</p>
              <p className="text-2xl font-bold text-gray-900">
                {Math.round(results.reduce((sum, r) => sum + r.percentage, 0) / results.length)}%
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Search */}
          <div className="md:col-span-2">
            <input
              type="text"
              placeholder="البحث بالاسم أو الرقم الجامعي أو عنوان الامتحان..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          
          {/* Subject Filter */}
          <div>
            <select
              value={filterSubject}
              onChange={(e) => setFilterSubject(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="all">جميع المواد</option>
              {subjects.slice(1).map(subject => (
                <option key={subject} value={subject}>{subject}</option>
              ))}
            </select>
          </div>
          
          {/* Status Filter */}
          <div>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="all">جميع الحالات</option>
              <option value="pending">معلق</option>
              <option value="approved">معتمد</option>
              <option value="rejected">مرفوض</option>
            </select>
          </div>
        </div>
      </div>

      {/* Results List */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">قائمة النتائج ({filteredResults.length})</h2>
        </div>
        
        {filteredResults.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">لا توجد نتائج</h3>
            <p className="text-gray-600">لم يتم العثور على نتائج تطابق المعايير المحددة</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {filteredResults.map((result) => (
              <div key={result.id} className="p-6 hover:bg-gray-50">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 space-x-reverse mb-2">
                      <h3 className="text-lg font-semibold text-gray-900">{result.studentName}</h3>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(result.status)}`}>
                        {getStatusText(result.status)}
                      </span>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm text-gray-600">
                      <div>
                        <span className="font-medium">الرقم الجامعي:</span> {result.studentId}
                      </div>
                      <div>
                        <span className="font-medium">الامتحان:</span> {result.examTitle}
                      </div>
                      <div>
                        <span className="font-medium">المادة:</span> {result.subject}
                      </div>
                      <div>
                        <span className="font-medium">التاريخ:</span> {result.examDate}
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm text-gray-600 mt-2">
                      <div>
                        <span className="font-medium">الدرجة:</span> 
                        <span className={`font-bold ${getGradeColor(result.grade)}`}>
                          {result.score}/{result.maxScore} ({result.percentage}%)
                        </span>
                      </div>
                      <div>
                        <span className="font-medium">التقدير:</span> 
                        <span className={`font-bold ${getGradeColor(result.grade)}`}>
                          {result.grade}
                        </span>
                      </div>
                      <div>
                        <span className="font-medium">القسم:</span> {result.department}
                      </div>
                      <div>
                        <span className="font-medium">المرحلة:</span> {result.semester}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-2 space-x-reverse">
                    <button className="text-blue-600 hover:text-blue-800 text-sm font-medium">
                      عرض التفاصيل
                    </button>
                    <button className="text-green-600 hover:text-green-800 text-sm font-medium">
                      تعديل
                    </button>
                    <button className="text-purple-600 hover:text-purple-800 text-sm font-medium">
                      طباعة
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
