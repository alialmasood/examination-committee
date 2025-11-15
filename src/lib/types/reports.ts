export type StudentReportFilters = {
  departmentId?: string | null;
  stageId?: string | null;
  semesterId?: string | null;
  academicYear?: string | null;
  status?: string | null;
  gender?: string | null;
  admissionChannel?: string | null;
  studyType?: string | null;
  paymentStatus?: string | null;
};

export interface SimpleStatEntry {
  key: string;
  label: string;
  count: number;
  percentage: number;
}

export interface DepartmentSummaryEntry {
  id: string;
  name: string;
  count: number;
  percentage: number;
}

export interface DepartmentStageSummaryEntry {
  id: string;
  name: string;
  order: number;
  rawAdmissionType: string | null;
  total: number;
  semesters: SemesterSummaryEntry[];
}

export interface StageSummaryEntry {
  id: string;
  name: string;
  order: number;
  count: number;
  percentage: number;
  rawAdmissionType: string | null;
  semesters: SemesterSummaryEntry[];
}

export interface StageBreakdownEntry {
  id: string;
  name: string;
  rawAdmissionType: string | null;
  count: number;
  percentage: number;
}

export interface SemesterSummaryEntry {
  id: string;
  name: string;
  raw: string | null;
  stageId: string;
  count: number;
  percentage: number;
}

export interface SemesterBreakdownEntry {
  id: string;
  name: string;
  stageId: string;
  stageName: string;
  count: number;
  percentage: number;
  raw: string | null;
}

export interface StudentReportData {
  totals: {
    totalStudents: number;
    male?: number | null;
    female?: number | null;
  };
  newStudentsCount: number;
  filters: {
    departments: DepartmentSummaryEntry[];
    departmentStages: Record<string, DepartmentStageSummaryEntry[]>;
    stages: StageSummaryEntry[];
    semesters: SemesterSummaryEntry[];
  };
  breakdown: {
    departments: DepartmentSummaryEntry[];
    stages: StageBreakdownEntry[];
    semesters: SemesterBreakdownEntry[];
    genders: SimpleStatEntry[];
    statuses: SimpleStatEntry[];
    admissionChannels: SimpleStatEntry[];
    studyTypes: SimpleStatEntry[];
    academicYears: SimpleStatEntry[];
    paymentStatuses: SimpleStatEntry[];
  };
}

