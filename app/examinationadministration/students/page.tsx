'use client';

import { useState, useEffect } from 'react';

interface Student {
  id: string;
  universityId: string;
  fullNameAr: string;
  fullName: string;
  department: string;
  semester: string;
  level: string;
  status: 'active' | 'inactive' | 'suspended';
  email: string;
  phone: string;
  examCount: number;
  lastExamDate: string;
}

export default function StudentsPage() {
  const [students, setStudents] = useState<Student[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDepartment, setFilterDepartment] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');

  useEffect(() => {
    // محاكاة جلب البيانات
    setTimeout(() => {
      setStudents([
        {
          id: '1',
          universityId: '2021001',
          fullNameAr: 'أحمد محمد علي',
          fullName: 'Ahmed Mohammed Ali',
          department: 'علوم الحاسوب',
          semester: 'المرحلة الثانية',
          level: 'bachelor',
          status: 'active',
          email: 'ahmed.ali@student.east.edu',
          phone: '0912345678',
          examCount: 8,
          lastExamDate: '2025-01-15'
        },
        {
          id: '2',
          universityId: '2021002',
          fullNameAr: 'فاطمة أحمد حسن',
          fullName: 'Fatima Ahmed Hassan',
          department: 'الرياضيات',
          semester: 'المرحلة الأولى',
          level: 'bachelor',
          status: 'active',
          email: 'fatima.hassan@student.east.edu',
          phone: '0912345679',
          examCount: 6,
          lastExamDate: '2025-01-18'
        },
        {
          id: '3',
          universityId: '2021003',
          fullNameAr: 'محمد عبدالله السعيد',
          fullName: 'Mohammed Abdullah Al-Saeed',
          department: 'الفيزياء',
          semester: 'المرحلة الثالثة',
          level: 'bachelor',
          status: 'active',
          email: 'mohammed.saeed@student.east.edu',
          phone: '0912345680',
          examCount: 12,
          lastExamDate: '2025-01-20'
        }
      ]);
      setIsLoading(false);
    }, 1000);
  }, []);

  const filteredStudents = students.filter(student => {
    const matchesSearch = student.fullNameAr.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         student.universityId.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         student.email.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesDepartment = filterDepartment === 'all' || student.department === filterDepartment;
    const matchesStatus = filterStatus === 'all' || student.status === filterStatus;
    
    return matchesSearch && matchesDepartment && matchesStatus;
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-100 text-green-800';
      case 'inactive':
        return 'bg-gray-100 text-gray-800';
      case 'suspended':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'active':
        return 'نشط';
      case 'inactive':
        return 'غير نشط';
      case 'suspended':
        return 'معلق';
      default:
        return 'غير محدد';
    }
  };

  const departments = ['all', 'علوم الحاسوب', 'الرياضيات', 'الفيزياء', 'الكيمياء', 'الأحياء'];

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
        <h1 className="text-3xl font-bold text-gray-900 mb-2">إدارة الطلبة</h1>
        <p className="text-gray-600">عرض وإدارة بيانات الطلبة المسجلين في النظام</p>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Search */}
          <div className="md:col-span-2">
            <input
              type="text"
              placeholder="البحث بالاسم أو الرقم الجامعي أو البريد الإلكتروني..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          
          {/* Department Filter */}
          <div>
            <select
              value={filterDepartment}
              onChange={(e) => setFilterDepartment(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="all">جميع الأقسام</option>
              {departments.slice(1).map(dept => (
                <option key={dept} value={dept}>{dept}</option>
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
              <option value="active">نشط</option>
              <option value="inactive">غير نشط</option>
              <option value="suspended">معلق</option>
            </select>
          </div>
        </div>
      </div>

      {/* Students List */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">قائمة الطلبة ({filteredStudents.length})</h2>
        </div>
        
        {filteredStudents.length === 0 ? (
          <div className="text-center py-12">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">لا توجد نتائج</h3>
            <p className="text-gray-600">لم يتم العثور على طلبة يطابقون المعايير المحددة</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-200">
            {filteredStudents.map((student) => (
              <div key={student.id} className="p-6 hover:bg-gray-50">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 space-x-reverse mb-2">
                      <h3 className="text-lg font-semibold text-gray-900">{student.fullNameAr}</h3>
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(student.status)}`}>
                        {getStatusText(student.status)}
                      </span>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm text-gray-600">
                      <div>
                        <span className="font-medium">الرقم الجامعي:</span> {student.universityId}
                      </div>
                      <div>
                        <span className="font-medium">القسم:</span> {student.department}
                      </div>
                      <div>
                        <span className="font-medium">المرحلة:</span> {student.semester}
                      </div>
                      <div>
                        <span className="font-medium">البريد الإلكتروني:</span> {student.email}
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm text-gray-600 mt-2">
                      <div>
                        <span className="font-medium">الهاتف:</span> {student.phone}
                      </div>
                      <div>
                        <span className="font-medium">عدد الامتحانات:</span> {student.examCount}
                      </div>
                      <div>
                        <span className="font-medium">آخر امتحان:</span> {student.lastExamDate}
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
                      سجل الامتحانات
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
