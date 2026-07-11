'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { WeekView, DayView } from './week-day-views';

interface CalendarEvent {
  id: string;
  title: string;
  description: string | null;
  event_type: 'lecture' | 'exam' | 'meeting' | 'task' | 'announcement' | 'special';
  event_category: string | null;
  start_date: string;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  all_day: boolean;
  location: string | null;
  lecture_id: string | null;
  subject_id: string | null;
  color: string;
  priority: string;
  status: string;
  is_shared_with_students: boolean;
  is_shared_with_teachers: boolean;
  subject_name: string | null;
  lecture_topic: string | null;
  is_owner: boolean;
  teacher_name?: string | null;
  exam_type?: string | null;
  exam_duration_minutes?: number | null;
  notes?: string | null;
}

interface Teacher {
  id: string;
  full_name: string;
  full_name_ar: string;
  department: string;
}

const eventTypeLabels: Record<string, string> = {
  lecture: 'محاضرة',
  exam: 'امتحان',
  meeting: 'اجتماع',
  task: 'مهمة',
  announcement: 'إعلان',
  special: 'مناسبة خاصة'
};

const eventTypeColors: Record<string, string> = {
  lecture: '#DC2626', // red
  exam: '#F59E0B', // amber
  meeting: '#3B82F6', // blue
  task: '#10B981', // green
  announcement: '#8B5CF6', // purple
  special: '#EC4899' // pink
};

