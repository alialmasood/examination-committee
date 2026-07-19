/**
 * أقفال موارد الرواتب (9.A.1).
 *
 * تعتمد على البنية المحاسبية الموحّدة acquireAccountingResourceLocks التي:
 *  - تطبّع الموارد ثم تزيل التكرار ثم تفرزها فرزاً حتمياً (localeCompare) قبل الإقفال.
 *  - تستخدم pg_advisory_xact_lock داخل المعاملة (تُحرَّر تلقائياً عند COMMIT/ROLLBACK).
 *
 * الترتيب المنطقي الموصى به عند بناء قائمة الموارد (9.A.2.1):
 *   Calendar → Period → Run → Person → Contract → Assignment
 *   → Component → Component Assignment → Mapping
 * غير أنّ الفرز الحتمي داخل acquireAccountingResourceLocks يضمن عدم حدوث Deadlock
 * بصرف النظر عن ترتيب الإدراج، لأن كل المسارات تُقفل بنفس الترتيب النهائي.
 */
import type { AccountingLockResource } from './accounting-locks';
import {
  acquireAccountingResourceLocks,
  payrollAssignmentLock,
  payrollCalendarLock,
  payrollComponentAssignmentLock,
  payrollComponentLock,
  payrollContractLock,
  payrollMappingLock,
  payrollPeriodLock,
  payrollPersonLock,
  payrollRunLock,
} from './accounting-locks';
import type { TxClient } from './with-transaction';

export {
  payrollPersonLock,
  payrollContractLock,
  payrollAssignmentLock,
  payrollComponentLock,
  payrollComponentAssignmentLock,
  payrollMappingLock,
  payrollCalendarLock,
  payrollPeriodLock,
  payrollRunLock,
};

/** الترتيب المنطقي الموثّق لأقفال الرواتب (توثيقي — الفرز الحتمي يضمن السلامة). */
export const PAYROLL_LOCK_ORDER = [
  'PAYROLL_CALENDAR',
  'PAYROLL_PERIOD',
  'PAYROLL_RUN',
  'PAYROLL_PERSON',
  'PAYROLL_CONTRACT',
  'PAYROLL_ASSIGNMENT',
  'PAYROLL_COMPONENT',
  'PAYROLL_COMPONENT_ASSIGNMENT',
  'PAYROLL_MAPPING',
] as const;

/** يحصل على أقفال موارد الرواتب المطلوبة بترتيب حتمي آمن ضد الـ Deadlock. */
export async function acquirePayrollLocks(
  client: TxClient,
  resources: AccountingLockResource[]
): Promise<string[]> {
  return acquireAccountingResourceLocks(client, resources);
}
