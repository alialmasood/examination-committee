/** أقسام النظام — مصدر موحّد لقائمة الأقسام الأكاديمية */
import type { QueryResultRow } from 'pg';
import { query } from '@/src/lib/db';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export const ACADEMIC_DEPARTMENT_NAMES = [
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
] as const;

export type DepartmentOption = {
  id: string;
  name_ar: string;
  name_en: string | null;
};

/**
 * يضمن وجود أقسام النظام المعتمدة + أي قسم يظهر في سجلات الطلبة (major)
 * دون تكرار بالاسم العربي (مقارنة بعد التطبيع البسيط).
 */
export async function ensureSystemDepartments(client?: TxClient | null): Promise<void> {
  const run = async (c: TxClient | null) => {
    const exec = async <T extends QueryResultRow = QueryResultRow>(
      sql: string,
      params: unknown[] = []
    ) => (c ? txQuery<T>(c, sql, params) : query(sql, params));

    // أقسام النظام الثابتة
    await exec(
      `INSERT INTO student_affairs.departments (name_ar)
       SELECT x.name_ar
       FROM UNNEST($1::text[]) AS x(name_ar)
       WHERE NOT EXISTS (
         SELECT 1 FROM student_affairs.departments d
         WHERE TRIM(d.name_ar) = TRIM(x.name_ar)
       )`,
      [ACADEMIC_DEPARTMENT_NAMES as unknown as string[]]
    );

    // أقسام مستخدمة فعلياً في بيانات الطلبة وغير مسجّلة بعد
    await exec(
      `INSERT INTO student_affairs.departments (name_ar)
       SELECT DISTINCT TRIM(s.major)
       FROM student_affairs.students s
       WHERE s.major IS NOT NULL AND TRIM(s.major) <> ''
         AND NOT EXISTS (
           SELECT 1 FROM student_affairs.departments d
           WHERE TRIM(d.name_ar) = TRIM(s.major)
         )`
    );
  };

  await run(client ?? null);
}

export async function listSystemDepartments(client?: TxClient | null): Promise<DepartmentOption[]> {
  await ensureSystemDepartments(client ?? null);
  const exec = async <T extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: unknown[] = []
  ) => (client ? txQuery<T>(client, sql, params) : query(sql, params));

  const r = await exec<DepartmentOption>(
    `SELECT id, name_ar, name_en
     FROM student_affairs.departments
     ORDER BY name_ar ASC`
  );
  return r.rows;
}
