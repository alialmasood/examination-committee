// أنواع TypeScript للمصادقة والنظام

export interface AuthUser {
  id: string;
  username: string;
  email?: string;
  full_name?: string;
  is_active: boolean;
}

export interface SystemAccess {
  code: string;
  name_ar: string;
  base_path: string;
}

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  success: boolean;
  user?: AuthUser;
  systems?: SystemAccess[];
  access_token?: string;
  refresh_token?: string;
  message?: string;
}

export interface JWTPayload {
  user_id: string;
  username: string;
  iat: number;
  exp: number;
}

export interface RefreshTokenPayload {
  user_id: string;
  token_id: string;
  iat: number;
  exp: number;
}

export interface SessionData {
  user_id: string;
  username: string;
  systems: SystemAccess[];
  last_activity: Date;
}

export interface AuthError {
  code: string;
  message: string;
  details?: unknown;
}

// أنواع للأنظمة المختلفة
export type SystemCode = 'STUDENT_AFFAIRS' | 'EXAM_COMMITTEE' | 'ACCOUNTING';

export interface SystemConfig {
  code: SystemCode;
  name_ar: string;
  base_path: string;
  description?: string;
}

// أنواع للاستجابات API
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

// أنواع للطلاب
export interface Student {
  id: string;
  university_id: string;
  full_name: string; // الاسم الرباعي
  full_name_ar?: string; // الاسم الرباعي بالعربية
  nickname?: string; // اللقب
  first_name: string; // للتوافق مع النظام القديم
  last_name: string; // للتوافق مع النظام القديم
  middle_name?: string; // للتوافق مع النظام القديم
  national_id: string;
  birth_date: string;
  birth_place?: string;
  mother_name?: string;
  area?: string;
  gender: 'male' | 'female';
  religion: 'مسلم' | 'مسيحي' | 'الصابئة' | 'اليزيدية' | 'غير ذلك';
  marital_status: 'single' | 'married' | 'divorced' | 'widowed';
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  postal_code?: string;
  emergency_contact_name?: string;
  emergency_contact_relationship?: string;
  emergency_contact_phone?: string;
  
  // بيانات الدراسة الإعدادية
  secondary_school_name?: string;
  secondary_school_type?: 'public' | 'private' | 'international';
  secondary_graduation_year?: string;
  secondary_gpa?: number;
  secondary_total_score?: number;
  exam_attempt?: string;
  exam_number?: string;
  exam_password?: string;
  branch?: string;
  secondary_achievements?: string;
  secondary_activities?: string;
  
  // بيانات القبول الجامعي
  admission_type?: 'regular' | 'conditional' | 'transfer' | 'international' | 'first' | 'second' | 'third' | 'fourth';
  admission_channel?: string;
  admission_year?: string;
  department?: string;
  major?: string;
  study_type?: 'morning' | 'evening';
  level?: 'bachelor' | 'master' | 'phd' | 'diploma';
  semester?: string;
  academic_year?: string;
  admission_score?: number;
  english_level?: string;
  math_level?: string;
  science_level?: string;
  
  // المستمسكات والوثائق
  national_id_copy?: boolean;
  birth_certificate?: boolean;
  secondary_certificate?: boolean;
  photo?: boolean;
  medical_certificate?: boolean;
  medical_examination?: string;
  other_documents?: string;
  
  // حالة الطالب
  status: 'active' | 'suspended' | 'graduated' | 'withdrawn';
  payment_status?: 'pending' | 'paid' | 'registration_pending';
  academic_status?: string;
  registration_date: string;
  
  // تواريخ النظام
  created_at: string;
  updated_at: string;
  created_by?: string;
  updated_by?: string;
}

export interface StudentSubject {
  id: string;
  student_id: string;
  subject_name: string;
  subject_code?: string;
  score?: number;
  grade?: string;
  semester?: string;
  academic_year?: string;
  created_at: string;
}

export interface StudentAbsence {
  id: string;
  student_id: string;
  absence_date: string;
  reason?: string;
  is_excused: boolean;
  created_at: string;
  created_by?: string;
}

export interface StudentWarning {
  id: string;
  student_id: string;
  warning_type: string;
  warning_reason: string;
  warning_date: string;
  is_resolved: boolean;
  created_at: string;
  created_by?: string;
}

export interface CreateStudentRequest {
  full_name: string; // الاسم الرباعي
  nickname?: string; // اللقب
  first_name: string; // للتوافق مع النظام القديم
  last_name: string; // للتوافق مع النظام القديم
  middle_name?: string; // للتوافق مع النظام القديم
  national_id: string;
  birth_date: string;
  birth_place?: string;
  gender: 'male' | 'female';
  religion?: 'مسلم' | 'مسيحي' | 'الصابئة' | 'اليزيدية' | 'غير ذلك';
  marital_status?: 'single' | 'married' | 'divorced' | 'widowed';
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  postal_code?: string;
  emergency_contact_name?: string;
  emergency_contact_relationship?: string;
  emergency_contact_phone?: string;
  
