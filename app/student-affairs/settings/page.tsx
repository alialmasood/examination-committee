'use client';

import { useState } from 'react';

interface Department {
  id: string;
  name: string;
  nameEn: string;
  code: string;
  description: string;
  isActive: boolean;
  createdAt: string;
}

interface StudyLevel {
  id: string;
  name: string;
  nameEn: string;
  code: string;
  duration: number;
  description: string;
  isActive: boolean;
  createdAt: string;
}

interface Subject {
  id: string;
  name: string;
  nameEn: string;
  code: string;
  credits: number;
  department: string;
  level: string;
  description: string;
  isActive: boolean;
  createdAt: string;
}

interface AcademicYear {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  semesters: Array<{
    name: string;
    startDate: string;
    endDate: string;
    isActive: boolean;
  }>;
  createdAt: string;
}

interface PrintSettings {
  logo: string;
  headerText: string;
  footerText: string;
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  margins: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  };
  colors: {
    primary: string;
    secondary: string;
    text: string;
  };
  watermark: {
    enabled: boolean;
    text: string;
    opacity: number;
  };
}

interface BackupSettings {
  autoBackup: boolean;
  backupFrequency: 'daily' | 'weekly' | 'monthly';
  backupTime: string;
  retentionDays: number;
  includeFiles: boolean;
  includeDatabase: boolean;
  backupLocation: string;
  emailNotification: boolean;
  lastBackup: string;
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<'departments' | 'subjects' | 'academic-year' | 'print' | 'backup'>('departments');
  const [showDepartmentForm, setShowDepartmentForm] = useState(false);
  const [showLevelForm, setShowLevelForm] = useState(false);
  const [showSubjectForm, setShowSubjectForm] = useState(false);
  const [showYearForm, setShowYearForm] = useState(false);
  const [showPrintForm, setShowPrintForm] = useState(false);
  const [showBackupForm, setShowBackupForm] = useState(false);
  
  const [departmentData, setDepartmentData] = useState<Department>({
    id: '',
    name: '',
    nameEn: '',
    code: '',
    description: '',
    isActive: true,
    createdAt: new Date().toISOString().split('T')[0]
  });

  const [levelData, setLevelData] = useState<StudyLevel>({
    id: '',
    name: '',
    nameEn: '',
    code: '',
    duration: 4,
    description: '',
    isActive: true,
    createdAt: new Date().toISOString().split('T')[0]
  });

  const [subjectData, setSubjectData] = useState<Subject>({
    id: '',
    name: '',
    nameEn: '',
    code: '',
    credits: 3,
    department: '',
    level: '',
    description: '',
    isActive: true,
    createdAt: new Date().toISOString().split('T')[0]
  });

  const [yearData, setYearData] = useState<AcademicYear>({
    id: '',
    name: '',
    startDate: '',
    endDate: '',
    isCurrent: false,
    semesters: [],
    createdAt: new Date().toISOString().split('T')[0]
  });

  const [printData, setPrintData] = useState<PrintSettings>({
    logo: '',
    headerText: '',
    footerText: '',
    fontFamily: 'Arial',
    fontSize: 12,
    lineHeight: 1.5,
    margins: {
      top: 2.5,
      bottom: 2.5,
      left: 2.5,
      right: 2.5
    },
    colors: {
      primary: '#1f2937',
      secondary: '#6b7280',
      text: '#000000'
    },
    watermark: {
      enabled: false,
      text: '',
      opacity: 0.1
    }
  });

  const [backupData, setBackupData] = useState<BackupSettings>({
    autoBackup: true,
    backupFrequency: 'daily',
    backupTime: '02:00',
    retentionDays: 30,
    includeFiles: true,
    includeDatabase: true,
    backupLocation: '/backups',
    emailNotification: true,
    lastBackup: ''
  });

  const [departments] = useState<Department[]>([
    {
      id: '1',
      name: 'قسم علوم الحاسب',
      nameEn: 'Computer Science Department',
      code: 'CS',
      description: 'قسم متخصص في علوم الحاسب وتقنية المعلومات',
      isActive: true,
      createdAt: '2024-01-01'
    },
    {
      id: '2',
      name: 'قسم الهندسة',
      nameEn: 'Engineering Department',
      code: 'ENG',
      description: 'قسم متخصص في الهندسة والتكنولوجيا',
      isActive: true,
      createdAt: '2024-01-01'
    }
  ]);

