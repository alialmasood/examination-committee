'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Student } from '@/src/lib/types';

type EditableStudent = Student & {
  admission_channel?: string;
};

type FieldKey =
  | 'full_name'
  | 'nickname'
  | 'mother_name'
  | 'national_id'
  | 'birth_date'
  | 'province'
  | 'area'
  | 'gender'
  | 'phone'
  | 'religion'
  | 'marital_status'
  | 'secondary_school_name'
  | 'secondary_graduation_year'
  | 'secondary_gpa'
  | 'exam_attempt'
  | 'exam_number'
  | 'exam_password'
  | 'branch'
  | 'department'
  | 'admission_type'
  | 'admission_channel'
  | 'study_type'
  | 'level'
  | 'semester'
  | 'academic_year';

type ColumnDef = {
  key: FieldKey | 'university_id';
  label: string;
  width: string;
  editable?: boolean;
  type?: 'text' | 'date' | 'number' | 'select';
  options?: { value: string; label: string }[];
};

const DEPARTMENTS = [
  'تقنيات التخدير',
  'تقنيات الاشعة',
  'تقنيات صناعة الاسنان',
  'هندسة تقنيات البناء والانشاءات',
  'تقنيات هندسة النفط والغاز',
  'تقنيات الفيزياء الصحية',
  'تقنيات البصريات',
  'تقنيات صحة المجتمع',
  'تقنيات طب الطوارئ',
  'تقنيات العلاج الطبيعي',
  'هندسة تقنيات الامن السيبراني والحوسبة السحابية',
  'القانون',
];

