'use client';

import { useState } from 'react';

interface FAQItem {
  id: string;
  question: string;
  answer: string;
  category: 'general' | 'technical' | 'account' | 'features';
  isExpanded: boolean;
}

interface SupportTicket {
  id: string;
  subject: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  category: 'technical' | 'account' | 'feature' | 'bug' | 'other';
  status: 'open' | 'in-progress' | 'resolved' | 'closed';
  createdAt: string;
  attachments?: File[];
}

interface UserGuideSection {
  id: string;
  title: string;
  content: string;
  category: 'getting-started' | 'features' | 'troubleshooting' | 'advanced';
  isExpanded: boolean;
}

export default function SupportPage() {
  const [activeTab, setActiveTab] = useState<'guide' | 'faq' | 'contact'>('guide');
  const [showContactForm, setShowContactForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  
  const [supportData, setSupportData] = useState<SupportTicket>({
    id: '',
    subject: '',
    description: '',
    priority: 'medium',
    category: 'technical',
    status: 'open',
    createdAt: new Date().toISOString().split('T')[0],
    attachments: []
  });

  const [faqItems] = useState<FAQItem[]>([
    {
      id: '1',
      question: 'كيف يمكنني تسجيل الدخول إلى النظام؟',
      answer: 'يمكنك تسجيل الدخول باستخدام رقم الطالب وكلمة المرور الخاصة بك. تأكد من أن كلمة المرور صحيحة وأن الحساب نشط.',
      category: 'general',
      isExpanded: false
    },
    {
      id: '2',
      question: 'كيف يمكنني تغيير كلمة المرور؟',
      answer: 'اذهب إلى إعدادات الحساب واختر "تغيير كلمة المرور". أدخل كلمة المرور الحالية ثم كلمة المرور الجديدة.',
      category: 'account',
      isExpanded: false
    },
    {
      id: '3',
      question: 'كيف يمكنني عرض درجاتي؟',
      answer: 'اذهب إلى قسم "الدرجات" في القائمة الرئيسية. ستجد جميع درجاتك مرتبة حسب الفصل الدراسي.',
      category: 'features',
      isExpanded: false
    },
    {
      id: '4',
      question: 'ماذا أفعل إذا لم أتمكن من الوصول إلى النظام؟',
      answer: 'تأكد من اتصالك بالإنترنت، وحاول مسح ذاكرة التخزين المؤقت للمتصفح. إذا استمرت المشكلة، اتصل بالدعم الفني.',
      category: 'technical',
      isExpanded: false
    },
    {
      id: '5',
      question: 'كيف يمكنني تحديث معلوماتي الشخصية؟',
      answer: 'اذهب إلى "الملف الشخصي" واختر "تعديل المعلومات". يمكنك تحديث العنوان ورقم الهاتف والبريد الإلكتروني.',
      category: 'account',
      isExpanded: false
    },
    {
      id: '6',
      question: 'كيف يمكنني طباعة وثائقي؟',
      answer: 'اذهب إلى قسم "الوثائق" واختر الوثيقة المطلوبة. اضغط على "طباعة" واختر الطابعة المناسبة.',
      category: 'features',
      isExpanded: false
    }
  ]);

  const [userGuideSections] = useState<UserGuideSection[]>([
    {
      id: '1',
      title: 'البدء السريع',
      content: 'مرحباً بك في نظام شؤون الطلاب. هذا الدليل سيساعدك على استخدام النظام بفعالية. ابدأ بتسجيل الدخول باستخدام بياناتك الشخصية.',
      category: 'getting-started',
      isExpanded: false
    },
    {
      id: '2',
      title: 'تسجيل الدخول والخروج',
      content: 'لتسجيل الدخول: 1. أدخل رقم الطالب 2. أدخل كلمة المرور 3. اضغط على "تسجيل الدخول". للخروج: اضغط على "تسجيل الخروج" في القائمة.',
      category: 'getting-started',
      isExpanded: false
    },
    {
      id: '3',
      title: 'استخدام القائمة الرئيسية',
      content: 'القائمة الرئيسية تحتوي على جميع الأقسام المتاحة. يمكنك التنقل بين الأقسام المختلفة مثل الدرجات، الحضور، الوثائق، وغيرها.',
      category: 'features',
      isExpanded: false
    },
    {
      id: '4',
      title: 'عرض الدرجات',
      content: 'للعرض الدرجات: 1. اذهب إلى "الدرجات" 2. اختر الفصل الدراسي 3. ستظهر جميع درجاتك مع المعدل التراكمي.',
      category: 'features',
      isExpanded: false
    },
    {
      id: '5',
      title: 'تسجيل الحضور',
      content: 'لتسجيل الحضور: 1. اذهب إلى "الحضور" 2. اختر التاريخ 3. اضغط على "تسجيل حضور" 4. أكد العملية.',
      category: 'features',
      isExpanded: false
    },
    {
      id: '6',
      title: 'حل مشاكل الاتصال',
      content: 'إذا واجهت مشاكل في الاتصال: 1. تحقق من اتصال الإنترنت 2. مسح ذاكرة التخزين المؤقت 3. إعادة تشغيل المتصفح 4. الاتصال بالدعم الفني.',
      category: 'troubleshooting',
      isExpanded: false
    }
  ]);

  const handleSupportSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log('تذكرة دعم جديدة:', supportData);
    alert('تم إرسال طلب الدعم بنجاح! سنتواصل معك قريباً.');
    setShowContactForm(false);
    setSupportData({
      id: '',
      subject: '',
      description: '',
      priority: 'medium',
      category: 'technical',
      status: 'open',
      createdAt: new Date().toISOString().split('T')[0],
      attachments: []
    });
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setSupportData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const toggleFAQ = (id: string) => {
    // This would update the FAQ items in a real application
    console.log('Toggle FAQ:', id);
  };

  const toggleGuide = (id: string) => {
    // This would update the guide sections in a real application
    console.log('Toggle Guide:', id);
  };

  const filteredFAQ = faqItems.filter(item => {
    const matchesSearch = item.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         item.answer.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || item.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const filteredGuide = userGuideSections.filter(section => {
    const matchesSearch = section.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         section.content.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'all' || section.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const getCategoryLabel = (category: string) => {
    switch (category) {
      case 'general': return 'عام';
      case 'technical': return 'تقني';
      case 'account': return 'حساب';
      case 'features': return 'ميزات';
      case 'getting-started': return 'البدء السريع';
      case 'troubleshooting': return 'استكشاف الأخطاء';
      case 'advanced': return 'متقدم';
      default: return category;
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'text-red-600 bg-red-100';
      case 'high': return 'text-orange-600 bg-orange-100';
      case 'medium': return 'text-yellow-600 bg-yellow-100';
      case 'low': return 'text-green-600 bg-green-100';
      default: return 'text-gray-600 bg-gray-100';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-cyan-50 via-blue-50 to-indigo-50">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-800 mb-2">
            المساعدة والدعم الفني
          </h1>
          <p className="text-gray-600">
            دليل المستخدم والأسئلة الشائعة والدعم الفني
          </p>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-lg shadow-lg mb-6">
          <div className="border-b border-gray-200">
            <nav className="flex flex-wrap space-x-8 space-x-reverse px-6">
              <button
                onClick={() => setActiveTab('guide')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'guide'
                    ? 'border-cyan-500 text-cyan-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                دليل المستخدم
              </button>
              <button
                onClick={() => setActiveTab('faq')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'faq'
                    ? 'border-cyan-500 text-cyan-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                الأسئلة الشائعة
              </button>
              <button
                onClick={() => setActiveTab('contact')}
                className={`py-4 px-1 border-b-2 font-medium text-sm ${
                  activeTab === 'contact'
                    ? 'border-cyan-500 text-cyan-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                اتصل بالدعم الفني
              </button>
            </nav>
          </div>
        </div>

        {/* Content based on active tab */}
        {activeTab === 'guide' && (
          <div className="space-y-6">
            {/* Search and Filter */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <div className="flex flex-col md:flex-row gap-4 mb-6">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    البحث في دليل المستخدم
                  </label>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500"
                    placeholder="ابحث في دليل المستخدم..."
                  />
                </div>
                <div className="md:w-64">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    الفئة
                  </label>
                  <select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500"
                  >
                    <option value="all">جميع الفئات</option>
                    <option value="getting-started">البدء السريع</option>
                    <option value="features">الميزات</option>
                    <option value="troubleshooting">استكشاف الأخطاء</option>
                    <option value="advanced">متقدم</option>
                  </select>
                </div>
              </div>

              {/* User Guide Sections */}
              <div className="space-y-4">
                {filteredGuide.map((section) => (
                  <div key={section.id} className="border border-gray-200 rounded-lg">
                    <button
                      onClick={() => toggleGuide(section.id)}
                      className="w-full px-6 py-4 text-right flex justify-between items-center hover:bg-gray-50 transition-colors duration-200"
                    >
                      <div className="flex items-center space-x-4 space-x-reverse">
                        <span className="text-sm text-gray-500 bg-cyan-100 px-2 py-1 rounded-full">
                          {getCategoryLabel(section.category)}
                        </span>
                        <h3 className="text-lg font-medium text-gray-800">
                          {section.title}
                        </h3>
                      </div>
                      <svg
                        className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${
                          section.isExpanded ? 'rotate-180' : ''
                        }`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {section.isExpanded && (
                      <div className="px-6 pb-4">
                        <div className="text-gray-700 leading-relaxed">
                          {section.content}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'faq' && (
          <div className="space-y-6">
            {/* Search and Filter */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <div className="flex flex-col md:flex-row gap-4 mb-6">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    البحث في الأسئلة الشائعة
                  </label>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500"
                    placeholder="ابحث في الأسئلة الشائعة..."
                  />
                </div>
                <div className="md:w-64">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    الفئة
                  </label>
                  <select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500"
                  >
                    <option value="all">جميع الفئات</option>
                    <option value="general">عام</option>
                    <option value="technical">تقني</option>
                    <option value="account">حساب</option>
                    <option value="features">ميزات</option>
                  </select>
                </div>
              </div>

              {/* FAQ Items */}
              <div className="space-y-4">
                {filteredFAQ.map((item) => (
                  <div key={item.id} className="border border-gray-200 rounded-lg">
                    <button
                      onClick={() => toggleFAQ(item.id)}
                      className="w-full px-6 py-4 text-right flex justify-between items-center hover:bg-gray-50 transition-colors duration-200"
                    >
                      <div className="flex items-center space-x-4 space-x-reverse">
                        <span className="text-sm text-gray-500 bg-cyan-100 px-2 py-1 rounded-full">
                          {getCategoryLabel(item.category)}
                        </span>
                        <h3 className="text-lg font-medium text-gray-800">
                          {item.question}
                        </h3>
                      </div>
                      <svg
                        className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${
                          item.isExpanded ? 'rotate-180' : ''
                        }`}
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {item.isExpanded && (
                      <div className="px-6 pb-4">
                        <div className="text-gray-700 leading-relaxed">
                          {item.answer}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'contact' && (
          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold text-gray-800">
                اتصل بالدعم الفني
              </h2>
              <button
                onClick={() => setShowContactForm(!showContactForm)}
                className="bg-cyan-600 hover:bg-cyan-700 text-white px-4 py-2 rounded-lg transition-colors duration-200"
              >
                {showContactForm ? 'إلغاء' : 'إرسال طلب دعم'}
              </button>
            </div>

            {showContactForm && (
              <form onSubmit={handleSupportSubmit} className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  {/* معلومات الطلب */}
                  <div className="space-y-4">
                    <h3 className="text-lg font-medium text-gray-800 border-b pb-2">
                      معلومات الطلب
                    </h3>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        موضوع الطلب
                      </label>
                      <input
                        type="text"
                        name="subject"
                        value={supportData.subject}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500"
                        placeholder="مثال: مشكلة في تسجيل الدخول"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        فئة المشكلة
                      </label>
                      <select
                        name="category"
                        value={supportData.category}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500"
                        required
                      >
                        <option value="technical">مشكلة تقنية</option>
                        <option value="account">مشكلة في الحساب</option>
                        <option value="feature">طلب ميزة جديدة</option>
                        <option value="bug">تقرير خطأ</option>
                        <option value="other">أخرى</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        أولوية الطلب
                      </label>
                      <select
                        name="priority"
                        value={supportData.priority}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500"
                        required
                      >
                        <option value="low">منخفضة</option>
                        <option value="medium">متوسطة</option>
                        <option value="high">عالية</option>
                        <option value="urgent">عاجلة</option>
                      </select>
                    </div>
                  </div>

                  {/* معلومات الاتصال */}
                  <div className="space-y-4">
                    <h3 className="text-lg font-medium text-gray-800 border-b pb-2">
                      معلومات الاتصال
                    </h3>
                    
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        رقم الطالب
                      </label>
                      <input
                        type="text"
                        name="studentId"
                        value={supportData.id}
                        onChange={handleInputChange}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500"
                        placeholder="رقم الطالب"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        البريد الإلكتروني
                      </label>
                      <input
                        type="email"
                        name="email"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500"
                        placeholder="example@university.edu.sa"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        رقم الهاتف
                      </label>
                      <input
                        type="tel"
                        name="phone"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500"
                        placeholder="+966501234567"
                      />
                    </div>
                  </div>
                </div>

                {/* وصف المشكلة */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    وصف المشكلة بالتفصيل
                  </label>
                  <textarea
                    name="description"
                    value={supportData.description}
                    onChange={handleInputChange}
                    rows={6}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500"
                    placeholder="اكتب وصفاً مفصلاً للمشكلة التي تواجهها..."
                    required
                  />
                </div>

                {/* المرفقات */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    المرفقات (اختياري)
                  </label>
                  <input
                    type="file"
                    multiple
                    accept=".pdf,.doc,.docx,.jpg,.png,.gif"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500"
                  />
                  <p className="text-sm text-gray-500 mt-1">
                    يمكنك رفع ملفات PDF، Word، أو الصور (JPG, PNG, GIF)
                  </p>
                </div>

                {/* معلومات إضافية */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h4 className="text-sm font-medium text-blue-800 mb-2">
                    معلومات مهمة:
                  </h4>
                  <ul className="text-sm text-blue-700 space-y-1">
                    <li>• سيتم الرد على طلبك خلال 24-48 ساعة</li>
                    <li>• للطوارئ، اتصل بالدعم الفني مباشرة: 011-123-4567</li>
                    <li>• تأكد من إدخال معلوماتك بشكل صحيح</li>
                    <li>• يمكنك تتبع حالة طلبك من خلال رقم الطلب</li>
                  </ul>
                </div>

                {/* أزرار الإجراءات */}
                <div className="flex justify-end space-x-4 space-x-reverse pt-6 border-t">
                  <button
                    type="button"
                    onClick={() => setShowContactForm(false)}
                    className="px-6 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors duration-200"
                  >
                    إلغاء
                  </button>
                  <button
                    type="submit"
                    className="px-6 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 transition-colors duration-200"
                  >
                    إرسال طلب الدعم
                  </button>
                </div>
              </form>
            )}

            {!showContactForm && (
              <div className="space-y-6">
                {/* Contact Information */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-cyan-50 border border-cyan-200 rounded-lg p-6">
                    <div className="flex items-center mb-4">
                      <div className="w-12 h-12 bg-cyan-100 rounded-full flex items-center justify-center">
                        <svg className="w-6 h-6 text-cyan-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                        </svg>
                      </div>
                      <h3 className="text-lg font-semibold text-gray-800 mr-3">
                        الدعم الفني
                      </h3>
                    </div>
                    <p className="text-gray-600 mb-2">
                      <strong>الهاتف:</strong> 011-123-4567
                    </p>
                    <p className="text-gray-600 mb-2">
                      <strong>البريد الإلكتروني:</strong> support@university.edu.sa
                    </p>
                    <p className="text-gray-600">
                      <strong>ساعات العمل:</strong> الأحد - الخميس، 8:00 ص - 5:00 م
                    </p>
                  </div>

                  <div className="bg-green-50 border border-green-200 rounded-lg p-6">
                    <div className="flex items-center mb-4">
                      <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                        <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 4.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                      </div>
                      <h3 className="text-lg font-semibold text-gray-800 mr-3">
                        البريد الإلكتروني
                      </h3>
                    </div>
                    <p className="text-gray-600 mb-2">
                      <strong>للطلاب:</strong> students@university.edu.sa
                    </p>
                    <p className="text-gray-600 mb-2">
                      <strong>للموظفين:</strong> staff@university.edu.sa
                    </p>
                    <p className="text-gray-600">
                      <strong>الرد:</strong> خلال 24-48 ساعة
                    </p>
                  </div>
                </div>

                {/* Quick Actions */}
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-gray-800 mb-4">
                    إجراءات سريعة
                  </h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <button className="bg-white border border-gray-300 rounded-lg p-4 hover:bg-gray-50 transition-colors duration-200">
                      <div className="text-center">
                        <svg className="w-8 h-8 text-blue-600 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <h4 className="font-medium text-gray-800">تقرير خطأ</h4>
                        <p className="text-sm text-gray-600">الإبلاغ عن مشاكل تقنية</p>
                      </div>
                    </button>
                    <button className="bg-white border border-gray-300 rounded-lg p-4 hover:bg-gray-50 transition-colors duration-200">
                      <div className="text-center">
                        <svg className="w-8 h-8 text-green-600 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4" />
                        </svg>
                        <h4 className="font-medium text-gray-800">طلب ميزة</h4>
                        <p className="text-sm text-gray-600">اقتراح تحسينات جديدة</p>
                      </div>
                    </button>
                    <button className="bg-white border border-gray-300 rounded-lg p-4 hover:bg-gray-50 transition-colors duration-200">
                      <div className="text-center">
                        <svg className="w-8 h-8 text-purple-600 mx-auto mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.791 0 5.228 2.228 5.228 5s-2.437 5-5.228 5c-1.742 0-3.223-.835-3.772-2M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        <h4 className="font-medium text-gray-800">تتبع الطلب</h4>
                        <p className="text-sm text-gray-600">متابعة حالة طلبك</p>
                      </div>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
