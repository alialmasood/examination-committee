'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';

interface ExamStats {
  totalExams: number;
  activeExams: number;
  completedExams: number;
  totalStudents: number;
  pendingResults: number;
  approvedResults: number;
}

export default function ExaminationDashboard() {
  const [stats, setStats] = useState<ExamStats>({
    totalExams: 0,
    activeExams: 0,
    completedExams: 0,
    totalStudents: 0,
    pendingResults: 0,
    approvedResults: 0
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // محاكاة جلب البيانات
    setTimeout(() => {
      setStats({
        totalExams: 24,
        activeExams: 8,
        completedExams: 16,
        totalStudents: 1250,
        pendingResults: 45,
        approvedResults: 1200
      });
      setIsLoading(false);
    }, 1000);
  }, []);

  const statCards = [
    {
      title: 'إجمالي الامتحانات',
      value: stats.totalExams,
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
      color: 'bg-blue-500',
      link: '/examinationadministration/exams'
    },
    {
      title: 'الامتحانات النشطة',
      value: stats.activeExams,
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      color: 'bg-green-500',
      link: '/examinationadministration/exams'
    },
    {
      title: 'الامتحانات المكتملة',
      value: stats.completedExams,
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      color: 'bg-purple-500',
      link: '/examinationadministration/exams'
    },
    {
      title: 'إجمالي الطلبة',
      value: stats.totalStudents,
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
        </svg>
      ),
      color: 'bg-indigo-500',
      link: '/examinationadministration/students'
    },
    {
      title: 'النتائج المعلقة',
      value: stats.pendingResults,
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.268 19.5c-.77.833.192 2.5 1.732 2.5z" />
        </svg>
      ),
      color: 'bg-yellow-500',
      link: '/examinationadministration/results'
    },
    {
      title: 'النتائج المعتمدة',
      value: stats.approvedResults,
      icon: (
        <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      color: 'bg-emerald-500',
      link: '/examinationadministration/results'
    }
  ];

  const quickActions = [
    {
      title: 'إنشاء امتحان جديد',
      description: 'إضافة امتحان جديد للفصل الدراسي الحالي',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
        </svg>
      ),
      color: 'bg-blue-600',
      link: '/examinationadministration/exams/new'
    },
    {
      title: 'عرض الطلبة',
      description: 'إدارة بيانات الطلبة المسجلين',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
        </svg>
      ),
      color: 'bg-green-600',
      link: '/examinationadministration/students'
    },
    {
      title: 'إدخال النتائج',
      description: 'إدخال وتعديل نتائج الامتحانات',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
      ),
      color: 'bg-purple-600',
      link: '/examinationadministration/results'
    },
    {
      title: 'تقرير الامتحانات',
      description: 'عرض تقارير مفصلة عن الامتحانات',
      icon: (
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      ),
      color: 'bg-indigo-600',
      link: '/examinationadministration/reports'
    }
  ];

  if (isLoading) {
    return (
      <div className="p-6">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-1/4 mb-6"></div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="bg-white p-6 rounded-lg shadow">
                <div className="h-4 bg-gray-200 rounded w-3/4 mb-4"></div>
                <div className="h-8 bg-gray-200 rounded w-1/2"></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        {statCards.map((card, index) => (
          <Link
            key={index}
            href={card.link}
            className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow"
          >
            <div className="flex items-center">
              <div className={`${card.color} text-white p-3 rounded-lg`}>
                {card.icon}
              </div>
              <div className="mr-4">
                <p className="text-sm font-medium text-gray-600">{card.title}</p>
                <p className="text-2xl font-bold text-gray-900">{card.value}</p>
              </div>
            </div>
          </Link>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="mb-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">الإجراءات السريعة</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {quickActions.map((action, index) => (
            <Link
              key={index}
              href={action.link}
              className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow"
            >
              <div className="flex items-center mb-3">
                <div className={`${action.color} text-white p-2 rounded-lg`}>
                  {action.icon}
                </div>
                <h3 className="text-lg font-medium text-gray-900 mr-3">{action.title}</h3>
              </div>
              <p className="text-sm text-gray-600">{action.description}</p>
            </Link>
          ))}
        </div>
      </div>

      {/* Recent Activity */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-xl font-semibold text-gray-900">النشاط الأخير</h2>
        </div>
        <div className="p-6">
          <div className="space-y-4">
            <div className="flex items-center space-x-3 space-x-reverse">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              <div className="flex-1">
                <p className="text-sm text-gray-900">تم إنشاء امتحان مادة البرمجة المتقدمة</p>
                <p className="text-xs text-gray-500">منذ ساعتين</p>
              </div>
            </div>
            <div className="flex items-center space-x-3 space-x-reverse">
              <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
              <div className="flex-1">
                <p className="text-sm text-gray-900">تم إدخال نتائج 150 طالب في امتحان الرياضيات</p>
                <p className="text-xs text-gray-500">منذ 4 ساعات</p>
              </div>
            </div>
            <div className="flex items-center space-x-3 space-x-reverse">
              <div className="w-2 h-2 bg-yellow-500 rounded-full"></div>
              <div className="flex-1">
                <p className="text-sm text-gray-900">تم تعليق امتحان الفيزياء للاستفسار</p>
                <p className="text-xs text-gray-500">منذ 6 ساعات</p>
              </div>
            </div>
            <div className="flex items-center space-x-3 space-x-reverse">
              <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
              <div className="flex-1">
                <p className="text-sm text-gray-900">تم إنشاء تقرير نتائج الفصل الدراسي الأول</p>
                <p className="text-xs text-gray-500">منذ يوم واحد</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
