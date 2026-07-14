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
  getStudentCollection,
  replaceAllocations,
  serializeStudentCollection,
  serializeStudentCollectionAllocation,
  updateStudentCollection,
} from '@/src/lib/accounts/student-collections';
import {
  STUDENT_RECEIVABLES_CAPABILITIES,
  assertStudentReceivablesCapability,
  hasStudentReceivablesCapability,
} from '@/src/lib/accounts/student-receivables-access';
import { withTransaction } from '@/src/lib/accounts/with-transaction';
import { query } from '@/src/lib/db';

type Ctx = { params: Promise<{ id: string }> };

async function assertBillingReadAccess(
  client: Parameters<typeof hasStudentReceivablesCapability>[0],
  userId: string
): Promise<void> {
  const canView =
    (await hasStudentReceivablesCapability(
      client,
      userId,
      STUDENT_RECEIVABLES_CAPABILITIES.VIEW
    )) ||
    (await hasStudentReceivablesCapability(
      client,
      userId,
      STUDENT_RECEIVABLES_CAPABILITIES.BILLING_VIEW
    ));
  if (!canView) {
    throw new AccountsHttpError(
      `ليس لديك صلاحية العملية المطلوبة (${STUDENT_RECEIVABLES_CAPABILITIES.BILLING_VIEW})`,
      403
    );
  }
}

export async function GET(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    await assertBillingReadAccess(null, auth.user.id);
    const { id } = await context.params;

    const detail = await query(
      `SELECT c.*,
              sa.account_number,
              COALESCE(s.full_name_ar, s.full_name) AS student_full_name_ar,
              s.university_id AS student_university_id,
              cv.voucher_number AS cash_voucher_number,
              bv.voucher_number AS bank_voucher_number
       FROM accounts.student_collections c
       JOIN accounts.student_accounts sa ON sa.id = c.student_account_id
       JOIN student_affairs.students s ON s.id = c.student_id
       LEFT JOIN accounts.cash_vouchers cv ON cv.id = c.cash_voucher_id
       LEFT JOIN accounts.bank_vouchers bv ON bv.id = c.bank_voucher_id
       WHERE c.id = $1::uuid`,
      [id]
    );
    if (!detail.rows[0]) {
      return jsonError('التحصيل غير موجود', 404);
    }

    const allocationRows = await query(
      `SELECT sca.*,
              sc.charge_number,
              si.installment_number,
              si.due_date::text AS installment_due_date
       FROM accounts.student_collection_allocations sca
       JOIN accounts.student_charges sc ON sc.id = sca.student_charge_id
       LEFT JOIN accounts.student_installments si ON si.id = sca.student_installment_id
       WHERE sca.collection_id = $1::uuid
       ORDER BY sca.created_at ASC`,
      [id]
    );

    const row = detail.rows[0];
    return jsonSuccess({
      data: {
        ...serializeStudentCollection(
          row as Parameters<typeof serializeStudentCollection>[0]
        ),
        account_number: row.account_number ?? null,
        student_full_name_ar: row.student_full_name_ar ?? null,
        student_university_id: row.student_university_id ?? null,
        cash_voucher_number: row.cash_voucher_number ?? null,
        bank_voucher_number: row.bank_voucher_number ?? null,
        allocations: allocationRows.rows.map((a) => ({
          ...serializeStudentCollectionAllocation(
            a as Parameters<typeof serializeStudentCollectionAllocation>[0]
          ),
          charge_number: a.charge_number ?? null,
          installment_number: a.installment_number ?? null,
          installment_due_date: a.installment_due_date ?? null,
        })),
      },
    });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      const status = error.status === 403 ? 404 : error.status;
      return jsonError(
        status === 404 ? 'التحصيل غير موجود' : error.message,
        status
      );
    }
    return mapPgError(error);
  }
}

export async function PATCH(request: NextRequest, context: Ctx) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { id } = await context.params;
    const body = await request.json();

    const updated = await withTransaction(async (client) => {
      await assertStudentReceivablesCapability(
        client,
        auth.user.id,
        STUDENT_RECEIVABLES_CAPABILITIES.COLLECTIONS_PREPARE
      );
      const before = await getStudentCollection(client, id);

      let collection = before.collection;
      let allocations = before.allocations;
      let version = body.version;
      let updatedAt = body.updated_at;

      if (Array.isArray(body.allocations)) {
        allocations = await replaceAllocations(client, {
          collectionId: id,
          userId: auth.user.id,
          version,
          updated_at: updatedAt,
          allocations: body.allocations,
        });
        collection = await getStudentCollection(client, id).then((r) => r.collection);
        version = collection.version;
        updatedAt = collection.updated_at;
        await writeFinancialAudit(client, {
          userId: auth.user.id,
          action: 'student_collection.allocations_replaced',
          entityType: 'student_collection',
          entityId: collection.id,
          oldValues: {
            ...serializeStudentCollection(before.collection),
            allocations: before.allocations.map(serializeStudentCollectionAllocation),
          },
          newValues: {
            ...serializeStudentCollection(collection),
            allocations: allocations.map(serializeStudentCollectionAllocation),
          },
          description: `تحديث تخصيصات تحصيل ${collection.collection_number}`,
          ipAddress: auth.ipAddress,
          userAgent: auth.userAgent,
        });
      }

      const hasMetadataUpdate =
        body.collection_date !== undefined ||
        body.amount !== undefined ||
        body.payer_name !== undefined ||
        body.external_reference !== undefined ||
        body.description !== undefined;

      if (hasMetadataUpdate) {
        const beforeMeta = collection;
        collection = await updateStudentCollection(client, {
          id,
          userId: auth.user.id,
          version,
          updated_at: updatedAt,
          collection_date: body.collection_date,
          amount: body.amount,
          payer_name: body.payer_name,
          external_reference: body.external_reference,
          description: body.description,
        });
        await writeFinancialAudit(client, {
          userId: auth.user.id,
          action: 'student_collection.updated',
          entityType: 'student_collection',
          entityId: collection.id,
          oldValues: serializeStudentCollection(beforeMeta),
          newValues: serializeStudentCollection(collection),
          description: `تعديل تحصيل ${collection.collection_number}`,
          ipAddress: auth.ipAddress,
          userAgent: auth.userAgent,
        });
      } else if (!Array.isArray(body.allocations)) {
        collection = await updateStudentCollection(client, {
          id,
          userId: auth.user.id,
          version,
          updated_at: updatedAt,
          collection_date: body.collection_date,
          amount: body.amount,
          payer_name: body.payer_name,
          external_reference: body.external_reference,
          description: body.description,
        });
        await writeFinancialAudit(client, {
          userId: auth.user.id,
          action: 'student_collection.updated',
          entityType: 'student_collection',
          entityId: collection.id,
          oldValues: serializeStudentCollection(before.collection),
          newValues: serializeStudentCollection(collection),
          description: `تعديل تحصيل ${collection.collection_number}`,
          ipAddress: auth.ipAddress,
          userAgent: auth.userAgent,
        });
      }

      return { collection, allocations };
    });

    return jsonSuccess({
      data: {
        ...serializeStudentCollection(updated.collection),
        allocations: updated.allocations.map(serializeStudentCollectionAllocation),
      },
    });
  } catch (error) {
    if (error instanceof AccountsHttpError) {
      return jsonError(error.message, error.status);
    }
    return mapPgError(error);
  }
}
