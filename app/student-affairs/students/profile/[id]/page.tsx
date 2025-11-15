'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Image from 'next/image';
import { Student } from '@/src/lib/types';

export default function StudentProfileViewPage() {
  const params = useParams();
  const router = useRouter();
  const [student, setStudent] = useState<Student | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedDocument, setSelectedDocument] = useState<string | null>(null);

  // جلب بيانات الطالب
  useEffect(() => {
    const fetchStudent = async () => {
      try {
        const response = await fetch(`/api/students/${params.id}`);
        const data = await response.json();
        
        if (data.success && data.data) {
          setStudent(data.data);
        }
      } catch (error) {
        console.error('خطأ في جلب بيانات الطالب:', error);
      } finally {
        setLoading(false);
      }
    };

    if (params.id) {
      fetchStudent();
    }
  }, [params.id]);

  // Helper Functions
  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return null;
    try {
      const date = new Date(dateString);
      return new Intl.DateTimeFormat('ar-EG', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }).format(date);
    } catch {
      return null;
    }
  };

  const generateQRCode = () => {
    if (typeof window !== 'undefined' && params.id) {
      const url = `${window.location.origin}/student-affairs/students/profile/${params.id}`;
      return `https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=${encodeURIComponent(url)}`;
    }
    return '';
  };

  const generateBarcode = (text: string) => {
    if (!text) return '';
    return `https://barcode.tec-it.com/barcode.ashx?data=${encodeURIComponent(text)}&code=Code128&translate-esc=on`;
  };

  // دالة الطباعة البسيطة
  const handlePrint = () => {
    window.print();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#8A2E25] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">جاري تحميل البيانات...</p>
        </div>
      </div>
    );
  }

  if (!student) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600 mb-4">لم يتم العثور على بيانات الطالب</p>
          <button
            onClick={() => router.back()}
            className="px-6 py-2 bg-[#8A2E25] text-white rounded-lg hover:bg-[#6B1F19] transition-colors duration-200"
          >
            العودة
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F3F4F6]" dir="rtl">
      <style jsx global>{`
        @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;800;900&display=swap');
        
        * {
          font-family: 'Cairo', sans-serif;
        }
        
                 /* حجم الصفحة وهوامشها */
         @page {
           size: A4 portrait;
           margin: 10mm;  /* عدّل 8–15mm حسب ما تحب */
         }
        
                 /* طباعة مطابقة للعرض */
         @media print {
           /* إخفاء كل شيء */
           * {
             visibility: hidden !important;
           }

           /* إظهار البروفايل فقط */
           #profileSheet,
           #profileSheet * {
             visibility: visible !important;
           }

           /* إخفاء عناصر النظام */
           .app-chrome {
             display: none !important;
             visibility: hidden !important;
           }

           /* إعدادات الصفحة */
           @page {
             size: A4 portrait;
             margin: 15mm;
           }

           /* تنسيق البروفايل */
           #profileSheet {
             position: absolute !important;
             top: 0 !important;
             left: 0 !important;
             width: 100% !important;
             height: auto !important;
             margin: 0 !important;
             padding: 0 !important;
             background: white !important;
             z-index: 9999 !important;
           }

           /* إظهار الشريط الجانبي في الطباعة */
           #profileSheet .side-rail {
             display: flex !important;
             width: 56px !important;
             height: 100% !important;
             background: #8A2E25 !important;
             flex-direction: column !important;
             align-items: center !important;
             padding: 20px 0 !important;
             gap: 20px !important;
           }

           /* ضمان ظهور المحتوى الرئيسي مع مساحة للشريط الجانبي */
           #profileSheet .flex-1 {
             margin-right: 0 !important;
             flex: 1 !important;
           }
         }
         
         /* تحسين العرض لمنع تمدد الصفحة في المتصفّح أثناء الطباعة */
         html, body { height: auto; overflow: auto; }
         
         /* وضع الطباعة */
         .print-mode {
           overflow: hidden;
         }
        }
      `}</style>

      <div className="w-[210mm] mx-auto">
        {/* Action Bar - للويب فقط */}
        <div className="app-chrome print-hidden py-4 mb-2">
          <div className="flex items-center justify-end gap-3 pr-12">
            <button
              onClick={() => router.back()}
              className="app-chrome flex items-center gap-2 px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors text-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              العودة
            </button>
            
            <button
              onClick={handlePrint}
              className="app-chrome flex items-center gap-2 px-4 py-2 bg-[#8A2E25] text-white rounded-lg hover:bg-[#6B1F19] transition-colors text-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              طباعة / حفظ PDF
            </button>
          </div>
        </div>

        {/* Profile Container */}
        <div id="profileSheet" className="bg-white shadow-2xl w-full max-w-[210mm] h-[297mm] mx-auto my-6 print:my-0 print:shadow-none print:w-full">
        
                 {/* Main Layout: Sidebar + Content */}
         <div className="flex h-full">
           
           {/* Sidebar - Maroon Vertical Strip */}
           <div className="side-rail w-[56px] bg-[#8A2E25] flex flex-col items-center py-6 gap-6 h-full">
            {/* Contact Icons */}
            <a href={`https://wa.me/${student.phone?.replace(/\D/g, '') || ''}`} target="_blank" rel="noopener noreferrer" className="text-white hover:text-gray-200 transition-colors">
              <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/>
              </svg>
            </a>
            <a href={`mailto:${student.email || ''}`} className="text-white hover:text-gray-200 transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </a>
          </div>

          {/* Main Content Area */}
          <div className="flex-1 p-6">
            
                         {/* Header: College Logo + Name + Student Serial */}
             <div className="flex items-center justify-between gap-4 mb-6 pb-4 border-b border-[#E5E7EB]">
               <div className="flex items-center gap-4">
                 <Image 
                   src="/logos/college-logo.png" 
                   alt="شعار الكلية" 
                   width={56}
                   height={56}
                   className="w-14 h-14 rounded-full object-cover"
                 />
                 <div>
                   <h2 className="text-xl font-bold text-[#111827]">كلية الشرق للعلوم التقنية التخصصية</h2>
                   <p className="text-sm text-gray-600 font-medium">AlSharq Technical College for Specialized Sciences</p>
                 </div>
               </div>
               {student.university_id && (
                 <div className="text-right">
                   <p className="text-sm text-[#6B7280] font-medium mb-1">الرقم التسلسلي</p>
                   <p className="text-xl font-black text-[#8A2E25]">{student.university_id}</p>
                 </div>
               )}
             </div>

            {/* Student Name + Photo */}
            <div className="mb-6 pb-4 border-b border-[#E5E7EB] flex items-center gap-6">
              {/* Photo */}
              <div style={{ width: '120px', height: '154px', flexShrink: 0 }} className="passport-photo">
                {student.photo ? (
                  <Image 
                    src={`/uploads/students/${student.photo}`}
                    alt={student.full_name_ar || student.full_name}
                    width={120}
                    height={154}
                    className="w-full h-full object-cover"
                    onError={() => {
                      // onError handler will be handled by Image component
                    }}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-gray-100">
                    <svg className="w-16 h-16 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                  </div>
                )}
              </div>

                             {/* Name and Info */}
               <div className="flex-1">
                 <div className="flex items-baseline gap-3 flex-wrap">
                   <h1 className="text-[36px] font-black text-[#1F2937] leading-tight">
                     {student.full_name_ar || student.full_name || `${student.first_name} ${student.last_name}`}
                   </h1>
                   {student.nickname && (
                     <p className="text-xl text-gray-500 font-semibold">({student.nickname})</p>
                   )}
                 </div>
               
                               {/* Quick Info Badges */}
               <div className="flex flex-wrap gap-2 mt-4">
                 {student.department && (
                  <span className="inline-flex items-center px-3 py-1 rounded-lg text-xs font-semibold bg-purple-100 text-purple-800">
                    <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                    </svg>
                    {student.department}
                  </span>
                )}
                {student.study_type && (
                  <span className="inline-flex items-center px-3 py-1 rounded-lg text-xs font-semibold bg-indigo-100 text-indigo-800">
                    <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    {student.study_type === 'morning' ? 'صباحي' : student.study_type === 'evening' ? 'مسائي' : student.study_type}
                  </span>
                )}
                                 {student.admission_type && (
                   <span className="inline-flex items-center px-3 py-1 rounded-lg text-xs font-semibold bg-green-100 text-green-800">
                     <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                     </svg>
                     {student.admission_type === 'first' ? 'المرحلة الأولى' : student.admission_type === 'second' ? 'المرحلة الثانية' : student.admission_type === 'third' ? 'المرحلة الثالثة' : student.admission_type === 'fourth' ? 'المرحلة الرابعة' : student.admission_type}
                   </span>
                 )}
                {student.level && (
                   <span className="inline-flex items-center px-3 py-1 rounded-lg text-xs font-semibold bg-orange-100 text-orange-800">
                     <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l9-5-9-5-9 5 9 5z" />
                       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
                       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14v7" />
                     </svg>
                     {student.level === 'bachelor' ? 'بكالوريوس' : 
                      student.level === 'master' ? 'ماجستير' : 
                      student.level === 'phd' ? 'دكتوراه' : 
                      student.level === 'diploma' ? 'دبلوم' : student.level}
                   </span>
                 )}
               </div>
              </div>
             </div>

            {/* Content Grid: 2 Columns */}
            <div className="grid grid-cols-12 gap-6">
              
                             {/* Left Column: Contact */}
               <div className="col-span-12 md:col-span-4">
                 
                                                                       {/* Contact Info Card */}
                  <div className="card bg-[#3B3B3B] text-white p-6 rounded-xl shadow-lg">
                    <h3 className="text-base font-black text-white mb-4 flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      معلومات التواصل
                    </h3>
                    <div className="space-y-3">
                    {/* Phone */}
                    <div className="group relative">
                      <div className="flex items-start gap-3">
                        <svg className="w-5 h-5 text-white/70 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                        </svg>
                        <p className="text-[92%] text-white leading-relaxed">{student.phone || 'غير متوفر'}</p>
                      </div>
                      {student.phone && (
                        <button 
                          className="absolute left-0 top-0 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 hover:bg-white/10 rounded"
                          onClick={() => navigator.clipboard.writeText(student.phone || '')}
                          title="نسخ الرقم"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        </button>
                      )}
                    </div>
                    
                    {/* Email */}
                    <div className="group relative">
                      <div className="flex items-start gap-3">
                        <svg className="w-5 h-5 text-white/70 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                        <p className="text-[92%] text-white leading-relaxed break-all">{student.email || 'غير متوفر'}</p>
                      </div>
                      {student.email && (
                        <a 
                          href={`mailto:${student.email || ''}`}
                          className="absolute left-0 top-0 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 hover:bg-white/10 rounded"
                          title="فتح البريد"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                          </svg>
                        </a>
                      )}
                    </div>
                    
                    {/* Address */}
                    <div className="flex items-start gap-3">
                      <svg className="w-5 h-5 text-white/70 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      <p className="text-[92%] text-white leading-relaxed">{student.address || 'غير متوفر'}</p>
                    </div>
                  </div>
                </div>
                
                {/* Academic Year */}
                <div className="mt-10 text-center">
                  <p className="text-sm font-semibold text-gray-600 mb-1">السنة الأكاديمية</p>
                  <p className="text-lg font-black text-gray-900">{student.academic_year || 'غير متوفر'}</p>
                  
                  {/* Semester */}
                  <div className="mt-3">
                    <p className="text-xs font-semibold text-gray-600 mb-1">الفصل الدراسي</p>
                    <p className="text-sm font-bold text-gray-900">
                      {student.semester === 'first' ? 'الأول' :
                       student.semester === 'second' ? 'الثاني' : 'غير متوفر'}
                    </p>
                  </div>
                </div>

                {/* Barcode */}
                {student.university_id && (
                  <div className="flex flex-col items-center mt-10">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img 
                      src={generateBarcode(student.university_id)}
                      alt={`باركود ${student.university_id}`}
                      className="barcode max-w-full h-16 object-contain"
                      loading="lazy"
                    />
                    <p className="text-xs font-semibold text-gray-600 mt-2">{student.university_id}</p>
                  </div>
                )}

                {/* QR Code */}
                {params.id && (
                  <div className="flex flex-col items-center mt-8">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img 
                      src={generateQRCode()}
                      alt="رمز QR الطالب"
                      className="qr w-32 h-32 object-contain"
                      loading="lazy"
                    />
                    <p className="text-xs font-semibold text-gray-600 mt-2">مسح للوصول</p>
                    
                    {/* Student Status */}
                    <div className="mt-4">
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-green-100 text-green-800">
                        <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        حالة الطالب: مستمر
                      </span>
                    </div>
                  </div>
                )}

              </div>

              {/* Right Column: Data Sections */}
              <div className="col-span-12 md:col-span-8 space-y-6">
                
                {/* Personal Information Card */}
                <div>
                  {/* Title with Vertical Line */}
                  <div className="flex items-center gap-3 mb-6 pb-3 border-b border-gray-200">
                    <div className="w-1 h-8 bg-gradient-to-b from-blue-600 to-blue-800 rounded-full"></div>
                    <h2 className="text-[20px] font-black text-gray-900">المعلومات الشخصية</h2>
                  </div>
                  
                  {/* Personal Information Details */}
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                    <div className="flex items-center gap-3 py-1">
                      <span className="text-[12px] font-medium text-[#6B7280] min-w-[100px]">الرقم الوطني:</span>
                      <span className="text-sm text-gray-900 font-medium">{student.national_id || <span className="text-[#9CA3AF]">غير متوفر</span>}</span>
                    </div>
                    <div className="flex items-center gap-3 py-1">
                      <span className="text-[12px] font-medium text-[#6B7280] min-w-[100px]">تاريخ الميلاد:</span>
                      <span className="text-sm text-gray-900 font-medium">{formatDate(student.birth_date) || <span className="text-[#9CA3AF]">غير متوفر</span>}</span>
                    </div>
                    <div className="flex items-center gap-3 py-1">
                      <span className="text-[12px] font-medium text-[#6B7280] min-w-[100px]">الجنس:</span>
                      <span className="text-sm text-gray-900 font-medium">{student.gender === 'male' ? 'ذكر' : student.gender === 'female' ? 'أنثى' : <span className="text-[#9CA3AF]">غير متوفر</span>}</span>
                    </div>
                    <div className="flex items-center gap-3 py-1">
                      <span className="text-[12px] font-medium text-[#6B7280] min-w-[100px]">الديانة:</span>
                      <span className="text-sm text-gray-900 font-medium">{student.religion || <span className="text-[#9CA3AF]">غير متوفر</span>}</span>
                    </div>
                    <div className="flex items-center gap-3 py-1">
                      <span className="text-[12px] font-medium text-[#6B7280] min-w-[100px]">الحالة الاجتماعية:</span>
                      <span className="text-sm text-gray-900 font-medium">
                        {student.marital_status === 'single' ? 'أعزب' : 
                         student.marital_status === 'married' ? 'متزوج' : 
                         student.marital_status === 'divorced' ? 'مطلق' : 
                         student.marital_status === 'widowed' ? 'أرمل' : 
                         <span className="text-[#9CA3AF]">غير متوفر</span>}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 py-1">
                      <span className="text-[12px] font-medium text-[#6B7280] min-w-[100px]">اسم الأم الثلاثي:</span>
                      <span className="text-sm text-gray-900 font-medium">{student.mother_name || <span className="text-[#9CA3AF]">غير متوفر</span>}</span>
                    </div>
                    <div className="flex items-center gap-3 py-1">
                      <span className="text-[12px] font-medium text-[#6B7280] min-w-[100px]">المنطقة:</span>
                      <span className="text-sm text-gray-900 font-medium">{student.area || <span className="text-[#9CA3AF]">غير متوفر</span>}</span>
                    </div>
                  </div>
                </div>


                                 {/* Secondary Education Card */}
                <div className="card no-break bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                  {/* Title with Icon */}
                  <div className="flex items-center gap-3 mb-6 pb-3 border-b border-gray-200">
                    <div className="w-1 h-8 bg-gradient-to-b from-amber-500 to-amber-600 rounded-full"></div>
                    <div className="flex-1">
                      <h2 className="text-[20px] font-black text-gray-900 flex items-center gap-2">
                        <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l9-5-9-5-9 5 9 5z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14v7" />
                        </svg>
                        التعليم الثانوي
                      </h2>
                    </div>
                  </div>
                  
                  {/* Secondary Education Details */}
                  <div className="space-y-4">
                    {/* School Name, Type and Graduation Year Row */}
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-3 flex-1">
                        <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                        </svg>
                        <div>
                          <p className="text-xs text-[#6B7280] mb-0.5">اسم المدرسة</p>
                          <p className="text-base text-gray-900 font-semibold">{student.secondary_school_name || <span className="text-[#9CA3AF]">غير متوفر</span>}</p>
                        </div>
                      </div>
                      <div className="w-px h-12 bg-gray-200"></div>
                      <div className="flex items-center gap-3 flex-1">
                        <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                        </svg>
                        <div>
                          <p className="text-xs text-[#6B7280] mb-0.5">نوع المدرسة</p>
                          <p className="text-base text-gray-900 font-semibold">
                            {student.secondary_school_type ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-sm font-bold bg-blue-100 text-blue-800">
                                {student.secondary_school_type === 'public' ? 'حكومية' : 
                                 student.secondary_school_type === 'private' ? 'أهلية' : 
                                 student.secondary_school_type === 'international' ? 'دولية' : 
                                 student.secondary_school_type}
                              </span>
                            ) : (
                              <span className="text-[#9CA3AF]">غير متوفر</span>
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="w-px h-12 bg-gray-200"></div>
                      <div className="flex items-center gap-3 flex-1">
                        <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        <div>
                          <p className="text-xs text-[#6B7280] mb-0.5">سنة التخرج</p>
                          <p className="text-base text-gray-900 font-semibold">{student.secondary_graduation_year || <span className="text-[#9CA3AF]">غير متوفر</span>}</p>
                        </div>
                      </div>
                    </div>
                    
                    <div className="h-px w-full bg-gray-200"></div>
                    
                    {/* GPA and Total Score Row */}
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-3 flex-1">
                        <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <div>
                          <p className="text-xs text-[#6B7280] mb-0.5">المعدل التراكمي</p>
                          <p className="text-base text-gray-900 font-semibold">
                            {student.secondary_gpa !== null && student.secondary_gpa !== undefined ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-sm font-bold bg-amber-100 text-amber-800">
                                {(typeof student.secondary_gpa === 'number' 
                                  ? student.secondary_gpa.toFixed(2).replace(/\.?0+$/, '') 
                                  : parseFloat(String(student.secondary_gpa)).toFixed(2).replace(/\.?0+$/, ''))}%
                              </span>
                            ) : (
                              <span className="text-[#9CA3AF]">غير متوفر</span>
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="w-px h-12 bg-gray-200"></div>
                      <div className="flex items-center gap-3 flex-1">
                        <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                        </svg>
                        <div>
                          <p className="text-xs text-[#6B7280] mb-0.5">إجمالي الدرجات</p>
                          <p className="text-base text-gray-900 font-semibold">
                            {student.secondary_total_score ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-sm font-bold bg-green-100 text-green-800">
                                {Math.floor(Number(student.secondary_total_score))}
                              </span>
                            ) : (
                              <span className="text-[#9CA3AF]">غير متوفر</span>
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="w-px h-12 bg-gray-200"></div>
                      <div className="flex items-center gap-3 flex-1">
                        <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <div>
                          <p className="text-xs text-[#6B7280] mb-0.5">الدور</p>
                          <p className="text-base text-gray-900 font-semibold">
                            {student.exam_attempt ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-sm font-bold bg-purple-100 text-purple-800">
                                {student.exam_attempt === 'first' ? 'الأول' : 
                                 student.exam_attempt === 'second' ? 'الثاني' : 
                                 student.exam_attempt === 'third' ? 'الثالث' : 
                                 student.exam_attempt}
                              </span>
                            ) : (
                              <span className="text-[#9CA3AF]">غير متوفر</span>
                            )}
                          </p>
                        </div>
                      </div>
                    </div>
                    
                    <div className="h-px w-full bg-gray-200"></div>
                    
                    {/* Exam Number, Password and Branch Row */}
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-3 flex-1">
                        <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <div>
                          <p className="text-xs text-[#6B7280] mb-0.5">الرقم الامتحاني</p>
                          <p className="text-base text-gray-900 font-semibold">
                            {student.exam_number ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-sm font-bold bg-indigo-100 text-indigo-800">
                                {student.exam_number}
                              </span>
                            ) : (
                              <span className="text-[#9CA3AF]">غير متوفر</span>
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="w-px h-12 bg-gray-200"></div>
                      <div className="flex items-center gap-3 flex-1">
                        <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                        </svg>
                        <div>
                          <p className="text-xs text-[#6B7280] mb-0.5">الرقم السري</p>
                          <p className="text-base text-gray-900 font-semibold">
                            {student.exam_password ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-sm font-bold bg-red-100 text-red-800">
                                {student.exam_password}
                              </span>
                            ) : (
                              <span className="text-[#9CA3AF]">غير متوفر</span>
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="w-px h-12 bg-gray-200"></div>
                      <div className="flex items-center gap-3 flex-1">
                        <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                        </svg>
                        <div>
                          <p className="text-xs text-[#6B7280] mb-0.5">الفرع</p>
                          <p className="text-base text-gray-900 font-semibold">
                            {student.branch ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-sm font-bold bg-teal-100 text-teal-800">
                                {student.branch}
                              </span>
                            ) : (
                              <span className="text-[#9CA3AF]">غير متوفر</span>
                            )}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Emergency Contact Card */}
                <div className="card no-break bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                  {/* Title with Icon */}
                  <div className="flex items-center gap-3 mb-6 pb-3 border-b border-gray-200">
                    <div className="w-1 h-8 bg-gradient-to-b from-red-500 to-red-600 rounded-full"></div>
                    <div className="flex-1">
                      <h2 className="text-[20px] font-black text-gray-900 flex items-center gap-2">
                        <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                        </svg>
                        أقرب شخص له
                      </h2>
                    </div>
                  </div>
                  
                  {/* Emergency Contact Details */}
                  <div className="space-y-4">
                    {/* All Contact Info in One Row */}
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-3 flex-1">
                        <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                        </svg>
                        <div>
                          <p className="text-xs text-[#6B7280] mb-0.5">الاسم</p>
                          <p className="text-base text-gray-900 font-semibold">{student.emergency_contact_name || <span className="text-[#9CA3AF]">غير متوفر</span>}</p>
                        </div>
                      </div>
                      <div className="w-px h-12 bg-gray-200"></div>
                      <div className="flex items-center gap-3 flex-1">
                        <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                        </svg>
                        <div>
                          <p className="text-xs text-[#6B7280] mb-0.5">الهاتف</p>
                          <p className="text-base text-gray-900 font-semibold">
                            {student.emergency_contact_phone ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-sm font-bold bg-green-100 text-green-800">
                                {student.emergency_contact_phone}
                              </span>
                            ) : (
                              <span className="text-[#9CA3AF]">غير متوفر</span>
                            )}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

              </div>

            </div>

          </div>
        </div>
        </div>
      </div>

      {/* Academic Biography Section - A4 Page */}
      {student && (
        <div id="academicBiographySheet" className="app-chrome bg-white shadow-2xl w-[210mm] h-[297mm] mx-auto my-6 print:my-0 print:shadow-none mt-8">
          {/* Main Layout: Sidebar + Content */}
          <div className="flex h-full">
            
            {/* Sidebar - Maroon Vertical Strip */}
            <div className="w-[56px] bg-[#8A2E25] flex flex-col items-center py-6 gap-6 h-full">
              {/* Empty sidebar for consistency */}
            </div>

            {/* Main Content Area */}
            <div className="flex-1 p-6">
              
                             {/* Header: College Logo + Name */}
               <div className="flex items-center gap-4 mb-8 pb-4 border-b border-[#E5E7EB]">
                 <Image 
                   src="/logos/college-logo.png" 
                   alt="شعار الكلية" 
                   width={56}
                   height={56}
                   className="w-14 h-14 rounded-full object-cover"
                 />
                 <div>
                   <h2 className="text-xl font-bold text-[#111827]">كلية الشرق للعلوم التقنية التخصصية</h2>
                   <p className="text-sm text-gray-600 font-medium">AlSharq Technical College for Specialized Sciences</p>
                 </div>
               </div>

              {/* Title */}
              <div className="mb-8 pb-6 border-b-2 border-[#8A2E25]">
                <h1 className="text-[32px] font-black text-[#8A2E25] text-center">السيرة الدراسية</h1>
                <p className="text-lg text-gray-600 text-center mt-2">Student Academic Biography</p>
              </div>

              {/* Content Area - Empty for now */}
              <div className="mt-12">
                {/* This space is reserved for future academic biography content */}
              </div>

            </div>

          </div>
        </div>
      )}

      {/* Documents Gallery Section */}
      {student && (
        <div className="print-hidden max-w-[1200px] mx-auto mt-8 px-6">
          <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
            {/* Progress Bar */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-[24px] font-black text-gray-900">المستمسكات</h2>
                <span className="text-sm font-semibold text-gray-600">
                  {(() => {
                    const docs = [student.photo, student.national_id_copy, student.birth_certificate, student.secondary_certificate, student.medical_certificate, student.medical_examination].filter(doc => doc);
                    return `${docs.length}/6 مكتمل`;
                  })()}
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div 
                  className="bg-green-500 h-2 rounded-full transition-all duration-300"
                  style={{ 
                    width: `${(() => {
                      const docs = [student.photo, student.national_id_copy, student.birth_certificate, student.secondary_certificate, student.medical_certificate, student.medical_examination].filter(doc => doc);
                      return (docs.length / 6) * 100;
                    })()}%` 
                  }}
                ></div>
              </div>
            </div>

                         {/* Gallery Grid */}
             <div className="flex flex-wrap gap-3 justify-center">
                                            {/* Photo */}
                               <div className="bg-white border-2 border-gray-200 rounded-lg overflow-hidden hover:shadow-md transition-all duration-200 w-[120px] flex-shrink-0">
                  <div className="relative h-[70px] bg-gradient-to-br from-blue-50 to-blue-100 flex items-center justify-center">
                   {student.photo ? (
                     <Image 
                       src={`/uploads/students/${student.photo}`}
                       alt="الصورة الشخصية"
                       width={160}
                       height={100}
                       className="w-full h-full object-cover cursor-pointer"
                       onClick={() => setSelectedDocument(`/uploads/students/${student.photo}`)}
                     />
                   ) : (
                                           <svg className="w-8 h-8 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                     </svg>
                   )}
                   {student.photo && (
                     <span className="absolute top-2 right-2 px-2 py-0.5 bg-green-100 text-green-800 text-xs font-semibold rounded-full">مرفوع</span>
                   )}
                                                     </div>
                  <div className="p-1.5">
                    <h3 className="text-[10px] font-semibold text-gray-900 mb-0.5 text-center">الصورة الشخصية</h3>
                                       {student.photo && (
                      <div className="flex gap-0.5">
                        <button
                          onClick={() => setSelectedDocument(`/uploads/students/${student.photo}`)}
                          className="flex-1 px-1 py-0.5 bg-blue-600 text-white text-[10px] font-medium rounded hover:bg-blue-700 transition-colors"
                        >
                          عرض
                        </button>
                        <a
                          href={`/uploads/students/${student.photo}`}
                          download
                          className="px-1 py-0.5 bg-gray-200 text-gray-700 text-[10px] font-medium rounded hover:bg-gray-300 transition-colors"
                        >
                          ⬇
                        </a>
                      </div>
                    )}
                  </div>
               </div>

                               {/* National ID */}
                <div className="bg-white border-2 border-gray-200 rounded-lg overflow-hidden hover:shadow-md transition-all duration-200 w-[120px] flex-shrink-0">
                  <div className="relative h-[70px] bg-gradient-to-br from-green-50 to-green-100 flex items-center justify-center">
                  {student.national_id_copy ? (
                    <Image 
                      src={`/uploads/students/${student.national_id_copy}`}
                      alt="البطاقة الوطنية"
                      width={160}
                      height={120}
                      className="w-full h-full object-cover cursor-pointer"
                      onClick={() => setSelectedDocument(`/uploads/students/${student.national_id_copy}`)}
                    />
                  ) : (
                                         <svg className="w-8 h-8 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" />
                    </svg>
                  )}
                                     {student.national_id_copy && (
                     <span className="absolute top-2 right-2 px-2 py-0.5 bg-green-100 text-green-800 text-xs font-semibold rounded-full">مرفوع</span>
                   )}
                                   </div>
                  <div className="p-1.5">
                    <h3 className="text-[10px] font-semibold text-gray-900 mb-0.5 text-center">البطاقة الوطنية الوجه الأول</h3>
                                      {student.national_id_copy && (
                      <div className="flex gap-0.5">
                        <button
                          onClick={() => setSelectedDocument(`/uploads/students/${student.national_id_copy}`)}
                          className="flex-1 px-1 py-0.5 bg-green-600 text-white text-[10px] font-medium rounded hover:bg-green-700 transition-colors"
                        >
                          عرض
                        </button>
                        <a
                          href={`/uploads/students/${student.national_id_copy}`}
                          download
                          className="px-1 py-0.5 bg-gray-200 text-gray-700 text-[10px] font-medium rounded hover:bg-gray-300 transition-colors"
                        >
                          ⬇
                        </a>
                      </div>
                    )}
                  </div>
               </div>

                               {/* Residence Card Front */}
                <div className="bg-white border-2 border-gray-200 rounded-lg overflow-hidden hover:shadow-md transition-all duration-200 w-[120px] flex-shrink-0">
                  <div className="relative h-[70px] bg-gradient-to-br from-purple-50 to-purple-100 flex items-center justify-center">
                  {student.medical_certificate ? (
                    <Image 
                      src={`/uploads/students/${student.medical_certificate}`}
                      alt="بطاقة السكن الوجه الأول"
                      width={160}
                      height={120}
                      className="w-full h-full object-cover cursor-pointer"
                      onClick={() => setSelectedDocument(`/uploads/students/${student.medical_certificate}`)}
                    />
                  ) : (
                                         <svg className="w-8 h-8 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  )}
                                     {student.medical_certificate && (
                     <span className="absolute top-2 right-2 px-2 py-0.5 bg-green-100 text-green-800 text-xs font-semibold rounded-full">مرفوع</span>
                   )}
                                   </div>
                  <div className="p-1.5">
                    <h3 className="text-[10px] font-semibold text-gray-900 mb-0.5 text-center">بطاقة السكن الوجه الأول</h3>
                                      {student.medical_certificate && (
                      <div className="flex gap-0.5">
                        <button
                          onClick={() => setSelectedDocument(`/uploads/students/${student.medical_certificate}`)}
                          className="flex-1 px-1 py-0.5 bg-purple-600 text-white text-[10px] font-medium rounded hover:bg-purple-700 transition-colors"
                        >
                          عرض
                        </button>
                        <a
                          href={`/uploads/students/${student.medical_certificate}`}
                          download
                          className="px-1 py-0.5 bg-gray-200 text-gray-700 text-[10px] font-medium rounded hover:bg-gray-300 transition-colors"
                        >
                          ⬇
                        </a>
                      </div>
                    )}
                  </div>
               </div>

                               {/* Secondary Certificate */}
                <div className="bg-white border-2 border-gray-200 rounded-lg overflow-hidden hover:shadow-md transition-all duration-200 w-[120px] flex-shrink-0">
                  <div className="relative h-[70px] bg-gradient-to-br from-yellow-50 to-yellow-100 flex items-center justify-center">
                  {student.secondary_certificate ? (
                    <Image 
                      src={`/uploads/students/${student.secondary_certificate}`}
                      alt="شهادة الثانوية"
                      width={160}
                      height={120}
                      className="w-full h-full object-cover cursor-pointer"
                      onClick={() => setSelectedDocument(`/uploads/students/${student.secondary_certificate}`)}
                    />
                  ) : (
                                         <svg className="w-8 h-8 text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                  )}
                                     {student.secondary_certificate && (
                     <span className="absolute top-2 right-2 px-2 py-0.5 bg-green-100 text-green-800 text-xs font-semibold rounded-full">مرفوع</span>
                   )}
                                   </div>
                  <div className="p-1.5">
                    <h3 className="text-[10px] font-semibold text-gray-900 mb-0.5 text-center">وثيقة الإعدادية</h3>
                                      {student.secondary_certificate && (
                      <div className="flex gap-0.5">
                        <button
                          onClick={() => setSelectedDocument(`/uploads/students/${student.secondary_certificate}`)}
                          className="flex-1 px-1 py-0.5 bg-yellow-600 text-white text-[10px] font-medium rounded hover:bg-yellow-700 transition-colors"
                        >
                          عرض
                        </button>
                        <a
                          href={`/uploads/students/${student.secondary_certificate}`}
                          download
                          className="px-1 py-0.5 bg-gray-200 text-gray-700 text-[10px] font-medium rounded hover:bg-gray-300 transition-colors"
                        >
                          ⬇
                        </a>
                      </div>
                    )}
                  </div>
               </div>

                               {/* National ID Back */}
                <div className="bg-white border-2 border-gray-200 rounded-lg overflow-hidden hover:shadow-md transition-all duration-200 w-[120px] flex-shrink-0">
                  <div className="relative h-[70px] bg-gradient-to-br from-red-50 to-red-100 flex items-center justify-center">
                  {student.birth_certificate ? (
                    <Image 
                      src={`/uploads/students/${student.birth_certificate}`}
                      alt="البطاقة الوطنية الوجه الثاني"
                      width={160}
                      height={120}
                      className="w-full h-full object-cover cursor-pointer"
                      onClick={() => setSelectedDocument(`/uploads/students/${student.birth_certificate}`)}
                    />
                  ) : (
                                         <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" />
                    </svg>
                  )}
                                     {student.birth_certificate && (
                     <span className="absolute top-2 right-2 px-2 py-0.5 bg-green-100 text-green-800 text-xs font-semibold rounded-full">مرفوع</span>
                   )}
                                   </div>
                  <div className="p-1.5">
                    <h3 className="text-[10px] font-semibold text-gray-900 mb-0.5 text-center">البطاقة الوطنية الوجه الثاني</h3>
                                      {student.birth_certificate && (
                      <div className="flex gap-0.5">
                        <button
                          onClick={() => setSelectedDocument(`/uploads/students/${student.birth_certificate}`)}
                          className="flex-1 px-1 py-0.5 bg-red-600 text-white text-[10px] font-medium rounded hover:bg-red-700 transition-colors"
                        >
                          عرض
                        </button>
                        <a
                          href={`/uploads/students/${student.birth_certificate}`}
                          download
                          className="px-1 py-0.5 bg-gray-200 text-gray-700 text-[10px] font-medium rounded hover:bg-gray-300 transition-colors"
                        >
                          ⬇
                        </a>
                      </div>
                    )}
                  </div>
               </div>

                               {/* Residence Card Back */}
                <div className="bg-white border-2 border-gray-200 rounded-lg overflow-hidden hover:shadow-md transition-all duration-200 w-[120px] flex-shrink-0">
                  <div className="relative h-[70px] bg-gradient-to-br from-indigo-50 to-indigo-100 flex items-center justify-center">
                  {student.other_documents ? (
                    <Image 
                      src={`/uploads/students/${student.other_documents}`}
                      alt="بطاقة السكن الوجه الثاني"
                      width={160}
                      height={120}
                      className="w-full h-full object-cover cursor-pointer"
                      onClick={() => setSelectedDocument(`/uploads/students/${student.other_documents}`)}
                    />
                  ) : (
                    <svg className="w-8 h-8 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" />
                    </svg>
                  )}
                  {student.other_documents && (
                     <span className="absolute top-2 right-2 px-2 py-0.5 bg-green-100 text-green-800 text-xs font-semibold rounded-full">مرفوع</span>
                   )}
                  </div>
                  <div className="p-1.5">
                    <h3 className="text-[10px] font-semibold text-gray-900 mb-0.5 text-center">بطاقة السكن الوجه الثاني</h3>
                    {student.other_documents && (
                      <div className="flex gap-0.5">
                        <button
                          onClick={() => setSelectedDocument(`/uploads/students/${student.other_documents}`)}
                          className="flex-1 px-1 py-0.5 bg-indigo-600 text-white text-[10px] font-medium rounded hover:bg-indigo-700 transition-colors"
                        >
                          عرض
                        </button>
                        <a
                          href={`/uploads/students/${student.other_documents}`}
                          download
                          className="px-1 py-0.5 bg-gray-200 text-gray-700 text-[10px] font-medium rounded hover:bg-gray-300 transition-colors"
                        >
                          ⬇
                        </a>
                      </div>
                    )}
                  </div>
                </div>

                               {/* Medical Examination */}
                <div className="bg-white border-2 border-gray-200 rounded-lg overflow-hidden hover:shadow-md transition-all duration-200 w-[120px] flex-shrink-0">
                  <div className="relative h-[70px] bg-gradient-to-br from-teal-50 to-teal-100 flex items-center justify-center">
                  {student.medical_examination ? (
                    <Image 
                      src={`/uploads/students/${student.medical_examination}`}
                      alt="الفحص الطبي"
                      width={160}
                      height={120}
                      className="w-full h-full object-cover cursor-pointer"
                      onClick={() => setSelectedDocument(`/uploads/students/${student.medical_examination}`)}
                    />
                  ) : (
                    <svg className="w-8 h-8 text-teal-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                  )}
                  {student.medical_examination && (
                     <span className="absolute top-2 right-2 px-2 py-0.5 bg-green-100 text-green-800 text-xs font-semibold rounded-full">مرفوع</span>
                   )}
                  </div>
                  <div className="p-1.5">
                    <h3 className="text-[10px] font-semibold text-gray-900 mb-0.5 text-center">الفحص الطبي</h3>
                    {student.medical_examination && (
                      <div className="flex gap-0.5">
                        <button
                          onClick={() => setSelectedDocument(`/uploads/students/${student.medical_examination}`)}
                          className="flex-1 px-1 py-0.5 bg-teal-600 text-white text-[10px] font-medium rounded hover:bg-teal-700 transition-colors"
                        >
                          عرض
                        </button>
                        <a
                          href={`/uploads/students/${student.medical_examination}`}
                          download
                          className="px-1 py-0.5 bg-gray-200 text-gray-700 text-[10px] font-medium rounded hover:bg-gray-300 transition-colors"
                        >
                          ⬇
                        </a>
                      </div>
                    )}
                  </div>
                </div>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox Modal */}
      {selectedDocument && (
        <div 
          className="print-hidden fixed inset-0 bg-black bg-opacity-75 z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedDocument(null)}
        >
          <div className="relative max-w-4xl max-h-full">
            <button
              onClick={() => setSelectedDocument(null)}
              className="absolute -top-12 right-0 text-white hover:text-gray-300 text-2xl font-bold"
            >
              ✕ إغلاق
            </button>
                         <Image
               src={selectedDocument}
               alt="مستمسك"
               width={1200}
               height={1600}
               className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
               onClick={(e) => e.stopPropagation()}
               onError={() => {
                 alert('عذراً، لا يمكن تحميل هذه الوثيقة');
                 setSelectedDocument(null);
               }}
             />
          </div>
        </div>
      )}
    </div>
  );
}
