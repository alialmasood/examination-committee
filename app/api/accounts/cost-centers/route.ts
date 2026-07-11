import { NextRequest } from 'next/server';
import {
  AccountsHttpError,
  isAuthFailure,
  jsonError,
  jsonSuccess,
  mapPgError,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import { writeFinancialAudit } from '@/src/lib/accounts/audit';
import { computeCostCenterLevel } from '@/src/lib/accounts/cost-centers';
import { normalizeCode } from '@/src/lib/accounts/fiscal';
import {
  acquireCostCentersLock,
  txQuery,
  withTransaction,
} from '@/src/lib/accounts/with-transaction';
import { query } from '@/src/lib/db';

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const search = request.nextUrl.searchParams.get('q')?.trim() || '';
    const result = await query(
      `SELECT cc.*, d.name_ar AS department_name_ar
       FROM accounts.cost_centers cc
       LEFT JOIN student_affairs.departments d ON d.id = cc.department_id
       WHERE ($1 = '' OR cc.code ILIKE '%' || $1 || '%' OR cc.name_ar ILIKE '%' || $1 || '%')
       ORDER BY cc.code ASC`,
      [search]
    );
    const departments = await query(
      `SELECT id, name_ar FROM student_affairs.departments ORDER BY name_ar ASC`
    );
    return jsonSuccess({ data: result.rows, departments: departments.rows });
  } catch (error) {
    return mapPgError(error);
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const body = await request.json();
    const code = normalizeCode(String(body.code || ''));
    const nameAr = String(body.name_ar || '').trim();
    const nameEn = body.name_en ? String(body.name_en).trim() : null;
    const parentId = body.parent_id ? String(body.parent_id) : null;
    const isGroup = Boolean(body.is_group);
    const departmentId = body.department_id ? String(body.department_id) : null;
    const description = body.description ? String(body.description).trim() : null;

    if (!code || !nameAr) {
      return jsonError('رمز واسم مركز الكلفة مطلوبان', 400);
    }

    const created = await withTransaction(async (client) => {
      await acquireCostCentersLock(client);

      if (parentId) {
        const parent = await txQuery(
          client,
          `SELECT id FROM accounts.cost_centers WHERE id = $1`,
          [parentId]
        );
        if (parent.rows.length === 0) {
          throw new AccountsHttpError('مركز الكلفة الأب غير موجود', 404);
        }
      }

      if (departmentId) {
        const dept = await txQuery(
          client,
          `SELECT id FROM student_affairs.departments WHERE id = $1`,
          [departmentId]
        );
        if (dept.rows.length === 0) {
          throw new AccountsHttpError('القسم المحدد غير موجود', 404);
        }
      }

      const level = await computeCostCenterLevel(client, parentId);

      const result = await txQuery(
        client,
        `INSERT INTO accounts.cost_centers
          (code, name_ar, name_en, parent_id, level, is_group, is_active, department_id, description, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, $8, $9, $9)
         RETURNING *`,
        [code, nameAr, nameEn, parentId, level, isGroup, departmentId, description, auth.user.id]
      );

      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'cost_center.create',
        entityType: 'cost_center',
        entityId: result.rows[0].id,
        newValues: result.rows[0],
        description: `إنشاء مركز كلفة ${code}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });

      return result.rows[0];
    });

    return jsonSuccess({ data: created, message: 'تم إنشاء مركز الكلفة' }, 201);
  } catch (error) {
    if (error instanceof AccountsHttpError) return jsonError(error.message, error.status);
    return mapPgError(error);
  }
}
