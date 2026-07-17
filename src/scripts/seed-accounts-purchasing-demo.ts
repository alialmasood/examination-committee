/** بيانات عرض المشتريات 7.A — idempotent عبر أكواد DEMO في justification/description/notes/external_reference. */
import { query } from '../lib/db';
import {
  approvePurchaseOrder,
  createPurchaseOrder,
  createPurchaseOrderFromRequisition,
  listPurchaseOrderLines,
  submitPurchaseOrder,
} from '../lib/accounts/purchase-orders';
import {
  approvePurchaseRequisition,
  createPurchaseRequisition,
  listPurchaseRequisitionLines,
  rejectPurchaseRequisition,
  submitPurchaseRequisition,
} from '../lib/accounts/purchase-requisitions';
import {
  createPurchaseReceipt,
  postPurchaseReceipt,
  voidPurchaseReceipt,
} from '../lib/accounts/purchase-receipts';
import { createSupplierInvoiceFromPurchaseOrder } from '../lib/accounts/purchase-invoice-matching';
import { postSupplierInvoice } from '../lib/accounts/supplier-invoices';
import {
  acquireJournalEntriesLock,
  txQuery,
  withTransaction,
  type TxClient,
} from '../lib/accounts/with-transaction';

const MARK = {
  prqDraft: 'DEMO-PRQ-DRAFT',
  prqSubmitted: 'DEMO-PRQ-SUBMITTED',
  prqApproved: 'DEMO-PRQ-APPROVED',
  prqRejected: 'DEMO-PRQ-REJECTED',
  porApproved: 'DEMO-POR-APPROVED',
  porPartial: 'DEMO-POR-PARTIAL',
  porReceived: 'DEMO-POR-RECEIVED',
  prcPosted: 'DEMO-PRC-POSTED',
  prcVoid: 'DEMO-PRC-VOID',
  invPartial: 'DEMO-SIN-PO-PARTIAL',
  invFull: 'DEMO-SIN-PO-FULL',
} as const;

type SeedP = {
  userId: string;
  entryDate: string;
  ensureAccount: (x: {
    code: string;
    nameAr: string;
    typeCode: string;
    userId: string;
  }) => Promise<{ id: string }>;
};

async function existsMarker(
  marker: string,
  table: 'purchase_requisitions' | 'purchase_orders' | 'purchase_receipts'
): Promise<string | null> {
  const col =
    table === 'purchase_requisitions'
      ? 'justification'
      : table === 'purchase_orders'
        ? 'description'
        : 'notes';
  const r = await query(
    `SELECT id FROM accounts.${table} WHERE ${col} LIKE $1 LIMIT 1`,
    [`%${marker}%`]
  );
  return (r.rows[0]?.id as string | undefined) ?? null;
}

async function existsInvoiceRef(ref: string): Promise<boolean> {
  const r = await query(
    `SELECT id FROM accounts.supplier_invoices WHERE external_reference = $1 LIMIT 1`,
    [ref]
  );
  return Boolean(r.rows[0]);
}

function line(p: SeedP, expenseGlId: string, qty = '10', price = '100') {
  return {
    purchase_kind: 'SERVICE' as const,
    description: 'خدمة عرض DEMO',
    unit_of_measure: 'UNIT',
    requested_quantity: qty,
    estimated_unit_price: price,
    expense_gl_account_id: expenseGlId,
  };
}

async function seedSection<T>(name: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const detail = e instanceof Error && e.stack ? `\n${e.stack}` : '';
    throw new Error(`7.A [${name}]: ${msg}${detail}`);
  }
}

async function firstPoLineId(c: TxClient, purchaseOrderId: string): Promise<string> {
  const lines = await listPurchaseOrderLines(c, purchaseOrderId);
  const id = lines[0]?.id;
  if (!id) throw new Error(`لا سطر لأمر الشراء ${purchaseOrderId}`);
  return id;
}

async function firstPoLineForInvoice(
  c: TxClient,
  purchaseOrderId: string
): Promise<{ id: string; unit_price: string; accepted_quantity?: string }> {
  const r = await txQuery<{
    id: string;
    unit_price: string;
    accepted_quantity: string;
  }>(
    c,
    `SELECT id, unit_price::text AS unit_price, accepted_quantity::text AS accepted_quantity
     FROM accounts.purchase_order_lines WHERE purchase_order_id = $1::uuid ORDER BY line_number LIMIT 1`,
    [purchaseOrderId]
  );
  const row = r.rows[0];
  if (!row) throw new Error(`لا سطر لأمر الشراء ${purchaseOrderId}`);
  return row;
}