const COLUMNS: ColumnDef[] = [
  { key: 'full_name', label: 'الاسم الرباعي', width: '220px', editable: true, type: 'text' },
  { key: 'university_id', label: 'الرقم الجامعي', width: '130px', editable: false },
  { key: 'nickname', label: 'اللقب', width: '120px', editable: true, type: 'text' },
  { key: 'mother_name', label: 'اسم الأم', width: '170px', editable: true, type: 'text' },
  { key: 'national_id', label: 'الهوية الوطنية', width: '140px', editable: true, type: 'text' },
  { key: 'birth_date', label: 'تاريخ الميلاد', width: '140px', editable: true, type: 'date' },
  {
    key: 'province',
    label: 'المحافظة',
    width: '120px',
    editable: true,
    type: 'select',
    options: [
      'بغداد', 'البصرة', 'الموصل', 'أربيل', 'السليمانية', 'دهوك', 'كركوك', 'الأنبار',
      'النجف', 'كربلاء', 'بابل', 'واسط', 'ديالى', 'صلاح الدين', 'الديوانية', 'ميسان', 'ذي قار', 'المثنى',
    ].map((v) => ({ value: v, label: v })),
  },
  { key: 'area', label: 'المنطقة', width: '120px', editable: true, type: 'text' },
  {
    key: 'gender',
    label: 'الجنس',
    width: '100px',
    editable: true,
    type: 'select',
    options: [
      { value: 'male', label: 'ذكر' },
      { value: 'female', label: 'أنثى' },
    ],
  },
  { key: 'phone', label: 'الهاتف', width: '130px', editable: true, type: 'text' },
  {
    key: 'religion',
    label: 'الديانة',
    width: '110px',
    editable: true,
    type: 'select',
    options: ['مسلم', 'مسيحي', 'الصابئة', 'اليزيدية', 'غير ذلك'].map((v) => ({ value: v, label: v })),
  },
  {
    key: 'marital_status',
    label: 'الحالة الاجتماعية',
    width: '130px',
    editable: true,
    type: 'select',
    options: [
      { value: 'single', label: 'أعزب' },
      { value: 'married', label: 'متزوج' },
      { value: 'divorced', label: 'مطلق' },
      { value: 'widowed', label: 'أرمل' },
    ],
  },
  { key: 'secondary_school_name', label: 'المدرسة', width: '160px', editable: true, type: 'text' },
  { key: 'secondary_graduation_year', label: 'سنة التخرج', width: '120px', editable: true, type: 'text' },
  { key: 'secondary_gpa', label: 'المعدل', width: '90px', editable: true, type: 'number' },
  {
    key: 'exam_attempt',
    label: 'الدور',
    width: '100px',
    editable: true,
    type: 'select',
    options: [
      { value: 'first', label: 'الأول' },
      { value: 'second', label: 'الثاني' },
      { value: 'third', label: 'الثالث' },
    ],
  },
  { key: 'exam_number', label: 'الرقم الامتحاني', width: '130px', editable: true, type: 'text' },
  { key: 'exam_password', label: 'الرقم السري', width: '110px', editable: true, type: 'text' },
  { key: 'branch', label: 'الفرع', width: '140px', editable: true, type: 'text' },
  {
    key: 'department',
    label: 'القسم',
    width: '220px',
    editable: true,
    type: 'select',
    options: DEPARTMENTS.map((v) => ({ value: v, label: v })),
  },
  {
    key: 'admission_type',
    label: 'المرحلة',
    width: '110px',
    editable: true,
    type: 'select',
    options: [
      { value: 'first', label: 'الأولى' },
      { value: 'second', label: 'الثانية' },
      { value: 'third', label: 'الثالثة' },
      { value: 'fourth', label: 'الرابعة' },
    ],
  },
  {
    key: 'study_type',
    label: 'نوع الدراسة',
    width: '110px',
    editable: true,
    type: 'select',
    options: [
      { value: 'morning', label: 'صباحي' },
      { value: 'evening', label: 'مسائي' },
    ],
  },
  {
    key: 'level',
    label: 'المرحلة الدراسية',
    width: '130px',
    editable: true,
    type: 'select',
    options: [
      { value: 'bachelor', label: 'بكالوريوس' },
      { value: 'master', label: 'ماجستير' },
      { value: 'phd', label: 'دكتوراه' },
      { value: 'diploma', label: 'دبلوم' },
    ],
  },
  {
    key: 'semester',
    label: 'الفصل',
    width: '100px',
    editable: true,
    type: 'select',
    options: [
      { value: 'first', label: 'الأول' },
      { value: 'second', label: 'الثاني' },
    ],
  },
  {
    key: 'academic_year',
    label: 'السنة الأكاديمية',
    width: '130px',
    editable: true,
    type: 'select',
    options: ['2024-2025', '2025-2026', '2026-2027', '2027-2028', '2028-2029'].map((v) => ({
      value: v,
      label: v,
    })),
  },
  {
    key: 'admission_channel',
    label: 'قناة القبول',
    width: '180px',
    editable: true,
    type: 'select',
    options: [
      { value: 'general', label: 'القناة العامة' },
      { value: 'martyrs', label: 'ذوي الشهداء' },
      { value: 'social_care', label: 'الرعاية الاجتماعية' },
      { value: 'special_needs', label: 'ذوي الهمم' },
      { value: 'political_prisoners', label: 'السجناء السياسيين' },
      { value: 'siblings_married', label: 'تخفيض الاخوة والمتزوجين' },
      { value: 'minister_directive', label: 'توجيهات الوزير' },
      { value: 'dean_approval', label: 'موافقة العميد' },
      { value: 'faculty_children', label: 'ابناء الهيئة التدريسية' },
      { value: 'top_students', label: 'الاوائل' },
      { value: 'health_ministry', label: 'موظفي وزارة الصحة' },
    ],
  },
];

/** لوحة الاسم المجمّدة منفصلة عن الجدول القابل للتمرير (أوثق من sticky على td) */
const INDEX_W = 44;
const NAME_W = 220;
const ROW_H = 40;
const NAME_COLUMN = COLUMNS.find((c) => c.key === 'full_name')!;
const SCROLL_COLUMNS = COLUMNS.filter((c) => c.key !== 'full_name');

const cellClass =
  'h-9 w-full min-w-0 rounded border border-transparent bg-transparent px-2 text-xs text-slate-800 outline-none transition focus:border-sky-400 focus:bg-white focus:ring-1 focus:ring-sky-300';

function rowToneClasses(opts: {
  isDirty: boolean;
  justSaved: boolean;
  isEven: boolean;
  isActive: boolean;
}): string {
  const base = opts.isDirty
    ? 'bg-amber-50'
    : opts.justSaved
      ? 'bg-emerald-50'
      : opts.isEven
        ? 'bg-white'
        : 'bg-slate-50';
  return `${base} hover:bg-sky-100 ${opts.isActive ? 'bg-sky-100 ring-2 ring-inset ring-sky-400/70' : ''}`;
}

