/**
 * تحقق دورة المشتريات 7.A — اتساق الكميات والحالات والأيتام.
 * mode=strict يضيف فحوصات مطابقة GL وربط الفواتير.
 */
import {
  derivePoHeaderStatus,
  derivePoLineStatus,
  type PurchaseOrderLineStatus,
  type PurchaseOrderStatus,
} from './purchase-orders';
import {
  moneyEquals,
  moneyIsPositive,
  moneyToMillis,
  millisToMoney,
  normalizeMoneyInput,
  sumMoney,
} from './money';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type PurchasingVerifyMismatch = {
  kind: string;
  detail: string;
  entity_id?: string;
};

export type PurchasingVerifyResult = {
  ok: boolean;
  strict: boolean;
  mismatches: PurchasingVerifyMismatch[];
  warnings: PurchasingVerifyMismatch[];
  unexplained: PurchasingVerifyMismatch[];
  summary: {
    requisitions: number;
    purchase_orders: number;
    receipts_posted: number;
    po_invoices_posted: number;
    req_lines: number;
    po_lines: number;
  };
};

export type VerifyPurchasingOptions = {
  strict?: boolean;
};

function ms(v: string): bigint {
  return moneyToMillis(normalizeMoneyInput(v));
}

export async function verifyPurchasing(
  client: TxClient,
  options: VerifyPurchasingOptions = {}
): Promise<PurchasingVerifyResult> {
  const strict = options.strict === true;
  const mismatches: PurchasingVerifyMismatch[] = [];

  const reqLines = await txQuery<{
    id: string;
    requisition_id: string;
    requisition_number: string;
    line_number: number;
    requested_quantity: string;
    ordered_quantity: string;
    estimated_unit_price: string;
    estimated_total: string;
    status: string;
  }>(
    client,
    `SELECT rl.id, rl.requisition_id, pr.requisition_number, rl.line_number,
            rl.requested_quantity::text, rl.ordered_quantity::text,
            rl.estimated_unit_price::text, rl.estimated_total::text, pr.status
     FROM accounts.purchase_requisition_lines rl
     JOIN accounts.purchase_requisitions pr ON pr.id = rl.requisition_id`
  );

  for (const rl of reqLines.rows) {
    const ordered = normalizeMoneyInput(rl.ordered_quantity);
    const requested = normalizeMoneyInput(rl.requested_quantity);
    if (ms(ordered) > ms(requested)) {
      mismatches.push({
        kind: 'REQ_OVER_ORDERED',
        entity_id: rl.id,
        detail: `${rl.requisition_number} L${rl.line_number}: ordered=${ordered} > requested=${requested}`,
      });
    }

    const expectedLineTotal = millisToMoney(
      (ms(rl.requested_quantity) * ms(rl.estimated_unit_price) + BigInt(500)) / BigInt(1000)
    );
    if (!moneyEquals(expectedLineTotal, normalizeMoneyInput(rl.estimated_total))) {
      mismatches.push({
        kind: 'REQ_LINE_TOTAL',
        entity_id: rl.id,
        detail: `${rl.requisition_number} L${rl.line_number}: estimated_total mismatch`,
      });
    }

    const poSum = await txQuery<{ total: string }>(
      client,
      `SELECT COALESCE(SUM(pol.ordered_quantity),0)::text AS total
       FROM accounts.purchase_order_lines pol
       JOIN accounts.purchase_orders po ON po.id = pol.purchase_order_id
       WHERE pol.requisition_line_id = $1::uuid
         AND po.status NOT IN ('REJECTED', 'CANCELLED')`,
      [rl.id]
    );
    const fromPo = normalizeMoneyInput(poSum.rows[0]?.total ?? '0');
    if (!moneyEquals(fromPo, ordered)) {
      mismatches.push({
        kind: 'REQ_PO_ORDERED_MISMATCH',
        entity_id: rl.id,
        detail: `${rl.requisition_number} L${rl.line_number}: req ordered=${ordered} po sum=${fromPo}`,
      });
    }
  }

  const reqs = await txQuery<{
    id: string;
    requisition_number: string;
    status: string;
    total_estimated_amount: string;
  }>(
    client,
    `SELECT id, requisition_number, status, total_estimated_amount::text FROM accounts.purchase_requisitions`
  );

  for (const req of reqs.rows) {
    const lines = reqLines.rows.filter((l) => l.requisition_id === req.id);
    if (lines.length) {
      const sumEst = sumMoney(lines.map((l) => normalizeMoneyInput(l.estimated_total)));
      if (!moneyEquals(sumEst, normalizeMoneyInput(req.total_estimated_amount))) {
        mismatches.push({
          kind: 'REQ_HEADER_TOTAL',
          entity_id: req.id,
          detail: `${req.requisition_number}: header total ≠ Σ lines`,
        });
      }
    }
    if (!lines.length) continue;
    if (!['APPROVED', 'PARTIALLY_ORDERED', 'ORDERED'].includes(req.status)) continue;

    let anyOrdered = false;
    let allFull = true;
    for (const l of lines) {
      if (moneyIsPositive(l.ordered_quantity)) anyOrdered = true;
      if (!moneyEquals(l.ordered_quantity, l.requested_quantity)) allFull = false;
    }
    const expected = !anyOrdered ? 'APPROVED' : allFull ? 'ORDERED' : 'PARTIALLY_ORDERED';
    if (req.status !== expected) {
      mismatches.push({
        kind: 'REQ_STATUS',
        entity_id: req.id,
        detail: `${req.requisition_number}: status=${req.status} expected=${expected}`,
      });
    }
  }

  const poLines = await txQuery<{
    id: string;
    purchase_order_id: string;
    purchase_order_number: string;
    line_number: number;
    ordered_quantity: string;
    cancelled_quantity: string;
    received_quantity: string;
    accepted_quantity: string;
    rejected_quantity: string;
    invoiced_quantity: string;
    status: PurchaseOrderLineStatus;
    po_status: PurchaseOrderStatus;
    requisition_line_id: string | null;
    expense_gl_account_id: string;
  }>(
    client,
    `SELECT pol.id, pol.purchase_order_id, pol.line_number,
            pol.ordered_quantity::text, pol.cancelled_quantity::text,
            pol.received_quantity::text, pol.accepted_quantity::text,
            pol.rejected_quantity::text, pol.invoiced_quantity::text,
            pol.status, pol.requisition_line_id, pol.expense_gl_account_id,
            po.purchase_order_number, po.status AS po_status
     FROM accounts.purchase_order_lines pol
     JOIN accounts.purchase_orders po ON po.id = pol.purchase_order_id`
  );

  for (const pl of poLines.rows) {
    const ordered = normalizeMoneyInput(pl.ordered_quantity);
    const cancelled = normalizeMoneyInput(pl.cancelled_quantity);
    const received = normalizeMoneyInput(pl.received_quantity);
    const accepted = normalizeMoneyInput(pl.accepted_quantity);
    const rejected = normalizeMoneyInput(pl.rejected_quantity);
    const invoiced = normalizeMoneyInput(pl.invoiced_quantity);
    const open = ms(ordered) - ms(cancelled);

    if (ms(received) > open) {
      mismatches.push({
        kind: 'PO_OVER_RECEIVED',
        entity_id: pl.id,
        detail: `${pl.purchase_order_number} L${pl.line_number}: received=${received} > open`,
      });
    }
    if (ms(invoiced) > ms(accepted)) {
      mismatches.push({
        kind: 'PO_OVER_INVOICED',
        entity_id: pl.id,
        detail: `${pl.purchase_order_number} L${pl.line_number}: invoiced > accepted`,
      });
    }
    const recvSum = millisToMoney(ms(accepted) + ms(rejected));
    if (!moneyEquals(recvSum, received)) {
      mismatches.push({
        kind: 'PO_ACCEPT_REJECT',
        entity_id: pl.id,
        detail: `${pl.purchase_order_number} L${pl.line_number}: accepted+rejected ≠ received`,
      });
    }

    const recvPosted = await txQuery<{ r: string; a: string; j: string }>(
      client,
      `SELECT
         COALESCE(SUM(prl.received_quantity),0)::text AS r,
         COALESCE(SUM(prl.accepted_quantity),0)::text AS a,
         COALESCE(SUM(prl.rejected_quantity),0)::text AS j
       FROM accounts.purchase_receipt_lines prl
       JOIN accounts.purchase_receipts pr ON pr.id = prl.receipt_id
       WHERE prl.purchase_order_line_id = $1::uuid AND pr.status = 'POSTED'`,
      [pl.id]
    );
    const rr = recvPosted.rows[0];
    if (
      rr &&
      (!moneyEquals(normalizeMoneyInput(rr.r), received) ||
        !moneyEquals(normalizeMoneyInput(rr.a), accepted) ||
        !moneyEquals(normalizeMoneyInput(rr.j), rejected))
    ) {
      mismatches.push({
        kind: 'PO_RECEIPT_SUM_MISMATCH',
        entity_id: pl.id,
        detail: `${pl.purchase_order_number} L${pl.line_number}: PO vs posted receipts mismatch`,
      });
    }

    const invPosted = await txQuery<{ total: string }>(
      client,
      `SELECT COALESCE(SUM(sil.quantity),0)::text AS total
       FROM accounts.supplier_invoice_lines sil
       JOIN accounts.supplier_invoices si ON si.id = sil.supplier_invoice_id
       WHERE sil.purchase_order_line_id = $1::uuid
         AND si.invoice_source = 'PURCHASE_ORDER'
         AND si.status IN ('POSTED','PARTIALLY_PAID','PAID')`,
      [pl.id]
    );
    const invFromLines = normalizeMoneyInput(invPosted.rows[0]?.total ?? '0');
    if (!moneyEquals(invFromLines, invoiced)) {
      mismatches.push({
        kind: 'PO_INVOICE_SUM_MISMATCH',
        entity_id: pl.id,
        detail: `${pl.purchase_order_number} L${pl.line_number}: invoiced mismatch`,
      });
    }

    const expectedLineStatus = derivePoLineStatus({
      ordered_quantity: ordered,
      cancelled_quantity: cancelled,
      received_quantity: received,
      accepted_quantity: accepted,
      invoiced_quantity: invoiced,
      status: pl.status,
    });
    if (pl.status !== expectedLineStatus) {
      mismatches.push({
        kind: 'PO_LINE_STATUS',
        entity_id: pl.id,
        detail: `${pl.purchase_order_number} L${pl.line_number}: status=${pl.status} expected=${expectedLineStatus}`,
      });
    }

    if (pl.requisition_line_id) {
      const parent = reqLines.rows.find((r) => r.id === pl.requisition_line_id);
      if (!parent) {
        mismatches.push({
          kind: 'ORPHAN_PO_REQ_LINE',
          entity_id: pl.id,
          detail: `${pl.purchase_order_number} L${pl.line_number}: missing requisition_line`,
        });
      }
    }
  }

  const poHeaders = await txQuery<{
    id: string;
    purchase_order_number: string;
    status: PurchaseOrderStatus;
    supplier_id: string;
    currency_code: string;
  }>(client, `SELECT id, purchase_order_number, status, supplier_id, currency_code FROM accounts.purchase_orders`);
  for (const po of poHeaders.rows) {
    const lines = poLines.rows
      .filter((l) => l.purchase_order_id === po.id)
      .map((l) => ({ status: l.status }));
    const expected = derivePoHeaderStatus(po.status, lines);
    if (po.status !== expected) {
      mismatches.push({
        kind: 'PO_HEADER_STATUS',
        entity_id: po.id,
        detail: `${po.purchase_order_number}: status=${po.status} expected=${expected}`,
      });
    }
  }

  const receiptLineEq = await txQuery<{ n: number }>(
    client,
    `SELECT COUNT(*)::int AS n FROM accounts.purchase_receipt_lines
     WHERE ROUND(accepted_quantity + rejected_quantity, 3) <> ROUND(received_quantity, 3)`
  );
  if ((receiptLineEq.rows[0]?.n ?? 0) > 0) {
    mismatches.push({
      kind: 'RECEIPT_ACCEPT_REJECT',
      detail: `count=${receiptLineEq.rows[0]?.n}`,
    });
  }

  const orphanReceiptLines = await txQuery<{ n: number }>(
    client,
    `SELECT COUNT(*)::int AS n
     FROM accounts.purchase_receipt_lines prl
     LEFT JOIN accounts.purchase_order_lines pol ON pol.id = prl.purchase_order_line_id
     WHERE pol.id IS NULL`
  );
  if ((orphanReceiptLines.rows[0]?.n ?? 0) > 0) {
    mismatches.push({
      kind: 'ORPHAN_RECEIPT_LINE',
      detail: `count=${orphanReceiptLines.rows[0]?.n}`,
    });
  }

  const orphanInvLines = await txQuery<{ n: number }>(
    client,
    `SELECT COUNT(*)::int AS n
     FROM accounts.supplier_invoice_lines sil
     JOIN accounts.supplier_invoices si ON si.id = sil.supplier_invoice_id
     LEFT JOIN accounts.purchase_order_lines pol ON pol.id = sil.purchase_order_line_id
     WHERE si.invoice_source = 'PURCHASE_ORDER'
       AND sil.purchase_order_line_id IS NOT NULL
       AND pol.id IS NULL`
  );
  if ((orphanInvLines.rows[0]?.n ?? 0) > 0) {
    mismatches.push({
      kind: 'ORPHAN_INVOICE_PO_LINE',
      detail: `count=${orphanInvLines.rows[0]?.n}`,
    });
  }

  const poInvoices = await txQuery<{
    id: string;
    invoice_number: string;
    status: string;
    total_amount: string;
    journal_entry_id: string | null;
    supplier_account_id: string;
    supplier_id: string;
    currency_code: string;
    purchase_order_id: string | null;
  }>(
    client,
    `SELECT id, invoice_number, status, total_amount::text, journal_entry_id,
            supplier_account_id, supplier_id, currency_code, purchase_order_id
     FROM accounts.supplier_invoices
     WHERE invoice_source = 'PURCHASE_ORDER'`
  );

  for (const inv of poInvoices.rows) {
    const lines = await txQuery<{
      line_total: string;
      purchase_order_line_id: string | null;
      expense_gl_account_id: string;
    }>(
      client,
      `SELECT line_total::text, purchase_order_line_id, expense_gl_account_id
       FROM accounts.supplier_invoice_lines WHERE supplier_invoice_id=$1::uuid`,
      [inv.id]
    );
    if (lines.rows.length) {
      const sum = sumMoney(lines.rows.map((l) => normalizeMoneyInput(l.line_total)));
      // Header may include tax/discount differently; compare to stored total when lines exist
      if (
        ['POSTED', 'PARTIALLY_PAID', 'PAID', 'DRAFT'].includes(inv.status) &&
        !moneyEquals(sum, normalizeMoneyInput(inv.total_amount))
      ) {
        // Allow if header uses same total as lines (expected for PO invoices)
        mismatches.push({
          kind: 'INVOICE_HEADER_LINES_TOTAL',
          entity_id: inv.id,
          detail: `${inv.invoice_number}: header=${inv.total_amount} lines=${sum}`,
        });
      }
    }

    if (['POSTED', 'PARTIALLY_PAID', 'PAID'].includes(inv.status)) {
      if (!inv.journal_entry_id) {
        mismatches.push({
          kind: 'INVOICE_MISSING_JOURNAL',
          entity_id: inv.id,
          detail: inv.invoice_number,
        });
      } else {
        const je = await txQuery<{ n: number }>(
          client,
          `SELECT COUNT(*)::int AS n FROM accounts.journal_entries WHERE id=$1::uuid AND status='POSTED'`,
          [inv.journal_entry_id]
        );
        if ((je.rows[0]?.n ?? 0) === 0) {
          mismatches.push({
            kind: 'INVOICE_JOURNAL_NOT_POSTED',
            entity_id: inv.id,
            detail: inv.invoice_number,
          });
        }
      }
      const led = await txQuery<{ n: number }>(
        client,
        `SELECT COUNT(*)::int AS n FROM accounts.supplier_ledger_entries
         WHERE source_id=$1::uuid AND source_type='SUPPLIER_INVOICE' AND entry_type='INVOICE'`,
        [inv.id]
      );
      if ((led.rows[0]?.n ?? 0) < 1) {
        mismatches.push({
          kind: 'INVOICE_MISSING_LEDGER',
          entity_id: inv.id,
          detail: inv.invoice_number,
        });
      }
    }

    if (inv.purchase_order_id) {
      const po = poHeaders.rows.find((p) => p.id === inv.purchase_order_id);
      if (po && po.supplier_id !== inv.supplier_id) {
        mismatches.push({
          kind: 'INVOICE_SUPPLIER_MISMATCH',
          entity_id: inv.id,
          detail: inv.invoice_number,
        });
      }
      if (po && po.currency_code !== inv.currency_code) {
        mismatches.push({
          kind: 'INVOICE_CURRENCY_MISMATCH',
          entity_id: inv.id,
          detail: inv.invoice_number,
        });
      }
    }

    if (strict) {
      for (const l of lines.rows) {
        if (!l.purchase_order_line_id) {
          mismatches.push({
            kind: 'STRICT_MISSING_PO_LINE',
            entity_id: inv.id,
            detail: inv.invoice_number,
          });
          continue;
        }
        const pol = poLines.rows.find((p) => p.id === l.purchase_order_line_id);
        if (pol && pol.expense_gl_account_id !== l.expense_gl_account_id) {
          mismatches.push({
            kind: 'STRICT_GL_MISMATCH',
            entity_id: inv.id,
            detail: `${inv.invoice_number}: invoice GL ≠ PO line GL`,
          });
        }
      }
      if (['POSTED', 'PARTIALLY_PAID', 'PAID'].includes(inv.status) && !inv.journal_entry_id) {
        mismatches.push({
          kind: 'STRICT_POSTED_WITHOUT_JOURNAL',
          entity_id: inv.id,
          detail: inv.invoice_number,
        });
      }
    }
  }

  // لا يُسمح بمصادر يومية لوثائق المشتريات التشغيلية قبل الفاتورة
  const orphanPurchasingJe = await txQuery<{ n: number }>(
    client,
    `SELECT COUNT(*)::int AS n FROM accounts.journal_entries
     WHERE source_type IN ('PURCHASE_REQUISITION','PURCHASE_ORDER','PURCHASE_RECEIPT')`
  );
  const warnings: PurchasingVerifyMismatch[] = [];
  const unexplained: PurchasingVerifyMismatch[] = [];

  if ((orphanPurchasingJe.rows[0]?.n ?? 0) > 0) {
    mismatches.push({
      kind: 'ORPHAN_PURCHASING_JOURNAL',
      detail: `count=${orphanPurchasingJe.rows[0]?.n}`,
    });
  }

  // تحذير غير قاتل في الوضع العادي: فواتير PO DRAFT كثيرة بلا ترحيل
  const draftPoInv = await txQuery<{ n: number }>(
    client,
    `SELECT COUNT(*)::int AS n FROM accounts.supplier_invoices
     WHERE invoice_source='PURCHASE_ORDER' AND status='DRAFT'`
  );
  if ((draftPoInv.rows[0]?.n ?? 0) > 50) {
    warnings.push({
      kind: 'WARN_MANY_DRAFT_PO_INVOICES',
      detail: `count=${draftPoInv.rows[0]?.n}`,
    });
  }

  const postedReceipts = await txQuery<{ n: number }>(
    client,
    `SELECT COUNT(*)::int AS n FROM accounts.purchase_receipts WHERE status = 'POSTED'`
  );
  const poInvoicesPosted = await txQuery<{ n: number }>(
    client,
    `SELECT COUNT(*)::int AS n FROM accounts.supplier_invoices
     WHERE invoice_source = 'PURCHASE_ORDER' AND status IN ('POSTED','PARTIALLY_PAID','PAID')`
  );

  const ok =
    mismatches.length === 0 &&
    (!strict || (warnings.length === 0 && unexplained.length === 0));

  return {
    ok,
    strict,
    mismatches,
    warnings,
    unexplained,
    summary: {
      requisitions: reqs.rows.length,
      purchase_orders: poHeaders.rows.length,
      receipts_posted: postedReceipts.rows[0]?.n ?? 0,
      po_invoices_posted: poInvoicesPosted.rows[0]?.n ?? 0,
      req_lines: reqLines.rows.length,
      po_lines: poLines.rows.length,
    },
  };
}
