// Week View and Day View Components for Calendar

export interface CalendarEvent {
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
}

interface WeekViewProps {
  currentDate: Date;
  events: CalendarEvent[];
  getEventsForDate: (date: Date) => CalendarEvent[];
  selectedDate: Date | null;
  setSelectedDate: (date: Date) => void;
  eventTypeColors: Record<string, string>;
  onEventClick: (event: CalendarEvent) => void;
  onNavigateWeek: (direction: 'prev' | 'next') => void;
}

export function WeekView({
  currentDate,
  events,
  getEventsForDate,
  selectedDate,
  setSelectedDate,
  eventTypeColors,
  onEventClick,
  onNavigateWeek
}: WeekViewProps) {
  const dayOfWeek = currentDate.getDay();
  const weekStart = new Date(currentDate);
  weekStart.setDate(currentDate.getDate() - dayOfWeek);
  
  const weekDays: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(weekStart);
    day.setDate(weekStart.getDate() + i);
    weekDays.push(day);
  }

  const monthNames = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const dayNames = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
      {/* Week Header */}
      <div className="grid grid-cols-7 border-b border-gray-200 bg-gradient-to-r from-red-50 to-red-100">
        {weekDays.map((day, index) => {
          const isToday = day.toDateString() === new Date().toDateString();
          return (
            <div
              key={`header-${index}`}
              className={`p-2 sm:p-3 text-center border-r border-red-200 last:border-r-0 ${
                isToday ? 'bg-red-100' : ''
              }`}
            >
              <div className={`text-xs sm:text-sm font-bold ${isToday ? 'text-red-700' : 'text-gray-700'}`}>
                {dayNames[index]}
              </div>
            </div>
          );
        })}
      </div>
      
      {/* Week Days Content */}
      <div className="grid grid-cols-7">
        {weekDays.map((day, index) => {
          const dayEvents = getEventsForDate(day);
          const isToday = day.toDateString() === new Date().toDateString();
          const isSelected = selectedDate && day.toDateString() === selectedDate.toDateString();

          return (
            <div
              key={day.toISOString()}
              className={`border-r border-b border-gray-200 p-1.5 sm:p-2 md:p-4 min-h-[100px] sm:min-h-[150px] md:min-h-[200px] ${
                isToday ? 'bg-gradient-to-br from-red-50 to-red-100' : 'bg-white'
              } ${isSelected ? 'ring-2 ring-red-500 ring-inset' : ''} hover:bg-red-50 transition-colors`}
            >
              <div className="text-center mb-1 sm:mb-2">
                <div className={`text-xs sm:text-sm font-bold ${isToday ? 'text-red-600' : 'text-gray-500'}`}>
                  {dayNames[index]}
                </div>
                <div className={`text-base sm:text-lg md:text-xl font-bold mt-0.5 sm:mt-1 flex items-center justify-center gap-1 ${
                  isToday ? 'text-red-600' : 'text-gray-900'
                }`}>
                  <span>{day.getDate()}</span>
                  {isToday && <div className="w-1.5 h-1.5 bg-red-600 rounded-full"></div>}
                </div>
                <div className="text-[10px] sm:text-xs text-gray-500 mt-0.5 sm:mt-1">
                  {monthNames[day.getMonth()]}
                </div>
              </div>
              <div className="space-y-0.5 sm:space-y-1 mt-2 sm:mt-3">
                {dayEvents.map((event) => (
                  <div
                    key={event.id}
                    onClick={() => onEventClick(event)}
                    className="text-[10px] sm:text-xs px-1.5 sm:px-2 py-0.5 sm:py-1 rounded text-white font-medium cursor-pointer hover:opacity-90 truncate shadow-sm transition-opacity"
                    style={{ backgroundColor: event.color || eventTypeColors[event.event_type] || '#DC2626' }}
                    title={event.title}
                  >
                    {event.start_time && !event.all_day && (
                      <span className="hidden sm:inline">{event.start_time.substring(0, 5)} </span>
                    )}
                    <span className="truncate block">{event.title}</span>
                  </div>
                ))}
                {dayEvents.length === 0 && (
                  <div className="text-[10px] text-gray-400 text-center py-2">لا توجد أحداث</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface DayViewProps {
  currentDate: Date;
  events: CalendarEvent[];
  getEventsForDate: (date: Date) => CalendarEvent[];
  eventTypeColors: Record<string, string>;
  eventTypeLabels: Record<string, string>;
  onEventClick: (event: CalendarEvent) => void;
  onNavigateDay: (direction: 'prev' | 'next') => void;
}

export function DayView({
  currentDate,
  events,
  getEventsForDate,
  eventTypeColors,
  eventTypeLabels,
  onEventClick,
  onNavigateDay
}: DayViewProps) {
  const dayEvents = getEventsForDate(currentDate);
  const monthNames = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
  const dayNames = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  
  const formatTime = (timeStr: string | null) => {
    if (!timeStr) return '';
    return timeStr.substring(0, 5);
  };

  // Sort events by time
  const sortedEvents = [...dayEvents].sort((a, b) => {
    if (a.all_day && !b.all_day) return -1;
    if (!a.all_day && b.all_day) return 1;
    if (a.all_day && b.all_day) return 0;
    return (a.start_time || '').localeCompare(b.start_time || '');
  });

  const isToday = currentDate.toDateString() === new Date().toDateString();

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden hover:shadow-md transition-shadow">
      {/* Day Header */}
      <div className={`p-4 sm:p-5 md:p-6 border-b border-gray-200 ${
        isToday ? 'bg-gradient-to-r from-red-50 to-red-100' : 'bg-gray-50'
      }`}>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-4">
          <div>
            <h3 className="text-base sm:text-lg md:text-xl font-bold text-gray-900">
              {dayNames[currentDate.getDay()]}، {currentDate.getDate()} {monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}
            </h3>
            {isToday && (
              <p className="text-xs sm:text-sm text-red-600 font-medium mt-1">اليوم</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onNavigateDay('prev')}
              className="p-2 hover:bg-white rounded-lg transition-colors border border-gray-300 hover:border-red-300"
              aria-label="اليوم السابق"
            >
              <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              onClick={() => onNavigateDay('next')}
              className="p-2 hover:bg-white rounded-lg transition-colors border border-gray-300 hover:border-red-300"
              aria-label="اليوم التالي"
            >
              <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Events List */}
      <div className="p-4 sm:p-5 md:p-6">
        {sortedEvents.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <svg className="mx-auto h-12 w-12 text-gray-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            <p className="text-sm font-medium">لا توجد أحداث في هذا اليوم</p>
          </div>
        ) : (
          <div className="space-y-2 sm:space-y-3">
            {sortedEvents.map((event) => (
              <div
                key={event.id}
                onClick={() => onEventClick(event)}
                className="border border-gray-200 rounded-xl p-3 sm:p-4 hover:shadow-lg hover:border-red-300 transition-all cursor-pointer bg-white"
              >
                <div className="flex items-start gap-3">
                  <div
                    className="w-4 h-4 sm:w-5 sm:h-5 rounded-full mt-1 flex-shrink-0 shadow-sm"
                    style={{ backgroundColor: event.color || eventTypeColors[event.event_type] || '#DC2626' }}
                  ></div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1 sm:mb-2">
                      <h4 className="font-bold text-sm sm:text-base text-gray-900 truncate">{event.title}</h4>
                      <span className="text-xs px-2 py-0.5 bg-red-50 text-red-700 rounded-full font-medium border border-red-200">
                        {eventTypeLabels[event.event_type] || event.event_type}
                      </span>
                    </div>
                    <div className="space-y-1 text-xs sm:text-sm text-gray-600">
                      {event.start_time && !event.all_day && (
                        <p className="flex items-center gap-1.5">
                          <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          {formatTime(event.start_time)}
                          {event.end_time && ` - ${formatTime(event.end_time)}`}
                        </p>
                      )}
                      {event.all_day && (
                        <p className="flex items-center gap-1.5">
                          <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          طوال اليوم
                        </p>
                      )}
                      {event.location && (
                        <p className="flex items-center gap-1.5">
                          <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                          {event.location}
                        </p>
                      )}
                    </div>
                    {event.description && (
                      <p className="text-xs sm:text-sm text-gray-700 mt-2 sm:mt-3 line-clamp-2 bg-gray-50 p-2 sm:p-3 rounded-lg border border-gray-200">
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
    </div>
  );
}