function getFieldValue(student: EditableStudent, key: FieldKey | 'university_id'): string {
  if (key === 'university_id') return student.university_id || '';
  if (key === 'department') return student.department || student.major || '';
  if (key === 'province') return student.province || student.birth_place || '';
  if (key === 'secondary_gpa') {
    return student.secondary_gpa === undefined || student.secondary_gpa === null
      ? ''
      : String(student.secondary_gpa);
  }
  const value = student[key as keyof EditableStudent];
  return value === undefined || value === null ? '' : String(value);
}

export default function EditStudentsPage() {
  const [students, setStudents] = useState<EditableStudent[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingIds, setSavingIds] = useState<Set<string>>(new Set());
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(new Set());
  const [savedFlash, setSavedFlash] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [department, setDepartment] = useState('');
  const [admissionType, setAdmissionType] = useState('');
  const [studyType, setStudyType] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const limit = 50;
  const frozenPaneRef = useRef<HTMLDivElement>(null);
  const scrollPaneRef = useRef<HTMLDivElement>(null);
  const syncingScroll = useRef(false);

  const syncVerticalScroll = (source: 'frozen' | 'scroll') => {
    if (syncingScroll.current) return;
    const from = source === 'frozen' ? frozenPaneRef.current : scrollPaneRef.current;
    const to = source === 'frozen' ? scrollPaneRef.current : frozenPaneRef.current;
    if (!from || !to) return;
    syncingScroll.current = true;
    to.scrollTop = from.scrollTop;
    requestAnimationFrame(() => {
      syncingScroll.current = false;
    });
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchTerm.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  const fetchStudents = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const params = new URLSearchParams({
        page: String(page),
        limit: String(limit),
      });
      if (debouncedSearch) params.set('search', debouncedSearch);
      if (department) params.set('department', department);
      if (admissionType) params.set('admission_type', admissionType);
      if (studyType) params.set('study_type', studyType);

      const response = await fetch(`/api/students?${params}`);
      const data = await response.json();
      if (!data.success) {
        setStudents([]);
        setError(data.error || 'تعذر جلب الطلبة');
        return;
      }

      setStudents((data.students || []) as EditableStudent[]);
      setTotal(data.pagination?.total || 0);
      setTotalPages(data.pagination?.total_pages || 1);
      setDirtyIds(new Set());
      setActiveRowId(null);
    } catch (err) {
      console.error(err);
      setError('تعذر الاتصال بالخادم');
      setStudents([]);
    } finally {
      setLoading(false);
    }
  }, [page, debouncedSearch, department, admissionType, studyType]);

  useEffect(() => {
    void fetchStudents();
  }, [fetchStudents]);

  const dirtyCount = dirtyIds.size;

  const updateField = (id: string, key: FieldKey, value: string) => {
    setStudents((prev) =>
      prev.map((student) => {
        if (student.id !== id) return student;
        const next: EditableStudent = { ...student };
        if (key === 'department') {
          next.department = value;
          next.major = value;
        } else if (key === 'province') {
          next.province = value;
          next.birth_place = value;
        } else if (key === 'secondary_gpa') {
          next.secondary_gpa = value === '' ? undefined : Number(value);
        } else if (key === 'gender') {
          next.gender = value as EditableStudent['gender'];
        } else if (key === 'study_type') {
          next.study_type = value as EditableStudent['study_type'];
        } else if (key === 'level') {
          next.level = value as EditableStudent['level'];
        } else if (key === 'admission_type') {
          next.admission_type = value as EditableStudent['admission_type'];
        } else {
          (next as unknown as Record<string, unknown>)[key] = value;
        }
        return next;
      })
    );
    setDirtyIds((prev) => {
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  };

  const buildPayload = (student: EditableStudent) => {
    const nameParts = (student.full_name || '').trim().split(/\s+/);
    return {
      full_name: student.full_name || '',
      full_name_ar: student.full_name || student.full_name_ar || '',
      nickname: student.nickname || '',
      first_name: nameParts[0] || student.first_name || '',
      last_name: nameParts.slice(1).join(' ') || student.last_name || '',
      middle_name: student.middle_name || '',
      national_id: student.national_id || '',
      birth_date: student.birth_date || null,
      birth_place: student.province || student.birth_place || '',
      province: student.province || student.birth_place || '',
      mother_name: student.mother_name || '',
      area: student.area || '',
      gender: student.gender || 'male',
      religion: student.religion || 'مسلم',
      marital_status: student.marital_status || 'single',
      phone: student.phone || '',
      email: student.email || '',
      address: student.address || '',
      emergency_contact_name: student.emergency_contact_name || '',
      emergency_contact_relationship: student.emergency_contact_relationship || '',
      emergency_contact_phone: student.emergency_contact_phone || '',
      secondary_school_name: student.secondary_school_name || '',
      secondary_school_type: student.secondary_school_type || '',
      secondary_graduation_year: student.secondary_graduation_year || '',
      secondary_gpa: student.secondary_gpa ?? '',
      secondary_total_score: student.secondary_total_score ?? '',
      exam_attempt: student.exam_attempt || '',
      exam_number: student.exam_number || '',
      exam_password: student.exam_password || '',
      branch: student.branch || '',
      admission_type: student.admission_type || '',
      admission_channel: student.admission_channel || '',
      department: student.department || student.major || '',
      major: student.department || student.major || '',
      study_type: student.study_type || '',
      level: student.level || '',
      semester: student.semester || '',
      academic_year: student.academic_year || '',
      special_requirements: '',
      username: student.username || '',
      password: student.password || '',
      status: student.status || 'active',
      academic_status: student.academic_status || 'مستمر',
    };
  };

  const saveStudent = async (id: string) => {
    const student = students.find((s) => s.id === id);
    if (!student) return;

    setSavingIds((prev) => new Set(prev).add(id));
    try {
      const response = await fetch(`/api/students/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload(student)),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        alert(result.error || 'تعذر حفظ بيانات الطالب');
        return;
      }

      setDirtyIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setSavedFlash((prev) => new Set(prev).add(id));
      setTimeout(() => {
        setSavedFlash((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }, 1600);
    } catch (err) {
      console.error(err);
      alert('تعذر الاتصال بالخادم أثناء الحفظ');
    } finally {
      setSavingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const saveAllDirty = async () => {
    const ids = Array.from(dirtyIds);
    for (const id of ids) {
      await saveStudent(id);
    }
  };

  const filterSummary = useMemo(() => {
    const parts = [];
    if (department) parts.push('قسم محدد');
    if (admissionType) parts.push('مرحلة محددة');
    if (studyType) parts.push('نوع دراسة محدد');
    if (debouncedSearch) parts.push('بحث نشط');
    return parts.length ? parts.join(' · ') : 'عرض حسب الفلاتر الحالية';
  }, [department, admissionType, studyType, debouncedSearch]);

  const renderEditableCell = (student: EditableStudent, col: ColumnDef) => {
    const value = getFieldValue(student, col.key);
    if (!col.editable) {
      return (
        <span className="block truncate px-2 text-xs font-medium text-slate-700">
          {value || '—'}
        </span>
      );
    }
    if (col.type === 'select') {
      return (
        <select
          value={value}
          onChange={(e) => updateField(student.id, col.key as FieldKey, e.target.value)}
          onFocus={() => setActiveRowId(student.id)}
          className={cellClass}
        >
          <option value="">—</option>
          {col.options?.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      );
    }
    return (
      <input
        type={col.type === 'date' ? 'date' : col.type === 'number' ? 'number' : 'text'}
        value={value}
        onChange={(e) => updateField(student.id, col.key as FieldKey, e.target.value)}
        onFocus={() => setActiveRowId(student.id)}
        onKeyDown={(e) => {
          if (col.type === 'date') e.preventDefault();
          if (e.key === 'Enter') {
            e.preventDefault();
            void saveStudent(student.id);
          }
        }}
        onPaste={col.type === 'date' ? (e) => e.preventDefault() : undefined}
        step={col.type === 'number' ? '0.01' : undefined}
        className={cellClass}
      />
    );
  };

  return (
    <div className="w-full min-w-0 max-w-full space-y-4 overflow-x-hidden">
      <div className="w-full max-w-5xl rounded-xl border border-sky-200/70 bg-gradient-to-l from-sky-50 via-white to-indigo-50 p-3 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-xs font-medium tracking-wide text-sky-700">شؤون الطلبة · إكمال البيانات</p>
            <h1 className="text-lg font-bold text-slate-800">تعديل الطلبة</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="rounded-lg border border-sky-200 bg-white px-2.5 py-1.5 text-center">
              <p className="text-[10px] text-slate-500">المعروض</p>
              <p className="text-sm font-bold text-sky-700">{total.toLocaleString('ar-IQ')}</p>
            </div>
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-center">
              <p className="text-[10px] text-amber-700">غير محفوظ</p>
              <p className="text-sm font-bold text-amber-800">{dirtyCount}</p>
            </div>
            <button
              type="button"
              onClick={() => void saveAllDirty()}
              disabled={dirtyCount === 0 || savingIds.size > 0}
              className="rounded-lg bg-sky-700 px-3 py-2 text-sm font-semibold text-white transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              حفظ التغييرات ({dirtyCount})
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200/80 bg-white/90 p-2.5">
          <div className="min-w-[200px] flex-1 basis-[220px]">
            <label className="mb-1 block text-[11px] font-semibold text-slate-600">بحث</label>
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="الاسم، الرقم الجامعي، الهوية..."
              className="h-9 w-full rounded-lg border border-slate-300 bg-slate-50 px-3 text-sm text-slate-800 outline-none focus:border-sky-500 focus:bg-white focus:ring-1 focus:ring-sky-300"
            />
          </div>
          <div className="w-[180px] shrink-0">
            <label className="mb-1 block text-[11px] font-semibold text-slate-600">القسم</label>
            <select
              value={department}
              onChange={(e) => {
                setDepartment(e.target.value);
                setPage(1);
              }}
              className="h-9 w-full rounded-lg border border-slate-300 bg-slate-50 px-2 text-sm text-slate-800 outline-none focus:border-sky-500 focus:bg-white focus:ring-1 focus:ring-sky-300"
            >
              <option value="">كل الأقسام</option>
              {DEPARTMENTS.map((dept) => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))}
            </select>
          </div>
          <div className="w-[120px] shrink-0">
            <label className="mb-1 block text-[11px] font-semibold text-slate-600">المرحلة</label>
            <select
              value={admissionType}
              onChange={(e) => {
                setAdmissionType(e.target.value);
                setPage(1);
              }}
              className="h-9 w-full rounded-lg border border-slate-300 bg-slate-50 px-2 text-sm text-slate-800 outline-none focus:border-sky-500 focus:bg-white focus:ring-1 focus:ring-sky-300"
            >
              <option value="">الكل</option>
              <option value="first">الأولى</option>
              <option value="second">الثانية</option>
              <option value="third">الثالثة</option>
              <option value="fourth">الرابعة</option>
            </select>
          </div>
          <div className="w-[120px] shrink-0">
            <label className="mb-1 block text-[11px] font-semibold text-slate-600">نوع الدراسة</label>
            <select
              value={studyType}
              onChange={(e) => {
                setStudyType(e.target.value);
                setPage(1);
              }}
              className="h-9 w-full rounded-lg border border-slate-300 bg-slate-50 px-2 text-sm text-slate-800 outline-none focus:border-sky-500 focus:bg-white focus:ring-1 focus:ring-sky-300"
            >
              <option value="">الكل</option>
              <option value="morning">صباحي</option>
              <option value="evening">مسائي</option>
            </select>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">{filterSummary} · 50 صف في الصفحة</p>
      </div>

      <div className="w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        {loading || error || students.length === 0 ? (
          <div className="px-4 py-10 text-center text-sm text-slate-500">
            {loading ? 'جاري تحميل الطلبة...' : error ? <span className="text-red-600">{error}</span> : 'لا توجد نتائج مطابقة'}
          </div>
        ) : (
          <div className="flex w-full min-w-0 max-h-[calc(100vh-280px)] overflow-hidden" dir="rtl">
            <div
              ref={frozenPaneRef}
              onScroll={() => syncVerticalScroll('frozen')}
              className="shrink-0 overflow-y-auto overflow-x-hidden border-l border-slate-200 bg-white"
              style={{ width: INDEX_W + NAME_W, boxShadow: '-8px 0 12px -8px rgba(0,0,0,0.18)' }}
            >
              <table className="w-full table-fixed border-separate border-spacing-0 text-right">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-sky-800 text-white">
                    <th style={{ width: INDEX_W, height: ROW_H }} className="border-b border-sky-600 px-1 py-2 text-xs font-semibold">
                      #
                    </th>
                    <th style={{ width: NAME_W, height: ROW_H }} className="border-b border-sky-600 px-2 py-2 text-xs font-semibold">
                      {NAME_COLUMN.label}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((student, index) => {
                    const isDirty = dirtyIds.has(student.id);
                    const justSaved = savedFlash.has(student.id);
                    const isEven = index % 2 === 0;
                    const isActive = activeRowId === student.id;
                    return (
                      <tr
                        key={`frozen-${student.id}`}
                        style={{ height: ROW_H }}
                        onMouseEnter={() => setActiveRowId(student.id)}
                        onFocusCapture={() => setActiveRowId(student.id)}
                        className={`border-b border-slate-100 transition-colors ${rowToneClasses({ isDirty, justSaved, isEven, isActive })}`}
                      >
                        <td className="px-1 py-1 text-xs text-slate-500">
                          {(page - 1) * limit + index + 1}
                        </td>
                        <td className="overflow-hidden px-1 py-1">
                          {renderEditableCell(student, NAME_COLUMN)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div
              ref={scrollPaneRef}
              onScroll={() => syncVerticalScroll('scroll')}
              className="min-w-0 flex-1 overflow-x-auto overflow-y-auto"
            >
              <table className="min-w-max border-separate border-spacing-0 text-right">
                <thead className="sticky top-0 z-10">
                  <tr className="bg-gradient-to-l from-sky-700 to-indigo-700 text-white">
                    {SCROLL_COLUMNS.map((col) => (
                      <th
                        key={col.key}
                        style={{ minWidth: col.width, width: col.width, height: ROW_H }}
                        className="whitespace-nowrap border-b border-sky-600 px-2 py-2 text-xs font-semibold"
                      >
                        {col.label}
                      </th>
                    ))}
                    <th style={{ minWidth: 72, width: 72, height: ROW_H }} className="border-b border-sky-600 px-2 py-2 text-xs font-semibold">
                      حفظ
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((student, index) => {
                    const isDirty = dirtyIds.has(student.id);
                    const isSaving = savingIds.has(student.id);
                    const justSaved = savedFlash.has(student.id);
                    const isEven = index % 2 === 0;
                    const isActive = activeRowId === student.id;
                    return (
                      <tr
                        key={`scroll-${student.id}`}
                        style={{ height: ROW_H }}
                        onMouseEnter={() => setActiveRowId(student.id)}
                        onFocusCapture={() => setActiveRowId(student.id)}
                        className={`border-b border-slate-100 transition-colors ${rowToneClasses({ isDirty, justSaved, isEven, isActive })}`}
                      >
                        {SCROLL_COLUMNS.map((col) => (
                          <td
                            key={`${student.id}-${col.key}`}
                            style={{ minWidth: col.width, width: col.width }}
                            className="overflow-hidden px-1 py-1"
                          >
                            {renderEditableCell(student, col)}
                          </td>
                        ))}
                        <td className="px-2 py-1" style={{ minWidth: 72, width: 72 }}>
                          <button
                            type="button"
                            onClick={() => void saveStudent(student.id)}
                            disabled={!isDirty || isSaving}
                            className={`rounded-md px-2.5 py-1.5 text-[11px] font-semibold transition ${
                              isDirty
                                ? 'bg-sky-600 text-white hover:bg-sky-700'
                                : justSaved
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : 'bg-slate-100 text-slate-400'
                            } disabled:cursor-not-allowed`}
                          >
                            {isSaving ? '...' : justSaved ? 'تم' : 'حفظ'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-xs text-slate-600">
            الصفحة {page} من {Math.max(totalPages, 1)} · Enter لحفظ الصف · الاسم مجمّد في لوحة ثابتة
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              السابق
            </button>
            <button
              type="button"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              التالي
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