  const [levels] = useState<StudyLevel[]>([
    {
      id: '1',
      name: 'البكالوريوس',
      nameEn: 'Bachelor',
      code: 'BSC',
      duration: 4,
      description: 'درجة البكالوريوس في التخصص',
      isActive: true,
      createdAt: '2024-01-01'
    },
    {
      id: '2',
      name: 'الماجستير',
      nameEn: 'Master',
      code: 'MSC',
      duration: 2,
      description: 'درجة الماجستير في التخصص',
      isActive: true,
      createdAt: '2024-01-01'
    }
  ]);

  const [subjects] = useState<Subject[]>([
    {
      id: '1',
      name: 'برمجة الحاسب',
      nameEn: 'Computer Programming',
      code: 'CS101',
      credits: 3,
      department: 'CS',
      level: 'BSC',
      description: 'مقدمة في برمجة الحاسب',
      isActive: true,
      createdAt: '2024-01-01'
    },
    {
      id: '2',
      name: 'هياكل البيانات',
      nameEn: 'Data Structures',
      code: 'CS201',
      credits: 3,
      department: 'CS',
      level: 'BSC',
      description: 'دراسة هياكل البيانات والخوارزميات',
      isActive: true,
      createdAt: '2024-01-01'
    }
  ]);

  const handleDepartmentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('قسم جديد:', departmentData);
    alert('تم إضافة القسم بنجاح!');
    setShowDepartmentForm(false);
    setDepartmentData({
      id: '',
      name: '',
      nameEn: '',
      code: '',
      description: '',
      isActive: true,
      createdAt: new Date().toISOString().split('T')[0]
    });
  };

  const handleLevelSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('مرحلة جديدة:', levelData);
    alert('تم إضافة المرحلة بنجاح!');
    setShowLevelForm(false);
    setLevelData({
      id: '',
      name: '',
      nameEn: '',
      code: '',
      duration: 4,
      description: '',
      isActive: true,
      createdAt: new Date().toISOString().split('T')[0]
    });
  };

  const handleSubjectSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('مادة جديدة:', subjectData);
    alert('تم إضافة المادة بنجاح!');
    setShowSubjectForm(false);
    setSubjectData({
      id: '',
      name: '',
      nameEn: '',
      code: '',
      credits: 3,
      department: '',
      level: '',
      description: '',
      isActive: true,
      createdAt: new Date().toISOString().split('T')[0]
    });
  };

  const handleYearSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('سنة أكاديمية جديدة:', yearData);
    alert('تم إضافة السنة الأكاديمية بنجاح!');
    setShowYearForm(false);
    setYearData({
      id: '',
      name: '',
      startDate: '',
      endDate: '',
      isCurrent: false,
      semesters: [],
      createdAt: new Date().toISOString().split('T')[0]
    });
  };

  const handlePrintSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('إعدادات الطباعة:', printData);
    alert('تم حفظ إعدادات الطباعة بنجاح!');
    setShowPrintForm(false);
  };

  const handleBackupSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('إعدادات النسخ الاحتياطي:', backupData);
    alert('تم حفظ إعدادات النسخ الاحتياطي بنجاح!');
    setShowBackupForm(false);
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    if (type === 'checkbox') {
      const checked = (e.target as HTMLInputElement).checked;
      setDepartmentData(prev => ({
        ...prev,
        [name]: checked
      }));
    } else {
      setDepartmentData(prev => ({
        ...prev,
        [name]: value
      }));
    }
  };

  const handleLevelInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    if (type === 'checkbox') {
      const checked = (e.target as HTMLInputElement).checked;
      setLevelData(prev => ({
        ...prev,
        [name]: checked
      }));
    } else {
      setLevelData(prev => ({
        ...prev,
        [name]: value
      }));
    }
  };

  const handleSubjectInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    if (type === 'checkbox') {
      const checked = (e.target as HTMLInputElement).checked;
      setSubjectData(prev => ({
        ...prev,
        [name]: checked
      }));
    } else {
      setSubjectData(prev => ({
        ...prev,
        [name]: value
      }));
    }
  };

  const handleYearInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    if (type === 'checkbox') {
      const checked = (e.target as HTMLInputElement).checked;
      setYearData(prev => ({
        ...prev,
        [name]: checked
      }));
    } else {
      setYearData(prev => ({
        ...prev,
        [name]: value
      }));
    }
  };

  const handlePrintInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    if (type === 'checkbox') {
      const checked = (e.target as HTMLInputElement).checked;
      if (name.startsWith('margins.')) {
        const field = name.split('.')[1];
        setPrintData(prev => ({
          ...prev,
          margins: {
            ...prev.margins,
            [field]: parseFloat(value)
          }
        }));
      } else if (name.startsWith('colors.')) {
        const field = name.split('.')[1];
        setPrintData(prev => ({
          ...prev,
          colors: {
            ...prev.colors,
            [field]: value
          }
        }));
      } else if (name.startsWith('watermark.')) {
        const field = name.split('.')[1];
        setPrintData(prev => ({
          ...prev,
          watermark: {
            ...prev.watermark,
            [field]: field === 'enabled' ? checked : value
          }
        }));
      } else {
        setPrintData(prev => ({
          ...prev,
          [name]: checked
        }));
      }
    } else {
      setPrintData(prev => ({
        ...prev,
        [name]: type === 'number' ? parseFloat(value) : value
      }));
    }
  };

  const handleBackupInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value, type } = e.target;
    if (type === 'checkbox') {
      const checked = (e.target as HTMLInputElement).checked;
      setBackupData(prev => ({
        ...prev,
        [name]: checked
      }));
    } else {
      setBackupData(prev => ({
        ...prev,
        [name]: value
      }));
    }
  };

  const addSemester = () => {
    setYearData(prev => ({
      ...prev,
      semesters: [...prev.semesters, {
        name: '',
        startDate: '',
        endDate: '',
        isActive: false
      }]
    }));
  };

  const removeSemester = (index: number) => {
    setYearData(prev => ({
      ...prev,
      semesters: prev.semesters.filter((_, i) => i !== index)
    }));
  };

  const updateSemester = (index: number, field: string, value: string | boolean) => {
    setYearData(prev => ({
      ...prev,
      semesters: prev.semesters.map((semester, i) => 
        i === index ? { ...semester, [field]: value } : semester
      )
    }));
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-gray-50 to-zinc-50">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">
            الإعدادات العامة
          </h1>
          <p className="text-gray-600">
            إدارة إعدادات النظام العامة والأقسام والمواد الدراسية
          </p>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-lg shadow-lg mb-6">
          <div className="border-b border-gray-200">
            <nav className="flex flex-wrap space-x-8 space-x-reverse px-6">
              <button
                onClick={() => setActiveTab('departments')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'departments'
                    ? 'border-slate-500 text-slate-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                الأقسام والمراحل
              </button>
              <button
                onClick={() => setActiveTab('subjects')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'subjects'
                    ? 'border-slate-500 text-slate-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                المواد الدراسية
              </button>
              <button
                onClick={() => setActiveTab('academic-year')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'academic-year'
                    ? 'border-slate-500 text-slate-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                السنة الدراسية
              </button>
              <button
                onClick={() => setActiveTab('print')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'print'
                    ? 'border-slate-500 text-slate-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                إعدادات الطباعة
              </button>
              <button
                onClick={() => setActiveTab('backup')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'backup'
                    ? 'border-slate-500 text-slate-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                النسخ الاحتياطي
              </button>
            </nav>
          </div>
        </div>

        {/* Content based on active tab */}
        {activeTab === 'departments' && (
          <div className="space-y-6">
            {/* Departments Section */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-semibold text-gray-800">
                  إدارة الأقسام
                </h2>
                <button
                  onClick={() => setShowDepartmentForm(!showDepartmentForm)}
                  className="bg-slate-600 hover:bg-slate-700 text-white px-4 py-2 rounded-lg transition-colors duration-200"
                >
                  {showDepartmentForm ? 'إلغاء' : 'إضافة قسم جديد'}
                </button>
              </div>

              {showDepartmentForm && (
                <form onSubmit={handleDepartmentSubmit} className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        اسم القسم (عربي)
                      </label>
                      <input
                        type="text"
                        name="name"
                        value={departmentData.name}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-slate-500 focus:border-slate-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        اسم القسم (إنجليزي)
                      </label>
                      <input
                        type="text"
                        name="nameEn"
                        value={departmentData.nameEn}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-slate-500 focus:border-slate-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        رمز القسم
                      </label>
                      <input
                        type="text"
                        name="code"
                        value={departmentData.code}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-slate-500 focus:border-slate-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        تاريخ الإنشاء
                      </label>
                      <input
                        type="date"
                        name="createdAt"
                        value={departmentData.createdAt}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-slate-500 focus:border-slate-500"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      وصف القسم
                    </label>
                    <textarea
                      name="description"
                      value={departmentData.description}
                      onChange={handleInputChange}
                      rows={3}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-slate-500 focus:border-slate-500"
                      required
                    />
                  </div>

                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      name="isActive"
                      checked={departmentData.isActive}
                      onChange={handleInputChange}
                      className="h-4 w-4 text-slate-600 focus:ring-slate-500 border-gray-300 rounded"
                    />
                    <label className="mr-2 block text-sm text-gray-700">
                      القسم نشط
                    </label>
                  </div>

                  <div className="flex justify-end space-x-4 space-x-reverse pt-6 border-t">
                    <button
                      type="button"
                      onClick={() => setShowDepartmentForm(false)}
                      className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors duration-200"
                    >
                      إلغاء
                    </button>
                    <button
                      type="submit"
                      className="px-6 py-2 bg-slate-600 text-white rounded-lg hover:bg-slate-700 transition-colors duration-200"
                    >
                      إضافة القسم
                    </button>
                  </div>
                </form>
              )}

              {/* Departments List */}
              <div className="mt-6">
                <h3 className="text-lg font-medium text-gray-800 mb-4">قائمة الأقسام</h3>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                          اسم القسم
                        </th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                          الرمز
                        </th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                          الحالة
                        </th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                          الإجراءات
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {departments.map((dept) => (
                        <tr key={dept.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div>
                              <div className="text-sm font-medium text-gray-900">{dept.name}</div>
                              <div className="text-sm text-gray-500">{dept.nameEn}</div>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {dept.code}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                              dept.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                            }`}>
                              {dept.isActive ? 'نشط' : 'غير نشط'}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                            <button className="text-slate-600 hover:text-slate-900 mr-4">تعديل</button>
                            <button className="text-red-600 hover:text-red-900">حذف</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Study Levels Section */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-xl font-semibold text-gray-800">
                  إدارة المراحل الدراسية
                </h2>
                <button
                  onClick={() => setShowLevelForm(!showLevelForm)}
                  className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg transition-colors duration-200"
                >
                  {showLevelForm ? 'إلغاء' : 'إضافة مرحلة جديدة'}
                </button>
              </div>

              {showLevelForm && (
                <form onSubmit={handleLevelSubmit} className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        اسم المرحلة (عربي)
                      </label>
                      <input
                        type="text"
                        name="name"
                        value={levelData.name}
                        onChange={handleLevelInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-500 focus:border-gray-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        اسم المرحلة (إنجليزي)
                      </label>
                      <input
                        type="text"
                        name="nameEn"
                        value={levelData.nameEn}
                        onChange={handleLevelInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-500 focus:border-gray-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        رمز المرحلة
                      </label>
                      <input
                        type="text"
                        name="code"
                        value={levelData.code}
                        onChange={handleLevelInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-500 focus:border-gray-500"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        مدة الدراسة (سنوات)
                      </label>
                      <input
                        type="number"
                        name="duration"
                        value={levelData.duration}
                        onChange={handleLevelInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-500 focus:border-gray-500"
                        min="1"
                        max="10"
                        required
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      وصف المرحلة
                    </label>
                    <textarea
                      name="description"
                      value={levelData.description}
                      onChange={handleLevelInputChange}
                      rows={3}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-500 focus:border-gray-500"
                      required
                    />
                  </div>

                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      name="isActive"
                      checked={levelData.isActive}
                      onChange={handleLevelInputChange}
                      className="h-4 w-4 text-gray-600 focus:ring-gray-500 border-gray-300 rounded"
                    />
                    <label className="mr-2 block text-sm text-gray-700">
                      المرحلة نشطة
                    </label>
                  </div>

                  <div className="flex justify-end space-x-4 space-x-reverse pt-6 border-t">
                    <button
                      type="button"
                      onClick={() => setShowLevelForm(false)}
                      className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors duration-200"
                    >
                      إلغاء
                    </button>
                    <button
                      type="submit"
                      className="px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors duration-200"
                    >
                      إضافة المرحلة
                    </button>
                  </div>
                </form>
              )}

              {/* Levels List */}
              <div className="mt-6">
                <h3 className="text-lg font-medium text-gray-800 mb-4">قائمة المراحل</h3>
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                          اسم المرحلة
                        </th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                          الرمز
                        </th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                          المدة
                        </th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                          الحالة
                        </th>
                        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                          الإجراءات
                        </th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {levels.map((level) => (
                        <tr key={level.id} className="hover:bg-gray-50">
                          <td className="px-6 py-4 whitespace-nowrap">
                            <div>
                              <div className="text-sm font-medium text-gray-900">{level.name}</div>
                              <div className="text-sm text-gray-500">{level.nameEn}</div>
                            </div>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {level.code}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                            {level.duration} سنوات
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                              level.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                            }`}>
                              {level.isActive ? 'نشط' : 'غير نشط'}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                            <button className="text-gray-600 hover:text-gray-900 mr-4">تعديل</button>
                            <button className="text-red-600 hover:text-red-900">حذف</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'subjects' && (
          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold text-gray-800">
                إدارة المواد الدراسية
              </h2>
              <button
                onClick={() => setShowSubjectForm(!showSubjectForm)}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors duration-200"
              >
                {showSubjectForm ? 'إلغاء' : 'إضافة مادة جديدة'}
              </button>
            </div>

            {showSubjectForm && (
              <form onSubmit={handleSubjectSubmit} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      اسم المادة (عربي)
                    </label>
                    <input
                      type="text"
                      name="name"
                      value={subjectData.name}
                      onChange={handleSubjectInputChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      اسم المادة (إنجليزي)
                    </label>
                    <input
                      type="text"
                      name="nameEn"
                      value={subjectData.nameEn}
                      onChange={handleSubjectInputChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      رمز المادة
                    </label>
                    <input
                      type="text"
                      name="code"
                      value={subjectData.code}
                      onChange={handleSubjectInputChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      عدد الساعات المعتمدة
                    </label>
                    <input
                      type="number"
                      name="credits"
                      value={subjectData.credits}
                      onChange={handleSubjectInputChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      min="1"
                      max="10"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      القسم
                    </label>
                    <select
                      name="department"
                      value={subjectData.department}
                      onChange={handleSubjectInputChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      required
                    >
                      <option value="">اختر القسم</option>
                      <option value="CS">قسم علوم الحاسب</option>
                      <option value="ENG">قسم الهندسة</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      المرحلة الدراسية
                    </label>
                    <select
                      name="level"
                      value={subjectData.level}
                      onChange={handleSubjectInputChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      required
                    >
                      <option value="">اختر المرحلة</option>
                      <option value="BSC">البكالوريوس</option>
                      <option value="MSC">الماجستير</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    وصف المادة
                  </label>
                  <textarea
                    name="description"
                    value={subjectData.description}
                    onChange={handleSubjectInputChange}
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    required
                  />
                </div>

                <div className="flex items-center">
                  <input
                    type="checkbox"
                    name="isActive"
                    checked={subjectData.isActive}
                    onChange={handleSubjectInputChange}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <label className="mr-2 block text-sm text-gray-700">
                    المادة نشطة
                  </label>
                </div>

                <div className="flex justify-end space-x-4 space-x-reverse pt-6 border-t">
                  <button
                    type="button"
                    onClick={() => setShowSubjectForm(false)}
                    className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors duration-200"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors duration-200"
                  >
                    إضافة المادة
                  </button>
                </div>
              </form>
            )}

            {/* Subjects List */}
            <div className="mt-6">
              <h3 className="text-lg font-medium text-gray-800 mb-4">قائمة المواد</h3>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        اسم المادة
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        الرمز
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        الساعات
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        القسم
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        المرحلة
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        الحالة
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        الإجراءات
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {subjects.map((subject) => (
                      <tr key={subject.id} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div>
                            <div className="text-sm font-medium text-gray-900">{subject.name}</div>
                            <div className="text-sm text-gray-500">{subject.nameEn}</div>
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {subject.code}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {subject.credits}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {subject.department}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {subject.level}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                            subject.isActive ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                          }`}>
                            {subject.isActive ? 'نشط' : 'غير نشط'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                          <button className="text-blue-600 hover:text-blue-900 mr-4">تعديل</button>
                          <button className="text-red-600 hover:text-red-900">حذف</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'academic-year' && (
          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold text-gray-800">
                إعداد السنة الدراسية الحالية
              </h2>
              <button
                onClick={() => setShowYearForm(!showYearForm)}
                className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg transition-colors duration-200"
              >
                {showYearForm ? 'إلغاء' : 'إضافة سنة أكاديمية'}
              </button>
            </div>

            {showYearForm && (
              <form onSubmit={handleYearSubmit} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      اسم السنة الأكاديمية
                    </label>
                    <input
                      type="text"
                      name="name"
                      value={yearData.name}
                      onChange={handleYearInputChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                      placeholder="مثال: 2024/2025"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      تاريخ البداية
                    </label>
                    <input
                      type="date"
                      name="startDate"
                      value={yearData.startDate}
                      onChange={handleYearInputChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                      required
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      تاريخ النهاية
                    </label>
                    <input
                      type="date"
                      name="endDate"
                      value={yearData.endDate}
                      onChange={handleYearInputChange}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                      required
                    />
                  </div>

                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      name="isCurrent"
                      checked={yearData.isCurrent}
                      onChange={handleYearInputChange}
                      className="h-4 w-4 text-green-600 focus:ring-green-500 border-gray-300 rounded"
                    />
                    <label className="mr-2 block text-sm text-gray-700">
                      السنة الحالية
                    </label>
                  </div>
                </div>

                {/* Semesters */}
                <div>
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg font-medium text-gray-800">
                      الفصول الدراسية
                    </h3>
                    <button
                      type="button"
                      onClick={addSemester}
                      className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg transition-colors duration-200"
                    >
                      إضافة فصل
                    </button>
                  </div>

                  {yearData.semesters.map((semester, index) => (
                    <div key={index} className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4 p-4 border border-gray-200 rounded-lg">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          اسم الفصل
                        </label>
                        <input
                          type="text"
                          value={semester.name}
                          onChange={(e) => updateSemester(index, 'name', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                          placeholder="مثال: الفصل الأول"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          تاريخ البداية
                        </label>
                        <input
                          type="date"
                          value={semester.startDate}
                          onChange={(e) => updateSemester(index, 'startDate', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                          required
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          تاريخ النهاية
                        </label>
                        <input
                          type="date"
                          value={semester.endDate}
                          onChange={(e) => updateSemester(index, 'endDate', e.target.value)}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                          required
                        />
                      </div>
                      <div className="flex items-end">
                        <button
                          type="button"
                          onClick={() => removeSemester(index)}
                          className="w-full bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg transition-colors duration-200"
                        >
                          حذف
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex justify-end space-x-4 space-x-reverse pt-6 border-t">
                  <button
                    type="button"
                    onClick={() => setShowYearForm(false)}
                    className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors duration-200"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors duration-200"
                  >
                    إضافة السنة
                  </button>
                </div>
              </form>
            )}

            {!showYearForm && (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-gray-800 mb-2">
                  إعداد السنة الدراسية
                </h3>
                <p className="text-gray-600 mb-6">
                  اضغط على &quot;إضافة سنة أكاديمية&quot; لبدء عملية إعداد السنة الدراسية الجديدة
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'print' && (
          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold text-gray-800">
                إعدادات الطباعة والهوية البصرية
              </h2>
              <button
                onClick={() => setShowPrintForm(!showPrintForm)}
                className="bg-orange-600 hover:bg-orange-700 text-white px-4 py-2 rounded-lg transition-colors duration-200"
              >
                {showPrintForm ? 'إلغاء' : 'تعديل الإعدادات'}
              </button>
            </div>

            {showPrintForm && (
              <form onSubmit={handlePrintSubmit} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* الهوية البصرية */}
                  <div className="space-y-4">
                    <h3 className="text-lg font-medium text-gray-800 border-b pb-2">
                      الهوية البصرية
                    </h3>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        الشعار
                      </label>
                      <input
                        type="file"
                        name="logo"
                        accept="image/*"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        نص الرأس
                      </label>
                      <input
                        type="text"
                        name="headerText"
                        value={printData.headerText}
                        onChange={handlePrintInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                        placeholder="مثال: جامعة الملك سعود"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        نص التذييل
                      </label>
                      <input
                        type="text"
                        name="footerText"
                        value={printData.footerText}
                        onChange={handlePrintInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                        placeholder="مثال: جميع الحقوق محفوظة"
                      />
                    </div>
                  </div>

                  {/* إعدادات الخط */}
                  <div className="space-y-4">
                    <h3 className="text-lg font-medium text-gray-800 border-b pb-2">
                      إعدادات الخط
                    </h3>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        نوع الخط
                      </label>
                      <select
                        name="fontFamily"
                        value={printData.fontFamily}
                        onChange={handlePrintInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                      >
                        <option value="Arial">Arial</option>
                        <option value="Times New Roman">Times New Roman</option>
                        <option value="Calibri">Calibri</option>
                        <option value="Tahoma">Tahoma</option>
                        <option value="Arabic">Arabic</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        حجم الخط
                      </label>
                      <input
                        type="number"
                        name="fontSize"
                        value={printData.fontSize}
                        onChange={handlePrintInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                        min="8"
                        max="24"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        تباعد الأسطر
                      </label>
                      <input
                        type="number"
                        name="lineHeight"
                        value={printData.lineHeight}
                        onChange={handlePrintInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                        min="1"
                        max="3"
                        step="0.1"
                        required
                      />
                    </div>
                  </div>
                </div>

                {/* الهوامش */}
                <div className="space-y-4">
                  <h3 className="text-lg font-medium text-gray-800 border-b pb-2">
                    الهوامش (بالبوصة)
                  </h3>
                  
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        الأعلى
                      </label>
                      <input
                        type="number"
                        name="margins.top"
                        value={printData.margins.top}
                        onChange={handlePrintInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                        min="0"
                        max="5"
                        step="0.1"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        الأسفل
                      </label>
                      <input
                        type="number"
                        name="margins.bottom"
                        value={printData.margins.bottom}
                        onChange={handlePrintInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                        min="0"
                        max="5"
                        step="0.1"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        اليمين
                      </label>
                      <input
                        type="number"
                        name="margins.right"
                        value={printData.margins.right}
                        onChange={handlePrintInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                        min="0"
                        max="5"
                        step="0.1"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        اليسار
                      </label>
                      <input
                        type="number"
                        name="margins.left"
                        value={printData.margins.left}
                        onChange={handlePrintInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                        min="0"
                        max="5"
                        step="0.1"
                        required
                      />
                    </div>
                  </div>
                </div>

                {/* الألوان */}
                <div className="space-y-4">
                  <h3 className="text-lg font-medium text-gray-800 border-b pb-2">
                    الألوان
                  </h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        اللون الأساسي
                      </label>
                      <input
                        type="color"
                        name="colors.primary"
                        value={printData.colors.primary}
                        onChange={handlePrintInputChange}
                        className="w-full h-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        اللون الثانوي
                      </label>
                      <input
                        type="color"
                        name="colors.secondary"
                        value={printData.colors.secondary}
                        onChange={handlePrintInputChange}
                        className="w-full h-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        لون النص
                      </label>
                      <input
                        type="color"
                        name="colors.text"
                        value={printData.colors.text}
                        onChange={handlePrintInputChange}
                        className="w-full h-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                      />
                    </div>
                  </div>
                </div>

                {/* العلامة المائية */}
                <div className="space-y-4">
                  <h3 className="text-lg font-medium text-gray-800 border-b pb-2">
                    العلامة المائية
                  </h3>
                  
                  <div className="flex items-center">
                    <input
                      type="checkbox"
                      name="watermark.enabled"
                      checked={printData.watermark.enabled}
                      onChange={handlePrintInputChange}
                      className="h-4 w-4 text-orange-600 focus:ring-orange-500 border-gray-300 rounded"
                    />
                    <label className="mr-2 block text-sm text-gray-700">
                      تفعيل العلامة المائية
                    </label>
                  </div>

                  {printData.watermark.enabled && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          نص العلامة المائية
                        </label>
                        <input
                          type="text"
                          name="watermark.text"
                          value={printData.watermark.text}
                          onChange={handlePrintInputChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                          placeholder="مثال: مسودة"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          الشفافية
                        </label>
                        <input
                          type="number"
                          name="watermark.opacity"
                          value={printData.watermark.opacity}
                          onChange={handlePrintInputChange}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500"
                          min="0"
                          max="1"
                          step="0.1"
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex justify-end space-x-4 space-x-reverse pt-6 border-t">
                  <button
                    type="button"
                    onClick={() => setShowPrintForm(false)}
                    className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors duration-200"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors duration-200"
                  >
                    حفظ الإعدادات
                  </button>
                </div>
              </form>
            )}

            {!showPrintForm && (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-gray-800 mb-2">
                  إعدادات الطباعة والهوية البصرية
                </h3>
                <p className="text-gray-600 mb-6">
                  اضغط على &quot;تعديل الإعدادات&quot; لتخصيص إعدادات الطباعة والهوية البصرية للوثائق
                </p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'backup' && (
          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold text-gray-800">
                إعداد النسخ الاحتياطي للبيانات
              </h2>
              <button
                onClick={() => setShowBackupForm(!showBackupForm)}
                className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg transition-colors duration-200"
              >
                {showBackupForm ? 'إلغاء' : 'تعديل الإعدادات'}
              </button>
            </div>

            {showBackupForm && (
              <form onSubmit={handleBackupSubmit} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* إعدادات النسخ الاحتياطي التلقائي */}
                  <div className="space-y-4">
                    <h3 className="text-lg font-medium text-gray-800 border-b pb-2">
                      النسخ الاحتياطي التلقائي
                    </h3>
                    
                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        name="autoBackup"
                        checked={backupData.autoBackup}
                        onChange={handleBackupInputChange}
                        className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded"
                      />
                      <label className="mr-2 block text-sm text-gray-700">
                        تفعيل النسخ الاحتياطي التلقائي
                      </label>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        تكرار النسخ الاحتياطي
                      </label>
                      <select
                        name="backupFrequency"
                        value={backupData.backupFrequency}
                        onChange={handleBackupInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                      >
                        <option value="daily">يومي</option>
                        <option value="weekly">أسبوعي</option>
                        <option value="monthly">شهري</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        وقت النسخ الاحتياطي
                      </label>
                      <input
                        type="time"
                        name="backupTime"
                        value={backupData.backupTime}
                        onChange={handleBackupInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        مدة الاحتفاظ (أيام)
                      </label>
                      <input
                        type="number"
                        name="retentionDays"
                        value={backupData.retentionDays}
                        onChange={handleBackupInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                        min="1"
                        max="365"
                        required
                      />
                    </div>
                  </div>

                  {/* محتويات النسخ الاحتياطي */}
                  <div className="space-y-4">
                    <h3 className="text-lg font-medium text-gray-800 border-b pb-2">
                      محتويات النسخ الاحتياطي
                    </h3>
                    
                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        name="includeDatabase"
                        checked={backupData.includeDatabase}
                        onChange={handleBackupInputChange}
                        className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded"
                      />
                      <label className="mr-2 block text-sm text-gray-700">
                        تضمين قاعدة البيانات
                      </label>
                    </div>

                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        name="includeFiles"
                        checked={backupData.includeFiles}
                        onChange={handleBackupInputChange}
                        className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded"
                      />
                      <label className="mr-2 block text-sm text-gray-700">
                        تضمين الملفات
                      </label>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        موقع النسخ الاحتياطي
                      </label>
                      <input
                        type="text"
                        name="backupLocation"
                        value={backupData.backupLocation}
                        onChange={handleBackupInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500"
                        placeholder="/backups"
                        required
                      />
                    </div>

                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        name="emailNotification"
                        checked={backupData.emailNotification}
                        onChange={handleBackupInputChange}
                        className="h-4 w-4 text-red-600 focus:ring-red-500 border-gray-300 rounded"
                      />
                      <label className="mr-2 block text-sm text-gray-700">
                        إشعار عبر البريد الإلكتروني
                      </label>
                    </div>
                  </div>
                </div>

                {/* إجراءات النسخ الاحتياطي */}
                <div className="space-y-4">
                  <h3 className="text-lg font-medium text-gray-800 border-b pb-2">
                    إجراءات النسخ الاحتياطي
                  </h3>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <button
                      type="button"
                      className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg transition-colors duration-200"
                    >
                      إنشاء نسخة احتياطية الآن
                    </button>
                    <button
                      type="button"
                      className="bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg transition-colors duration-200"
                    >
                      استعادة من نسخة احتياطية
                    </button>
                    <button
                      type="button"
                      className="bg-yellow-600 hover:bg-yellow-700 text-white px-4 py-2 rounded-lg transition-colors duration-200"
                    >
                      عرض النسخ الاحتياطية
                    </button>
                  </div>
                </div>

                <div className="flex justify-end space-x-4 space-x-reverse pt-6 border-t">
                  <button
                    type="button"
                    onClick={() => setShowBackupForm(false)}
                    className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors duration-200"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors duration-200"
                  >
                    حفظ الإعدادات
                  </button>
                </div>
              </form>
            )}

            {!showBackupForm && (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                  </svg>
                </div>
                <h3 className="text-lg font-medium text-gray-800 mb-2">
                  إعداد النسخ الاحتياطي للبيانات
                </h3>
                <p className="text-gray-600 mb-6">
                  اضغط على &quot;تعديل الإعدادات&quot; لتخصيص إعدادات النسخ الاحتياطي للبيانات
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
