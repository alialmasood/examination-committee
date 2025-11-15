'use client';

import { useState } from 'react';

export default function SettingsPage() {
  const [settings, setSettings] = useState({
    examDuration: 120,
    maxAttempts: 3,
    autoGrade: true,
    notifications: true,
    emailNotifications: true,
    smsNotifications: false,
    defaultLanguage: 'ar',
    timezone: 'Asia/Baghdad',
    dateFormat: 'DD/MM/YYYY',
    gradeScale: 'arabic',
    passPercentage: 50,
    maxGrade: 100,
    minGrade: 0
  });

  const [isSaving, setIsSaving] = useState(false);

  const handleInputChange = (field: string, value: any) => {
    setSettings(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const handleSave = async () => {
    setIsSaving(true);
    
    // محاكاة حفظ الإعدادات
    setTimeout(() => {
      setIsSaving(false);
      alert('تم حفظ الإعدادات بنجاح');
    }, 1000);
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">الإعدادات</h1>
        <p className="text-gray-600">تخصيص إعدادات نظام اللجنة الامتحانية</p>
      </div>

      <div className="space-y-8">
        {/* Exam Settings */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">إعدادات الامتحانات</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                مدة الامتحان الافتراضية (دقيقة)
              </label>
              <input
                type="number"
                value={settings.examDuration}
                onChange={(e) => handleInputChange('examDuration', parseInt(e.target.value))}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                min="30"
                max="300"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                عدد المحاولات المسموحة
              </label>
              <input
                type="number"
                value={settings.maxAttempts}
                onChange={(e) => handleInputChange('maxAttempts', parseInt(e.target.value))}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                min="1"
                max="10"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                النسبة المئوية للنجاح
              </label>
              <input
                type="number"
                value={settings.passPercentage}
                onChange={(e) => handleInputChange('passPercentage', parseInt(e.target.value))}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                min="0"
                max="100"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                أعلى درجة
              </label>
              <input
                type="number"
                value={settings.maxGrade}
                onChange={(e) => handleInputChange('maxGrade', parseInt(e.target.value))}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                min="1"
                max="1000"
              />
            </div>
          </div>
          
          <div className="mt-6">
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={settings.autoGrade}
                onChange={(e) => handleInputChange('autoGrade', e.target.checked)}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              />
              <span className="mr-2 text-sm text-gray-700">التصحيح التلقائي للامتحانات</span>
            </label>
          </div>
        </div>

        {/* Notification Settings */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">إعدادات الإشعارات</h2>
          
          <div className="space-y-4">
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={settings.notifications}
                onChange={(e) => handleInputChange('notifications', e.target.checked)}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              />
              <span className="mr-2 text-sm text-gray-700">تفعيل الإشعارات</span>
            </label>
            
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={settings.emailNotifications}
                onChange={(e) => handleInputChange('emailNotifications', e.target.checked)}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                disabled={!settings.notifications}
              />
              <span className="mr-2 text-sm text-gray-700">الإشعارات عبر البريد الإلكتروني</span>
            </label>
            
            <label className="flex items-center">
              <input
                type="checkbox"
                checked={settings.smsNotifications}
                onChange={(e) => handleInputChange('smsNotifications', e.target.checked)}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                disabled={!settings.notifications}
              />
              <span className="mr-2 text-sm text-gray-700">الإشعارات عبر الرسائل النصية</span>
            </label>
          </div>
        </div>

        {/* System Settings */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">إعدادات النظام</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                اللغة الافتراضية
              </label>
              <select
                value={settings.defaultLanguage}
                onChange={(e) => handleInputChange('defaultLanguage', e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="ar">العربية</option>
                <option value="en">English</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                المنطقة الزمنية
              </label>
              <select
                value={settings.timezone}
                onChange={(e) => handleInputChange('timezone', e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="Asia/Baghdad">بغداد (GMT+3)</option>
                <option value="Asia/Dubai">دبي (GMT+4)</option>
                <option value="Asia/Riyadh">الرياض (GMT+3)</option>
                <option value="UTC">UTC (GMT+0)</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                تنسيق التاريخ
              </label>
              <select
                value={settings.dateFormat}
                onChange={(e) => handleInputChange('dateFormat', e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="DD/MM/YYYY">يوم/شهر/سنة</option>
                <option value="MM/DD/YYYY">شهر/يوم/سنة</option>
                <option value="YYYY-MM-DD">سنة-شهر-يوم</option>
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                نظام التقدير
              </label>
              <select
                value={settings.gradeScale}
                onChange={(e) => handleInputChange('gradeScale', e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="arabic">عربي (ممتاز، جيد جداً، جيد، مقبول، راسب)</option>
                <option value="english">إنجليزي (A, B, C, D, F)</option>
                <option value="numeric">رقمي (0-100)</option>
              </select>
            </div>
          </div>
        </div>

        {/* Save Button */}
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSaving ? (
              <div className="flex items-center space-x-2 space-x-reverse">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                <span>جاري الحفظ...</span>
              </div>
            ) : (
              'حفظ الإعدادات'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
