import { NextRequest } from 'next/server';
import { AccountsHttpError, isAuthFailure, jsonError, jsonSuccess, mapPgError, requireAccountsAccess } from '@/src/lib/accounts/auth';
import { writeFinancialAudit } from '@/src/lib/accounts/audit';
import { PAYROLL_CAPABILITIES, assertPayrollCapability } from '@/src/lib/accounts/payroll-access';
import { createPayrollPerson, listPayrollPeople, serializePayrollPerson, serializePayrollPersonListItem } from '@/src/lib/accounts/payroll-people';
import { query } from '@/src/lib/db';
import { withTransaction } from '@/src/lib/accounts/with-transaction';

async function ensureTeachingStaffColumns() {
  await query(`
    ALTER TABLE accounts.payroll_people
      ADD COLUMN IF NOT EXISTS academic_title VARCHAR(40) NULL
  `).catch(() => undefined);
  await query(`
    ALTER TABLE accounts.payroll_people
      ADD COLUMN IF NOT EXISTS degree VARCHAR(40) NULL
  `).catch(() => undefined);
  await query(`
    ALTER TABLE accounts.payroll_people
      ADD COLUMN IF NOT EXISTS phone VARCHAR(40) NULL
  `).catch(() => undefined);
  await query(`
    ALTER TABLE accounts.payroll_people
      ADD COLUMN IF NOT EXISTS job_title VARCHAR(200) NULL
  `).catch(() => undefined);
  await query(`
    ALTER TABLE accounts.payroll_people
      ADD COLUMN IF NOT EXISTS university_id VARCHAR(64) NULL
  `).catch(() => undefined);
  await query(`
    ALTER TABLE accounts.payroll_people
      ADD COLUMN IF NOT EXISTS affiliation VARCHAR(200) NULL
  `).catch(() => undefined);
  await query(`
    ALTER TABLE accounts.payroll_people
      ADD COLUMN IF NOT EXISTS job_classification VARCHAR(40) NULL
  `).catch(() => undefined);
  await query(`
    ALTER TABLE accounts.payroll_people
      ADD COLUMN IF NOT EXISTS workplace VARCHAR(200) NULL
  `).catch(() => undefined);

  // توسيع قيد الشهادة ليشمل مستويات الكادر الوظيفي
  await query(`
    DO $$
    DECLARE
      cname text;
    BEGIN
      SELECT con.conname INTO cname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
      WHERE nsp.nspname = 'accounts'
        AND rel.relname = 'payroll_people'
        AND con.contype = 'c'
        AND pg_get_constraintdef(con.oid) ILIKE '%degree%'
        AND pg_get_constraintdef(con.oid) NOT ILIKE '%يقرأ ويكتب%';
      IF cname IS NOT NULL THEN
        EXECUTE format('ALTER TABLE accounts.payroll_people DROP CONSTRAINT %I', cname);
        ALTER TABLE accounts.payroll_people
          ADD CONSTRAINT ck_payroll_people_degree
          CHECK (
            degree IS NULL OR degree IN (
              'يقرأ ويكتب','ابتدائية','متوسطة','اعدادية',
              'دبلوم','دبلوم عالي','بكالوريوس','ماجستير','دكتوراه'
            )
          );
      END IF;
    END $$;
  `).catch(() => undefined);
}

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;
  try {
    await ensureTeachingStaffColumns();
    await assertPayrollCapability(null, auth.user.id, PAYROLL_CAPABILITIES.VIEW);
    const sp = request.nextUrl.searchParams;
    const result = await withTransaction((client) => listPayrollPeople(client, {
      q: sp.get('q')?.trim() || '',
      person_type: sp.get('person_type')?.trim() || '',
      status: sp.get('status')?.trim() || '',
      active_only: sp.get('active_only') === 'true',
      page: Math.max(1, Number(sp.get('page') || 1)),
      page_size: Math.min(200, Math.max(1, Number(sp.get('page_size') || 50))),
    }));
    return jsonSuccess({
      data: result.rows.map(serializePayrollPersonListItem),
      pagination: {
        page: result.page,
        page_size: result.page_size,
        total: result.total,
        total_pages: Math.ceil(result.total / result.page_size) || 1,
      },
    });
  } catch (error) {
    return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;
  try {
    await ensureTeachingStaffColumns();
    const body = await request.json();
    const row = await withTransaction(async (client) => {
      await assertPayrollCapability(client, auth.user.id, PAYROLL_CAPABILITIES.MANAGE_PEOPLE);
      const person = await createPayrollPerson(client, { ...body, created_by: auth.user.id });
      await writeFinancialAudit(client, { userId: auth.user.id, action: 'payroll_person.created', entityType: 'payroll_person', entityId: person.id, newValues: serializePayrollPerson(person), description: `إنشاء شخص رواتب ${person.person_code}`, ipAddress: auth.ipAddress, userAgent: auth.userAgent });
      return person;
    });
    return jsonSuccess({ data: serializePayrollPerson(row) }, 201);
  } catch (error) {
    return error instanceof AccountsHttpError ? jsonError(error.message, error.status) : mapPgError(error);
  }
}