export async function seedPurchasingDemo(p: SeedP): Promise<void> {
  const [supplier, cc] = await Promise.all([
    query(
      `SELECT sa.id AS supplier_account_id, s.id AS supplier_id
       FROM accounts.supplier_accounts sa
       JOIN accounts.suppliers s ON s.id = sa.supplier_id
       WHERE s.code = 'DEMO-SUP-01' AND sa.status = 'ACTIVE' LIMIT 1`
    ),
    query(`SELECT id FROM accounts.cost_centers WHERE code = 'DEMO-CC-01' LIMIT 1`),
  ]);
  if (!supplier.rows[0]) {
    console.log('⚠ تخطّي 7.A DEMO: DEMO-SUP-01 غير متاح — شغّل seed:accounts-demo أولاً');
    return;
  }

  const accountId = supplier.rows[0].supplier_account_id as string;
  const expenseGl = await p.ensureAccount({
    code: 'DEMO-PUR-EXP',
    nameAr: 'مصروف مشتريات DEMO',
    typeCode: 'EXPENSE',
    userId: p.userId,
  });

  // ——— طلبات شراء ———
  if (!(await existsMarker(MARK.prqDraft, 'purchase_requisitions'))) {
    await seedSection('PRQ draft', () =>
      withTransaction((c) =>
        createPurchaseRequisition(c, {
          requisition_date: p.entryDate,
          requested_by: p.userId,
          justification: `${MARK.prqDraft} — مسودة طلب شراء عرض`,
          lines: [line(p, expenseGl.id, '5', '200')],
          created_by: p.userId,
        })
      )
    );
  }

  if (!(await existsMarker(MARK.prqSubmitted, 'purchase_requisitions'))) {
    await seedSection('PRQ submitted', () =>
      withTransaction(async (c) => {
        const req = await createPurchaseRequisition(c, {
          requisition_date: p.entryDate,
          requested_by: p.userId,
          justification: `${MARK.prqSubmitted} — طلب مقدّم`,
          lines: [line(p, expenseGl.id, '8', '150')],
          created_by: p.userId,
        });
        await submitPurchaseRequisition(c, {
          id: req.id,
          userId: p.userId,
          version: req.version,
          updated_at: req.updated_at,
        });
      })
    );
  }

  let approvedReqId = await existsMarker(MARK.prqApproved, 'purchase_requisitions');
  if (!approvedReqId) {
    approvedReqId = await seedSection('PRQ approved', () =>
      withTransaction(async (c) => {
        const req = await createPurchaseRequisition(c, {
          requisition_date: p.entryDate,
          requested_by: p.userId,
          justification: `${MARK.prqApproved} — طلب معتمد للأوامر`,
          lines: [line(p, expenseGl.id, '20', '100')],
          created_by: p.userId,
        });
        const sub = await submitPurchaseRequisition(c, {
          id: req.id,
          userId: p.userId,
          version: req.version,
          updated_at: req.updated_at,
        });
        const app = await approvePurchaseRequisition(c, {
          id: sub.id,
          userId: p.userId,
          version: sub.version,
          updated_at: sub.updated_at,
        });
        return app.id;
      })
    );
  }

  if (!(await existsMarker(MARK.prqRejected, 'purchase_requisitions'))) {
    await seedSection('PRQ rejected', () =>
      withTransaction(async (c) => {
        const req = await createPurchaseRequisition(c, {
          requisition_date: p.entryDate,
          requested_by: p.userId,
          justification: `${MARK.prqRejected} — طلب مرفوض`,
          lines: [line(p, expenseGl.id, '3', '50')],
          created_by: p.userId,
        });
        const sub = await submitPurchaseRequisition(c, {
          id: req.id,
          userId: p.userId,
          version: req.version,
          updated_at: req.updated_at,
        });
        await rejectPurchaseRequisition(c, {
          id: sub.id,
          userId: p.userId,
          version: sub.version,
          updated_at: sub.updated_at,
          reason: 'رفض عرض DEMO',
        });
      })
    );
  }

  // ——— أمر معتمد (من طلب) ———
  let porApprovedId = await existsMarker(MARK.porApproved, 'purchase_orders');
  if (!porApprovedId && approvedReqId) {
    porApprovedId = await seedSection('PO approved from PRQ', () =>
      withTransaction(async (c) => {
        const reqLines = await listPurchaseRequisitionLines(c, approvedReqId!);
        const rlId = reqLines[0]?.id;
        if (!rlId) throw new Error('لا سطر للطلب المعتمد DEMO');
        const po = await createPurchaseOrderFromRequisition(c, {
          requisitionId: approvedReqId!,
          supplier_account_id: accountId,
          order_date: p.entryDate,
          description: `${MARK.porApproved} — أمر معتمد من طلب DEMO`,
          lines: [{ requisition_line_id: rlId, ordered_quantity: '10', unit_price: '100' }],
          userId: p.userId,
        });
        const sub = await submitPurchaseOrder(c, {
          id: po.id,
          userId: p.userId,
          version: po.version,
          updated_at: po.updated_at,
        });
        const app = await approvePurchaseOrder(c, {
          id: sub.id,
          userId: p.userId,
          version: sub.version,
          updated_at: sub.updated_at,
        });
        return app.id;
      })
    );
  }

  // ——— أمر استلام جزئي ———
  let porPartialId = await existsMarker(MARK.porPartial, 'purchase_orders');
  if (!porPartialId) {
    porPartialId = await seedSection('PO partial receipt', () =>
      withTransaction(async (c) => {
        const po = await createPurchaseOrder(c, {
          supplier_account_id: accountId,
          order_date: p.entryDate,
          description: `${MARK.porPartial} — أمر استلام جزئي`,
          lines: [
            {
              purchase_kind: 'SERVICE',
              description: 'خدمة جزئية DEMO',
              ordered_quantity: '15',
              unit_price: '80',
              expense_gl_account_id: expenseGl.id,
              cost_center_id: cc.rows[0]?.id,
            },
          ],
          created_by: p.userId,
        });
        const sub = await submitPurchaseOrder(c, {
          id: po.id,
          userId: p.userId,
          version: po.version,
          updated_at: po.updated_at,
        });
        const app = await approvePurchaseOrder(c, {
          id: sub.id,
          userId: p.userId,
          version: sub.version,
          updated_at: sub.updated_at,
        });
        const poLineId = await firstPoLineId(c, app.id);
        const rc = await createPurchaseReceipt(c, {
          purchase_order_id: app.id,
          receipt_date: p.entryDate,
          received_by: p.userId,
          notes: 'استلام جزئي DEMO',
          lines: [
            {
              purchase_order_line_id: poLineId,
              received_quantity: '6',
              accepted_quantity: '5',
              rejected_quantity: '1',
              rejection_reason: 'عيب DEMO',
            },
          ],
          created_by: p.userId,
        });
        await postPurchaseReceipt(c, {
          id: rc.id,
          userId: p.userId,
          version: rc.version,
          updated_at: rc.updated_at,
        });
        return app.id;
      })
    );
  }

  // ——— أمر مستلم بالكامل + محضر مرحّل ———
  let porReceivedId = await existsMarker(MARK.porReceived, 'purchase_orders');
  if (!porReceivedId) {
    porReceivedId = await seedSection('PO full receipt', () =>
      withTransaction(async (c) => {
        const po = await createPurchaseOrder(c, {
          supplier_account_id: accountId,
          order_date: p.entryDate,
          description: `${MARK.porReceived} — أمر مستلم كامل`,
          lines: [
            {
              purchase_kind: 'SERVICE',
              description: 'خدمة كاملة DEMO',
              ordered_quantity: '12',
              unit_price: '90',
              expense_gl_account_id: expenseGl.id,
            },
          ],
          created_by: p.userId,
        });
        const sub = await submitPurchaseOrder(c, {
          id: po.id,
          userId: p.userId,
          version: po.version,
          updated_at: po.updated_at,
        });
        const app = await approvePurchaseOrder(c, {
          id: sub.id,
          userId: p.userId,
          version: sub.version,
          updated_at: sub.updated_at,
        });
        const poLineId = await firstPoLineId(c, app.id);
        const rc = await createPurchaseReceipt(c, {
          purchase_order_id: app.id,
          receipt_date: p.entryDate,
          received_by: p.userId,
          notes: `${MARK.prcPosted} — محضر استلام مرحّل`,
          lines: [
            {
              purchase_order_line_id: poLineId,
              received_quantity: '12',
              accepted_quantity: '12',
            },
          ],
          created_by: p.userId,
        });
        await postPurchaseReceipt(c, {
          id: rc.id,
          userId: p.userId,
          version: rc.version,
          updated_at: rc.updated_at,
        });
        return app.id;
      })
    );
  }

  // ——— محضر مُبطَل ———
  if (!(await existsMarker(MARK.prcVoid, 'purchase_receipts'))) {
    await seedSection('PRC void', () =>
      withTransaction(async (c) => {
        const po = await createPurchaseOrder(c, {
          supplier_account_id: accountId,
          order_date: p.entryDate,
          description: 'DEMO-POR-VOID-RC — أمر لمحضر مُبطَل',
          lines: [
            {
              purchase_kind: 'SERVICE',
              description: 'خدمة void DEMO',
              ordered_quantity: '4',
              unit_price: '50',
              expense_gl_account_id: expenseGl.id,
            },
          ],
          created_by: p.userId,
        });
        const sub = await submitPurchaseOrder(c, {
          id: po.id,
          userId: p.userId,
          version: po.version,
          updated_at: po.updated_at,
        });
        const app = await approvePurchaseOrder(c, {
          id: sub.id,
          userId: p.userId,
          version: sub.version,
          updated_at: sub.updated_at,
        });
        const poLineId = await firstPoLineId(c, app.id);
        const rc = await createPurchaseReceipt(c, {
          purchase_order_id: app.id,
          receipt_date: p.entryDate,
          received_by: p.userId,
          notes: `${MARK.prcVoid} — محضر مُبطَل`,
          lines: [
            {
              purchase_order_line_id: poLineId,
              received_quantity: '4',
              accepted_quantity: '4',
            },
          ],
          created_by: p.userId,
        });
        const posted = await postPurchaseReceipt(c, {
          id: rc.id,
          userId: p.userId,
          version: rc.version,
          updated_at: rc.updated_at,
        });
        await voidPurchaseReceipt(c, {
          id: posted.receipt.id,
          userId: p.userId,
          version: posted.receipt.version,
          updated_at: posted.receipt.updated_at,
          reason: 'إبطال عرض DEMO',
        });
      })
    );
  }

  // ——— فواتير مطابقة جزئية + كاملة ———
  if (porPartialId && !(await existsInvoiceRef(MARK.invPartial))) {
    await seedSection('SIN partial', () =>
      withTransaction(async (c) => {
        const poLine = await firstPoLineForInvoice(c, porPartialId!);
        const draft = await createSupplierInvoiceFromPurchaseOrder(c, {
          purchase_order_id: porPartialId!,
          supplier_invoice_number: 'DEMO-VINV-PARTIAL',
          invoice_date: p.entryDate,
          external_reference: MARK.invPartial,
          description: 'فاتورة جزئية من PO DEMO',
          lines: [
            {
              purchase_order_line_id: poLine.id,
              quantity: '3',
              unit_price: poLine.unit_price,
            },
          ],
          created_by: p.userId,
        });
        await acquireJournalEntriesLock(c);
        await postSupplierInvoice(c, {
          id: draft.invoice.id,
          userId: p.userId,
          version: draft.invoice.version,
          updated_at: draft.invoice.updated_at,
        });
      })
    );
  }

  if (porReceivedId && !(await existsInvoiceRef(MARK.invFull))) {
    await seedSection('SIN full', () =>
      withTransaction(async (c) => {
        const poLine = await firstPoLineForInvoice(c, porReceivedId!);
        const draft = await createSupplierInvoiceFromPurchaseOrder(c, {
          purchase_order_id: porReceivedId!,
          supplier_invoice_number: 'DEMO-VINV-FULL',
          invoice_date: p.entryDate,
          external_reference: MARK.invFull,
          description: 'فاتورة كاملة من PO DEMO',
          lines: [
            {
              purchase_order_line_id: poLine.id,
              quantity: poLine.accepted_quantity ?? '12',
              unit_price: poLine.unit_price,
            },
          ],
          created_by: p.userId,
        });
        await acquireJournalEntriesLock(c);
        await postSupplierInvoice(c, {
          id: draft.invoice.id,
          userId: p.userId,
          version: draft.invoice.version,
          updated_at: draft.invoice.updated_at,
        });
      })
    );
  }

  const links = await query(
    `SELECT pr.id, pr.requisition_number AS num, 'requisition' AS kind, pr.status,
            pr.justification AS marker
     FROM accounts.purchase_requisitions pr
     WHERE pr.justification LIKE 'DEMO-PRQ-%'
     UNION ALL
     SELECT po.id, po.purchase_order_number, 'order', po.status, po.description
     FROM accounts.purchase_orders po
     WHERE po.description LIKE 'DEMO-POR-%' OR po.description LIKE '%DEMO-POR-%'
     UNION ALL
     SELECT prc.id, prc.receipt_number, 'receipt', prc.status, prc.notes
     FROM accounts.purchase_receipts prc
     WHERE prc.notes LIKE 'DEMO-PRC-%'
     UNION ALL
     SELECT si.id, si.invoice_number, 'invoice', si.status, si.external_reference
     FROM accounts.supplier_invoices si
     WHERE si.external_reference LIKE 'DEMO-SIN-PO-%'
     ORDER BY marker`
  );

  console.log('✓ بيانات مشتريات DEMO 7.A جاهزة');
  for (const row of links.rows) {
    const base =
      row.kind === 'requisition'
        ? '/accounts/purchasing/requisitions'
        : row.kind === 'order'
          ? '/accounts/purchasing/orders'
          : row.kind === 'receipt'
            ? '/accounts/purchasing/receipts'
            : '/accounts/suppliers/invoices';
    console.log(`  - ${row.marker}: ${row.num} (${row.status}) → ${base}/${row.id}`);
  }
}