  // بيانات الدراسة الإعدادية
  secondary_school_name?: string;
  secondary_school_type?: 'public' | 'private' | 'international';
  secondary_graduation_year?: string;
  secondary_gpa?: number;
  secondary_total_score?: number;
  exam_attempt?: string;
  exam_number?: string;
  exam_password?: string;
  branch?: string;
  secondary_achievements?: string;
  secondary_activities?: string;
  
  // بيانات القبول الجامعي
  admission_type?: 'regular' | 'conditional' | 'transfer' | 'international' | 'first' | 'second' | 'third' | 'fourth';
  admission_channel?: string;
  admission_year?: string;
  department?: string;
  major?: string;
  study_type?: 'morning' | 'evening';
  level?: 'bachelor' | 'master' | 'phd' | 'diploma';
  semester?: string;
  academic_year?: string;
  admission_score?: number;
  english_level?: string;
  math_level?: string;
  science_level?: string;
  
  // المستمسكات والوثائق
  national_id_copy?: boolean;
  birth_certificate?: boolean;
  secondary_certificate?: boolean;
  photo?: boolean;
  medical_certificate?: boolean;
  medical_examination?: string;
  other_documents?: string;
  
  // إضافة payment_amount و payment_date
  payment_amount?: number;
  payment_date?: string;
}

// أنواع المواد التدريسية
export interface TeachingSubject {
  id: string;
  department: string;
  material_name: string;
  instructor_name: string;
  semester: 'first' | 'second';
  academic_year: string;
  stage?: 'first' | 'second' | 'third' | 'fourth';
  study_type?: 'morning' | 'evening';
  has_practical?: boolean;
  created_at: string;
  updated_at: string;
  created_by?: string;
  updated_by?: string;
}

export interface CreateTeachingSubjectRequest {
  material_name: string;
  instructor_name: string;
  semester: 'first' | 'second';
  academic_year: string;
  stage?: 'first' | 'second' | 'third' | 'fourth';
  study_type?: 'morning' | 'evening';
  has_practical?: boolean;
}

// أنواع درجات السب ماستر
export interface SubMasterGrade {
  id: string;
  subject_id: string;
  student_id: string;
  academic_year: string;
  semester: 'first' | 'second';
  
  // السعي 40 درجة
  sae_40?: number;
  
  // الدور الأول
  first_practical_25?: number;
  first_theory_35?: number;
  first_total_60?: number;
  first_final_100?: number;
  
  // الدور الثاني
  second_practical_25?: number;
  second_theory_35?: number;
  second_total_60?: number;
  second_final_100?: number;
  
  // معلومات إضافية
  created_at: string;
  updated_at: string;
  created_by?: string;
  updated_by?: string;
}

export interface CreateSubMasterGradeRequest {
  subject_id: string;
  student_id: string;
  academic_year: string;
  semester: 'first' | 'second';
  sae_40?: number;
  first_practical_25?: number;
  first_theory_35?: number;
  first_total_60?: number;
  first_final_100?: number;
  second_practical_25?: number;
  second_theory_35?: number;
  second_total_60?: number;
  second_final_100?: number;
}

export type CommunicationCampaignStatus =
  | 'draft'
  | 'scheduled'
  | 'processing'
  | 'sent'
  | 'failed'
  | 'cancelled';

export type CommunicationChannelType =
  | 'systemNotification'
  | 'systemAlert'
  | 'email'
  | 'whatsapp'
  | 'sms';

export type CommunicationAudienceType =
  | 'all'
  | 'department'
  | 'stage'
  | 'semester'
  | 'newStudents'
  | 'custom';

export interface CommunicationCampaign {
  id: string;
  title: string;
  message: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  audience_type: CommunicationAudienceType;
  filters: Record<string, unknown>;
  custom_recipients: string[];
  status: CommunicationCampaignStatus;
  scheduled_at?: string | null;
  sent_at?: string | null;
  total_recipients?: number | null;
  created_by?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CommunicationCampaignChannel {
  id: string;
  campaign_id: string;
  channel_type: CommunicationChannelType;
  sender_profile?: string | null;
  config: Record<string, unknown>;
  status: 'pending' | 'scheduled' | 'processing' | 'sent' | 'failed' | 'cancelled';
  last_error?: string | null;
  last_attempt_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface CommunicationChannelProfile {
  id: string;
  channel_type: CommunicationChannelType;
  profile_name: string;
  sender_identity: string;
  config: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CommunicationChannelDelivery {
  id: string;
  campaign_id: string;
  channel_id: string;
  recipient?: string | null;
  payload: Record<string, unknown>;
  status: 'success' | 'failed';
  error_message?: string | null;
  provider_response?: Record<string, unknown> | null;
  created_at: string;
}