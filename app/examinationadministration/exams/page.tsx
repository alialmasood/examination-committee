'use client';

import { useState } from 'react';
import Link from 'next/link';

interface Exam {
  id: string;
  title: string;
  subject: string;
  date: string;
  time: string;
  duration: number;
  status: 'scheduled' | 'active' | 'completed' | 'cancelled';
  studentsCount: number;
  department: string;
  semester: string;
}

export default function ExamsPage() {
  const [exams, setExams] = useState<Exam[]>([
    {
      id: '1',
      title: 'امتحان البرمجة المتقدمة',
      subject: 'البرمجة المتقدمة',
      date: '2025-02-15',
      time: '09:00',
      duration: 120,
      status: 'scheduled',
      studentsCount: 45,
      department: 'علوم الحاسوب',
      semester: 'المرحلة الثانية'
    },
    {
      id: '2',
      title: 'امتحان الرياضيات',
      subject: 'الرياضيات',
      date: '2025-02-18',
      time: '10:30',
      duration: 90,
      status: 'active',
      studentsCount: 60,
      department: 'الرياضيات',
      semester: 'المرحلة الأولى'
    },
    {
      id: '3',
      title: 'امتحان الفيزياء',
      subject: 'الفيزياء',
      date: '2025-02-12',
      time: '14:00',
      duration: 150,
      status: 'completed',
      studentsCount: 38,
      department: 'الفيزياء',
      semester: 'المرحلة الأولى'
    }
  ]);

  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');

  const filteredExams = exams.filter(exam => {
    const matchesStatus = filterStatus === 'all' || exam.status === filterStatus;
    const matchesSearch = exam.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         exam.subject.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         exam.department.toLowerCase().includes(searchTerm.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'scheduled':
        return 'bg-blue-100 text-blue-800';
      case 'active':
        return 'bg-green-100 text-green-800';
      case 'completed':
        return 'bg-gray-100 text-gray-800';
      case 'cancelled':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'scheduled':
        return 'مجدول';
      case 'active':
        return 'نشط';
      case 'completed':
        return 'مكتمل';
      case 'cancelled':
        return 'ملغي';
      default:
        return 'غير محدد';
    }
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-8">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">إدارة الامتحانات</h1>
            <p className="text-gray-600">إدارة جميع الامتحانات والجداول الزمنية</p>
          </div>
          <Link
            href="/examinationadministration/exams/new"
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
          >
            إضافة امتحان جديد
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <div className="flex flex-col sm:flex-row gap-4">
          {/* Search */}
          <div className="flex-1">
            <input
              type="text"
              placeholder="البحث في الامتحانات..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          
          {/* Status Filter */}
          <div className="flex gap-2">
            <button
              onClick={() => setFilterStatus('all')}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${
                filterStatus === 'all'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              جميع الامتحانات
            </button>
            <button
              onClick={() => setFilterStatus('scheduled')}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${
                filterStatus === 'scheduled'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              مجدولة
            </button>
            <button
              onClick={() => setFilterStatus('active')}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${
                filterStatus === 'active'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              نشطة
            </button>
            <button
              onClick={() => setFilterStatus('completed')}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${
                filterStatus === 'completed'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              مكتملة
            </button>
          </div>
        </div>
      </div>

      {/* Exams List */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">قائمة الامتحانات</h2>
        </div>
        
        {filteredExams.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">لا توجد امتحانات</h3>
            <p className="text-gray-600">لم يتم العثور على امتحانات تطابق المعايير المحددة</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {filteredExams.map((exam) => (
              <div key={exam.id} className="p-6 hover:bg-gray-50">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 space-x-reverse mb-2">
                      <h3 className="text-lg font-semibold text-gray-900">{exam.title}</h3>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(exam.status)}`}>
                        {getStatusText(exam.status)}
                      </span>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm text-gray-600">
                      <div>
                        <span className="font-medium">المادة:</span> {exam.subject}
                      </div>
                      <div>
                        <span className="font-medium">التاريخ:</span> {exam.date}
                      </div>
                      <div>
                        <span className="font-medium">الوقت:</span> {exam.time}
                      </div>
                      <div>
                        <span className="font-medium">المدة:</span> {exam.duration} دقيقة
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-gray-600 mt-2">
                      <div>
                        <span className="font-medium">القسم:</span> {exam.department}
                      </div>
                      <div>
                        <span className="font-medium">المرحلة:</span> {exam.semester}
                      </div>
                      <div>
                        <span className="font-medium">عدد الطلبة:</span> {exam.studentsCount}
                      </div>
                    </div>
                  </div>
                  
                  <div className="flex items-center space-x-2 space-x-reverse">
                    <Link
                      href={`/examinationadministration/exams/${exam.id}`}
                      className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                    >
                      عرض التفاصيل
                    </Link>
                    <Link
                      href={`/examinationadministration/exams/${exam.id}/edit`}
                      className="text-green-600 hover:text-green-800 text-sm font-medium"
                    >
                      تعديل
                    </Link>
                    <button className="text-red-600 hover:text-red-800 text-sm font-medium">
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
