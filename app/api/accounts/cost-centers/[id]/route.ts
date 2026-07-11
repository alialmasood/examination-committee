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
import {
  assertNoCostCenterCycle,
  computeCostCenterLevel,
  recountSubtreeLevels,
} from '@/src/lib/accounts/cost-centers';
import { normalizeCode } from '@/src/lib/accounts/fiscal';
import {
  acquireCostCentersLock,
  txQuery,
  withTransaction,
} from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    const result = await withTransaction(async (client) => {
      const res = await txQuery(
        client,
        `SELECT cc.*, d.name_ar AS department_name_ar
         FROM accounts.cost_centers cc
         LEFT JOIN student_affairs.departments d ON d.id = cc.department_id
         WHERE cc.id = $1`,
        [id]
      );
      if (res.rows.length === 0) throw new AccountsHttpError('مركز الكلفة غير موجود', 404);
      return res.rows[0];
    });
    return jsonSuccess({ data: result });
  } catch (error) {
    if (error instanceof AccountsHttpError) return jsonError(error.message, error.status);
    return mapPgError(error);
  }
}

export async function PUT(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    const body = await request.json();

    const updated = await withTransaction(async (client) => {
      await acquireCostCentersLock(client);
      const existing = await txQuery(client, `SELECT * FROM accounts.cost_centers WHERE id = $1`, [id]);
      if (existing.rows.length === 0) throw new AccountsHttpError('مركز الكلفة غير موجود', 404);
      const current = existing.rows[0];

      const code = body.code != null ? normalizeCode(String(body.code)) : current.code;
      const nameAr = body.name_ar != null ? String(body.name_ar).trim() : current.name_ar;
      const nameEn = body.name_en != null ? (body.name_en ? String(body.name_en).trim() : null) : current.name_en;
      const parentId =
        body.parent_id === undefined
          ? current.parent_id
          : body.parent_id
            ? String(body.parent_id)
            : null;
      const isGroup = body.is_group != null ? Boolean(body.is_group) : current.is_group;
      const departmentId =
        body.department_id === undefined
          ? current.department_id
          : body.department_id
            ? String(body.department_id)
            : null;
      const description =
        body.description != null
          ? body.description
            ? String(body.description).trim()
            : null
          : current.description;

      if (!code || !nameAr) {
        throw new AccountsHttpError('رمز واسم مركز الكلفة مطلوبان', 400);
      }

      await assertNoCostCenterCycle(client, id, parentId);

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
        `UPDATE accounts.cost_centers
         SET code = $2, name_ar = $3, name_en = $4, parent_id = $5, level = $6,
             is_group = $7, department_id = $8, description = $9,
             updated_by = $10, updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [id, code, nameAr, nameEn, parentId, level, isGroup, departmentId, description, auth.user.id]
      );

      if (level !== current.level || parentId !== current.parent_id) {
        await recountSubtreeLevels(client, id, level);
      }

      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'cost_center.update',
        entityType: 'cost_center',
        entityId: id,
        oldValues: current,
        newValues: result.rows[0],
        description: `تعديل مركز كلفة ${code}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });

      return result.rows[0];
    });

    return jsonSuccess({ data: updated, message: 'تم تحديث مركز الكلفة' });
  } catch (error) {
    if (error instanceof AccountsHttpError) return jsonError(error.message, error.status);
    return mapPgError(error);
  }
}

export async function DELETE(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;

    const result = await withTransaction(async (client) => {
      await acquireCostCentersLock(client);
      const existing = await txQuery(client, `SELECT * FROM accounts.cost_centers WHERE id = $1`, [id]);
      if (existing.rows.length === 0) throw new AccountsHttpError('مركز الكلفة غير موجود', 404);
      const current = existing.rows[0];

      const children = await txQuery(
        client,
        `SELECT COUNT(*)::int AS c FROM accounts.cost_centers WHERE parent_id = $1`,
        [id]
      );
      if (children.rows[0].c > 0) {
        throw new AccountsHttpError(
          'لا يمكن حذف مركز الكلفة لوجود مراكز فرعية مرتبطة به. يمكنك تعطيله بدلاً من ذلك.',
          409
        );
      }

      await txQuery(client, `DELETE FROM accounts.cost_centers WHERE id = $1`, [id]);

      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'cost_center.delete',
        entityType: 'cost_center',
        entityId: id,
        oldValues: current,
        description: `حذف مركز كلفة ${current.code}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });

      return { deleted: true };
    });

    return jsonSuccess({ ...result, message: 'تم حذف مركز الكلفة' });
  } catch (error) {
    if (error instanceof AccountsHttpError) return jsonError(error.message, error.status);
    return mapPgError(error);
  }
}