export default function CalendarPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [teacher, setTeacher] = useState<Teacher | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [viewMode, setViewMode] = useState<'month' | 'week' | 'day'>('month');
  const [filterType, setFilterType] = useState<string>('all');
  
  // Add Event Modal State
  const [showAddEventModal, setShowAddEventModal] = useState(false);
  const [loadingSubjects, setLoadingSubjects] = useState(false);
  const [subjects, setSubjects] = useState<any[]>([]);
  const [lectures, setLectures] = useState<any[]>([]);
  const [creatingEvent, setCreatingEvent] = useState(false);
  
  // Event Details/Edit Modal State
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [showEventDetailsModal, setShowEventDetailsModal] = useState(false);
  const [showEditEventModal, setShowEditEventModal] = useState(false);
  const [updatingEvent, setUpdatingEvent] = useState(false);
  const [deletingEvent, setDeletingEvent] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const [showDayEventsModal, setShowDayEventsModal] = useState(false);
  
  // Event Form Data
  const [eventForm, setEventForm] = useState({
    title: '',
    description: '',
    event_type: 'lecture' as 'lecture' | 'exam' | 'meeting' | 'task' | 'announcement' | 'special',
    event_category: '',
    start_date: new Date().toISOString().split('T')[0],
    end_date: new Date().toISOString().split('T')[0],
    start_time: '',
    end_time: '',
    all_day: false,
    location: '',
    lecture_id: '',
    subject_id: '',
    color: '#DC2626',
    priority: 'normal' as 'low' | 'normal' | 'high' | 'urgent',
    reminder_minutes: null as number | null,
    is_shared_with_students: false,
    is_shared_with_teachers: false,
    shared_with_departments: [] as string[],
    shared_with_stages: [] as string[],
    shared_with_study_types: [] as string[],
    exam_type: '',
    exam_duration_minutes: null as number | null,
    notes: '',
    visibility: 'private' as 'private' | 'shared' | 'public'
  });

  // Get current month info
  const currentMonth = currentDate.getMonth();
  const currentYear = currentDate.getFullYear();
  // استخدام أسماء الأشهر بالعربية مع التاريخ الميلادي
  const monthNames = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const monthName = `${monthNames[currentMonth]} ${currentYear}`;

  useEffect(() => {
    fetchData();
  }, [currentDate, filterType, viewMode]);

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

      // Calculate date range based on view mode
      let startDate: Date;
      let endDate: Date;

      if (viewMode === 'day') {
        // Single day view
        startDate = new Date(currentDate);
        endDate = new Date(currentDate);
      } else if (viewMode === 'week') {
        // Week view - get start of week (Sunday) and end of week (Saturday)
        const dayOfWeek = currentDate.getDay();
        startDate = new Date(currentDate);
        startDate.setDate(currentDate.getDate() - dayOfWeek);
        endDate = new Date(startDate);
        endDate.setDate(startDate.getDate() + 6);
      } else {
        // Month view
        startDate = new Date(currentYear, currentMonth, 1);
        endDate = new Date(currentYear, currentMonth + 1, 0);
      }

      const params = new URLSearchParams();
      params.append('startDate', startDate.toISOString().split('T')[0]);
      params.append('endDate', endDate.toISOString().split('T')[0]);
      if (filterType !== 'all') {
        params.append('type', filterType);
      }

      const response = await fetch(`/api/teachers-portal/calendar/events?${params.toString()}`);
      const data = await response.json();

      if (!response.ok || !data.success) {
        if (response.status === 401) {
          router.push('/teachers-portal');
          return;
        }
        throw new Error(data.error || 'حدث خطأ في جلب البيانات');
      }

      // جلب بيانات التدريسي
      const teacherResponse = await fetch('/api/auth/me');
      const teacherData = await teacherResponse.json();
      
      if (teacherData.success) {
        const teacherInfoResponse = await fetch(`/api/hr/teachers?user_id=${teacherData.user.id}`);
        const teacherInfoData = await teacherInfoResponse.json();
        
        if (teacherInfoData.success && teacherInfoData.data && teacherInfoData.data.length > 0) {
          setTeacher(teacherInfoData.data[0]);
        }
      }

      const eventsData = data.data || [];
      setEvents(eventsData);
      console.log('تم جلب الأحداث:', eventsData.length, 'حدث');
      if (eventsData.length > 0) {
        console.log('مثال على حدث:', eventsData[0]);
      }
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

  // Get events for a specific date
  const getEventsForDate = (date: Date): CalendarEvent[] => {
    if (!events || events.length === 0) return [];
    
    // تحويل التاريخ إلى YYYY-MM-DD لمقارنة صحيحة
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;
    
    return events.filter(event => {
      if (!event || !event.start_date) return false;
      
      // تحويل تاريخ الحدث إلى YYYY-MM-DD
      const eventStartStr = typeof event.start_date === 'string' 
        ? event.start_date.split('T')[0] 
        : new Date(event.start_date).toISOString().split('T')[0];
      
      const eventEndStr = event.end_date
        ? (typeof event.end_date === 'string' 
            ? event.end_date.split('T')[0] 
            : new Date(event.end_date).toISOString().split('T')[0])
        : eventStartStr;
      
      // المقارنة كسلاسل نصية (YYYY-MM-DD) لضمان الدقة
      return dateStr >= eventStartStr && dateStr <= eventEndStr;
    });
  };

  // Generate calendar days
  const calendarDays = useMemo(() => {
    const firstDayOfMonth = new Date(currentYear, currentMonth, 1);
    const lastDayOfMonth = new Date(currentYear, currentMonth + 1, 0);
    const startingDayOfWeek = firstDayOfMonth.getDay();
    const daysInMonth = lastDayOfMonth.getDate();

    const days: (Date | null)[] = [];

    // Add empty cells for days before the first day of the month
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null);
    }

    // Add days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(new Date(currentYear, currentMonth, day));
    }

    return days;
  }, [currentYear, currentMonth]);

  // Statistics - Calendar Specific
  const stats = useMemo(() => {
    const totalEvents = events.length;
    
    // Filter events for current month
    const currentMonthEvents = events.filter(event => {
      if (!event.start_date) return false;
      const eventDate = new Date(event.start_date);
      return eventDate.getMonth() === currentMonth && eventDate.getFullYear() === currentYear;
    });
    
    // Upcoming lectures (next 7 days)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const nextWeek = new Date(today);
    nextWeek.setDate(today.getDate() + 7);
    
    const upcomingLectures = events.filter(event => {
      if (event.event_type !== 'lecture' || !event.start_date) return false;
      const eventDate = new Date(event.start_date);
      eventDate.setHours(0, 0, 0, 0);
      return eventDate >= today && eventDate <= nextWeek;
    }).length;
    
    // Upcoming exams (next 30 days)
    const nextMonth = new Date(today);
    nextMonth.setDate(today.getDate() + 30);
    
    const upcomingExams = events.filter(event => {
      if (event.event_type !== 'exam' || !event.start_date) return false;
      const eventDate = new Date(event.start_date);
      eventDate.setHours(0, 0, 0, 0);
      return eventDate >= today && eventDate <= nextMonth;
    }).length;
    
    return {
      totalEvents,
      currentMonthEvents: currentMonthEvents.length,
      upcomingLectures,
      upcomingExams
    };
  }, [events, currentMonth, currentYear]);

  const navigateMonth = (direction: 'prev' | 'next') => {
    setCurrentDate(prev => {
      const newDate = new Date(prev);
      if (direction === 'prev') {
        newDate.setMonth(prev.getMonth() - 1);
      } else {
        newDate.setMonth(prev.getMonth() + 1);
      }
      return newDate;
    });
  };

  const goToToday = () => {
    setCurrentDate(new Date());
    setSelectedDate(new Date());
  };

  // Fetch subjects and lectures for the modal
  const fetchSubjectsAndLectures = async () => {
    try {
      setLoadingSubjects(true);
      
      // Fetch subjects
      const subjectsResponse = await fetch('/api/teachers-portal/subjects');
      const subjectsData = await subjectsResponse.json();
      if (subjectsData.success) {
        setSubjects(subjectsData.data || []);
      }

      // Fetch lectures
      const lecturesResponse = await fetch('/api/teachers-portal/lectures');
      const lecturesData = await lecturesResponse.json();
      if (lecturesData.success) {
        setLectures(lecturesData.data || []);
      }
    } catch (err) {
      console.error('خطأ في جلب البيانات:', err);
    } finally {
      setLoadingSubjects(false);
    }
  };

  // Open add event modal
  const handleOpenAddEventModal = () => {
    const defaultDate = selectedDate || new Date();
    setEventForm({
      ...eventForm,
      start_date: defaultDate.toISOString().split('T')[0],
      end_date: defaultDate.toISOString().split('T')[0],
    });
    setShowAddEventModal(true);
    fetchSubjectsAndLectures();
  };

  // Handle event type change
  const handleEventTypeChange = (type: string) => {
    setEventForm({
      ...eventForm,
      event_type: type as any,
      color: eventTypeColors[type] || '#DC2626',
    });
  };

  // Handle create event
  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!eventForm.title || !eventForm.start_date) {
      alert('العنوان وتاريخ البداية مطلوبان');
      return;
    }

    try {
      setCreatingEvent(true);

      const response = await fetch('/api/teachers-portal/calendar/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...eventForm,
          end_date: eventForm.end_date || eventForm.start_date,
          reminder_minutes: eventForm.reminder_minutes || null,
          exam_duration_minutes: eventForm.exam_duration_minutes || null,
          lecture_id: eventForm.lecture_id || null,
          subject_id: eventForm.subject_id || null,
          shared_with_departments: eventForm.shared_with_departments.length > 0 ? eventForm.shared_with_departments : null,
          shared_with_stages: eventForm.shared_with_stages.length > 0 ? eventForm.shared_with_stages : null,
          shared_with_study_types: eventForm.shared_with_study_types.length > 0 ? eventForm.shared_with_study_types : null,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        if (response.status === 401) {
          router.push('/teachers-portal');
          return;
        }
        throw new Error(data.error || 'حدث خطأ في إنشاء الحدث');
      }

      // Close modal and refresh events
      setShowAddEventModal(false);
      fetchData();
      alert('تم إنشاء الحدث بنجاح!');
    } catch (err) {
      console.error('خطأ في إنشاء الحدث:', err);
      alert(err instanceof Error ? err.message : 'حدث خطأ في إنشاء الحدث');
    } finally {
      setCreatingEvent(false);
    }
  };

  // Filter lectures by selected subject
  const filteredLectures = useMemo(() => {
    if (!eventForm.subject_id) return [];
    return lectures.filter((lecture: any) => lecture.subject_id === eventForm.subject_id);
  }, [lectures, eventForm.subject_id]);

  // Handle open event for edit
  const handleOpenEventForEdit = async (event: CalendarEvent) => {
    try {
      const response = await fetch(`/api/teachers-portal/calendar/events/${event.id}`);
      const data = await response.json();
      
      if (response.ok && data.success) {
        const eventData = data.data;
        setEventForm({
          title: eventData.title || '',
          description: eventData.description || '',
          event_type: eventData.event_type || 'lecture',
          event_category: eventData.event_category || '',
          start_date: eventData.start_date ? eventData.start_date.split('T')[0] : new Date().toISOString().split('T')[0],
          end_date: eventData.end_date ? eventData.end_date.split('T')[0] : eventData.start_date ? eventData.start_date.split('T')[0] : new Date().toISOString().split('T')[0],
          start_time: eventData.start_time || '',
          end_time: eventData.end_time || '',
          all_day: eventData.all_day || false,
          location: eventData.location || '',
          lecture_id: eventData.lecture_id || '',
          subject_id: eventData.subject_id || '',
          color: eventData.color || '#DC2626',
          priority: eventData.priority || 'normal',
          reminder_minutes: eventData.reminder_minutes || null,
          is_shared_with_students: eventData.is_shared_with_students || false,
          is_shared_with_teachers: eventData.is_shared_with_teachers || false,
          shared_with_departments: eventData.shared_with_departments || [],
          shared_with_stages: eventData.shared_with_stages || [],
          shared_with_study_types: eventData.shared_with_study_types || [],
          exam_type: eventData.exam_type || '',
          exam_duration_minutes: eventData.exam_duration_minutes || null,
          notes: eventData.notes || '',
          visibility: eventData.visibility || 'private'
        });
        setSelectedEvent(event);
        setShowEventDetailsModal(false);
        setShowEditEventModal(true);
        fetchSubjectsAndLectures();
      }
    } catch (err) {
      console.error('خطأ في جلب بيانات الحدث:', err);
      alert('حدث خطأ في جلب بيانات الحدث');
    }
  };

  // Handle update event
  const handleUpdateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!selectedEvent || !eventForm.title || !eventForm.start_date) {
      alert('العنوان وتاريخ البداية مطلوبان');
      return;
    }

    try {
      setUpdatingEvent(true);

      const response = await fetch(`/api/teachers-portal/calendar/events/${selectedEvent.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...eventForm,
          end_date: eventForm.end_date || eventForm.start_date,
          reminder_minutes: eventForm.reminder_minutes || null,
          exam_duration_minutes: eventForm.exam_duration_minutes || null,
          lecture_id: eventForm.lecture_id || null,
          subject_id: eventForm.subject_id || null,
          shared_with_departments: eventForm.shared_with_departments.length > 0 ? eventForm.shared_with_departments : null,
          shared_with_stages: eventForm.shared_with_stages.length > 0 ? eventForm.shared_with_stages : null,
          shared_with_study_types: eventForm.shared_with_study_types.length > 0 ? eventForm.shared_with_study_types : null,
        }),
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        if (response.status === 401) {
          router.push('/teachers-portal');
          return;
        }
        throw new Error(data.error || 'حدث خطأ في تحديث الحدث');
      }

      setShowEditEventModal(false);
      setSelectedEvent(null);
      fetchData();
      alert('تم تحديث الحدث بنجاح!');
    } catch (err) {
      console.error('خطأ في تحديث الحدث:', err);
      alert(err instanceof Error ? err.message : 'حدث خطأ في تحديث الحدث');
    } finally {
      setUpdatingEvent(false);
    }
  };

  // Handle delete event
  const handleDeleteEvent = async () => {
    if (!selectedEvent) return;

    try {
      setDeletingEvent(true);

      const response = await fetch(`/api/teachers-portal/calendar/events/${selectedEvent.id}`, {
        method: 'DELETE',
      });

      const data = await response.json();

      if (!response.ok || !data.success) {
        if (response.status === 401) {
          router.push('/teachers-portal');
          return;
        }
        throw new Error(data.error || 'حدث خطأ في حذف الحدث');
      }

      setShowDeleteConfirm(false);
      setShowEventDetailsModal(false);
      setSelectedEvent(null);
      fetchData();
      alert('تم حذف الحدث بنجاح!');
    } catch (err) {
      console.error('خطأ في حذف الحدث:', err);
      alert(err instanceof Error ? err.message : 'حدث خطأ في حذف الحدث');
    } finally {
      setDeletingEvent(false);
    }
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
      <div className="min-h-screen bg-gray-50 safe-area-inset flex items-center justify-center p-4">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-red-800 text-center max-w-md">
          <p className="font-medium mb-2">حدث خطأ</p>
          <p className="text-sm mb-4">{error}</p>
          <button
            onClick={fetchData}
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
          >
            إعادة المحاولة
          </button>
        </div>
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
                {/* Statistics Cards - Calendar Specific */}
                <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-4 sm:mb-6">
                  {/* Total Events Card */}
                  <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
                    <div className="bg-gradient-to-br from-red-50 to-red-100 px-4 py-3 border-b border-red-200">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center flex-shrink-0">
                          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        </div>
                        <p className="text-xs sm:text-sm font-medium text-gray-700 truncate">إجمالي الأحداث</p>
                      </div>
                    </div>
                    <div className="p-4">
                      <p className="text-2xl sm:text-3xl font-bold text-red-700">{stats.totalEvents}</p>
                      <p className="text-xs text-gray-500 mt-1">حدث مسجل</p>
                    </div>
                  </div>

                  {/* Current Month Events Card */}
                  <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
                    <div className="bg-gradient-to-br from-red-50 to-red-100 px-4 py-3 border-b border-red-200">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center flex-shrink-0">
                          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                          </svg>
                        </div>
                        <p className="text-xs sm:text-sm font-medium text-gray-700 truncate">أحداث هذا الشهر</p>
                      </div>
                    </div>
                    <div className="p-4">
                      <p className="text-2xl sm:text-3xl font-bold text-red-700">{stats.currentMonthEvents}</p>
                      <p className="text-xs text-gray-500 mt-1">في {monthName}</p>
                    </div>
                  </div>

                  {/* Upcoming Lectures Card */}
                  <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
                    <div className="bg-gradient-to-br from-red-50 to-red-100 px-4 py-3 border-b border-red-200">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center flex-shrink-0">
                          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                          </svg>
                        </div>
                        <p className="text-xs sm:text-sm font-medium text-gray-700 truncate">محاضرات قادمة</p>
                      </div>
                    </div>
                    <div className="p-4">
                      <p className="text-2xl sm:text-3xl font-bold text-red-700">{stats.upcomingLectures}</p>
                      <p className="text-xs text-gray-500 mt-1">خلال 7 أيام</p>
                    </div>
                  </div>

                  {/* Upcoming Exams Card */}
                  <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
                    <div className="bg-gradient-to-br from-red-50 to-red-100 px-4 py-3 border-b border-red-200">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center flex-shrink-0">
                          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                        </div>
                        <p className="text-xs sm:text-sm font-medium text-gray-700 truncate">امتحانات قادمة</p>
                      </div>
                    </div>
                    <div className="p-4">
                      <p className="text-2xl sm:text-3xl font-bold text-red-700">{stats.upcomingExams}</p>
                      <p className="text-xs text-gray-500 mt-1">خلال 30 يوم</p>
                    </div>
                  </div>
                </div>

                {/* Calendar Controls - Full width on mobile */}
                <div className="bg-white rounded-none sm:rounded-xl shadow-sm border-x-0 sm:border-x border-t border-b sm:border border-gray-200 overflow-hidden mb-4 sm:mb-6 hover:shadow-md transition-shadow -mx-3 sm:mx-0 w-[calc(100%+1.5rem)] sm:w-auto">
                  <div className="bg-gradient-to-r from-red-50 to-red-100 px-4 sm:px-5 md:px-6 py-3 sm:py-4 border-b border-red-200">
                    <div className="flex items-center gap-2 sm:gap-3">
                      <div className="w-8 h-8 sm:w-10 sm:h-10 bg-red-600 rounded-lg flex items-center justify-center flex-shrink-0">
                        <svg className="w-4 h-4 sm:w-5 sm:h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      </div>
                      <h2 className="text-base sm:text-lg font-bold text-gray-900">تحكم التقويم</h2>
                    </div>
                  </div>
                  <div className="p-4 sm:p-5 md:p-6">
                    <div className="flex flex-col gap-4">
                      {/* Navigation and Month */}
                      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-4">
                        <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto">
                          <button
                            onClick={() => navigateMonth('prev')}
                            className="p-2 sm:p-2.5 hover:bg-red-50 rounded-lg transition-colors border border-red-200 hover:border-red-300"
                            aria-label="الشهر السابق"
                          >
                            <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                            </svg>
                          </button>
                          <h2 className="text-lg sm:text-xl md:text-2xl font-bold text-gray-900 min-w-[180px] sm:min-w-[200px] text-center">
                            {monthName}
                          </h2>
                          <button
                            onClick={() => navigateMonth('next')}
                            className="p-2 sm:p-2.5 hover:bg-red-50 rounded-lg transition-colors border border-red-200 hover:border-red-300"
                            aria-label="الشهر التالي"
                          >
                            <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </button>
                          <button
                            onClick={goToToday}
                            className="px-3 sm:px-4 py-1.5 sm:py-2 text-xs sm:text-sm font-medium text-red-600 hover:bg-red-50 rounded-lg transition-colors border border-red-200 hover:border-red-300 whitespace-nowrap"
                          >
                            اليوم
                          </button>
                        </div>
                        
                        {/* View Mode Toggle and Filters */}
                        <div className="flex items-center gap-2 sm:gap-3 w-full sm:w-auto flex-wrap">
                          {/* View Mode Toggle */}
                          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 flex-1 sm:flex-none">
                            <button
                              onClick={() => setViewMode('month')}
                              className={`px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-medium rounded transition-colors flex-1 sm:flex-none ${
                                viewMode === 'month' 
                                  ? 'bg-red-600 text-white shadow-sm' 
                                  : 'text-gray-700 hover:bg-gray-200'
                              }`}
                            >
                              شهري
                            </button>
                            <button
                              onClick={() => setViewMode('week')}
                              className={`px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-medium rounded transition-colors flex-1 sm:flex-none ${
                                viewMode === 'week' 
                                  ? 'bg-red-600 text-white shadow-sm' 
                                  : 'text-gray-700 hover:bg-gray-200'
                              }`}
                            >
                              أسبوعي
                            </button>
                            <button
                              onClick={() => setViewMode('day')}
                              className={`px-2 sm:px-3 py-1.5 text-xs sm:text-sm font-medium rounded transition-colors flex-1 sm:flex-none ${
                                viewMode === 'day' 
                                  ? 'bg-red-600 text-white shadow-sm' 
                                  : 'text-gray-700 hover:bg-gray-200'
                              }`}
                            >
                              يومي
                            </button>
                          </div>
                          
                          {/* Filter */}
                          <select
                            value={filterType}
                            onChange={(e) => setFilterType(e.target.value)}
                            className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 text-xs sm:text-sm bg-white flex-1 sm:flex-none min-w-[140px]"
                          >
                            <option value="all">جميع الأحداث</option>
                            <option value="lecture">المحاضرات</option>
                            <option value="exam">الامتحانات</option>
                            <option value="meeting">الاجتماعات</option>
                            <option value="task">المهام</option>
                            <option value="announcement">الإعلانات</option>
                            <option value="special">مناسبات خاصة</option>
                          </select>
                          
                          {/* Add Event Button */}
                          <button
                            onClick={handleOpenAddEventModal}
                            className="px-3 sm:px-4 py-2 bg-gradient-to-r from-red-600 to-red-700 text-white rounded-lg hover:from-red-700 hover:to-red-800 transition-all font-medium text-xs sm:text-sm whitespace-nowrap shadow-sm hover:shadow-md flex items-center justify-center gap-1.5 sm:gap-2 flex-1 sm:flex-none"
                          >
                            <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                            </svg>
                            <span className="hidden sm:inline">إضافة حدث</span>
                            <span className="sm:hidden">إضافة</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Calendar View */}
                {viewMode === 'month' && (
                  <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
                    {/* Days of Week Header */}
                    <div className="grid grid-cols-7 border-b border-gray-200 bg-gradient-to-r from-red-50 to-red-100">
                      {['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'].map((day) => (
                        <div key={day} className="p-2 sm:p-3 md:p-4 text-center text-xs sm:text-sm font-bold text-gray-700 border-r border-red-200 last:border-r-0">
                          {day}
                        </div>
                      ))}
                    </div>

                    {/* Calendar Days */}
                    <div className="grid grid-cols-7">
                      {calendarDays.map((day, index) => {
                        if (!day) {
                          return <div key={`empty-${index}`} className="min-h-[60px] sm:min-h-[80px] md:min-h-[120px] border-r border-b border-gray-200 bg-gray-50"></div>;
                        }

                        const dayEvents = getEventsForDate(day);
                        const isToday = day.toDateString() === new Date().toDateString();
                        const isSelected = selectedDate && day.toDateString() === selectedDate.toDateString();

                        return (
                          <div
                            key={day.toISOString()}
                            onClick={() => {
                              setSelectedDate(day);
                              if (dayEvents.length > 1) {
                                setShowDayEventsModal(true);
                              } else if (dayEvents.length === 1) {
                                setSelectedEvent(dayEvents[0]);
                                setShowEventDetailsModal(true);
                              }
                            }}
                            className={`min-h-[60px] sm:min-h-[80px] md:min-h-[120px] border-r border-b border-gray-200 p-1 sm:p-1.5 md:p-2 cursor-pointer hover:bg-red-50 transition-colors relative ${
                              isToday ? 'bg-gradient-to-br from-red-50 to-red-100' : 'bg-white'
                            } ${isSelected ? 'ring-2 ring-red-500 ring-inset' : ''}`}
                          >
                            {/* Date Number */}
                            <div className={`text-xs sm:text-sm md:text-base font-bold mb-1 flex items-center justify-between ${
                              isToday ? 'text-red-600' : 'text-gray-900'
                            }`}>
                              <div className="flex items-center gap-1.5">
                                <span>{day.getDate()}</span>
                                {dayEvents.length > 0 && !isToday && (
                                  <div className="w-1.5 h-1.5 bg-blue-500 rounded-full"></div>
                                )}
                                {isToday && (
                                  <div className="w-1.5 h-1.5 bg-red-600 rounded-full"></div>
                                )}
                              </div>
                              {dayEvents.length > 0 && (
                                <span className="text-[9px] sm:text-[10px] bg-red-100 text-red-700 font-bold px-1 sm:px-1.5 rounded-full border border-red-200">
                                  {dayEvents.length}
                                </span>
                              )}
                            </div>
                            
                            {/* Events List */}
                            <div className="space-y-0.5 sm:space-y-1 overflow-hidden">
                              {/* On mobile, show only 1 event, on larger screens show 2 */}
                              {dayEvents.slice(0, 2).map((event, eventIndex) => (
                                <div
                                  key={event.id}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedEvent(event);
                                    setShowEventDetailsModal(true);
                                  }}
                                  className={`text-[10px] sm:text-xs px-1 sm:px-1.5 py-0.5 sm:py-1 rounded truncate text-white font-medium cursor-pointer hover:opacity-90 transition-opacity shadow-sm ${
                                    eventIndex >= 1 ? 'hidden sm:block' : ''
                                  }`}
                                  style={{ backgroundColor: event.color || eventTypeColors[event.event_type] || '#DC2626' }}
                                  title={event.title}
                                >
                                  {event.start_time && !event.all_day && (
                                    <span className="hidden sm:inline">{event.start_time.substring(0, 5)} </span>
                                  )}
                                  <span className="truncate block">{event.title}</span>
                                </div>
                              ))}
                              {dayEvents.length > 1 && (
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedDate(day);
                                  }}
                                  className="text-[10px] sm:text-xs text-red-600 font-semibold px-1 sm:px-1.5 py-0.5 hover:bg-red-50 rounded transition-colors w-full text-right"
                                >
                                  {dayEvents.length > 2 ? `+${dayEvents.length - 2} المزيد` : dayEvents.length > 1 ? `${dayEvents.length} أحداث` : ''}
                                </button>
                              )}
                              {dayEvents.length === 0 && (
                                <div className="text-[8px] text-gray-400 text-center py-1 hidden sm:block">-</div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

        {viewMode === 'week' && (
          <WeekView
            currentDate={currentDate}
            events={events}
            getEventsForDate={getEventsForDate}
            selectedDate={selectedDate}
            setSelectedDate={setSelectedDate}
            eventTypeColors={eventTypeColors}
            onEventClick={(event) => {
              setSelectedEvent(event);
              setShowEventDetailsModal(true);
            }}
            onNavigateWeek={(direction) => {
              setCurrentDate(prev => {
                const newDate = new Date(prev);
                if (direction === 'prev') {
                  newDate.setDate(prev.getDate() - 7);
                } else {
                  newDate.setDate(prev.getDate() + 7);
                }
                return newDate;
              });
            }}
          />
        )}

        {viewMode === 'day' && (
          <DayView
            currentDate={currentDate}
            events={events}
            getEventsForDate={getEventsForDate}
            eventTypeColors={eventTypeColors}
            eventTypeLabels={eventTypeLabels}
            onEventClick={(event) => {
              setSelectedEvent(event);
              setShowEventDetailsModal(true);
            }}
            onNavigateDay={(direction) => {
              setCurrentDate(prev => {
                const newDate = new Date(prev);
                if (direction === 'prev') {
                  newDate.setDate(prev.getDate() - 1);
                } else {
                  newDate.setDate(prev.getDate() + 1);
                }
                return newDate;
              });
            }}
          />
        )}

                {/* Event Legend */}
                <div className="mt-4 sm:mt-6 bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
                  <div className="bg-gradient-to-r from-red-50 to-red-100 px-4 sm:px-5 md:px-6 py-3 sm:py-4 border-b border-red-200">
                    <div className="flex items-center gap-2 sm:gap-3">
                      <div className="w-8 h-8 sm:w-10 sm:h-10 bg-red-600 rounded-lg flex items-center justify-center flex-shrink-0">
                        <svg className="w-4 h-4 sm:w-5 sm:h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                        </svg>
                      </div>
                      <h3 className="text-base sm:text-lg font-bold text-gray-900">دليل الأحداث</h3>
                    </div>
                  </div>
                  <div className="p-4 sm:p-5 md:p-6">
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3 sm:gap-4">
                      {Object.entries(eventTypeLabels).map(([type, label]) => (
                        <div key={type} className="flex items-center gap-2 bg-gray-50 rounded-lg p-2 sm:p-3 border border-gray-200 hover:border-red-300 transition-colors">
                          <div
                            className="w-4 h-4 sm:w-5 sm:h-5 rounded flex-shrink-0 shadow-sm"
                            style={{ backgroundColor: eventTypeColors[type] || '#DC2626' }}
                          ></div>
                          <span className="text-xs sm:text-sm text-gray-700 font-medium">{label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
            </div>
            </>
        ) : null}
      </main>

      {/* Add Event Modal */}
      {showAddEventModal && (
        <AddEventModal
          eventForm={eventForm}
          setEventForm={setEventForm}
          subjects={subjects}
          filteredLectures={filteredLectures}
          loadingSubjects={loadingSubjects}
          creatingEvent={creatingEvent}
          onCreateEvent={handleCreateEvent}
          onClose={() => setShowAddEventModal(false)}
          onEventTypeChange={handleEventTypeChange}
          eventTypeColors={eventTypeColors}
          eventTypeLabels={eventTypeLabels}
        />
      )}

      {/* Event Details Modal */}
      {showEventDetailsModal && selectedEvent && (
        <EventDetailsModal
          event={selectedEvent}
          onEdit={() => handleOpenEventForEdit(selectedEvent)}
          onDelete={() => {
            setShowDeleteConfirm(true);
          }}
          onClose={() => {
            setShowEventDetailsModal(false);
            setSelectedEvent(null);
          }}
          eventTypeColors={eventTypeColors}
          eventTypeLabels={eventTypeLabels}
          isOwner={selectedEvent.is_owner}
        />
      )}

      {/* Edit Event Modal */}
      {showEditEventModal && selectedEvent && (
        <AddEventModal
          eventForm={eventForm}
          setEventForm={setEventForm}
          subjects={subjects}
          filteredLectures={filteredLectures}
          loadingSubjects={loadingSubjects}
          creatingEvent={updatingEvent}
          onCreateEvent={handleUpdateEvent}
          onClose={() => {
            setShowEditEventModal(false);
            setSelectedEvent(null);
          }}
          onEventTypeChange={handleEventTypeChange}
          eventTypeColors={eventTypeColors}
          eventTypeLabels={eventTypeLabels}
          isEdit={true}
          editTitle="تعديل الحدث"
        />
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && selectedEvent && (
        <DeleteConfirmModal
          eventTitle={selectedEvent.title}
          onConfirm={handleDeleteEvent}
          onCancel={() => {
            setShowDeleteConfirm(false);
          }}
          deleting={deletingEvent}
        />
      )}

      {/* Day Events Modal */}
      {showDayEventsModal && selectedDate && (
        <DayEventsModal
          date={selectedDate}
          events={getEventsForDate(selectedDate)}
          eventTypeColors={eventTypeColors}
          eventTypeLabels={eventTypeLabels}
          onEventClick={(event) => {
            setSelectedEvent(event);
            setShowDayEventsModal(false);
            setShowEventDetailsModal(true);
          }}
          onClose={() => {
            setShowDayEventsModal(false);
            setSelectedDate(null);
          }}
        />
      )}
    </div>
  );
}

// Day Events Modal Component
interface DayEventsModalProps {
  date: Date;
  events: CalendarEvent[];
  eventTypeColors: Record<string, string>;
  eventTypeLabels: Record<string, string>;
  onEventClick: (event: CalendarEvent) => void;
  onClose: () => void;
}

function DayEventsModal({
  date,
  events,
  eventTypeColors,
  eventTypeLabels,
  onEventClick,
  onClose
}: DayEventsModalProps) {
  const monthNames = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const dayNames = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  
  const formatTime = (timeStr: string | null) => {
    if (!timeStr) return '';
    return timeStr.substring(0, 5);
  };

  // Sort events by time
  const sortedEvents = [...events].sort((a, b) => {
    if (a.all_day && !b.all_day) return -1;
    if (!a.all_day && b.all_day) return 1;
    if (a.all_day && b.all_day) return 0;
    return (a.start_time || '').localeCompare(b.start_time || '');
  });

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-red-600 to-red-700 px-4 sm:px-6 py-4 text-white">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg sm:text-xl font-bold">
                {dayNames[date.getDay()]}، {date.getDate()} {monthNames[date.getMonth()]} {date.getFullYear()}
              </h2>
              <p className="text-xs sm:text-sm text-red-100 mt-1">
                {events.length} {events.length === 1 ? 'حدث' : 'أحداث'}
              </p>
            </div>
            <button
              onClick={onClose}
              className="text-white hover:text-red-100 text-2xl font-bold"
            >
              ×
            </button>
          </div>
        </div>

        {/* Events List */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {sortedEvents.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <svg className="mx-auto h-12 w-12 text-gray-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <p className="text-sm font-medium">لا توجد أحداث في هذا اليوم</p>
            </div>
          ) : (
            <div className="space-y-3">
              {sortedEvents.map((event) => (
                <div
                  key={event.id}
                  onClick={() => onEventClick(event)}
                  className="border border-gray-200 rounded-xl p-4 hover:shadow-lg hover:border-red-300 transition-all cursor-pointer bg-white"
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="w-5 h-5 rounded-full mt-1 flex-shrink-0 shadow-sm"
                      style={{ backgroundColor: event.color || eventTypeColors[event.event_type] || '#DC2626' }}
                    ></div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        <h4 className="font-bold text-base text-gray-900">{event.title}</h4>
                        <span className="text-xs px-2.5 py-1 bg-red-50 text-red-700 rounded-full font-medium border border-red-200">
                          {eventTypeLabels[event.event_type] || event.event_type}
                        </span>
                      </div>
                      <div className="space-y-1.5 text-sm text-gray-600">
                        {event.start_time && !event.all_day && (
                          <p className="flex items-center gap-2">
                            <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            {formatTime(event.start_time)}
                            {event.end_time && ` - ${formatTime(event.end_time)}`}
                          </p>
                        )}
                        {event.all_day && (
                          <p className="flex items-center gap-2">
                            <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            طوال اليوم
                          </p>
                        )}
                        {event.location && (
                          <p className="flex items-center gap-2">
                            <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                            {event.location}
                          </p>
                        )}
                        {event.subject_name && (
                          <p className="flex items-center gap-2">
                            <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                            </svg>
                            {event.subject_name}
                          </p>
                        )}
                      </div>
                      {event.description && (
                        <p className="text-sm text-gray-700 mt-3 bg-gray-50 p-3 rounded-lg border border-gray-200 line-clamp-3">
                          {event.description}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-gray-50 border-t border-gray-200 px-4 sm:px-6 py-3">
          <button
            onClick={onClose}
            className="w-full px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
          >
            إغلاق
          </button>
        </div>
      </div>
    </div>
  );
}

// Add Event Modal Component
interface AddEventModalProps {
  eventForm: any;
  setEventForm: (form: any) => void;
  subjects: any[];
  filteredLectures: any[];
  loadingSubjects: boolean;
  creatingEvent: boolean;
  onCreateEvent: (e: React.FormEvent) => void;
  onClose: () => void;
  onEventTypeChange: (type: string) => void;
  eventTypeColors: Record<string, string>;
  eventTypeLabels: Record<string, string>;
  isEdit?: boolean;
  editTitle?: string;
}

function AddEventModal({
  eventForm,
  setEventForm,
  subjects,
  filteredLectures,
  loadingSubjects,
  creatingEvent,
  onCreateEvent,
  onClose,
  onEventTypeChange,
  eventTypeColors,
  eventTypeLabels,
  isEdit = false,
  editTitle = 'تعديل الحدث'
}: AddEventModalProps) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full max-h-[95vh] overflow-y-auto my-4">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-4 sm:px-6 py-4 flex items-center justify-between z-10">
          <h2 className="text-lg sm:text-xl font-bold text-gray-900">
            {isEdit ? editTitle : 'إضافة حدث جديد'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl font-bold"
            disabled={creatingEvent}
          >
            ×
          </button>
        </div>

        <form onSubmit={onCreateEvent} className="p-4 sm:p-6 space-y-6">
          {/* Event Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              نوع الحدث <span className="text-red-600">*</span>
            </label>
            <select
              value={eventForm.event_type}
              onChange={(e) => onEventTypeChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
              required
              disabled={creatingEvent}
            >
              {Object.entries(eventTypeLabels).map(([type, label]) => (
                <option key={type} value={type}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              عنوان الحدث <span className="text-red-600">*</span>
            </label>
            <input
              type="text"
              value={eventForm.title}
              onChange={(e) => setEventForm({ ...eventForm, title: e.target.value })}
              placeholder="مثال: امتحان الشهر الأول..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
              required
              disabled={creatingEvent}
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              وصف الحدث
            </label>
            <textarea
              value={eventForm.description}
              onChange={(e) => setEventForm({ ...eventForm, description: e.target.value })}
              placeholder="وصف تفصيلي للحدث..."
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500 resize-none"
              disabled={creatingEvent}
            />
          </div>

          {/* Date Range */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                تاريخ البداية <span className="text-red-600">*</span>
              </label>
              <input
                type="date"
                value={eventForm.start_date}
                onChange={(e) => {
                  const newStartDate = e.target.value;
                  setEventForm({
                    ...eventForm,
                    start_date: newStartDate,
                    end_date: newStartDate > eventForm.end_date ? newStartDate : eventForm.end_date
                  });
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
                required
                disabled={creatingEvent}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                تاريخ النهاية
              </label>
              <input
                type="date"
                value={eventForm.end_date}
                onChange={(e) => setEventForm({ ...eventForm, end_date: e.target.value })}
                min={eventForm.start_date}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
                disabled={creatingEvent}
              />
            </div>
          </div>

          {/* All Day Toggle */}
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="all_day"
              checked={eventForm.all_day}
              onChange={(e) => setEventForm({ ...eventForm, all_day: e.target.checked })}
              className="w-4 h-4 text-red-600 border-gray-300 rounded focus:ring-red-500"
              disabled={creatingEvent}
            />
            <label htmlFor="all_day" className="text-sm font-medium text-gray-700">
              حدث طوال اليوم
            </label>
          </div>

          {/* Time Range (if not all day) */}
          {!eventForm.all_day && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  وقت البداية
                </label>
                <input
                  type="time"
                  value={eventForm.start_time}
                  onChange={(e) => setEventForm({ ...eventForm, start_time: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
                  disabled={creatingEvent}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  وقت النهاية
                </label>
                <input
                  type="time"
                  value={eventForm.end_time}
                  onChange={(e) => setEventForm({ ...eventForm, end_time: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
                  disabled={creatingEvent}
                />
              </div>
            </div>
          )}

          {/* Location */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              المكان
            </label>
            <input
              type="text"
              value={eventForm.location}
              onChange={(e) => setEventForm({ ...eventForm, location: e.target.value })}
              placeholder="مثال: القاعة 101، المختبر 5..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
              disabled={creatingEvent}
            />
          </div>

          {/* Subject and Lecture Linking */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                ربط بمادة دراسية
              </label>
              <select
                value={eventForm.subject_id}
                onChange={(e) => setEventForm({ ...eventForm, subject_id: e.target.value, lecture_id: '' })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
                disabled={creatingEvent || loadingSubjects}
              >
                <option value="">لا يوجد</option>
                {subjects.map((subject) => (
                  <option key={subject.subject_id} value={subject.subject_id}>
                    {subject.subject_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                ربط بمحاضرة
              </label>
              <select
                value={eventForm.lecture_id}
                onChange={(e) => setEventForm({ ...eventForm, lecture_id: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
                disabled={creatingEvent || loadingSubjects || !eventForm.subject_id}
              >
                <option value="">لا يوجد</option>
                {filteredLectures.map((lecture) => (
                  <option key={lecture.id} value={lecture.id}>
                    {lecture.topic || 'بدون عنوان'} - {new Date(lecture.lecture_date).toLocaleDateString('en-US')}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Exam-specific fields */}
          {eventForm.event_type === 'exam' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  نوع الامتحان
                </label>
                <select
                  value={eventForm.exam_type}
                  onChange={(e) => setEventForm({ ...eventForm, exam_type: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
                  disabled={creatingEvent}
                >
                  <option value="">اختر نوع الامتحان</option>
                  <option value="monthly">امتحان شهري</option>
                  <option value="midterm">امتحان منتصف الفصل</option>
                  <option value="final">امتحان نهائي</option>
                  <option value="quiz">اختبار سريع</option>
                  <option value="practical">امتحان عملي</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  مدة الامتحان (بالدقائق)
                </label>
                <input
                  type="number"
                  min="15"
                  max="480"
                  value={eventForm.exam_duration_minutes || ''}
                  onChange={(e) => setEventForm({ ...eventForm, exam_duration_minutes: e.target.value ? parseInt(e.target.value) : null })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
                  disabled={creatingEvent}
                />
              </div>
            </div>
          )}

          {/* Priority */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              الأولوية
            </label>
            <select
              value={eventForm.priority}
              onChange={(e) => setEventForm({ ...eventForm, priority: e.target.value as any })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
              disabled={creatingEvent}
            >
              <option value="low">منخفضة</option>
              <option value="normal">عادية</option>
              <option value="high">عالية</option>
              <option value="urgent">عاجلة</option>
            </select>
          </div>

          {/* Reminder */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              تذكير قبل الحدث (بالدقائق)
            </label>
            <select
              value={eventForm.reminder_minutes || ''}
              onChange={(e) => setEventForm({ ...eventForm, reminder_minutes: e.target.value ? parseInt(e.target.value) : null })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500"
              disabled={creatingEvent}
            >
              <option value="">بدون تذكير</option>
              <option value="15">15 دقيقة</option>
              <option value="30">30 دقيقة</option>
              <option value="60">ساعة واحدة</option>
              <option value="120">ساعتان</option>
              <option value="1440">يوم واحد</option>
            </select>
          </div>

          {/* Sharing Options */}
          <div className="border-t border-gray-200 pt-4">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">خيارات المشاركة</h3>
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="share_students"
                  checked={eventForm.is_shared_with_students}
                  onChange={(e) => setEventForm({ ...eventForm, is_shared_with_students: e.target.checked })}
                  className="w-4 h-4 text-red-600 border-gray-300 rounded focus:ring-red-500"
                  disabled={creatingEvent}
                />
                <label htmlFor="share_students" className="text-sm font-medium text-gray-700">
                  مشاركة مع الطلبة
                </label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="share_teachers"
                  checked={eventForm.is_shared_with_teachers}
                  onChange={(e) => setEventForm({ ...eventForm, is_shared_with_teachers: e.target.checked })}
                  className="w-4 h-4 text-red-600 border-gray-300 rounded focus:ring-red-500"
                  disabled={creatingEvent}
                />
                <label htmlFor="share_teachers" className="text-sm font-medium text-gray-700">
                  مشاركة مع التدريسيين الآخرين
                </label>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              ملاحظات
            </label>
            <textarea
              value={eventForm.notes}
              onChange={(e) => setEventForm({ ...eventForm, notes: e.target.value })}
              placeholder="أي ملاحظات إضافية..."
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-red-500 focus:border-red-500 resize-none"
              disabled={creatingEvent}
            />
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-gray-200">
            <button
              type="submit"
              disabled={creatingEvent}
              className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {creatingEvent ? (isEdit ? 'جاري التحديث...' : 'جاري الإنشاء...') : (isEdit ? 'تحديث الحدث' : 'إنشاء الحدث')}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={creatingEvent}
              className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              إلغاء
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Event Details Modal Component
interface EventDetailsModalProps {
  event: CalendarEvent;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
  eventTypeColors: Record<string, string>;
  eventTypeLabels: Record<string, string>;
  isOwner: boolean;
}

function EventDetailsModal({
  event,
  onEdit,
  onDelete,
  onClose,
  eventTypeColors,
  eventTypeLabels,
  isOwner
}: EventDetailsModalProps) {
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const monthNames = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
    return `${date.getDate()} ${monthNames[date.getMonth()]} ${date.getFullYear()}`;
  };

  const priorityLabels: Record<string, string> = {
    low: 'منخفضة',
    normal: 'عادية',
    high: 'عالية',
    urgent: 'عاجلة'
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 px-4 sm:px-6 py-4 flex items-center justify-between z-10">
          <div className="flex items-center gap-3">
            <div
              className="w-4 h-4 rounded"
              style={{ backgroundColor: event.color || eventTypeColors[event.event_type] || '#DC2626' }}
            ></div>
            <h2 className="text-lg sm:text-xl font-bold text-gray-900">
              {event.title}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl font-bold"
          >
            ×
          </button>
        </div>

        <div className="p-4 sm:p-6 space-y-4">
          {/* Event Type */}
          <div>
            <span className="text-xs font-medium text-gray-500">نوع الحدث</span>
            <p className="text-sm font-medium text-gray-900 mt-1">
              {eventTypeLabels[event.event_type] || event.event_type}
            </p>
          </div>

          {/* Description */}
          {event.description && (
            <div>
              <span className="text-xs font-medium text-gray-500">الوصف</span>
              <p className="text-sm text-gray-900 mt-1 whitespace-pre-wrap">
                {event.description}
              </p>
            </div>
          )}

          {/* Date and Time */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <span className="text-xs font-medium text-gray-500">تاريخ البداية</span>
              <p className="text-sm font-medium text-gray-900 mt-1">
                {formatDate(event.start_date)}
              </p>
            </div>
            {event.end_date && event.end_date !== event.start_date && (
              <div>
                <span className="text-xs font-medium text-gray-500">تاريخ النهاية</span>
                <p className="text-sm font-medium text-gray-900 mt-1">
                  {formatDate(event.end_date)}
                </p>
              </div>
            )}
            {!event.all_day && event.start_time && (
              <div>
                <span className="text-xs font-medium text-gray-500">الوقت</span>
                <p className="text-sm font-medium text-gray-900 mt-1">
                  {event.start_time}
                  {event.end_time && ` - ${event.end_time}`}
                </p>
              </div>
            )}
            {event.all_day && (
              <div>
                <span className="text-xs font-medium text-gray-500">الوقت</span>
                <p className="text-sm font-medium text-gray-900 mt-1">طوال اليوم</p>
              </div>
            )}
          </div>

          {/* Location */}
          {event.location && (
            <div>
              <span className="text-xs font-medium text-gray-500">المكان</span>
              <p className="text-sm font-medium text-gray-900 mt-1">
                {event.location}
              </p>
            </div>
          )}

          {/* Subject and Lecture */}
          {(event.subject_name || event.lecture_topic) && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {event.subject_name && (
                <div>
                  <span className="text-xs font-medium text-gray-500">المادة الدراسية</span>
                  <p className="text-sm font-medium text-gray-900 mt-1">
                    {event.subject_name}
                  </p>
                </div>
              )}
              {event.lecture_topic && (
                <div>
                  <span className="text-xs font-medium text-gray-500">المحاضرة</span>
                  <p className="text-sm font-medium text-gray-900 mt-1">
                    {event.lecture_topic}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Exam Details */}
          {event.event_type === 'exam' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {event.exam_type && (
                <div>
                  <span className="text-xs font-medium text-gray-500">نوع الامتحان</span>
                  <p className="text-sm font-medium text-gray-900 mt-1">
                    {event.exam_type}
                  </p>
                </div>
              )}
              {event.exam_duration_minutes && (
                <div>
                  <span className="text-xs font-medium text-gray-500">مدة الامتحان</span>
                  <p className="text-sm font-medium text-gray-900 mt-1">
                    {event.exam_duration_minutes} دقيقة
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Priority */}
          <div>
            <span className="text-xs font-medium text-gray-500">الأولوية</span>
            <p className="text-sm font-medium text-gray-900 mt-1">
              {priorityLabels[event.priority] || event.priority}
            </p>
          </div>

          {/* Sharing */}
          {(event.is_shared_with_students || event.is_shared_with_teachers) && (
            <div>
              <span className="text-xs font-medium text-gray-500">المشاركة</span>
              <div className="flex flex-wrap gap-2 mt-1">
                {event.is_shared_with_students && (
                  <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs rounded">
                    مع الطلبة
                  </span>
                )}
                {event.is_shared_with_teachers && (
                  <span className="px-2 py-1 bg-green-100 text-green-800 text-xs rounded">
                    مع التدريسيين
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Notes */}
          {event.notes && (
            <div>
              <span className="text-xs font-medium text-gray-500">ملاحظات</span>
              <p className="text-sm text-gray-900 mt-1 whitespace-pre-wrap">
                {event.notes}
              </p>
            </div>
          )}

          {/* Owner Info */}
          {!isOwner && event.teacher_name && (
            <div>
              <span className="text-xs font-medium text-gray-500">منشئ الحدث</span>
              <p className="text-sm font-medium text-gray-900 mt-1">
                {event.teacher_name}
              </p>
            </div>
          )}

          {/* Actions */}
          {isOwner && (
            <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-gray-200">
              <button
                onClick={onEdit}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
              >
                تعديل
              </button>
              <button
                onClick={onDelete}
                className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium"
              >
                حذف
              </button>
              <button
                onClick={onClose}
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium"
              >
                إغلاق
              </button>
            </div>
          )}
          {!isOwner && (
            <div className="pt-4 border-t border-gray-200">
              <button
                onClick={onClose}
                className="w-full px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium"
              >
                إغلاق
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Delete Confirmation Modal Component
interface DeleteConfirmModalProps {
  eventTitle: string;
  onConfirm: () => void;
  onCancel: () => void;
  deleting: boolean;
}

function DeleteConfirmModal({
  eventTitle,
  onConfirm,
  onCancel,
  deleting
}: DeleteConfirmModalProps) {
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
        <h3 className="text-lg font-bold text-gray-900 mb-4">
          تأكيد الحذف
        </h3>
        <p className="text-sm text-gray-700 mb-6">
          هل أنت متأكد من حذف الحدث <strong>"{eventTitle}"</strong>؟ لا يمكن التراجع عن هذه العملية.
        </p>
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={onConfirm}
            disabled={deleting}
            className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {deleting ? 'جاري الحذف...' : 'حذف'}
          </button>
          <button
            onClick={onCancel}
            disabled={deleting}
            className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            إلغاء
          </button>
        </div>
      </div>
    </div>
  );
}

