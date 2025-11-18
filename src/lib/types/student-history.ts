export type StudentHistoryFilters = {
  year?: string;
  department?: string;
  stage?: string;
  status?: string;
  search?: string;
  page?: number;
  limit?: number;
};

export type StudentHistorySummary = {
  studentId: string;
  universityId: string;
  fullName: string;
  academicYear: string;
  stageCode: string | null;
  stage: string;
  department: string;
  status: string;
  statusLabel: string;
  studyType?: string | null;
  gpa?: number | null;
};

export type StudentHistoryTimelineEntry = {
  academicYear: string;
  semester?: string | null;
  stageCode: string | null;
  stage: string;
  status: string;
  statusLabel: string;
  gpa?: number | null;
  subjectsCount?: number | null;
  notes?: string | null;
};

export type SubjectGrade = {
  gradeId?: string;
  subjectId: string;
  subjectName: string;
  department: string;
  instructorName: string;
  academicYear: string;
  semester: string;
  stage?: string;
  sae_40?: number;
  first_practical_25?: number;
  first_theory_35?: number;
  first_total_60?: number;
  first_final_100?: number;
  second_practical_25?: number;
  second_theory_35?: number;
  second_total_60?: number;
  second_final_100?: number;
  finalGrade?: number;
};

export type StudentDetails = {
  registrationDate?: string;
  nationalId?: string;
  birthDate?: string;
  gender?: string;
  phone?: string;
  email?: string;
  photo?: string;
  username?: string | null;
  password?: string | null;
};

export type StudentHistoryMeta = {
  years: string[];
  departments: string[];
  stages: string[];
  statuses: string[];
};

export type StudentHistoryResponse = {
  success: boolean;
  data: {
    students: StudentHistorySummary[];
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  meta: StudentHistoryMeta;
};

export type StudentTimelineResponse = {
  success: boolean;
  data: {
    student: StudentHistorySummary;
    timeline: StudentHistoryTimelineEntry[];
    subjects?: SubjectGrade[];
    studentDetails?: StudentDetails;
  };
};

