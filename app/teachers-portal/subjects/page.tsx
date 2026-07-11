'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface TeacherSubject {
  subject_id: string;
  subject_name: string;
  department: string;
  stage: string;
  study_type: string;
  academic_year: string;
  semester: string;
  units: number | null;
  student_count: number;
}

interface Teacher {
  id: string;
  full_name: string;
  full_name_ar: string;
  department: string;
}

const stageLabelMap: Record<string, string> = {
  first: 'المرحلة الأولى',
  second: 'المرحلة الثانية',
  third: 'المرحلة الثالثة',
  fourth: 'المرحلة الرابعة'
};

const studyTypeLabelMap: Record<string, string> = {
  morning: 'صباحي',
  evening: 'مسائي'
};

const semesterLabelMap: Record<string, string> = {
  first: 'الفصل الأول',
  second: 'الفصل الثاني'
};

export default function SubjectsPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [teacher, setTeacher] = useState<Teacher | null>(null);
  const [subjects, setSubjects] = useState<TeacherSubject[]>([]);
  const [selectedSubject, setSelectedSubject] = useState<TeacherSubject | null>(null);
  const [showLectureModal, setShowLectureModal] = useState(false);
  const [showAttendanceModal, setShowAttendanceModal] = useState(false);
  const [showEditLectureModal, setShowEditLectureModal] = useState(false);
  const [currentLectureId, setCurrentLectureId] = useState<string | null>(null);
  const [editingLectureId, setEditingLectureId] = useState<string | null>(null);
  const [creatingLecture, setCreatingLecture] = useState(false);
  const [updatingLecture, setUpdatingLecture] = useState(false);
  const [deletingLectureId, setDeletingLectureId] = useState<string | null>(null);
  const [subjectLectures, setSubjectLectures] = useState<Record<string, any[]>>({});
  const [expandedSubjects, setExpandedSubjects] = useState<Record<string, boolean>>({});
  const [loadingLectures, setLoadingLectures] = useState<Record<string, boolean>>({});
  
  // All lectures state
  const [allLectures, setAllLectures] = useState<any[]>([]);
  const [loadingAllLectures, setLoadingAllLectures] = useState(false);
  const [lecturesSearchQuery, setLecturesSearchQuery] = useState('');
  const [lecturesFilterSubject, setLecturesFilterSubject] = useState<string>('all');
  const [lecturesFilterMonth, setLecturesFilterMonth] = useState<string>('all');
  const [showAllLectures, setShowAllLectures] = useState(false);
  const [expandedLectureSubjects, setExpandedLectureSubjects] = useState<Record<string, boolean>>({});
  const [expandedLectureMonths, setExpandedLectureMonths] = useState<Record<string, boolean>>({});
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  
  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [filterStage, setFilterStage] = useState<string>('all');
  const [filterStudyType, setFilterStudyType] = useState<string>('all');
  const [filterAcademicYear, setFilterAcademicYear] = useState<string>('all');
  const [filterSemester, setFilterSemester] = useState<string>('all');

  // Lecture form data
  const [lectureForm, setLectureForm] = useState({
    lecture_date: new Date().toISOString().split('T')[0],
    lecture_time: '',
    duration_minutes: 90,
    topic: '',
    location: '',
    notes: ''
  });

  useEffect(() => {
    fetchData();
    fetchAllLectures();
  }, []);

  // إغلاق القائمة عند الضغط خارجها
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;
      if (
        isMenuOpen &&
        menuRef.current &&
        menuButtonRef.current &&
        !menuRef.current.contains(target) &&
        !menuButtonRef.current.contains(target)
      ) {
        setIsMenuOpen(false);
      }
    };

    if (isMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, [isMenuOpen]);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/teachers-portal/subjects');
      const data = await response.json();

      if (!response.ok || !data.success) {
        if (response.status === 401) {
          router.push('/teachers-portal');
          return;
        }
        const errorMsg = data.error || data.message || 'حدث خطأ في جلب البيانات';
        throw new Error(errorMsg);
      }

      setTeacher(data.teacher);
      setSubjects(data.data || []);
    } catch (err) {
      console.error('خطأ في جلب البيانات:', err);
      setError(err instanceof Error ? err.message : 'حدث خطأ في جلب البيانات');
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      router.push('/teachers-portal');
    } catch (error) {
      console.error('خطأ في تسجيل الخروج:', error);
    }
  };

  const handleCreateLecture = (subject: TeacherSubject) => {
    setSelectedSubject(subject);
    setShowLectureModal(true);
    setLectureForm({
      lecture_date: new Date().toISOString().split('T')[0],
      lecture_time: '',
      duration_minutes: 90,
      topic: '',
      location: '',
      notes: ''
    });
    // جلب المحاضرات المحفوظة لهذه المادة
    fetchLecturesForSubject(subject.subject_id);
  };

  const fetchLecturesForSubject = async (subjectId: string) => {
    try {
      setLoadingLectures(prev => ({ ...prev, [subjectId]: true }));
      const response = await fetch(`/api/teachers-portal/subjects/${subjectId}/lectures`);
      const data = await response.json();

      if (response.ok && data.success) {
        setSubjectLectures(prev => ({ ...prev, [subjectId]: data.data || [] }));
      }
    } catch (err) {
      console.error('خطأ في جلب المحاضرات:', err);
    } finally {
      setLoadingLectures(prev => ({ ...prev, [subjectId]: false }));
    }
  };

  const handleOpenLecture = (lectureId: string) => {
    setCurrentLectureId(lectureId);
    setShowAttendanceModal(true);
  };

  const handleEditLecture = async (lectureId: string) => {
    try {
      setEditingLectureId(lectureId);
      const response = await fetch(`/api/teachers-portal/lectures/${lectureId}`);
      const data = await response.json();

      if (!response.ok || !data.success) {
        if (response.status === 401) {
          try {
            const refreshResponse = await fetch('/api/auth/refresh', { method: 'POST' });
            if (refreshResponse.ok) {
              const retryResponse = await fetch(`/api/teachers-portal/lectures/${lectureId}`);
              const retryData = await retryResponse.json();
              if (retryResponse.ok && retryData.success) {
                setLectureForm({
                  lecture_date: retryData.data.lecture_date ? new Date(retryData.data.lecture_date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
                  lecture_time: retryData.data.lecture_time || '',
                  duration_minutes: retryData.data.duration_minutes || 90,
                  topic: retryData.data.topic || '',
                  location: retryData.data.location || '',
                  notes: retryData.data.notes || ''
                });
                setShowEditLectureModal(true);
                return;
              }
            }
          } catch {
            alert('انتهت جلسة العمل. يرجى تسجيل الدخول مرة أخرى.');
            return;
          }
        }
        throw new Error(data.error || 'حدث خطأ في جلب معلومات المحاضرة');
      }

      setLectureForm({
        lecture_date: data.data.lecture_date ? new Date(data.data.lecture_date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
        lecture_time: data.data.lecture_time || '',
        duration_minutes: data.data.duration_minutes || 90,
        topic: data.data.topic || '',
        location: data.data.location || '',
        notes: data.data.notes || ''
      });
      setShowEditLectureModal(true);
    } catch (err) {
      console.error('خطأ في جلب معلومات المحاضرة:', err);
      alert(err instanceof Error ? err.message : 'حدث خطأ في جلب معلومات المحاضرة');
    }
  };

  const handleUpdateLecture = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!editingLectureId) return;

    try {
      setUpdatingLecture(true);

      const response = await fetch(`/api/teachers-portal/lectures/${editingLectureId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(lectureForm)
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        if (response.status === 401) {
          try {
            const refreshResponse = await fetch('/api/auth/refresh', { method: 'POST' });
            if (refreshResponse.ok) {
              const retryResponse = await fetch(`/api/teachers-portal/lectures/${editingLectureId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(lectureForm)
              });
              const retryData = await retryResponse.json();
              if (retryResponse.ok && retryData.success) {
                alert('تم تحديث المحاضرة بنجاح!');
                setShowEditLectureModal(false);
                setEditingLectureId(null);
                // إعادة تحميل المحاضرات
                fetchAllLectures();
                if (selectedSubject) {
                  fetchLecturesForSubject(selectedSubject.subject_id);
                }
                return;
              }
            }
          } catch {
            alert('انتهت جلسة العمل. يرجى تسجيل الدخول مرة أخرى.');
            return;
          }
        }
        throw new Error(data.error || 'حدث خطأ في تحديث المحاضرة');
      }

      alert('تم تحديث المحاضرة بنجاح!');
      setShowEditLectureModal(false);
      setEditingLectureId(null);
      // إعادة تحميل المحاضرات
      fetchAllLectures();
      if (selectedSubject) {
        fetchLecturesForSubject(selectedSubject.subject_id);
      }
    } catch (err) {
      console.error('خطأ في تحديث المحاضرة:', err);
      alert(err instanceof Error ? err.message : 'حدث خطأ في تحديث المحاضرة');
    } finally {
      setUpdatingLecture(false);
    }
  };

  const handleDeleteLecture = async (lectureId: string) => {
    if (!confirm('هل أنت متأكد من حذف هذه المحاضرة؟ سيتم حذف جميع سجلات الحضور المرتبطة بها أيضاً.')) {
      return;
    }

    try {
      setDeletingLectureId(lectureId);

      const response = await fetch(`/api/teachers-portal/lectures/${lectureId}`, {
        method: 'DELETE'
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        if (response.status === 401) {
          try {
            const refreshResponse = await fetch('/api/auth/refresh', { method: 'POST' });
            if (refreshResponse.ok) {
              const retryResponse = await fetch(`/api/teachers-portal/lectures/${lectureId}`, {
                method: 'DELETE'
              });
              const retryData = await retryResponse.json();
              if (retryResponse.ok && retryData.success) {
                alert('تم حذف المحاضرة بنجاح!');
                // إعادة تحميل المحاضرات
                fetchAllLectures();
                if (selectedSubject) {
                  fetchLecturesForSubject(selectedSubject.subject_id);
                }
                return;
              }
            }
          } catch {
            alert('انتهت جلسة العمل. يرجى تسجيل الدخول مرة أخرى.');
            return;
          }
        }
        throw new Error(data.error || 'حدث خطأ في حذف المحاضرة');
      }

      alert('تم حذف المحاضرة بنجاح!');
      // إعادة تحميل المحاضرات
      fetchAllLectures();
      if (selectedSubject) {
        fetchLecturesForSubject(selectedSubject.subject_id);
      }
    } catch (err) {
      console.error('خطأ في حذف المحاضرة:', err);
      alert(err instanceof Error ? err.message : 'حدث خطأ في حذف المحاضرة');
    } finally {
      setDeletingLectureId(null);
    }
  };

  const handleToggleSubjectLectures = (subjectId: string) => {
    const isCurrentlyExpanded = expandedSubjects[subjectId] || false;
    setExpandedSubjects(prev => ({ ...prev, [subjectId]: !isCurrentlyExpanded }));
    
    // إذا تم فتح القسم لأول مرة، جلب المحاضرات
    if (!isCurrentlyExpanded && !subjectLectures[subjectId]) {
      fetchLecturesForSubject(subjectId);
    }
  };

  const fetchAllLectures = async () => {
    try {
      setLoadingAllLectures(true);
      const response = await fetch('/api/teachers-portal/lectures');
      const data = await response.json();

      if (response.ok && data.success) {
        setAllLectures(data.data || []);
      }
    } catch (err) {
      console.error('خطأ في جلب جميع المحاضرات:', err);
    } finally {
      setLoadingAllLectures(false);
    }
  };

  const handleSubmitLecture = async (e: React.FormEvent, openAttendance: boolean = false) => {
    e.preventDefault();
    
    if (!selectedSubject) return;

    try {
      setCreatingLecture(true);

      const response = await fetch('/api/teachers-portal/lectures', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject_id: selectedSubject.subject_id,
          ...lectureForm
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        if (response.status === 401) {
          // محاولة تجديد token
          try {
            const refreshResponse = await fetch('/api/auth/refresh', {
              method: 'POST'
            });
            if (refreshResponse.ok) {
              // إعادة المحاولة
              const retryResponse = await fetch('/api/teachers-portal/lectures', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  subject_id: selectedSubject.subject_id,
                  ...lectureForm
                })
              });
              const retryData = await retryResponse.json();
              if (retryResponse.ok && retryData.success) {
                if (!retryData.data || !retryData.data.lecture_id) {
                  throw new Error('لم يتم إنشاء المحاضرة بشكل صحيح');
                }
                console.log('تم إنشاء المحاضرة بنجاح (بعد التجديد):', retryData.data.lecture_id);
                setShowLectureModal(false);
                
                // إذا كان مطلوب فتح نافذة الحضور
                if (openAttendance) {
                  setCurrentLectureId(retryData.data.lecture_id);
                  setTimeout(() => {
                    setShowAttendanceModal(true);
                  }, 500);
                } else {
                  alert('تم حفظ المحاضرة بنجاح! يمكنك فتحها لاحقاً لتسجيل الحضور.');
                  // إعادة تحميل البيانات إذا لزم الأمر
                  if (selectedSubject) {
                    fetchLecturesForSubject(selectedSubject.subject_id);
                  }
                  // إعادة تحميل جميع المحاضرات
                  fetchAllLectures();
                }
                return;
              }
            }
          } catch {
            // إذا فشل التجديد، إعادة توجيه
            alert('انتهت جلسة العمل. يرجى تسجيل الدخول مرة أخرى.');
            router.push('/teachers-portal');
            return;
          }
        }
        throw new Error(data.error || 'حدث خطأ في إنشاء المحاضرة');
      }

      // التأكد من أن lecture_id موجود
      if (!data.data || !data.data.lecture_id) {
        throw new Error('لم يتم إنشاء المحاضرة بشكل صحيح');
      }
      
      console.log('تم إنشاء المحاضرة بنجاح:', data.data.lecture_id);
      setShowLectureModal(false);
      
      // إذا كان مطلوب فتح نافذة الحضور
      if (openAttendance) {
        setCurrentLectureId(data.data.lecture_id);
        setTimeout(() => {
          setShowAttendanceModal(true);
        }, 500);
      } else {
        alert('تم حفظ المحاضرة بنجاح! يمكنك فتحها لاحقاً لتسجيل الحضور.');
        // إعادة تحميل البيانات إذا لزم الأمر
        if (selectedSubject) {
          fetchLecturesForSubject(selectedSubject.subject_id);
        }
        // إعادة تحميل جميع المحاضرات
        fetchAllLectures();
      }
    } catch (err) {
      console.error('خطأ في إنشاء المحاضرة:', err);
      alert(err instanceof Error ? err.message : 'حدث خطأ في إنشاء المحاضرة');
    } finally {
      setCreatingLecture(false);
    }
  };

  // Filtered subjects
  const filteredSubjects = useMemo(() => {
    return subjects.filter((subject) => {
      const matchesSearch = searchQuery === '' || 
        subject.subject_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        subject.department.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesStage = filterStage === 'all' || subject.stage === filterStage;
      const matchesStudyType = filterStudyType === 'all' || subject.study_type === filterStudyType;
      const matchesAcademicYear = filterAcademicYear === 'all' || subject.academic_year === filterAcademicYear;
      const matchesSemester = filterSemester === 'all' || subject.semester === filterSemester;

      return matchesSearch && matchesStage && matchesStudyType && matchesAcademicYear && matchesSemester;
    });
  }, [subjects, searchQuery, filterStage, filterStudyType, filterAcademicYear, filterSemester]);

  // Unique values for filters
  const uniqueStages = useMemo(() => {
    return Array.from(new Set(subjects.map((s) => s.stage)));
  }, [subjects]);

  const uniqueStudyTypes = useMemo(() => {
    return Array.from(new Set(subjects.map((s) => s.study_type)));
  }, [subjects]);

  const uniqueAcademicYears = useMemo(() => {
    return Array.from(new Set(subjects.map((s) => s.academic_year))).sort().reverse();
  }, [subjects]);

  // Statistics - Subjects Specific
  const stats = useMemo(() => {
    const totalSubjects = subjects.length;
    const totalStudents = subjects.reduce((sum, s) => sum + (s.student_count || 0), 0);
    const filteredSubjectsCount = filteredSubjects.length;
    const totalLectures = allLectures.length;
    
    return {
      totalSubjects,
      totalStudents,
      filteredSubjects: filteredSubjectsCount,
      totalLectures
    };
  }, [subjects, filteredSubjects, allLectures]);

  // Filtered lectures
  const filteredLectures = useMemo(() => {
    return allLectures.filter((lecture) => {
      const matchesSearch = lecturesSearchQuery === '' ||
        (lecture.topic || '').toLowerCase().includes(lecturesSearchQuery.toLowerCase()) ||
        (lecture.subject_name || '').toLowerCase().includes(lecturesSearchQuery.toLowerCase());
      const matchesSubject = lecturesFilterSubject === 'all' || lecture.subject_name === lecturesFilterSubject;
      
      // Filter by month
      let matchesMonth = true;
      if (lecturesFilterMonth !== 'all') {
        const lectureDate = new Date(lecture.lecture_date);
        const lectureMonth = `${lectureDate.getFullYear()}-${String(lectureDate.getMonth() + 1).padStart(2, '0')}`;
        matchesMonth = lectureMonth === lecturesFilterMonth;
      }
      
      return matchesSearch && matchesSubject && matchesMonth;
    }).sort((a, b) => {
      // Sort by date (newest first)
      return new Date(b.lecture_date).getTime() - new Date(a.lecture_date).getTime();
    });
  }, [allLectures, lecturesSearchQuery, lecturesFilterSubject, lecturesFilterMonth]);

  // Group lectures by subject and month
  const groupedLectures = useMemo(() => {
    const groups: Record<string, { subjectInfo: any, months: Record<string, { monthName: string, lectures: any[] }> }> = {};
    
    filteredLectures.forEach((lecture) => {
      const subjectKey = lecture.subject_id || lecture.subject_name;
      
      if (!groups[subjectKey]) {
        groups[subjectKey] = {
          subjectInfo: {
            subject_id: lecture.subject_id,
            subject_name: lecture.subject_name,
            department: lecture.department,
            stage: lecture.stage,
            study_type: lecture.study_type,
            academic_year: lecture.academic_year,
            semester: lecture.semester
          },
          months: {}
        };
      }
      
      const lectureDate = new Date(lecture.lecture_date);
      const monthKey = `${lectureDate.getFullYear()}-${String(lectureDate.getMonth() + 1).padStart(2, '0')}`;
      // استخدام تقويم ميلادي فقط
      const monthNames = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
      const monthName = `${monthNames[lectureDate.getMonth()]} ${lectureDate.getFullYear()}`;
      
      if (!groups[subjectKey].months[monthKey]) {
        groups[subjectKey].months[monthKey] = {
          monthName,
          lectures: []
        };
      }
      
      groups[subjectKey].months[monthKey].lectures.push(lecture);
    });
    
    return groups;
  }, [filteredLectures]);

  // Get unique months for filter
  const uniqueMonths = useMemo(() => {
    const months = new Set<string>();
    allLectures.forEach((lecture) => {
      const lectureDate = new Date(lecture.lecture_date);
      const monthKey = `${lectureDate.getFullYear()}-${String(lectureDate.getMonth() + 1).padStart(2, '0')}`;
      // استخدام تقويم ميلادي فقط
      const monthNames = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
      const monthName = `${monthNames[lectureDate.getMonth()]} ${lectureDate.getFullYear()}`;
      months.add(`${monthKey}|${monthName}`);
    });
    
    return Array.from(months)
      .map(m => {
        const [key, name] = m.split('|');
        return { key, name };
      })
      .sort((a, b) => b.key.localeCompare(a.key)); // Sort newest first
  }, [allLectures]);

  // Toggle subject expansion
  const toggleSubjectExpansion = (subjectKey: string) => {
    setExpandedLectureSubjects(prev => ({
      ...prev,
      [subjectKey]: !prev[subjectKey]
    }));
  };

  // Toggle month expansion
  const toggleMonthExpansion = (subjectKey: string, monthKey: string) => {
    const key = `${subjectKey}-${monthKey}`;
    setExpandedLectureMonths(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 safe-area-inset flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">جاري التحميل...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 safe-area-inset">
        <header className="bg-white border-b border-gray-200 sticky top-0 z-40 shadow-sm">
          <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-3 sm:py-4">
            <div className="flex items-center justify-between gap-2">
              <Link href="/teachers-portal/dashboard" className="text-lg sm:text-xl font-bold text-red-600">
                بوابة التدريسين
              </Link>
              <button
                onClick={handleLogout}
                className="text-gray-500 hover:text-gray-700 px-3 py-2 text-sm font-medium"
              >
                خروج
              </button>
            </div>
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-4 sm:py-6">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800 text-center">
            <p className="whitespace-pre-line">{error}</p>
            <button
              onClick={fetchData}
              className="mt-4 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
            >
              إعادة المحاولة
            </button>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 safe-area-inset">
      {/* Main Content */}
      <main className="pb-20 sm:pb-8">
        {teacher ? (
          <>
            {/* Welcome Section - Merged Header */}
            <div className="bg-gradient-to-r from-red-600 to-red-700 shadow-lg sticky top-0 z-40">
              <div className="w-full px-3 sm:px-4 lg:px-8 py-3 sm:py-4">
                <div className="flex items-center justify-between gap-2 sm:gap-4 flex-wrap">
                  {/* Left Side - Welcome */}
                  <div className="flex items-center gap-2 sm:gap-4 min-w-0 flex-1">
                    {/* Mobile Menu Button */}
                    <button
                      ref={menuButtonRef}
                      onClick={() => setIsMenuOpen(!isMenuOpen)}
                      className="sm:hidden p-2 text-white hover:bg-white/10 rounded transition-colors touch-manipulation"
                      aria-label="القائمة"
                      aria-expanded={isMenuOpen}
                    >
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        {isMenuOpen ? (
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        ) : (
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                        )}
                      </svg>
                    </button>
                    {/* Desktop Welcome */}
                    <div className="hidden sm:block">
                      <h1 className="text-base sm:text-lg md:text-xl font-bold text-white truncate">مرحباً {teacher.full_name_ar}</h1>
                      <p className="text-xs sm:text-sm text-red-100 truncate">القسم: {teacher.department}</p>
                    </div>
                    {/* Mobile Welcome */}
                    <div className="sm:hidden min-w-0 flex-1">
                      <div className="text-xs font-bold text-white truncate">مرحباً {teacher.full_name_ar}</div>
                      <div className="text-[10px] text-red-100 truncate">القسم: {teacher.department}</div>
                    </div>
                  </div>
                  
                  {/* Right Side - User, Logout */}
                  <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
                    {/* اسم المستخدم */}
                    <span className="text-white text-xs sm:text-sm font-medium hidden xs:inline truncate max-w-[120px] sm:max-w-none">
                      {teacher.full_name_ar}
                    </span>
                    {/* زر الخروج */}
                    <button
                      onClick={handleLogout}
                      className="text-white hover:text-red-100 active:text-red-200 px-2 sm:px-3 py-1.5 sm:py-2 text-xs sm:text-sm font-medium touch-manipulation whitespace-nowrap border border-white/30 hover:border-white/50 rounded transition-colors flex-shrink-0"
                    >
                      خروج
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Mobile Menu - Overlay */}
            {isMenuOpen && (
              <div ref={menuRef} className="fixed left-0 right-0 bg-white border-t border-gray-200 shadow-xl z-[50] sm:hidden overflow-y-auto" style={{ top: '73px', maxHeight: 'calc(100vh - 73px)' }}>
                  <div className="px-4 py-3 space-y-2">
                  <Link
                    href="/teachers-portal/dashboard"
                    onClick={() => setIsMenuOpen(false)}
                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-gray-50 transition-colors touch-manipulation border border-gray-100"
                  >
                    <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-gray-900">الصفحة الرئيسية</h3>
                      <p className="text-xs text-gray-600">لوحة التحكم</p>
                    </div>
                  </Link>

                  <Link
                    href="/teachers-portal/profile"
                    onClick={() => setIsMenuOpen(false)}
                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-red-50 transition-colors touch-manipulation border border-gray-100"
                  >
                    <div className="w-10 h-10 bg-red-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-gray-900">ملفي الشخصي</h3>
                      <p className="text-xs text-gray-600">عرض وتعديل بياناتي</p>
                    </div>
                  </Link>

                  <Link
                    href="/teachers-portal/my-students"
                    onClick={() => setIsMenuOpen(false)}
                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-blue-50 transition-colors touch-manipulation border border-gray-100"
                  >
                    <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-gray-900">طلابي</h3>
                      <p className="text-xs text-gray-600">عرض وإدارة طلابي</p>
                    </div>
                  </Link>

                  <Link
                    href="/teachers-portal/grades"
                    onClick={() => setIsMenuOpen(false)}
                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-green-50 transition-colors touch-manipulation border border-gray-100"
                  >
                    <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-gray-900">الدرجات</h3>
                      <p className="text-xs text-gray-600">إدخال درجات الامتحانات</p>
                    </div>
                  </Link>

                  <Link
                    href="/teachers-portal/attendance"
                    onClick={() => setIsMenuOpen(false)}
                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-yellow-50 transition-colors touch-manipulation border border-gray-100"
                  >
                    <div className="w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-gray-900">الحضور والغياب</h3>
                      <p className="text-xs text-gray-600">تسجيل الحضور اليومي</p>
                    </div>
                  </Link>

                  <Link
                    href="/teachers-portal/subjects"
                    onClick={() => setIsMenuOpen(false)}
                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-purple-50 transition-colors touch-manipulation border border-gray-100"
                  >
                    <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-gray-900">موادي التدريسية</h3>
                      <p className="text-xs text-gray-600">إدارة المحاضرات والحضور</p>
                    </div>
                  </Link>

                  <Link
                    href="/teachers-portal/calendar"
                    onClick={() => setIsMenuOpen(false)}
                    className="flex items-center gap-3 p-3 rounded-lg hover:bg-indigo-50 transition-colors touch-manipulation border border-gray-100"
                  >
                    <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center flex-shrink-0">
                      <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-gray-900">التقويم الجامعي</h3>
                      <p className="text-xs text-gray-600">إدارة المحاضرات والامتحانات والأحداث</p>
                    </div>
                  </Link>
                  </div>
                </div>
            )}

            {/* Main Content */}
            <div className="max-w-7xl mx-auto px-3 sm:px-4 lg:px-8 py-4 sm:py-6 lg:py-8">
              {/* Statistics Cards - Subjects Specific */}
              {stats.totalSubjects > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">
                  {/* Total Subjects Card */}
                  <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
                    <div className="bg-gradient-to-br from-red-50 to-red-100 px-4 py-3 border-b border-red-200">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center flex-shrink-0">
                          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                          </svg>
                        </div>
                        <p className="text-xs sm:text-sm font-medium text-gray-700 truncate">عدد المواد</p>
                      </div>
                    </div>
                    <div className="p-4">
                      <p className="text-2xl sm:text-3xl font-bold text-red-700">{stats.totalSubjects}</p>
                      <p className="text-xs text-gray-500 mt-1">مادة دراسية</p>
                    </div>
                  </div>

                  {/* Total Students Card */}
                  <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
                    <div className="bg-gradient-to-br from-red-50 to-red-100 px-4 py-3 border-b border-red-200">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center flex-shrink-0">
                          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                          </svg>
                        </div>
                        <p className="text-xs sm:text-sm font-medium text-gray-700 truncate">إجمالي الطلاب</p>
                      </div>
                    </div>
                    <div className="p-4">
                      <p className="text-2xl sm:text-3xl font-bold text-red-700">{stats.totalStudents}</p>
                      <p className="text-xs text-gray-500 mt-1">طالب مسجل</p>
                    </div>
                  </div>

                  {/* Total Lectures Card */}
                  <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
                    <div className="bg-gradient-to-br from-red-50 to-red-100 px-4 py-3 border-b border-red-200">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center flex-shrink-0">
                          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                          </svg>
                        </div>
                        <p className="text-xs sm:text-sm font-medium text-gray-700 truncate">إجمالي المحاضرات</p>
                      </div>
                    </div>
                    <div className="p-4">
                      <p className="text-2xl sm:text-3xl font-bold text-red-700">{stats.totalLectures}</p>
                      <p className="text-xs text-gray-500 mt-1">محاضرة محفوظة</p>
                    </div>
                  </div>

                  {/* Filtered Subjects Card */}
                  <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
                    <div className="bg-gradient-to-br from-red-50 to-red-100 px-4 py-3 border-b border-red-200">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center flex-shrink-0">
                          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        </div>
                        <p className="text-xs sm:text-sm font-medium text-gray-700 truncate">المواد المعروضة</p>
                      </div>
                    </div>
                    <div className="p-4">
                      <p className="text-2xl sm:text-3xl font-bold text-red-700">{stats.filteredSubjects}</p>
                      <p className="text-xs text-gray-500 mt-1">بعد التصفية</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Filters and Search */}
              {subjects.length > 0 && (
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden mb-4 sm:mb-6 hover:shadow-md transition-shadow">
                  <div className="bg-gradient-to-r from-red-50 to-red-100 px-4 sm:px-5 md:px-6 py-3 sm:py-4 border-b border-red-200">
                    <div className="flex items-center gap-2 sm:gap-3">
                      <div className="w-8 h-8 sm:w-10 sm:h-10 bg-red-600 rounded-lg flex items-center justify-center flex-shrink-0">
                        <svg className="w-4 h-4 sm:w-5 sm:h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                        </svg>
                      </div>
                      <h2 className="text-base sm:text-lg font-bold text-gray-900">البحث والتصفية</h2>
                    </div>
                  </div>
                  <div className="p-4 sm:p-5 md:p-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                      {/* Search */}
                      <div className="sm:col-span-2 lg:col-span-3">
                        <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5">
                          <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                          </svg>
                          بحث
                        </label>
                        <div className="relative">
                          <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="ابحث باسم المادة أو القسم..."
                            className="w-full px-4 py-2.5 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base bg-white"
                          />
                          <svg className="absolute right-3 top-3 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                          </svg>
                        </div>
                      </div>

                      {/* Stage Filter */}
                      <div>
                        <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5">
                          <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                          </svg>
                          المرحلة
                        </label>
                        <select
                          value={filterStage}
                          onChange={(e) => setFilterStage(e.target.value)}
                          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base bg-white"
                        >
                          <option value="all">الكل</option>
                          {uniqueStages.map((stage) => (
                            <option key={stage} value={stage}>
                              {stageLabelMap[stage] || stage}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Study Type Filter */}
                      <div>
                        <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5">
                          <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          نوع الدراسة
                        </label>
                        <select
                          value={filterStudyType}
                          onChange={(e) => setFilterStudyType(e.target.value)}
                          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base bg-white"
                        >
                          <option value="all">الكل</option>
                          {uniqueStudyTypes.map((type) => (
                            <option key={type} value={type}>
                              {studyTypeLabelMap[type] || type}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Academic Year Filter */}
                      <div>
                        <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5">
                          <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          السنة الأكاديمية
                        </label>
                        <select
                          value={filterAcademicYear}
                          onChange={(e) => setFilterAcademicYear(e.target.value)}
                          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base bg-white"
                        >
                          <option value="all">الكل</option>
                          {uniqueAcademicYears.map((year) => (
                            <option key={year} value={year}>
                              {year}
                            </option>
                          ))}
                        </select>
                      </div>

                      {/* Semester Filter */}
                      <div>
                        <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5">
                          <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                          </svg>
                          الفصل
                        </label>
                        <select
                          value={filterSemester}
                          onChange={(e) => setFilterSemester(e.target.value)}
                          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base bg-white"
                        >
                          <option value="all">الكل</option>
                          <option value="first">الأول</option>
                          <option value="second">الثاني</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* All Lectures Section - Full width on mobile */}
              <div className="mb-6 sm:mb-8">
                <div className="bg-white rounded-none sm:rounded-xl shadow-sm border-x-0 sm:border-x border-t border-b sm:border border-gray-200 overflow-hidden hover:shadow-md transition-shadow -mx-3 sm:mx-0 w-[calc(100%+1.5rem)] sm:w-auto">
                  <div className="bg-gradient-to-r from-red-50 to-red-100 px-4 sm:px-6 py-4 border-b border-red-200">
                    <div className="flex items-center justify-between flex-wrap gap-3">
                      <div className="flex items-center gap-2 sm:gap-3">
                        <div className="w-8 h-8 sm:w-10 sm:h-10 bg-red-600 rounded-lg flex items-center justify-center flex-shrink-0">
                          <svg className="w-4 h-4 sm:w-5 sm:h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                          </svg>
                        </div>
                        <h2 className="text-base sm:text-lg md:text-xl font-bold text-gray-900">
                          المحاضرات المحفوظة
                          {allLectures.length > 0 && (
                            <span className="mr-2 text-sm sm:text-base font-normal text-gray-600">
                              ({allLectures.length})
                            </span>
                          )}
                        </h2>
                      </div>
                      <button
                        onClick={() => {
                          setShowAllLectures(!showAllLectures);
                          if (!showAllLectures && allLectures.length === 0) {
                            fetchAllLectures();
                          }
                        }}
                        className="px-4 py-2 bg-gradient-to-r from-red-600 to-red-700 text-white rounded-lg hover:from-red-700 hover:to-red-800 transition-all text-sm font-medium shadow-sm hover:shadow-md"
                      >
                        {showAllLectures ? 'إخفاء' : 'عرض جميع المحاضرات'}
                      </button>
                    </div>
                  </div>

                  {showAllLectures && (
                    <div className="p-4 sm:p-6">
                      {/* Search and Filters */}
                      <div className="mb-4 sm:mb-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                        <div className="lg:col-span-3">
                          <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5">
                            <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                            </svg>
                            بحث
                          </label>
                          <input
                            type="text"
                            value={lecturesSearchQuery}
                            onChange={(e) => setLecturesSearchQuery(e.target.value)}
                            placeholder="ابحث بعنوان المحاضرة أو المادة..."
                            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base bg-white"
                          />
                        </div>
                        <div>
                          <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5">
                            <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                            </svg>
                            المادة الدراسية
                          </label>
                          <select
                            value={lecturesFilterSubject}
                            onChange={(e) => setLecturesFilterSubject(e.target.value)}
                            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base bg-white"
                          >
                            <option value="all">الكل</option>
                            {Array.from(new Set(allLectures.map(l => l.subject_name))).map((subjectName) => (
                              <option key={subjectName} value={subjectName}>
                                {subjectName.length > 30 ? `${subjectName.substring(0, 30)}...` : subjectName}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs sm:text-sm font-medium text-gray-700 mb-2 flex items-center gap-1.5">
                            <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            الشهر
                          </label>
                          <select
                            value={lecturesFilterMonth}
                            onChange={(e) => setLecturesFilterMonth(e.target.value)}
                            className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-sm sm:text-base bg-white"
                          >
                            <option value="all">الكل</option>
                            {uniqueMonths.map((month) => (
                              <option key={month.key} value={month.key}>
                                {month.name}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>

                {/* Lectures List */}
                {loadingAllLectures ? (
                  <div className="text-center py-12">
                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto"></div>
                    <p className="mt-4 text-gray-600">جاري التحميل...</p>
                  </div>
                ) : Object.keys(groupedLectures).length === 0 ? (
                  <div className="text-center py-12">
                    <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <h3 className="mt-2 text-sm font-medium text-gray-900">
                      {allLectures.length === 0 ? 'لا توجد محاضرات محفوظة' : 'لا توجد نتائج'}
                    </h3>
                    <p className="mt-1 text-sm text-gray-500">
                      {allLectures.length === 0
                        ? 'لم يتم إنشاء أي محاضرة بعد'
                        : 'لم يتم العثور على محاضرات تطابق معايير البحث'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {Object.entries(groupedLectures).map(([subjectKey, subjectData]) => {
                      const totalLectures = Object.values(subjectData.months).reduce((sum, month) => sum + month.lectures.length, 0);
                      const isExpanded = expandedLectureSubjects[subjectKey] !== false; // Default to expanded
                      
                      return (
                        <div key={subjectKey} className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm hover:shadow-md transition-shadow">
                          {/* Subject Header */}
                          <button
                            onClick={() => toggleSubjectExpansion(subjectKey)}
                            className="w-full px-4 sm:px-6 py-3 sm:py-4 bg-gradient-to-r from-red-50 to-red-100 hover:from-red-100 hover:to-red-200 transition-colors text-right border-b border-red-200"
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex-1 min-w-0 text-right">
                                <h3 className="text-base sm:text-lg font-bold text-gray-900 mb-1 truncate">
                                  {subjectData.subjectInfo.subject_name}
                                </h3>
                                <div className="flex flex-wrap items-center gap-2 justify-end">
                                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800 border border-red-200">
                                    {subjectData.subjectInfo.department}
                                  </span>
                                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800 border border-red-200">
                                    {stageLabelMap[subjectData.subjectInfo.stage] || subjectData.subjectInfo.stage}
                                  </span>
                                  <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-red-600 text-white">
                                    {totalLectures} محاضرة
                                  </span>
                                </div>
                              </div>
                              <svg
                                className={`w-5 h-5 text-gray-600 flex-shrink-0 transform transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            </div>
                          </button>
                          
                          {/* Subject Content - Months */}
                          {isExpanded && (
                            <div className="p-4 sm:p-6 space-y-4 border-t border-gray-200">
                              {Object.entries(subjectData.months)
                                .sort((a, b) => b[0].localeCompare(a[0])) // Sort months newest first
                                .map(([monthKey, monthData]) => {
                                  const monthExpansionKey = `${subjectKey}-${monthKey}`;
                                  const isMonthExpanded = expandedLectureMonths[monthExpansionKey] !== false; // Default to expanded
                                  
                                  return (
                                    <div key={monthKey} className="border border-gray-200 rounded-lg overflow-hidden">
                                      {/* Month Header */}
                                      <button
                                        onClick={() => toggleMonthExpansion(subjectKey, monthKey)}
                                        className="w-full px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors text-right"
                                      >
                                        <div className="flex items-center justify-between gap-3">
                                          <div className="flex items-center gap-2">
                                            <span className="text-sm sm:text-base font-semibold text-gray-900">
                                              {monthData.monthName}
                                            </span>
                                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-200 text-gray-800">
                                              {monthData.lectures.length} محاضرة
                                            </span>
                                          </div>
                                          <svg
                                            className={`w-5 h-5 text-gray-600 transform transition-transform ${isMonthExpanded ? 'rotate-180' : ''}`}
                                            fill="none"
                                            stroke="currentColor"
                                            viewBox="0 0 24 24"
                                          >
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                          </svg>
                                        </div>
                                      </button>
                                      
                                      {/* Month Content - Lectures */}
                                      {isMonthExpanded && (
                                        <div className="p-3 sm:p-4 space-y-2 bg-gray-50">
                                          {monthData.lectures.map((lecture) => (
                                            <div
                                              key={lecture.id}
                                              className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4 hover:border-blue-300 hover:shadow-sm transition-all"
                                            >
                                              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                                                <div className="flex-1 min-w-0">
                                                  <div className="flex items-start gap-2 sm:gap-3 mb-2">
                                                    <div className="bg-blue-100 rounded-lg p-2 flex-shrink-0">
                                                      <svg className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                                                      </svg>
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                      <h4 className="text-sm sm:text-base font-semibold text-gray-900 mb-1">
                                                        {lecture.topic || 'بدون عنوان'}
                                                      </h4>
                                                      <div className="text-xs sm:text-sm text-gray-600 space-y-1">
                                                        <p>
                                                          📅 <span className="font-medium">{new Date(lecture.lecture_date).toLocaleDateString('en-US')}</span>
                                                          {lecture.lecture_time && (
                                                            <> - ⏰ <span className="font-medium">{lecture.lecture_time}</span></>
                                                          )}
                                                        </p>
                                                        {lecture.location && (
                                                          <p>📍 <span className="font-medium">{lecture.location}</span></p>
                                                        )}
                                                      </div>
                                                    </div>
                                                  </div>
                                                  {lecture.attendance_stats && lecture.attendance_stats.total > 0 && (
                                                    <div className="mt-2 flex items-center gap-2 text-xs sm:text-sm">
                                                      <span className="text-gray-600">الحضور:</span>
                                                      <span className="font-medium text-green-600">
                                                        {lecture.attendance_stats.present}
                                                      </span>
                                                      <span className="text-gray-400">/</span>
                                                      <span className="font-medium text-gray-700">
                                                        {lecture.attendance_stats.total}
                                                      </span>
                                                    </div>
                                                  )}
                                                </div>
                                                <div className="flex flex-col gap-2 sm:flex-shrink-0">
                                                  <button
                                                    onClick={() => handleOpenLecture(lecture.id)}
                                                    className="px-3 sm:px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-xs sm:text-sm font-medium whitespace-nowrap"
                                                  >
                                                    فتح لتسجيل الحضور
                                                  </button>
                                                  <div className="flex gap-2">
                                                    <button
                                                      onClick={() => handleEditLecture(lecture.id)}
                                                      className="flex-1 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-xs font-medium"
                                                    >
                                                      تعديل
                                                    </button>
                                                    <button
                                                      onClick={() => handleDeleteLecture(lecture.id)}
                                                      disabled={deletingLectureId === lecture.id}
                                                      className="flex-1 px-3 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                                                    >
                                                      {deletingLectureId === lecture.id ? 'جاري...' : 'حذف'}
                                                    </button>
                                                  </div>
                                                </div>
                                              </div>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Subjects Grid */}
        {filteredSubjects.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 sm:p-12 text-center">
            <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            <h3 className="mt-2 text-sm sm:text-base font-medium text-gray-900">
              {subjects.length === 0 ? 'لا توجد مواد دراسية' : 'لا توجد نتائج'}
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              {subjects.length === 0 
                ? 'لا توجد مواد دراسية مرتبطة بك حالياً' 
                : 'لم يتم العثور على مواد تطابق معايير البحث'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {filteredSubjects.map((subject) => (
              <div
                key={subject.subject_id}
                className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-lg transition-shadow"
              >
                {/* Subject Header */}
                <div className="bg-gradient-to-r from-red-600 via-red-700 to-red-800 px-4 sm:px-6 py-4 sm:py-5 text-white">
                  <div className="flex items-center gap-2 sm:gap-3 mb-2">
                    <div className="w-8 h-8 sm:w-10 sm:h-10 bg-white/20 backdrop-blur-sm rounded-lg flex items-center justify-center flex-shrink-0">
                      <svg className="w-4 h-4 sm:w-5 sm:h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                      </svg>
                    </div>
                    <h3 className="text-base sm:text-lg md:text-xl font-bold line-clamp-2 min-h-[3rem] flex-1">
                      {subject.subject_name}
                    </h3>
                  </div>
                  
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-white/20 backdrop-blur-sm text-white border border-white/30">
                      {stageLabelMap[subject.stage] || subject.stage}
                    </span>
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-white/20 backdrop-blur-sm text-white border border-white/30">
                      {studyTypeLabelMap[subject.study_type] || subject.study_type}
                    </span>
                    <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-white/20 backdrop-blur-sm text-white border border-white/30">
                      {semesterLabelMap[subject.semester] || subject.semester}
                    </span>
                  </div>
                </div>

                <div className="p-4 sm:p-6">
                  <div className="space-y-3 sm:space-y-4 mb-4 sm:mb-6">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3">
                      <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                        <div className="flex items-center gap-2 mb-1">
                          <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                          </svg>
                          <p className="text-xs text-gray-500">القسم</p>
                        </div>
                        <p className="text-sm font-semibold text-gray-900">{subject.department}</p>
                      </div>
                      
                      <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                        <div className="flex items-center gap-2 mb-1">
                          <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                          <p className="text-xs text-gray-500">السنة الأكاديمية</p>
                        </div>
                        <p className="text-sm font-semibold text-gray-900">{subject.academic_year}</p>
                      </div>
                      
                      {subject.units && (
                        <div className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                          <div className="flex items-center gap-2 mb-1">
                            <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h4m1 8l-4-4H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-3l-4 4z" />
                            </svg>
                            <p className="text-xs text-gray-500">الوحدات</p>
                          </div>
                          <p className="text-sm font-semibold text-gray-900">{subject.units}</p>
                        </div>
                      )}
                      
                      <div className="bg-red-50 rounded-lg p-3 border border-red-200">
                        <div className="flex items-center gap-2 mb-1">
                          <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                          </svg>
                          <p className="text-xs text-red-600">عدد الطلاب</p>
                        </div>
                        <p className="text-sm font-bold text-red-700">{subject.student_count}</p>
                      </div>
                    </div>
                  </div>

                  {/* المحاضرات المحفوظة */}
                  {subjectLectures[subject.subject_id] && subjectLectures[subject.subject_id].length > 0 && (
                    <div className="mb-4 sm:mb-6 border-t border-gray-200 pt-4">
                      <button
                        onClick={() => handleToggleSubjectLectures(subject.subject_id)}
                        className="w-full flex items-center justify-between px-3 py-2 bg-gradient-to-r from-red-50 to-red-100 hover:from-red-100 hover:to-red-200 rounded-lg transition-colors text-sm font-medium text-gray-700 hover:text-gray-900 mb-3 border border-red-200"
                      >
                        <span className="flex items-center gap-2">
                          <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                          </svg>
                          المحاضرات المحفوظة ({subjectLectures[subject.subject_id]?.length || 0})
                        </span>
                        <svg
                          className={`w-5 h-5 text-red-600 transform transition-transform ${expandedSubjects[subject.subject_id] ? 'rotate-180' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      
                      {expandedSubjects[subject.subject_id] && (
                        <div className="space-y-2 mt-2 max-h-60 overflow-y-auto">
                          {subjectLectures[subject.subject_id].map((lecture: any) => (
                            <div
                              key={lecture.id}
                              className="bg-gradient-to-r from-gray-50 to-red-50 rounded-lg p-3 border border-gray-200 hover:border-red-300 transition-all hover:shadow-sm"
                            >
                              <div className="flex items-start justify-between gap-2 mb-2">
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs sm:text-sm font-semibold text-gray-900 truncate">
                                    {lecture.topic || 'بدون عنوان'}
                                  </p>
                                  <p className="text-xs text-gray-600 mt-1 flex items-center gap-1">
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                    </svg>
                                    {new Date(lecture.lecture_date).toLocaleDateString('en-US')}
                                    {lecture.lecture_time && (
                                      <>
                                        <span className="mx-1">-</span>
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        {lecture.lecture_time}
                                      </>
                                    )}
                                  </p>
                                  {lecture.location && (
                                    <p className="text-xs text-gray-500 mt-1 flex items-center gap-1">
                                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                                      </svg>
                                      {lecture.location}
                                    </p>
                                  )}
                                </div>
                                {lecture.attendance_stats && lecture.attendance_stats.total > 0 && (
                                  <div className="flex items-center gap-1 text-xs bg-green-50 px-2 py-1 rounded border border-green-200">
                                    <span className="text-green-700 font-bold">
                                      {lecture.attendance_stats.present}
                                    </span>
                                    <span className="text-gray-400">/</span>
                                    <span className="text-gray-600">
                                      {lecture.attendance_stats.total}
                                    </span>
                                  </div>
                                )}
                              </div>
                              <div className="flex gap-2">
                                <button
                                  onClick={() => handleOpenLecture(lecture.id)}
                                  className="flex-1 px-3 py-1.5 bg-gradient-to-r from-red-600 to-red-700 text-white text-xs rounded-lg hover:from-red-700 hover:to-red-800 transition-all font-medium shadow-sm"
                                >
                                  فتح الحضور
                                </button>
                                <button
                                  onClick={() => handleEditLecture(lecture.id)}
                                  className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700 transition-colors font-medium"
                                >
                                  تعديل
                                </button>
                                <button
                                  onClick={() => handleDeleteLecture(lecture.id)}
                                  disabled={deletingLectureId === lecture.id}
                                  className="px-3 py-1.5 bg-red-600 text-white text-xs rounded-lg hover:bg-red-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  {deletingLectureId === lecture.id ? '...' : 'حذف'}
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <button
                    onClick={() => handleCreateLecture(subject)}
                    className="w-full px-4 py-2.5 sm:py-3 bg-gradient-to-r from-red-600 to-red-700 text-white rounded-lg hover:from-red-700 hover:to-red-800 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-all font-medium text-sm sm:text-base shadow-sm hover:shadow-md flex items-center justify-center gap-2"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    إنشاء محاضرة جديدة
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
            </div>
            </>
        ) : null}
      </main>

      {showLectureModal && selectedSubject && (
        <CreateLectureModal
          subject={selectedSubject}
          formData={lectureForm}
          onFormChange={setLectureForm}
          onSubmit={handleSubmitLecture}
          onClose={() => setShowLectureModal(false)}
          loading={creatingLecture}
        />
      )}

      {showAttendanceModal && currentLectureId && (
        <AttendanceModal
          lectureId={currentLectureId}
          onClose={() => {
            setShowAttendanceModal(false);
            setCurrentLectureId(null);
          }}
        />
      )}

      {showEditLectureModal && editingLectureId && (
        <EditLectureModal
          lectureId={editingLectureId}
          formData={lectureForm}
          onFormChange={setLectureForm}
          onSubmit={handleUpdateLecture}
          onClose={() => {
            setShowEditLectureModal(false);
            setEditingLectureId(null);
          }}
          loading={updatingLecture}
        />
      )}
    </div>
  );
}

// Create Lecture Modal Component
type LectureFormData = {
  lecture_date: string;
  lecture_time: string;
  duration_minutes: number;
  topic: string;
  location: string;
  notes: string;
};

interface CreateLectureModalProps {
  subject: TeacherSubject;
  formData: LectureFormData;
  onFormChange: (data: LectureFormData) => void;
  onSubmit: (e: React.FormEvent, openAttendance?: boolean) => void;
  onClose: () => void;
  loading: boolean;
}

function CreateLectureModal({
  subject,
  formData,
  onFormChange,
  onSubmit,
  onClose,
  loading
}: CreateLectureModalProps) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-4 sm:px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg sm:text-xl font-bold text-gray-900">
            إنشاء محاضرة جديدة
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl font-bold"
            disabled={loading}
          >
            ×
          </button>
        </div>

        <form onSubmit={onSubmit} className="p-4 sm:p-6 space-y-4">
          {/* Subject Info */}
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-4">
            <p className="text-sm font-medium text-red-900">المادة: {subject.subject_name}</p>
            <p className="text-xs text-red-700 mt-1">
              {stageLabelMap[subject.stage] || subject.stage} - {studyTypeLabelMap[subject.study_type] || subject.study_type} - {subject.academic_year}
            </p>
          </div>

          {/* Lecture Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              تاريخ المحاضرة <span className="text-red-600">*</span>
            </label>
            <input
              type="date"
              value={formData.lecture_date}
              onChange={(e) => onFormChange({ ...formData, lecture_date: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
              required
              disabled={loading}
            />
          </div>

          {/* Lecture Time and Duration */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                وقت المحاضرة
              </label>
              <input
                type="time"
                value={formData.lecture_time}
                onChange={(e) => onFormChange({ ...formData, lecture_time: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
                disabled={loading}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                مدة المحاضرة (بالدقائق)
              </label>
              <input
                type="number"
                min="30"
                max="240"
                value={formData.duration_minutes}
                onChange={(e) => onFormChange({ ...formData, duration_minutes: parseInt(e.target.value) || 90 })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
                disabled={loading}
              />
            </div>
          </div>

          {/* Topic */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              عنوان المحاضرة
            </label>
            <input
              type="text"
              value={formData.topic}
              onChange={(e) => onFormChange({ ...formData, topic: e.target.value })}
              placeholder="مثال: مقدمة في البرمجة..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
              disabled={loading}
            />
          </div>

          {/* Location */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              مكان المحاضرة
            </label>
            <input
              type="text"
              value={formData.location}
              onChange={(e) => onFormChange({ ...formData, location: e.target.value })}
              placeholder="مثال: القاعة 101، المختبر 5..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
              disabled={loading}
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              ملاحظات
            </label>
            <textarea
              value={formData.notes}
              onChange={(e) => onFormChange({ ...formData, notes: e.target.value })}
              placeholder="أي ملاحظات إضافية..."
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500 resize-none"
              disabled={loading}
            />
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-3 pt-4 border-t border-gray-200">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={(e) => onSubmit(e, false)}
                disabled={loading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'جاري الحفظ...' : 'حفظ المحاضرة'}
              </button>
              <button
                type="button"
                onClick={(e) => onSubmit(e, true)}
                disabled={loading}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'جاري الإنشاء...' : 'حفظ وفتح الحضور'}
              </button>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="w-full px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Edit Lecture Modal Component
interface EditLectureModalProps {
  lectureId: string;
  formData: LectureFormData;
  onFormChange: (data: LectureFormData) => void;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
  loading: boolean;
}

function EditLectureModal({
  lectureId,
  formData,
  onFormChange,
  onSubmit,
  onClose,
  loading
}: EditLectureModalProps) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-4 sm:px-6 py-4 flex items-center justify-between">
          <h2 className="text-lg sm:text-xl font-bold text-gray-900">
            تعديل معلومات المحاضرة
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl font-bold"
            disabled={loading}
          >
            ×
          </button>
        </div>

        <form onSubmit={onSubmit} className="p-4 sm:p-6 space-y-4">
          {/* Lecture Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              تاريخ المحاضرة <span className="text-red-600">*</span>
            </label>
            <input
              type="date"
              value={formData.lecture_date}
              onChange={(e) => onFormChange({ ...formData, lecture_date: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
              required
              disabled={loading}
            />
          </div>

          {/* Lecture Time and Duration */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                وقت المحاضرة
              </label>
              <input
                type="time"
                value={formData.lecture_time}
                onChange={(e) => onFormChange({ ...formData, lecture_time: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
                disabled={loading}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                مدة المحاضرة (بالدقائق)
              </label>
              <input
                type="number"
                min="30"
                max="240"
                value={formData.duration_minutes}
                onChange={(e) => onFormChange({ ...formData, duration_minutes: parseInt(e.target.value) || 90 })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
                disabled={loading}
              />
            </div>
          </div>

          {/* Topic */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              عنوان المحاضرة
            </label>
            <input
              type="text"
              value={formData.topic}
              onChange={(e) => onFormChange({ ...formData, topic: e.target.value })}
              placeholder="مثال: مقدمة في البرمجة..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
              disabled={loading}
            />
          </div>

          {/* Location */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              مكان المحاضرة
            </label>
            <input
              type="text"
              value={formData.location}
              onChange={(e) => onFormChange({ ...formData, location: e.target.value })}
              placeholder="مثال: القاعة 101، المختبر 5..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
              disabled={loading}
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              ملاحظات
            </label>
            <textarea
              value={formData.notes}
              onChange={(e) => onFormChange({ ...formData, notes: e.target.value })}
              placeholder="أي ملاحظات إضافية..."
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500 resize-none"
              disabled={loading}
            />
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-3 pt-4 border-t border-gray-200">
            <button
              type="submit"
              disabled={loading}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'جاري التحديث...' : 'حفظ التعديلات'}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="w-full px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Attendance Modal Component
interface AttendanceModalProps {
  lectureId: string;
  onClose: () => void;
}

function AttendanceModal({ lectureId, onClose }: AttendanceModalProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lecture, setLecture] = useState<any>(null);
  const [students, setStudents] = useState<any[]>([]);
  const [savingStatus, setSavingStatus] = useState<Record<string, boolean>>({});
  const [attendanceStatus, setAttendanceStatus] = useState<Record<string, string>>({});
  const [completing, setCompleting] = useState(false);

  useEffect(() => {
    if (lectureId) {
      console.log('جاري جلب بيانات الحضور للمحاضرة:', lectureId);
      fetchAttendanceData();
    }
  }, [lectureId]);

  const fetchAttendanceData = async () => {
    try {
      setLoading(true);
      setError(null);

      console.log('جاري جلب بيانات الحضور للمحاضرة:', lectureId);
      const response = await fetch(`/api/teachers-portal/lectures/${lectureId}/attendance`);
      const data = await response.json();

      console.log('استجابة جلب بيانات الحضور:', { 
        ok: response.ok, 
        status: response.status, 
        success: data.success, 
        error: data.error,
        hasLecture: !!data.data?.lecture 
      });

      if (!response.ok || !data.success) {
        if (response.status === 401) {
          // محاولة تجديد token
          try {
            const refreshResponse = await fetch('/api/auth/refresh', {
              method: 'POST'
            });
            if (refreshResponse.ok) {
              const retryResponse = await fetch(`/api/teachers-portal/lectures/${lectureId}/attendance`);
              const retryData = await retryResponse.json();
              if (retryResponse.ok && retryData.success) {
                setLecture(retryData.data.lecture);
                setStudents(retryData.data.students);
                const initialStatus: Record<string, string> = {};
                retryData.data.students.forEach((student: any) => {
                  initialStatus[student.student_id] = student.attendance_status || '';
                });
                setAttendanceStatus(initialStatus);
                return;
              }
            }
          } catch {
            alert('انتهت جلسة العمل. يرجى تسجيل الدخول مرة أخرى.');
            onClose();
            return;
          }
        }
        throw new Error(data.error || 'حدث خطأ في جلب البيانات');
      }

      setLecture(data.data.lecture);
      setStudents(data.data.students);
      const initialStatus: Record<string, string> = {};
      data.data.students.forEach((student: any) => {
        initialStatus[student.student_id] = student.attendance_status || '';
      });
      setAttendanceStatus(initialStatus);
    } catch (err) {
      console.error('خطأ في جلب البيانات:', err);
      setError(err instanceof Error ? err.message : 'حدث خطأ في جلب البيانات');
    } finally {
      setLoading(false);
    }
  };

  const handleStatusChange = async (studentId: string, status: string) => {
    setAttendanceStatus(prev => ({ ...prev, [studentId]: status }));
    
    try {
      setSavingStatus(prev => ({ ...prev, [studentId]: true }));

      const response = await fetch(`/api/teachers-portal/lectures/${lectureId}/attendance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          student_id: studentId,
          status: status,
          arrival_time: status === 'present' ? new Date().toTimeString().slice(0, 5) : null
        })
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        if (response.status === 401) {
          // محاولة تجديد token
          try {
            const refreshResponse = await fetch('/api/auth/refresh', {
              method: 'POST'
            });
            if (refreshResponse.ok) {
              const retryResponse = await fetch(`/api/teachers-portal/lectures/${lectureId}/attendance`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  student_id: studentId,
                  status: status,
                  arrival_time: status === 'present' ? new Date().toTimeString().slice(0, 5) : null
                })
              });
              const retryData = await retryResponse.json();
              if (retryResponse.ok && retryData.success) {
                return;
              }
            }
          } catch {
            alert('انتهت جلسة العمل. يرجى تسجيل الدخول مرة أخرى.');
            onClose();
            return;
          }
        }
        throw new Error(data.error || 'حدث خطأ في حفظ الحضور');
      }
    } catch (err) {
      console.error('خطأ في حفظ الحضور:', err);
      alert(err instanceof Error ? err.message : 'حدث خطأ في حفظ الحضور');
      // إعادة الحالة السابقة
      fetchAttendanceData();
    } finally {
      setSavingStatus(prev => ({ ...prev, [studentId]: false }));
    }
  };

  const handleCompleteAttendance = async () => {
    // التحقق من وجود طلاب بدون حالة
    const studentsWithoutStatus = students.filter(s => !attendanceStatus[s.student_id] || attendanceStatus[s.student_id] === '');
    
    if (studentsWithoutStatus.length > 0) {
      const confirmMessage = `يوجد ${studentsWithoutStatus.length} طالب(ة) لم يتم تحديد حالة الحضور لهم. هل تريد المتابعة؟`;
      if (!confirm(confirmMessage)) {
        return;
      }
    }

    try {
      setCompleting(true);

      // التأكد من حفظ جميع حالات الحضور
      const pendingStudents = students.filter(s => {
        const currentStatus = attendanceStatus[s.student_id];
        return currentStatus && ['present', 'absent', 'excused'].includes(currentStatus);
      });

      // حفظ حالات الحضور المتبقية (إذا كانت هناك أي حالات لم يتم حفظها)
      const savePromises = pendingStudents.map(async (student) => {
        const status = attendanceStatus[student.student_id];
        if (status) {
          try {
            const response = await fetch(`/api/teachers-portal/lectures/${lectureId}/attendance`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                student_id: student.student_id,
                status: status,
                arrival_time: status === 'present' ? new Date().toTimeString().slice(0, 5) : null
              })
            });

            if (!response.ok) {
              if (response.status === 401) {
                const refreshResponse = await fetch('/api/auth/refresh', { method: 'POST' });
                if (refreshResponse.ok) {
                  const retryResponse = await fetch(`/api/teachers-portal/lectures/${lectureId}/attendance`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      student_id: student.student_id,
                      status: status,
                      arrival_time: status === 'present' ? new Date().toTimeString().slice(0, 5) : null
                    })
                  });
                  return retryResponse.ok;
                }
              }
              return false;
            }
            return true;
          } catch {
            return false;
          }
        }
        return true;
      });

      await Promise.all(savePromises);

      // عرض رسالة نجاح مع رابط لصفحة الحضور
      const confirmMessage = `تم حفظ الحضور والغياب بنجاح!\n\nإجمالي الطلاب: ${stats.total}\nحاضر: ${stats.present}\nغائب: ${stats.absent}\nمجاز: ${stats.excused}\n\nهل تريد الانتقال إلى صفحة الحضور والغياب؟`;
      
      if (confirm(confirmMessage)) {
        router.push('/teachers-portal/attendance');
      } else {
        onClose();
      }
    } catch (err) {
      console.error('خطأ في إكمال تسجيل الحضور:', err);
      alert(err instanceof Error ? err.message : 'حدث خطأ في إكمال تسجيل الحضور');
    } finally {
      setCompleting(false);
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'present':
        return 'حاضر';
      case 'absent':
        return 'غائب';
      case 'excused':
        return 'مجاز';
      default:
        return 'غير محدد';
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'present':
        return 'bg-green-100 text-green-800 border-green-300';
      case 'absent':
        return 'bg-red-100 text-red-800 border-red-300';
      case 'excused':
        return 'bg-yellow-100 text-yellow-800 border-yellow-300';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-300';
    }
  };

  // Statistics
  const stats = useMemo(() => {
    const present = students.filter(s => attendanceStatus[s.student_id] === 'present').length;
    const absent = students.filter(s => attendanceStatus[s.student_id] === 'absent').length;
    const excused = students.filter(s => attendanceStatus[s.student_id] === 'excused').length;
    const notSet = students.filter(s => !attendanceStatus[s.student_id] || attendanceStatus[s.student_id] === '').length;
    
    return { total: students.length, present, absent, excused, notSet };
  }, [students, attendanceStatus]);

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full p-6">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-red-600 mx-auto"></div>
            <p className="mt-4 text-gray-600">جاري التحميل...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full p-6">
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-800 text-center">
            <p>{error}</p>
            <div className="flex gap-3 mt-4 justify-center">
              <button
                onClick={fetchAttendanceData}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                إعادة المحاولة
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
              >
                إغلاق
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-4 sm:px-6 py-4 flex items-center justify-between z-10">
          <div className="flex-1 min-w-0">
            <h2 className="text-lg sm:text-xl font-bold text-gray-900 truncate">
              تسجيل الحضور والغياب
            </h2>
            {lecture && (
              <p className="text-sm text-gray-600 mt-1 truncate">
                {lecture.subject_name} - {new Date(lecture.lecture_date).toLocaleDateString('en-US')}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl font-bold ml-4 flex-shrink-0"
          >
            ×
          </button>
        </div>

        {/* Statistics */}
        {lecture && (
          <div className="px-4 sm:px-6 py-3 bg-gray-50 border-b border-gray-200">
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div className="text-center">
                <p className="text-xs text-gray-600">إجمالي الطلاب</p>
                <p className="text-lg font-bold text-gray-900">{stats.total}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-600">حاضر</p>
                <p className="text-lg font-bold text-green-700">{stats.present}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-600">غائب</p>
                <p className="text-lg font-bold text-red-700">{stats.absent}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-600">مجاز</p>
                <p className="text-lg font-bold text-yellow-700">{stats.excused}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-gray-600">غير محدد</p>
                <p className="text-lg font-bold text-gray-500">{stats.notSet}</p>
              </div>
            </div>
          </div>
        )}

        {/* Attendance Table */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50 sticky top-0 z-10">
                <tr>
                  <th className="px-3 sm:px-4 py-2 sm:py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    #
                  </th>
                  <th className="px-3 sm:px-4 py-2 sm:py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    الرقم الجامعي
                  </th>
                  <th className="px-3 sm:px-4 py-2 sm:py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                    اسم الطالب
                  </th>
                  <th className="px-3 sm:px-4 py-2 sm:py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    الحضور / الغياب
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {students.map((student, index) => (
                  <tr key={student.student_id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-3 sm:px-4 py-2 sm:py-3 whitespace-nowrap text-sm text-gray-900 font-medium">
                      {index + 1}
                    </td>
                    <td className="px-3 sm:px-4 py-2 sm:py-3 whitespace-nowrap text-sm text-gray-900 font-mono">
                      {student.university_id}
                    </td>
                    <td className="px-3 sm:px-4 py-2 sm:py-3 text-sm text-gray-900 min-w-[150px]">
                      {student.full_name_ar || student.full_name}
                    </td>
                    <td className="px-3 sm:px-4 py-2 sm:py-3 whitespace-nowrap">
                      <div className="flex flex-wrap gap-2 justify-center">
                        <button
                          onClick={() => handleStatusChange(student.student_id, 'present')}
                          disabled={savingStatus[student.student_id]}
                          className={`px-3 py-1.5 text-xs sm:text-sm font-medium rounded-lg border-2 transition-all ${
                            attendanceStatus[student.student_id] === 'present'
                              ? 'bg-green-600 text-white border-green-600'
                              : 'bg-white text-green-700 border-green-300 hover:bg-green-50'
                          } disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation`}
                        >
                          {savingStatus[student.student_id] && attendanceStatus[student.student_id] === 'present' ? '...' : 'حاضر'}
                        </button>
                        <button
                          onClick={() => handleStatusChange(student.student_id, 'absent')}
                          disabled={savingStatus[student.student_id]}
                          className={`px-3 py-1.5 text-xs sm:text-sm font-medium rounded-lg border-2 transition-all ${
                            attendanceStatus[student.student_id] === 'absent'
                              ? 'bg-red-600 text-white border-red-600'
                              : 'bg-white text-red-700 border-red-300 hover:bg-red-50'
                          } disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation`}
                        >
                          {savingStatus[student.student_id] && attendanceStatus[student.student_id] === 'absent' ? '...' : 'غائب'}
                        </button>
                        <button
                          onClick={() => handleStatusChange(student.student_id, 'excused')}
                          disabled={savingStatus[student.student_id]}
                          className={`px-3 py-1.5 text-xs sm:text-sm font-medium rounded-lg border-2 transition-all ${
                            attendanceStatus[student.student_id] === 'excused'
                              ? 'bg-yellow-600 text-white border-yellow-600'
                              : 'bg-white text-yellow-700 border-yellow-300 hover:bg-yellow-50'
                          } disabled:opacity-50 disabled:cursor-not-allowed touch-manipulation`}
                        >
                          {savingStatus[student.student_id] && attendanceStatus[student.student_id] === 'excused' ? '...' : 'مجاز'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white border-t border-gray-200 px-4 sm:px-6 py-4 flex flex-col sm:flex-row justify-between items-center gap-3">
          <div className="text-xs sm:text-sm text-gray-600">
            {stats.notSet > 0 && (
              <span className="text-orange-600 font-medium">
                ⚠️ يوجد {stats.notSet} طالب(ة) بدون حالة حضور
              </span>
            )}
            {stats.notSet === 0 && (
              <span className="text-green-600 font-medium">
                ✓ تم تحديد حالة الحضور لجميع الطلاب
              </span>
            )}
          </div>
          <div className="flex gap-3 w-full sm:w-auto">
            <button
              onClick={handleCompleteAttendance}
              disabled={completing || Object.values(savingStatus).some(v => v)}
              className="flex-1 sm:flex-none px-4 sm:px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {completing ? 'جاري الحفظ...' : 'إكمال وإرسال'}
            </button>
            <button
              onClick={onClose}
              disabled={completing}
              className="flex-1 sm:flex-none px-4 sm:px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              إغلاق
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

