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
  assertValidParentForChild,
  computeChartAccountLevel,
  getAccountTypeById,
  nextSiblingSortOrder,
  resolveGroupPostingFlags,
} from '@/src/lib/accounts/chart-of-accounts';
import { normalizeCode } from '@/src/lib/accounts/fiscal';
import {
  acquireChartOfAccountsLock,
  txQuery,
  withTransaction,
} from '@/src/lib/accounts/with-transaction';
import { query } from '@/src/lib/db';

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const q = request.nextUrl.searchParams.get('q')?.trim() || '';
    const typeId = request.nextUrl.searchParams.get('account_type_id');
    const active = request.nextUrl.searchParams.get('is_active');
    const isGroup = request.nextUrl.searchParams.get('is_group');
    const level = request.nextUrl.searchParams.get('level');
    const parentId = request.nextUrl.searchParams.get('parent_id');

    const result = await query(
      `SELECT a.*, t.code AS account_type_code, t.name_ar AS account_type_name_ar,
              (SELECT COUNT(*)::int FROM accounts.chart_of_accounts c WHERE c.parent_id = a.id) AS children_count
       FROM accounts.chart_of_accounts a
       JOIN accounts.account_types t ON t.id = a.account_type_id
       WHERE ($1 = '' OR a.code ILIKE '%'||$1||'%' OR a.name_ar ILIKE '%'||$1||'%' OR COALESCE(a.name_en,'') ILIKE '%'||$1||'%')
         AND ($2::uuid IS NULL OR a.account_type_id = $2::uuid)
         AND ($3::boolean IS NULL OR a.is_active = $3::boolean)
         AND ($4::boolean IS NULL OR a.is_group = $4::boolean)
         AND ($5::int IS NULL OR a.level = $5::int)
         AND (
           $6::text IS NULL
           OR ($6 = 'root' AND a.parent_id IS NULL)
           OR ($6 <> 'root' AND a.parent_id = $6::uuid)
         )
       ORDER BY a.sort_order ASC, a.code ASC`,
      [
        q,
        typeId || null,
        active === null || active === '' ? null : active === 'true' || active === '1',
        isGroup === null || isGroup === '' ? null : isGroup === 'true' || isGroup === '1',
        level ? Number(level) : null,
        parentId,
      ]
    );

    return jsonSuccess({
      data: result.rows,
      totals: {
        total: result.rows.length,
        active: result.rows.filter((r) => r.is_active).length,
        inactive: result.rows.filter((r) => !r.is_active).length,
      },
    });
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
    const accountTypeId = String(body.account_type_id || '');
    const parentId = body.parent_id ? String(body.parent_id) : null;
    const isGroup = Boolean(body.is_group);
    const requiresCostCenter = Boolean(body.requires_cost_center);
    const description = body.description ? String(body.description).trim() : null;
    const isActive = body.is_active == null ? true : Boolean(body.is_active);

    if (!code || !nameAr || !accountTypeId) {
      return jsonError('كود الحساب والاسم ونوع الحساب مطلوبة', 400);
    }

    const flags = resolveGroupPostingFlags(isGroup);

    const created = await withTransaction(async (client) => {
      await acquireChartOfAccountsLock(client);
      const type = await getAccountTypeById(client, accountTypeId);
      const normalBalanceRaw = body.normal_balance != null ? String(body.normal_balance).toUpperCase() : type.normal_balance;
      if (normalBalanceRaw !== 'DEBIT' && normalBalanceRaw !== 'CREDIT') {
        throw new AccountsHttpError('طبيعة الرصيد يجب أن تكون مدين أو دائن', 400);
      }

      await assertValidParentForChild(client, parentId, accountTypeId);
      const level = await computeChartAccountLevel(client, parentId);

      const sortOrder =
        body.sort_order != null ? Number(body.sort_order) : await nextSiblingSortOrder(client, parentId);
      if (!Number.isInteger(sortOrder) || sortOrder < 1) {
        throw new AccountsHttpError('ترتيب العرض يجب أن يكون رقماً صحيحاً موجباً', 400);
      }

      const result = await txQuery(
        client,
        `INSERT INTO accounts.chart_of_accounts
          (code, name_ar, name_en, account_type_id, parent_id, level, is_group, allow_posting,
           normal_balance, requires_cost_center, is_active, description, source, sort_order,
           created_by, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'USER',$13,$14,$14)
         RETURNING *`,
        [
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

      await writeFinancialAudit(client, {
        userId: auth.user.id,
        action: 'chart_account.create',
        entityType: 'chart_account',
        entityId: result.rows[0].id,
        newValues: result.rows[0],
        description: `إنشاء حساب ${code} — ${nameAr}`,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      });

      return result.rows[0];
    });

    return jsonSuccess({ data: created, message: 'تم إنشاء الحساب بنجاح' }, 201);
  } catch (error) {
    if (error instanceof AccountsHttpError) return jsonError(error.message, error.status);
    return mapPgError(error);
  }
}
