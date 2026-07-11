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
  assertNoChartCycle,
  assertValidParentForChild,
  computeChartAccountLevel,
  getAccountTypeById,
  loadChartAccount,
  nextSiblingSortOrder,
  recountChartSubtreeLevels,
  resolveGroupPostingFlags,
} from '@/src/lib/accounts/chart-of-accounts';
import { normalizeCode } from '@/src/lib/accounts/fiscal';
import {
  acquireChartOfAccountsLock,
  txQuery,
  withTransaction,
} from '@/src/lib/accounts/with-transaction';

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    const data = await withTransaction(async (client) => loadChartAccount(client, id));
    return jsonSuccess({ data });
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
      await acquireChartOfAccountsLock(client);
      const current = await loadChartAccount(client, id, true);
      const childrenCount = Number(current.children_count || 0);

      const code = body.code != null ? normalizeCode(String(body.code)) : current.code;
      const nameAr = body.name_ar != null ? String(body.name_ar).trim() : current.name_ar;
      const nameEn =
        body.name_en !== undefined
          ? body.name_en
            ? String(body.name_en).trim()
            : null
          : current.name_en;
      const description =
        body.description !== undefined
          ? body.description
            ? String(body.description).trim()
            : null
          : current.description;

      let accountTypeId = current.account_type_id;
      if (body.account_type_id != null) {
        accountTypeId = String(body.account_type_id);
        if (accountTypeId !== current.account_type_id && childrenCount > 0) {
          throw new AccountsHttpError('لا يمكن تغيير نوع الحساب لأنه يحتوي على حسابات فرعية', 409);
        }
      }

      let parentId = current.parent_id;
      if (body.parent_id !== undefined) {
        parentId = body.parent_id ? String(body.parent_id) : null;
      }

      let isGroup = current.is_group;
      if (body.is_group != null) {
        isGroup = Boolean(body.is_group);
        if (current.is_group && !isGroup && childrenCount > 0) {
          throw new AccountsHttpError(
            'لا يمكن تحويل حساب تجميعي إلى تفصيلي وهو يحتوي على حسابات فرعية',
            409
          );
        }
        if (!current.is_group && isGroup) {
          // detail -> group: ok if no future movements (none yet)
        }
      }

      // لا يسمح بجعل حساب تفصيلي أباً عبر الإبقاء على is_group=false ثم ربط أبناء — يُمنع عند الإضافة
      const flags = resolveGroupPostingFlags(isGroup);

      const type = await getAccountTypeById(client, accountTypeId);
      const normalBalanceRaw =
        body.normal_balance != null
          ? String(body.normal_balance).toUpperCase()
          : current.normal_balance;
      if (normalBalanceRaw !== 'DEBIT' && normalBalanceRaw !== 'CREDIT') {
        throw new AccountsHttpError('طبيعة الرصيد يجب أن تكون مدين أو دائن', 400);
      }

      if (!code || !nameAr) throw new AccountsHttpError('كود الحساب والاسم مطلوبان', 400);

      await assertNoChartCycle(client, id, parentId);
      await assertValidParentForChild(client, parentId, accountTypeId);

      const level = await computeChartAccountLevel(client, parentId);
      const requiresCostCenter =
        body.requires_cost_center != null
          ? Boolean(body.requires_cost_center)
          : current.requires_cost_center;
      const isActive =
        body.is_active != null ? Boolean(body.is_active) : current.is_active;

      let sortOrder = current.sort_order;
      if (body.sort_order != null) {
        sortOrder = Number(body.sort_order);
        if (!Number.isInteger(sortOrder) || sortOrder < 1) {
          throw new AccountsHttpError('ترتيب العرض يجب أن يكون رقماً صحيحاً موجباً', 400);
        }
      } else if (parentId !== current.parent_id) {
        sortOrder = await nextSiblingSortOrder(client, parentId);
      }

      const result = await txQuery(
        client,
        `UPDATE accounts.chart_of_accounts
         SET code = $2, name_ar = $3, name_en = $4, account_type_id = $5, parent_id = $6,
             level = $7, is_group = $8, allow_posting = $9, normal_balance = $10,
             requires_cost_center = $11, is_active = $12, description = $13, sort_order = $14,
             updated_by = $15, updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [
          id,
          code,
          nameAr,
          nameEn,
          accountTypeId,
          parentId,
          level,
          flags.is_group,
          flags.allow_posting,
          normalBalanceRaw,
          requiresCostCenter,
          isActive,
          description,
          sortOrder,
          auth.user.id,
        ]
      );

      if (level !== current.level || parentId !== current.parent_id) {
        await recountChartSubtreeLevels(client, id, level);
      }

      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'chart_account.update',
        entityType: 'chart_account',
        entityId: id,
        oldValues: current,
        newValues: result.rows[0],
        description: `تعديل حساب ${code}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });

      void type;
      return result.rows[0];
    });

    return jsonSuccess({ data: updated, message: 'تم تحديث الحساب' });
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

    await withTransaction(async (client) => {
      await acquireChartOfAccountsLock(client);
      const current = await loadChartAccount(client, id, true);
      if (Number(current.children_count || 0) > 0) {
        throw new AccountsHttpError(
          'لا يمكن حذف الحساب لوجود حسابات فرعية مرتبطة به. يمكنك تعطيله بدلاً من ذلك.',
          409
        );
      }

      await txQuery(client, `DELETE FROM accounts.chart_of_accounts WHERE id = $1`, [id]);

      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'chart_account.delete',
        entityType: 'chart_account',
        entityId: id,
        oldValues: current,
        description: `حذف حساب ${current.code}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });
    });

    return jsonSuccess({ message: 'تم حذف الحساب' });
  } catch (error) {
    if (error instanceof AccountsHttpError) return jsonError(error.message, error.status);
    return mapPgError(error);
  }
}
