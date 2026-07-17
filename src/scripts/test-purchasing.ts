/**
 * اختبارات قبول دورة المشتريات 7.A
 * npm run test:purchasing
 */
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcrypt';
import { closePool, query } from '../lib/db';
import { grantAccountsAdminRole } from '../lib/accounts/accounts-access';
import { createSupplierAccount } from '../lib/accounts/supplier-accounts';
import {
  createSupplierInvoiceFromPurchaseOrder,
  isPriceWithinTolerance,
  listMatchablePoLines,
  setPurchaseInvoiceMatchPostFaultForTests,
} from '../lib/accounts/purchase-invoice-matching';
import {
  approvePurchaseOrder,
  cancelPurchaseOrder,
  closePurchaseOrder,
  createPurchaseOrder,
  createPurchaseOrderFromRequisition,
  listPurchaseOrderLines,
  rejectPurchaseOrder,
  submitPurchaseOrder,
} from '../lib/accounts/purchase-orders';
import {
  approvePurchaseRequisition,
  cancelPurchaseRequisition,
  createPurchaseRequisition,
  listPurchaseRequisitionLines,
  rejectPurchaseRequisition,
  submitPurchaseRequisition,
  updatePurchaseRequisition,
} from '../lib/accounts/purchase-requisitions';
import {
  createPurchaseReceipt,
  postPurchaseReceipt,
  setPurchaseReceiptPostFaultForTests,
  setPurchaseReceiptVoidFaultForTests,
  voidPurchaseReceipt,
} from '../lib/accounts/purchase-receipts';
import {
  PURCHASING_CAPABILITIES,
  assertPurchasingCapability,
  grantAccountsPlatformRole,
  hasPurchasingCapability,
} from '../lib/accounts/purchasing-access';
import {
  ACCOUNTS_CLERK_ROLE_CODE,
  ACCOUNTS_VIEWER_ROLE_CODE,
} from '../lib/accounts/student-receivables-access';
import { activateSupplier, createSupplier, suspendSupplier } from '../lib/accounts/suppliers';
import { getSupplierLedger, postSupplierInvoice, voidSupplierInvoice } from '../lib/accounts/supplier-invoices';
import { AccountsHttpError } from '../lib/accounts/auth';
import { moneyEquals, normalizeMoneyInput } from '../lib/accounts/money';
import { pgDateOnly } from '../lib/accounts/document-sequences';
import {
  purchaseOrderLock,
  purchaseOrderLineLock,
  purchaseReceiptLock,
  purchaseRequisitionLock,
} from '../lib/accounts/accounting-locks';
import {
  hasUnexplainedGlActivity,
  verifySupplierPayables,
} from '../lib/accounts/verify-supplier-payables';
import { verifyPurchasing } from '../lib/accounts/verify-purchasing';
import type { TxClient } from '../lib/accounts/with-transaction';
import {
  acquireJournalEntriesLock,
  withTransaction,
} from '../lib/accounts/with-transaction';

let passCount = 0;
let failCount = 0;

function ok(name: string) {
  passCount += 1;
  console.log(`✅ ${name}`);
}
function fail(name: string, err?: unknown) {
  failCount += 1;
  console.error(`❌ ${name}`, err ?? '');
  process.exitCode = 1;
}
async function expectHttp(
  name: string,
  fn: () => Promise<unknown>,
  status: number,
  includes?: string
) {
  try {
    await fn();
    fail(name, `توقّعنا خطأ ${status} ولم يحدث`);
  } catch (e) {
    if (e instanceof AccountsHttpError && e.status === status) {
      if (includes && !e.message.includes(includes)) {
        fail(name, `الرسالة لا تحتوي "${includes}": ${e.message}`);
        return;
      }
      ok(name);
      return;
    }
    fail(name, e);
  }
}

async function ensureTypedAccount(
  code: string,
  nameAr: string,
  typeCode: 'LIABILITY' | 'EXPENSE' | 'ASSET' | 'REVENUE',
  userId: string
): Promise<string> {
  const existing = await query(
    `SELECT id FROM accounts.chart_of_accounts WHERE LOWER(code)=LOWER($1)`,
    [code]
  );
  if (existing.rows[0]) return existing.rows[0].id as string;
  const type = await query(
    `SELECT id, normal_balance FROM accounts.account_types WHERE code=$1`,
    [typeCode]
  );
  if (!type.rows[0]) throw new Error(`نوع حساب ${typeCode} غير موجود`);
  const sort = await query(
    `SELECT COALESCE(MAX(sort_order),0)+1 AS n FROM accounts.chart_of_accounts WHERE parent_id IS NULL`
  );
  const ins = await query(
    `INSERT INTO accounts.chart_of_accounts
      (code, name_ar, account_type_id, level, is_group, allow_posting,
       normal_balance, requires_cost_center, is_active, sort_order, created_by, description)
     VALUES ($1,$2,$3,1,FALSE,TRUE,$4,FALSE,TRUE,$5,$6,'اختبار 7.A')
     RETURNING id`,
    [code, nameAr, type.rows[0].id, type.rows[0].normal_balance, sort.rows[0].n, userId]
  );
  return ins.rows[0].id as string;
}

async function upsertCapabilityTestUser(username: string): Promise<string> {
  const hash = await bcrypt.hash('test-pur-pass', 10);
  const res = await query(
    `INSERT INTO student_affairs.users (username, email, full_name, password_hash, is_active)
     VALUES ($1, $2, $3, $4, TRUE)
     ON CONFLICT (username) DO UPDATE SET password_hash = EXCLUDED.password_hash, is_active = TRUE
     RETURNING id`,
    [username, `${username}@test.local`, `اختبار ${username}`, hash]
  );
  const userId = res.rows[0].id as string;
  await query(
    `INSERT INTO student_affairs.user_systems (user_id, system_id)
     SELECT $1::uuid, s.id FROM student_affairs.systems s WHERE s.code = 'ACCOUNTS'
     ON CONFLICT (user_id, system_id) DO NOTHING`,
    [userId]
  );
  return userId;
}

async function resolveOpenDate(): Promise<{ entryDate: string; yearId: string; periodId: string }> {
  const period = await query(
    `SELECT y.id AS year_id, p.id AS period_id, p.start_date::text AS start_date
     FROM accounts.fiscal_years y
     JOIN accounts.fiscal_periods p ON p.fiscal_year_id = y.id
     WHERE y.status = 'ACTIVE' AND p.status = 'OPEN'
     ORDER BY y.is_default DESC, p.start_date LIMIT 1`
  );
  if (!period.rows[0]) throw new Error('لا توجد فترة مالية OPEN');
  const start = pgDateOnly(period.rows[0].start_date as string);
  const entryDate = start.slice(0, 7) === '2026-01' ? '2026-01-15' : start;
  return {
    entryDate,
    yearId: period.rows[0].year_id as string,
    periodId: period.rows[0].period_id as string,
  };
}

function reqLine(expGl: string, qty: string, price: string) {
  return {
    purchase_kind: 'SERVICE' as const,
    description: 'سطر اختبار 7.A',
    unit_of_measure: 'UNIT',
    requested_quantity: qty,
    estimated_unit_price: price,
    expense_gl_account_id: expGl,
  };
}

async function approvePoInTx(
  c: TxClient,
  po: { id: string; version: number; updated_at: Date | string },
  userId: string
) {
  const sub = await submitPurchaseOrder(c, {
    id: po.id,
    userId,
    version: po.version,
    updated_at: po.updated_at,
  });
  return approvePurchaseOrder(c, {
    id: sub.id,
    userId,
    version: sub.version,
    updated_at: sub.updated_at,
  });
}

async function approvePoFlow(poId: string, userId: string, version: number, updated_at: Date | string) {
  const sub = await withTransaction((c) =>
    submitPurchaseOrder(c, { id: poId, userId, version, updated_at })
  );
  return withTransaction((c) =>
    approvePurchaseOrder(c, {
      id: sub.id,
      userId,
      version: sub.version,
      updated_at: sub.updated_at,
    })
  );
}

async function main() {
  console.log('===== اختبارات قبول Purchasing 7.A =====');

  let user = await query(
    `SELECT u.id, u.username FROM student_affairs.users u
     JOIN student_affairs.user_systems us ON us.user_id = u.id
     JOIN student_affairs.systems s ON s.id = us.system_id
     WHERE s.code = 'ACCOUNTS' AND u.is_active
     ORDER BY CASE WHEN LOWER(u.username) = 'accounts' THEN 0 ELSE 1 END, u.created_at LIMIT 1`
  );
  if (!user.rows[0]) {
    user = await query(
      `SELECT id, username FROM student_affairs.users WHERE is_active = TRUE ORDER BY created_at NULLS LAST LIMIT 1`
    );
  }
  if (!user.rows[0]) {
    fail('إعداد: لا يوجد مستخدم');
    return;
  }
  const userId = user.rows[0].id as string;
  await grantAccountsAdminRole(userId);

  let fiscal: { entryDate: string; yearId: string; periodId: string };
  try {
    fiscal = await resolveOpenDate();
    ok(`00) تاريخ فترة مفتوحة: ${fiscal.entryDate}`);
  } catch (e) {
    fail('00) فترة مالية', e);
    return;
  }

  const suffix = Date.now().toString(36).toUpperCase().slice(-6);
  const payGl = await ensureTypedAccount(`TST-PUR-AP-${suffix}`, 'ذمم 7.A', 'LIABILITY', userId);
  const expGl = await ensureTypedAccount(`TST-PUR-EX-${suffix}`, 'مصروف 7.A', 'EXPENSE', userId);
  const expGl2 = await ensureTypedAccount(`TST-PUR-EX2-${suffix}`, 'مصروف 7.A #2', 'EXPENSE', userId);
  ok('00b) حسابات GL جاهزة');

  const supplier = await withTransaction((c) =>
    createSupplier(c, {
      code: `PUR-SUP-${suffix}`,
      name_ar: `مورد مشتريات ${suffix}`,
      supplier_type: 'LOCAL',
      created_by: userId,
    })
  );
  const account = await withTransaction((c) =>
    createSupplierAccount(c, {
      supplier_id: supplier.id,
      payable_gl_account_id: payGl,
      created_by: userId,
    })
  );
  ok('00c) مورد ACTIVE + حساب');

  const verifyPayablesBaseline = await withTransaction((c) => verifySupplierPayables(c));

  // 01) PRQ DRAFT
  const reqDraft = await withTransaction((c) =>
    createPurchaseRequisition(c, {
      requisition_date: fiscal.entryDate,
      requested_by: userId,
      justification: `اختبار PRQ ${suffix}`,
      lines: [reqLine(expGl, '10', '25')],
      created_by: userId,
    })
  );
  if (reqDraft.status === 'DRAFT') ok('01) إنشاء طلب شراء DRAFT');
  else fail('01) DRAFT', reqDraft.status);

  // 02) estimated_total backend
  {
    const lines = await withTransaction((c) => listPurchaseRequisitionLines(c, reqDraft.id));
    if (
      lines.length === 1 &&
      moneyEquals(lines[0].estimated_total, '250.000') &&
      moneyEquals(reqDraft.total_estimated_amount, '250.000')
    ) {
      ok('02) estimated_total محسوب (10×25=250)');
    } else fail('02) estimated_total', { header: reqDraft.total_estimated_amount, line: lines[0] });
  }

  // 03) qty zero rejected
  await expectHttp(
    '03) رفض كمية صفر',
    () =>
      withTransaction((c) =>
        createPurchaseRequisition(c, {
          requisition_date: fiscal.entryDate,
          requested_by: userId,
          justification: 'صفر',
          lines: [{ ...reqLine(expGl, '0', '10'), requested_quantity: '0' }],
          created_by: userId,
        })
      ),
    400,
    'أكبر من صفر'
  );

  // 04-06) submit / approve / status
  const reqSub = await withTransaction(async (c) => {
    const s = await submitPurchaseRequisition(c, {
      id: reqDraft.id,
      userId,
      version: reqDraft.version,
      updated_at: reqDraft.updated_at,
    });
    return approvePurchaseRequisition(c, {
      id: s.id,
      userId,
      version: s.version,
      updated_at: s.updated_at,
    });
  });
  if (reqSub.status === 'APPROVED') ok('04) DRAFT→SUBMIT→APPROVE');
  else fail('04) اعتماد الطلب', reqSub.status);

  // 05) reject needs reason
  const reqRejBase = await withTransaction(async (c) => {
    const r = await createPurchaseRequisition(c, {
      requisition_date: fiscal.entryDate,
      requested_by: userId,
      justification: 'للرفض',
      lines: [reqLine(expGl, '2', '10')],
      created_by: userId,
    });
    return submitPurchaseRequisition(c, {
      id: r.id,
      userId,
      version: r.version,
      updated_at: r.updated_at,
    });
  });
  await expectHttp(
    '05) رفض بدون سبب',
    () =>
      withTransaction((c) =>
        rejectPurchaseRequisition(c, {
          id: reqRejBase.id,
          userId,
          version: reqRejBase.version,
          updated_at: reqRejBase.updated_at,
        })
      ),
    400
  );
  const reqRej = await withTransaction((c) =>
    rejectPurchaseRequisition(c, {
      id: reqRejBase.id,
      userId,
      version: reqRejBase.version,
      updated_at: reqRejBase.updated_at,
      reason: 'غير مناسب',
    })
  );
  if (reqRej.status === 'REJECTED') ok('06) رفض طلب SUBMITTED');
  else fail('06) REJECTED', reqRej.status);

  // 07) cancel DRAFT
  const reqCancel = await withTransaction((c) =>
    createPurchaseRequisition(c, {
      requisition_date: fiscal.entryDate,
      requested_by: userId,
      justification: 'للإلغاء',
      lines: [reqLine(expGl, '1', '5')],
      created_by: userId,
    })
  );
  const cancelled = await withTransaction((c) =>
    cancelPurchaseRequisition(c, {
      id: reqCancel.id,
      userId,
      version: reqCancel.version,
      updated_at: reqCancel.updated_at,
      reason: 'لم نعد نحتاج',
    })
  );
  if (cancelled.status === 'CANCELLED') ok('07) إلغاء طلب DRAFT');
  else fail('07) CANCELLED', cancelled.status);

  const reqLines = await withTransaction((c) => listPurchaseRequisitionLines(c, reqSub.id));
  const rlId = reqLines[0]!.id;

  // 08) PO from requisition
  const poFromReq = await withTransaction((c) =>
    createPurchaseOrderFromRequisition(c, {
      requisitionId: reqSub.id,
      supplier_account_id: account.id,
      order_date: fiscal.entryDate,
      lines: [{ requisition_line_id: rlId, ordered_quantity: '4', unit_price: '25' }],
      userId,
    })
  );
  if (poFromReq.requisition_id === reqSub.id) ok('08) أمر من طلب (requisition_line_id)');
  else fail('08) PO from req', poFromReq);

  // 09) partial order → PARTIALLY_ORDERED
  {
    const reqSt = await query(`SELECT status FROM accounts.purchase_requisitions WHERE id=$1`, [reqSub.id]);
    const rl = await query(
      `SELECT ordered_quantity::text AS o FROM accounts.purchase_requisition_lines WHERE id=$1`,
      [rlId]
    );
    if (reqSt.rows[0]?.status === 'PARTIALLY_ORDERED' && moneyEquals(String(rl.rows[0]?.o), '4.000')) {
      ok('09) PARTIALLY_ORDERED + ordered_quantity=4');
    } else fail('09) PARTIALLY_ORDERED', { reqSt: reqSt.rows[0], rl: rl.rows[0] });
  }

  // 10) over-order rejected
  await expectHttp(
    '10) رفض over-order على الطلب',
    () =>
      withTransaction((c) =>
        createPurchaseOrderFromRequisition(c, {
          requisitionId: reqSub.id,
          supplier_account_id: account.id,
          order_date: fiscal.entryDate,
          lines: [{ requisition_line_id: rlId, ordered_quantity: '20' }],
          userId,
        })
      ),
    409,
    'تتجاوز المتبقي'
  );

  // 11) direct PO
  const directPo = await withTransaction((c) =>
    createPurchaseOrder(c, {
      supplier_account_id: account.id,
      order_date: fiscal.entryDate,
      description: 'أمر مباشر',
      lines: [
        {
          purchase_kind: 'SERVICE',
          description: 'مباشر',
          ordered_quantity: '5',
          unit_price: '40',
          expense_gl_account_id: expGl,
        },
      ],
      created_by: userId,
    })
  );
  if (directPo.status === 'DRAFT' && !directPo.requisition_id) ok('11) أمر شراء مباشر DRAFT');
  else fail('11) direct PO', directPo);

  const poApproved = await approvePoFlow(
    directPo.id,
    userId,
    directPo.version,
    directPo.updated_at
  );
  if (poApproved.status === 'APPROVED') ok('12) PO SUBMIT→APPROVE');
  else fail('12) PO APPROVED', poApproved.status);

  // 13) SUSPENDED supplier on approve
  {
    const susPo = await withTransaction(async (c) => {
      const po = await createPurchaseOrder(c, {
        supplier_account_id: account.id,
        order_date: fiscal.entryDate,
        lines: [
          {
            purchase_kind: 'SERVICE',
            description: 'suspend test',
            ordered_quantity: '1',
            unit_price: '10',
            expense_gl_account_id: expGl,
          },
        ],
        created_by: userId,
      });
      return submitPurchaseOrder(c, {
        id: po.id,
        userId,
        version: po.version,
        updated_at: po.updated_at,
      });
    });
    await withTransaction((c) =>
      suspendSupplier(c, {
        id: supplier.id,
        userId,
        version: supplier.version,
        updated_at: supplier.updated_at,
      })
    );
    await expectHttp(
      '13) رفض اعتماد PO لمورد SUSPENDED',
      () =>
        withTransaction((c) =>
          approvePurchaseOrder(c, {
            id: susPo.id,
            userId,
            version: susPo.version,
            updated_at: susPo.updated_at,
          })
        ),
      409,
      'معلّق'
    );
    const supRow = await query(
      `SELECT version, updated_at FROM accounts.suppliers WHERE id=$1`,
      [supplier.id]
    );
    await withTransaction((c) =>
      activateSupplier(c, {
        id: supplier.id,
        userId,
        version: supRow.rows[0]!.version,
        updated_at: supRow.rows[0]!.updated_at,
      })
    );
  }

  const poLines = await withTransaction((c) => listPurchaseOrderLines(c, poApproved.id));
  const poLineId = poLines[0]!.id;

  // 14) partial receipt
  const rcPartial = await withTransaction(async (c) => {
    const rc = await createPurchaseReceipt(c, {
      purchase_order_id: poApproved.id,
      receipt_date: fiscal.entryDate,
      received_by: userId,
      lines: [
        {
          purchase_order_line_id: poLineId,
          received_quantity: '3',
          accepted_quantity: '2',
          rejected_quantity: '1',
          rejection_reason: 'تالف',
        },
      ],
      created_by: userId,
    });
    return postPurchaseReceipt(c, {
      id: rc.id,
      userId,
      version: rc.version,
      updated_at: rc.updated_at,
    });
  });
  if (rcPartial.receipt.status === 'POSTED') ok('14) استلام جزئي POSTED');
  else fail('14) partial receipt', rcPartial);

  {
    const pl = await query(
      `SELECT received_quantity::text r, accepted_quantity::text a, rejected_quantity::text j, status
       FROM accounts.purchase_order_lines WHERE id=$1`,
      [poLineId]
    );
    const row = pl.rows[0];
    if (
      row &&
      moneyEquals(String(row.r), '3.000') &&
      moneyEquals(String(row.a), '2.000') &&
      moneyEquals(String(row.j), '1.000') &&
      row.status === 'PARTIALLY_RECEIVED'
    ) {
      ok('15) accepted+rejected=received + PO PARTIALLY_RECEIVED');
    } else fail('15) PO quantities', row);
  }

  // 16) over-receive reject
  await expectHttp(
    '16) رفض over-receive',
    () =>
      withTransaction(async (c) => {
        const rc = await createPurchaseReceipt(c, {
          purchase_order_id: poApproved.id,
          receipt_date: fiscal.entryDate,
          received_by: userId,
          lines: [{ purchase_order_line_id: poLineId, received_quantity: '10', accepted_quantity: '10' }],
          created_by: userId,
        });
        return postPurchaseReceipt(c, {
          id: rc.id,
          userId,
          version: rc.version,
          updated_at: rc.updated_at,
        });
      }),
    409,
    'تتجاوز المتبقي'
  );

  // 17) full receipt on second PO
  const poFull = await withTransaction(async (c) => {
    const po = await createPurchaseOrder(c, {
      supplier_account_id: account.id,
      order_date: fiscal.entryDate,
      lines: [
        {
          purchase_kind: 'SERVICE',
          description: 'للاستلام الكامل',
          ordered_quantity: '6',
          unit_price: '50',
          expense_gl_account_id: expGl,
        },
      ],
      created_by: userId,
    });
    const app = await approvePoInTx(c, po, userId);
    const pl = (await listPurchaseOrderLines(c, app.id))[0]!;
    const rc = await createPurchaseReceipt(c, {
      purchase_order_id: app.id,
      receipt_date: fiscal.entryDate,
      received_by: userId,
      lines: [{ purchase_order_line_id: pl.id, received_quantity: '6', accepted_quantity: '6' }],
      created_by: userId,
    });
    await postPurchaseReceipt(c, {
      id: rc.id,
      userId,
      version: rc.version,
      updated_at: rc.updated_at,
    });
    return app;
  });
  {
    const st = await query(`SELECT status FROM accounts.purchase_orders WHERE id=$1`, [poFull.id]);
    if (st.rows[0]?.status === 'RECEIVED') ok('17) PO RECEIVED بعد استلام كامل');
    else fail('17) PO RECEIVED', st.rows[0]);
  }

  // 18) VOID draft receipt
  {
    const draftRc = await withTransaction(async (c) => {
      const po = await createPurchaseOrder(c, {
        supplier_account_id: account.id,
        order_date: fiscal.entryDate,
        lines: [
          {
            purchase_kind: 'SERVICE',
            description: 'void draft',
            ordered_quantity: '2',
            unit_price: '10',
            expense_gl_account_id: expGl,
          },
        ],
        created_by: userId,
      });
      const app = await approvePoInTx(c, po, userId);
      return createPurchaseReceipt(c, {
        purchase_order_id: app.id,
        receipt_date: fiscal.entryDate,
        received_by: userId,
        lines: [
          {
            purchase_order_line_id: (await listPurchaseOrderLines(c, app.id))[0]!.id,
            received_quantity: '1',
            accepted_quantity: '1',
          },
        ],
        created_by: userId,
      });
    });
    const voided = await withTransaction((c) =>
      voidPurchaseReceipt(c, {
        id: draftRc.id,
        userId,
        version: draftRc.version,
        updated_at: draftRc.updated_at,
      })
    );
    if (voided.status === 'VOID') ok('18) VOID محضر DRAFT');
    else fail('18) VOID draft', voided.status);
  }

  // 19-21) invoice from PO, over-invoice, tolerance
  const poInv = await withTransaction(async (c) => {
    const po = await createPurchaseOrder(c, {
      supplier_account_id: account.id,
      order_date: fiscal.entryDate,
      lines: [
        {
          purchase_kind: 'SERVICE',
          description: 'للفوترة',
          ordered_quantity: '8',
          unit_price: '100',
          expense_gl_account_id: expGl,
        },
      ],
      created_by: userId,
    });
    const app = await approvePoInTx(c, po, userId);
    const pl = (await listPurchaseOrderLines(c, app.id))[0]!;
    const rc = await createPurchaseReceipt(c, {
      purchase_order_id: app.id,
      receipt_date: fiscal.entryDate,
      received_by: userId,
      lines: [{ purchase_order_line_id: pl.id, received_quantity: '8', accepted_quantity: '8' }],
      created_by: userId,
    });
    await postPurchaseReceipt(c, {
      id: rc.id,
      userId,
      version: rc.version,
      updated_at: rc.updated_at,
    });
    return { po: app, line: pl };
  });

  const invDraft = await withTransaction((c) =>
    createSupplierInvoiceFromPurchaseOrder(c, {
      purchase_order_id: poInv.po.id,
      supplier_invoice_number: `VINV-${suffix}-1`,
      invoice_date: fiscal.entryDate,
      lines: [{ purchase_order_line_id: poInv.line.id, quantity: '5', unit_price: '100' }],
      created_by: userId,
    })
  );
  if (invDraft.invoice.invoice_source === 'PURCHASE_ORDER') ok('19) createSupplierInvoiceFromPurchaseOrder');
  else fail('19) PO invoice', invDraft.invoice);

  await expectHttp(
    '20) رفض over-invoice',
    () =>
      withTransaction((c) =>
        createSupplierInvoiceFromPurchaseOrder(c, {
          purchase_order_id: poInv.po.id,
          supplier_invoice_number: `VINV-${suffix}-OVER`,
          invoice_date: fiscal.entryDate,
          lines: [{ purchase_order_line_id: poInv.line.id, quantity: '20', unit_price: '100' }],
          created_by: userId,
        })
      ),
    409,
    'تتجاوز المتاح'
  );

  await expectHttp(
    '21) رفض سعر خارج التسامح',
    () =>
      withTransaction((c) =>
        createSupplierInvoiceFromPurchaseOrder(c, {
          purchase_order_id: poInv.po.id,
          supplier_invoice_number: `VINV-${suffix}-PRICE`,
          invoice_date: fiscal.entryDate,
          lines: [{ purchase_order_line_id: poInv.line.id, quantity: '1', unit_price: '150' }],
          created_by: userId,
        })
      ),
    409,
    'التسامح'
  );

  if (isPriceWithinTolerance('100', '100', 0) && !isPriceWithinTolerance('100', '120', 5)) {
    ok('22) isPriceWithinTolerance');
  } else fail('22) tolerance helper');

  const invPosted = await withTransaction(async (c) => {
    await acquireJournalEntriesLock(c);
    const r = await postSupplierInvoice(c, {
      id: invDraft.invoice.id,
      userId,
      version: invDraft.invoice.version,
      updated_at: invDraft.invoice.updated_at,
    });
    return r.invoice;
  });
  if (invPosted.status === 'POSTED' && invPosted.journal_entry_id) ok('23) POST فاتورة PO → JE');
  else fail('23) POST invoice', invPosted);

  {
    const pl = await query(
      `SELECT invoiced_quantity::text AS q FROM accounts.purchase_order_lines WHERE id=$1`,
      [poInv.line.id]
    );
    const led = await withTransaction((c) =>
      getSupplierLedger(c, { supplierAccountId: account.id, page: 1, page_size: 20 })
    );
    const entry = led.rows.find(
      (r) => r.entry_type === 'INVOICE' && r.source_id === invPosted.id
    );
    if (moneyEquals(String(pl.rows[0]?.q), '5.000') && entry && moneyEquals(entry.credit_amount, invPosted.total_amount)) {
      ok('24) invoiced_qty + supplier ledger INVOICE');
    } else fail('24) post effects', { pl: pl.rows[0], entry });
  }

  const invVoided = await withTransaction(async (c) => {
    await acquireJournalEntriesLock(c);
    const r = await voidSupplierInvoice(c, {
      id: invPosted.id,
      userId,
      version: invPosted.version,
      updated_at: invPosted.updated_at,
      reason: 'اختبار عكس',
    });
    return r;
  });
  {
    const pl = await query(
      `SELECT invoiced_quantity::text AS q FROM accounts.purchase_order_lines WHERE id=$1`,
      [poInv.line.id]
    );
    if (invVoided.status === 'VOID' && moneyEquals(String(pl.rows[0]?.q), '0.000')) {
      ok('25) void invoice يعكس invoiced_qty');
    } else fail('25) void invoice qty', { inv: invVoided.status, pl: pl.rows[0] });
  }

  // 26) block VOID receipt if invoiced
  {
    const pack = await withTransaction(async (c) => {
      const po = await createPurchaseOrder(c, {
        supplier_account_id: account.id,
        order_date: fiscal.entryDate,
        lines: [
          {
            purchase_kind: 'SERVICE',
            description: 'block void rc',
            ordered_quantity: '4',
            unit_price: '30',
            expense_gl_account_id: expGl,
          },
        ],
        created_by: userId,
      });
      const app = await approvePoInTx(c, po, userId);
      const pl = (await listPurchaseOrderLines(c, app.id))[0]!;
      const rc = await createPurchaseReceipt(c, {
        purchase_order_id: app.id,
        receipt_date: fiscal.entryDate,
        received_by: userId,
        lines: [{ purchase_order_line_id: pl.id, received_quantity: '4', accepted_quantity: '4' }],
        created_by: userId,
      });
      const posted = await postPurchaseReceipt(c, {
        id: rc.id,
        userId,
        version: rc.version,
        updated_at: rc.updated_at,
      });
      const inv = await createSupplierInvoiceFromPurchaseOrder(c, {
        purchase_order_id: app.id,
        supplier_invoice_number: `VINV-${suffix}-BLK`,
        invoice_date: fiscal.entryDate,
        lines: [{ purchase_order_line_id: pl.id, quantity: '4', unit_price: '30' }],
        created_by: userId,
      });
      await acquireJournalEntriesLock(c);
      await postSupplierInvoice(c, {
        id: inv.invoice.id,
        userId,
        version: inv.invoice.version,
        updated_at: inv.invoice.updated_at,
      });
      return posted.receipt;
    });
    await expectHttp(
      '26) منع VOID محضر مفوتر',
      () =>
        withTransaction((c) =>
          voidPurchaseReceipt(c, {
            id: pack.id,
            userId,
            version: pack.version,
            updated_at: pack.updated_at,
            reason: 'محاولة',
          })
        ),
      409,
      'المفوترة'
    );
  }

  // 27) fault after_po_update
  {
    const faultPo = await withTransaction(async (c) => {
      const po = await createPurchaseOrder(c, {
        supplier_account_id: account.id,
        order_date: fiscal.entryDate,
        lines: [
          {
            purchase_kind: 'SERVICE',
            description: 'fault',
            ordered_quantity: '2',
            unit_price: '10',
            expense_gl_account_id: expGl,
          },
        ],
        created_by: userId,
      });
      return approvePoInTx(c, po, userId);
    });
    const pl = (await withTransaction((c) => listPurchaseOrderLines(c, faultPo.id)))[0]!;
    const rc = await withTransaction((c) =>
      createPurchaseReceipt(c, {
        purchase_order_id: faultPo.id,
        receipt_date: fiscal.entryDate,
        received_by: userId,
        lines: [{ purchase_order_line_id: pl.id, received_quantity: '1', accepted_quantity: '1' }],
        created_by: userId,
      })
    );
    setPurchaseReceiptPostFaultForTests('after_po_update');
    try {
      await withTransaction((c) =>
        postPurchaseReceipt(c, {
          id: rc.id,
          userId,
          version: rc.version,
          updated_at: rc.updated_at,
        })
      );
      fail('27) fault — توقّعنا فشلًا');
    } catch {
      const st = await query(`SELECT status FROM accounts.purchase_receipts WHERE id=$1`, [rc.id]);
      const plAfter = await query(
        `SELECT received_quantity::text r FROM accounts.purchase_order_lines WHERE id=$1`,
        [pl.id]
      );
      if (st.rows[0]?.status === 'DRAFT' && moneyEquals(String(plAfter.rows[0]?.r), '0.000')) {
        ok('27) fault after_po_update — rollback');
      } else fail('27) fault leftover', { st: st.rows[0], pl: plAfter.rows[0] });
    } finally {
      setPurchaseReceiptPostFaultForTests(null);
    }
  }

  // 28) concurrent POs on same req line
  {
    const req = await withTransaction(async (c) => {
      const r = await createPurchaseRequisition(c, {
        requisition_date: fiscal.entryDate,
        requested_by: userId,
        justification: 'concurrent PO',
        lines: [reqLine(expGl, '10', '20')],
        created_by: userId,
      });
      const s = await submitPurchaseRequisition(c, {
        id: r.id,
        userId,
        version: r.version,
        updated_at: r.updated_at,
      });
      return approvePurchaseRequisition(c, {
        id: s.id,
        userId,
        version: s.version,
        updated_at: s.updated_at,
      });
    });
    const rl = (await withTransaction((c) => listPurchaseRequisitionLines(c, req.id)))[0]!;
    const results = await Promise.allSettled([
      withTransaction((c) =>
        createPurchaseOrderFromRequisition(c, {
          requisitionId: req.id,
          supplier_account_id: account.id,
          order_date: fiscal.entryDate,
          lines: [{ requisition_line_id: rl.id, ordered_quantity: '10' }],
          userId,
        })
      ),
      withTransaction((c) =>
        createPurchaseOrderFromRequisition(c, {
          requisitionId: req.id,
          supplier_account_id: account.id,
          order_date: fiscal.entryDate,
          lines: [{ requisition_line_id: rl.id, ordered_quantity: '10' }],
          userId,
        })
      ),
    ]);
    const okN = results.filter((r) => r.status === 'fulfilled').length;
    const badN = results.filter((r) => r.status === 'rejected').length;
    const ord = await query(
      `SELECT ordered_quantity::text AS o FROM accounts.purchase_requisition_lines WHERE id=$1`,
      [rl.id]
    );
    if (okN === 1 && badN === 1 && moneyEquals(String(ord.rows[0]?.o), '10.000')) {
      ok(`28) concurrent POs — نجاح=${okN} رفض=${badN}`);
    } else fail('28) concurrent POs', { okN, badN, ord: ord.rows[0] });
  }

  // 29) concurrent receipts
  {
    const po = await withTransaction(async (c) => {
      const p = await createPurchaseOrder(c, {
        supplier_account_id: account.id,
        order_date: fiscal.entryDate,
        lines: [
          {
            purchase_kind: 'SERVICE',
            description: 'conc rc',
            ordered_quantity: '5',
            unit_price: '20',
            expense_gl_account_id: expGl,
          },
        ],
        created_by: userId,
      });
      return approvePoInTx(c, p, userId);
    });
    const pl = (await withTransaction((c) => listPurchaseOrderLines(c, po.id)))[0]!;
    const rc1 = await withTransaction((c) =>
      createPurchaseReceipt(c, {
        purchase_order_id: po.id,
        receipt_date: fiscal.entryDate,
        received_by: userId,
        lines: [{ purchase_order_line_id: pl.id, received_quantity: '5', accepted_quantity: '5' }],
        created_by: userId,
      })
    );
    const rc2 = await withTransaction((c) =>
      createPurchaseReceipt(c, {
        purchase_order_id: po.id,
        receipt_date: fiscal.entryDate,
        received_by: userId,
        lines: [{ purchase_order_line_id: pl.id, received_quantity: '5', accepted_quantity: '5' }],
        created_by: userId,
      })
    );
    const results = await Promise.allSettled([
      withTransaction((c) =>
        postPurchaseReceipt(c, {
          id: rc1.id,
          userId,
          version: rc1.version,
          updated_at: rc1.updated_at,
        })
      ),
      withTransaction((c) =>
        postPurchaseReceipt(c, {
          id: rc2.id,
          userId,
          version: rc2.version,
          updated_at: rc2.updated_at,
        })
      ),
    ]);
    const okN = results.filter((r) => r.status === 'fulfilled').length;
    const badN = results.filter((r) => r.status === 'rejected').length;
    const recv = await query(
      `SELECT received_quantity::text r FROM accounts.purchase_order_lines WHERE id=$1`,
      [pl.id]
    );
    if (okN === 1 && badN === 1 && moneyEquals(String(recv.rows[0]?.r), '5.000')) {
      ok(`29) concurrent receipts — نجاح=${okN} رفض=${badN}`);
    } else fail('29) concurrent receipts', { okN, badN, recv: recv.rows[0] });
  }

  // 30) concurrent invoices
  {
    const invPo = await withTransaction(async (c) => {
      const p = await createPurchaseOrder(c, {
        supplier_account_id: account.id,
        order_date: fiscal.entryDate,
        lines: [
          {
            purchase_kind: 'SERVICE',
            description: 'conc inv',
            ordered_quantity: '4',
            unit_price: '25',
            expense_gl_account_id: expGl,
          },
        ],
        created_by: userId,
      });
      const app = await approvePoInTx(c, p, userId);
      const pl = (await listPurchaseOrderLines(c, app.id))[0]!;
      const rc = await createPurchaseReceipt(c, {
        purchase_order_id: app.id,
        receipt_date: fiscal.entryDate,
        received_by: userId,
        lines: [{ purchase_order_line_id: pl.id, received_quantity: '4', accepted_quantity: '4' }],
        created_by: userId,
      });
      await postPurchaseReceipt(c, {
        id: rc.id,
        userId,
        version: rc.version,
        updated_at: rc.updated_at,
      });
      return { poId: app.id, lineId: pl.id };
    });
    const draft1 = await withTransaction((c) =>
      createSupplierInvoiceFromPurchaseOrder(c, {
        purchase_order_id: invPo.poId,
        supplier_invoice_number: `VINV-${suffix}-C1`,
        invoice_date: fiscal.entryDate,
        lines: [{ purchase_order_line_id: invPo.lineId, quantity: '4', unit_price: '25' }],
        created_by: userId,
      })
    );
    const draft2 = await withTransaction((c) =>
      createSupplierInvoiceFromPurchaseOrder(c, {
        purchase_order_id: invPo.poId,
        supplier_invoice_number: `VINV-${suffix}-C2`,
        invoice_date: fiscal.entryDate,
        lines: [{ purchase_order_line_id: invPo.lineId, quantity: '4', unit_price: '25' }],
        created_by: userId,
      })
    );
    const results = await Promise.allSettled([
      withTransaction(async (c) => {
        await acquireJournalEntriesLock(c);
        return postSupplierInvoice(c, {
          id: draft1.invoice.id,
          userId,
          version: draft1.invoice.version,
          updated_at: draft1.invoice.updated_at,
        });
      }),
      withTransaction(async (c) => {
        await acquireJournalEntriesLock(c);
        return postSupplierInvoice(c, {
          id: draft2.invoice.id,
          userId,
          version: draft2.invoice.version,
          updated_at: draft2.invoice.updated_at,
        });
      }),
    ]);
    const okN = results.filter((r) => r.status === 'fulfilled').length;
    const badN = results.filter((r) => r.status === 'rejected').length;
    if (okN === 1 && badN === 1) ok(`30) concurrent invoices — نجاح=${okN} رفض=${badN}`);
    else fail('30) concurrent invoices', { okN, badN });
  }

  // 31) listMatchablePoLines
  {
    const lines = await withTransaction((c) => listMatchablePoLines(c, poFull.id));
    if (lines.length >= 1 && moneyIsPositiveSafe(lines[0]!.available_to_invoice)) {
      ok('31) listMatchablePoLines');
    } else fail('31) matchable lines', lines);
  }

  // 32) reject PO reverses req qty
  {
    const req = await withTransaction(async (c) => {
      const r = await createPurchaseRequisition(c, {
        requisition_date: fiscal.entryDate,
        requested_by: userId,
        justification: 'reject PO',
        lines: [reqLine(expGl, '6', '10')],
        created_by: userId,
      });
      const s = await submitPurchaseRequisition(c, {
        id: r.id,
        userId,
        version: r.version,
        updated_at: r.updated_at,
      });
      return approvePurchaseRequisition(c, {
        id: s.id,
        userId,
        version: s.version,
        updated_at: s.updated_at,
      });
    });
    const rl = (await withTransaction((c) => listPurchaseRequisitionLines(c, req.id)))[0]!;
    const po = await withTransaction((c) =>
      createPurchaseOrderFromRequisition(c, {
        requisitionId: req.id,
        supplier_account_id: account.id,
        order_date: fiscal.entryDate,
        lines: [{ requisition_line_id: rl.id, ordered_quantity: '6' }],
        userId,
      })
    );
    const sub = await withTransaction((c) =>
      submitPurchaseOrder(c, { id: po.id, userId, version: po.version, updated_at: po.updated_at })
    );
    await withTransaction((c) =>
      rejectPurchaseOrder(c, {
        id: sub.id,
        userId,
        version: sub.version,
        updated_at: sub.updated_at,
        reason: 'رفض',
      })
    );
    const ord = await query(
      `SELECT ordered_quantity::text o FROM accounts.purchase_requisition_lines WHERE id=$1`,
      [rl.id]
    );
    if (moneyEquals(String(ord.rows[0]?.o), '0.000')) ok('32) reject PO يعكس ordered على الطلب');
    else fail('32) reject PO reverse', ord.rows[0]);
  }

  // 33) capabilities
  {
    const viewerId = await upsertCapabilityTestUser(`pur-view-${suffix}`);
    const clerkId = await upsertCapabilityTestUser(`pur-clerk-${suffix}`);
    await grantAccountsPlatformRole(viewerId, ACCOUNTS_VIEWER_ROLE_CODE);
    await grantAccountsPlatformRole(clerkId, ACCOUNTS_CLERK_ROLE_CODE);
    const viewerView = await hasPurchasingCapability(null, viewerId, PURCHASING_CAPABILITIES.REQ_VIEW);
    const viewerApprove = await hasPurchasingCapability(
      null,
      viewerId,
      PURCHASING_CAPABILITIES.REQ_APPROVE
    );
    const clerkPrepare = await hasPurchasingCapability(
      null,
      clerkId,
      PURCHASING_CAPABILITIES.PO_PREPARE
    );
    const clerkPostRc = await hasPurchasingCapability(
      null,
      clerkId,
      PURCHASING_CAPABILITIES.RECEIPT_POST
    );
    const adminPostRc = await hasPurchasingCapability(
      null,
      userId,
      PURCHASING_CAPABILITIES.RECEIPT_POST
    );
    if (viewerView && !viewerApprove && clerkPrepare && !clerkPostRc && adminPostRc) {
      ok('33) صلاحيات viewer/clerk/admin');
    } else {
      fail('33) capabilities', {
        viewerView,
        viewerApprove,
        clerkPrepare,
        clerkPostRc,
        adminPostRc,
      });
    }
    await expectHttp(
      '34) assertPurchasingCapability 403',
      () => assertPurchasingCapability(null, viewerId, PURCHASING_CAPABILITIES.RECEIPT_POST),
      403
    );
  }

  // 35) verifyPurchasing
  {
    const v = await withTransaction((c) => verifyPurchasing(c));
    if (v.ok) ok('35) verifyPurchasing');
    else fail('35) verifyPurchasing', v.mismatches.slice(0, 5));
  }

  // 36) verifySupplierPayables still ok
  {
    const v = await withTransaction((c) => verifySupplierPayables(c));
    if (v.ok || (verifyPayablesBaseline.ok && !hasUnexplainedGlActivity(v))) {
      ok('36) verifySupplierPayables لا يزال سليماً');
    } else fail('36) verifySupplierPayables', v.mismatches.slice(0, 3));
  }

  // 37) print pages (fs)
  {
    const pages = [
      'app/accounts/purchasing/requisitions/[id]/print/page.tsx',
      'app/accounts/purchasing/orders/[id]/print/page.tsx',
      'app/accounts/purchasing/receipts/[id]/print/page.tsx',
    ];
    const missing = pages.filter((p) => !fs.existsSync(path.join(process.cwd(), p)));
    if (missing.length === 0) {
      ok('37) صفحات طباعة المشتريات موجودة');
    } else {
      fail('37) صفحات طباعة مفقودة', missing);
    }
  }

  // 38) lock domains
  {
    const src = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/accounts/accounting-locks.ts'),
      'utf8'
    );
    const domains = [
      'PURCHASE_REQUISITION',
      'PURCHASE_ORDER',
      'PURCHASE_RECEIPT',
      'SUPPLIER_INVOICE_MATCH',
    ];
    if (domains.every((d) => src.includes(`'${d}'`))) {
      ok('38) أقفال domains المشتريات');
    } else fail('38) lock domains');
    void purchaseRequisitionLock('x');
    void purchaseOrderLock('x');
    void purchaseOrderLineLock('x');
    void purchaseReceiptLock('x');
  }

  // 39) seed module
  {
    const seedFile = path.join(process.cwd(), 'src/scripts/seed-accounts-purchasing-demo.ts');
    if (fs.existsSync(seedFile)) ok('39) seed-accounts-purchasing-demo موجود');
    else fail('39) seed module');
  }

  // 40) cancel approved req with PO blocked
  {
    const reqRow = await query(
      `SELECT version, updated_at FROM accounts.purchase_requisitions WHERE id=$1`,
      [reqSub.id]
    );
    await expectHttp(
      '40) منع إلغاء طلب مرتبط بأمر',
      () =>
        withTransaction((c) =>
          cancelPurchaseRequisition(c, {
            id: reqSub.id,
            userId,
            version: reqRow.rows[0]!.version,
            updated_at: reqRow.rows[0]!.updated_at,
            reason: 'x',
          })
        ),
      409
    );
  }

  // 41) PO cancel without receipts
  {
    const po = await withTransaction(async (c) => {
      const p = await createPurchaseOrder(c, {
        supplier_account_id: account.id,
        order_date: fiscal.entryDate,
        lines: [
          {
            purchase_kind: 'SERVICE',
            description: 'cancel',
            ordered_quantity: '1',
            unit_price: '5',
            expense_gl_account_id: expGl,
          },
        ],
        created_by: userId,
      });
      return approvePoInTx(c, p, userId);
    });
    const cancelledPo = await withTransaction((c) =>
      cancelPurchaseOrder(c, {
        id: po.id,
        userId,
        version: po.version,
        updated_at: po.updated_at,
        reason: 'إلغاء',
      })
    );
    if (cancelledPo.status === 'CANCELLED') ok('41) إلغاء PO APPROVED بلا استلام');
    else fail('41) PO cancel', cancelledPo.status);
  }

  // 42) لا قيود يومية بعد إنشاء/تقديم/اعتماد طلب شراء (PRQ)
  let jeBefore = await query(`SELECT COUNT(*)::int n FROM accounts.journal_entries`);
  const flowReq = await withTransaction(async (c) => {
    const r = await createPurchaseRequisition(c, {
      requisition_date: fiscal.entryDate,
      requested_by: userId,
      justification: `تدفق كامل ${suffix}`,
      lines: [reqLine(expGl, '10', '15')],
      created_by: userId,
    });
    const s = await submitPurchaseRequisition(c, {
      id: r.id,
      userId,
      version: r.version,
      updated_at: r.updated_at,
    });
    return approvePurchaseRequisition(c, {
      id: s.id,
      userId,
      version: s.version,
      updated_at: s.updated_at,
    });
  });
  let jeAfter = await query(`SELECT COUNT(*)::int n FROM accounts.journal_entries`);
  if (Number(jeAfter.rows[0]?.n) === Number(jeBefore.rows[0]?.n)) {
    ok('42) لا قيود يومية بعد إنشاء/تقديم/اعتماد الطلب');
  } else fail('42) JE count PRQ', { before: jeBefore.rows[0], after: jeAfter.rows[0] });

  const flowRl = (await withTransaction((c) => listPurchaseRequisitionLines(c, flowReq.id)))[0]!;

  // 43) لا قيود يومية بعد اعتماد أمر الشراء (من الطلب)
  jeBefore = jeAfter;
  const poFlow6 = await withTransaction((c) =>
    createPurchaseOrderFromRequisition(c, {
      requisitionId: flowReq.id,
      supplier_account_id: account.id,
      order_date: fiscal.entryDate,
      lines: [{ requisition_line_id: flowRl.id, ordered_quantity: '6' }],
      userId,
    })
  );
  const poFlow6App = await approvePoFlow(poFlow6.id, userId, poFlow6.version, poFlow6.updated_at);
  jeAfter = await query(`SELECT COUNT(*)::int n FROM accounts.journal_entries`);
  if (Number(jeAfter.rows[0]?.n) === Number(jeBefore.rows[0]?.n)) {
    ok('43) لا قيود يومية بعد اعتماد أمر الشراء');
  } else fail('43) JE count PO approve', { before: jeBefore.rows[0], after: jeAfter.rows[0] });

  // 44) كمية10 → PO6: متبقي=4 وحالة الطلب PARTIALLY_ORDERED
  {
    const rl = await query(
      `SELECT ordered_quantity::text o FROM accounts.purchase_requisition_lines WHERE id=$1`,
      [flowRl.id]
    );
    const reqSt = await query(`SELECT status FROM accounts.purchase_requisitions WHERE id=$1`, [flowReq.id]);
    if (moneyEquals(String(rl.rows[0]?.o), '6.000') && reqSt.rows[0]?.status === 'PARTIALLY_ORDERED') {
      ok('44) كمية10 → PO6: متبقي=4 وحالة PARTIALLY_ORDERED');
    } else fail('44) PO6 remaining', { rl: rl.rows[0], reqSt: reqSt.rows[0] });
  }

  // 45) PO4 إضافي: متبقي=0 وحالة الطلب ORDERED
  const poFlow4 = await withTransaction((c) =>
    createPurchaseOrderFromRequisition(c, {
      requisitionId: flowReq.id,
      supplier_account_id: account.id,
      order_date: fiscal.entryDate,
      lines: [{ requisition_line_id: flowRl.id, ordered_quantity: '4' }],
      userId,
    })
  );
  const poFlow4App = await approvePoFlow(poFlow4.id, userId, poFlow4.version, poFlow4.updated_at);
  {
    const rl = await query(
      `SELECT ordered_quantity::text o FROM accounts.purchase_requisition_lines WHERE id=$1`,
      [flowRl.id]
    );
    const reqSt = await query(`SELECT status FROM accounts.purchase_requisitions WHERE id=$1`, [flowReq.id]);
    if (moneyEquals(String(rl.rows[0]?.o), '10.000') && reqSt.rows[0]?.status === 'ORDERED') {
      ok('45) PO4: متبقي=0 وحالة الطلب ORDERED');
    } else fail('45) PO4 remaining', { rl: rl.rows[0], reqSt: reqSt.rows[0] });
  }

  // 46) رفض PO1 إضافي بعد اكتمال الطلب (ORDERED لا يقبل مزيدًا من الأوامر)
  await expectHttp(
    '46) رفض PO1 إضافي (الطلب مكتمل الطلبية بالفعل)',
    () =>
      withTransaction((c) =>
        createPurchaseOrderFromRequisition(c, {
          requisitionId: flowReq.id,
          supplier_account_id: account.id,
          order_date: fiscal.entryDate,
          lines: [{ requisition_line_id: flowRl.id, ordered_quantity: '1' }],
          userId,
        })
      ),
    409
  );

  // 47) إلغاء PO4 → متبقي=4 وحالة الطلب PARTIALLY_ORDERED مجددًا
  await withTransaction((c) =>
    cancelPurchaseOrder(c, {
      id: poFlow4App.id,
      userId,
      version: poFlow4App.version,
      updated_at: poFlow4App.updated_at,
      reason: 'إلغاء لإعادة الفتح',
    })
  );
  {
    const rl = await query(
      `SELECT ordered_quantity::text o FROM accounts.purchase_requisition_lines WHERE id=$1`,
      [flowRl.id]
    );
    const reqSt = await query(`SELECT status FROM accounts.purchase_requisitions WHERE id=$1`, [flowReq.id]);
    if (moneyEquals(String(rl.rows[0]?.o), '6.000') && reqSt.rows[0]?.status === 'PARTIALLY_ORDERED') {
      ok('47) إلغاء PO4 → متبقي=4 وحالة PARTIALLY_ORDERED');
    } else fail('47) cancel PO4 reverse', { rl: rl.rows[0], reqSt: reqSt.rows[0] });
  }

  // 48) لا قيود يومية بعد ترحيل الاستلام (Receipt POST على PO6)
  jeBefore = await query(`SELECT COUNT(*)::int n FROM accounts.journal_entries`);
  await withTransaction(async (c) => {
    const pl = (await listPurchaseOrderLines(c, poFlow6App.id))[0]!;
    const rc = await createPurchaseReceipt(c, {
      purchase_order_id: poFlow6App.id,
      receipt_date: fiscal.entryDate,
      received_by: userId,
      lines: [{ purchase_order_line_id: pl.id, received_quantity: '6', accepted_quantity: '6' }],
      created_by: userId,
    });
    return postPurchaseReceipt(c, {
      id: rc.id,
      userId,
      version: rc.version,
      updated_at: rc.updated_at,
    });
  });
  jeAfter = await query(`SELECT COUNT(*)::int n FROM accounts.journal_entries`);
  if (Number(jeAfter.rows[0]?.n) === Number(jeBefore.rows[0]?.n)) {
    ok('48) لا قيود يومية بعد ترحيل الاستلام');
  } else fail('48) JE count receipt post', { before: jeBefore.rows[0], after: jeAfter.rows[0] });

  // 49) SUSPENDED يمنع إنشاء أمر شراء جديد (createPurchaseOrder وليس فقط الاعتماد)
  {
    const supRow = await query(`SELECT version, updated_at FROM accounts.suppliers WHERE id=$1`, [supplier.id]);
    await withTransaction((c) =>
      suspendSupplier(c, {
        id: supplier.id,
        userId,
        version: supRow.rows[0]!.version,
        updated_at: supRow.rows[0]!.updated_at,
      })
    );
    await expectHttp(
      '49) SUSPENDED يمنع إنشاء أمر شراء جديد',
      () =>
        withTransaction((c) =>
          createPurchaseOrder(c, {
            supplier_account_id: account.id,
            order_date: fiscal.entryDate,
            lines: [
              {
                purchase_kind: 'SERVICE',
                description: 'suspended create',
                ordered_quantity: '1',
                unit_price: '5',
                expense_gl_account_id: expGl,
              },
            ],
            created_by: userId,
          })
        ),
      409,
      'معلّق'
    );
    const supRow2 = await query(`SELECT version, updated_at FROM accounts.suppliers WHERE id=$1`, [supplier.id]);
    await withTransaction((c) =>
      activateSupplier(c, {
        id: supplier.id,
        userId,
        version: supRow2.rows[0]!.version,
        updated_at: supRow2.rows[0]!.updated_at,
      })
    );
  }

  // 50) محضر DRAFT لا يغيّر received_quantity على سطر الأمر
  {
    const po = await withTransaction(async (c) => {
      const p = await createPurchaseOrder(c, {
        supplier_account_id: account.id,
        order_date: fiscal.entryDate,
        lines: [
          {
            purchase_kind: 'SERVICE',
            description: 'draft receipt',
            ordered_quantity: '3',
            unit_price: '10',
            expense_gl_account_id: expGl,
          },
        ],
        created_by: userId,
      });
      return approvePoInTx(c, p, userId);
    });
    const pl = (await withTransaction((c) => listPurchaseOrderLines(c, po.id)))[0]!;
    await withTransaction((c) =>
      createPurchaseReceipt(c, {
        purchase_order_id: po.id,
        receipt_date: fiscal.entryDate,
        received_by: userId,
        lines: [{ purchase_order_line_id: pl.id, received_quantity: '2', accepted_quantity: '2' }],
        created_by: userId,
      })
    );
    const check = await query(
      `SELECT received_quantity::text r FROM accounts.purchase_order_lines WHERE id=$1`,
      [pl.id]
    );
    if (moneyEquals(String(check.rows[0]?.r), '0.000')) {
      ok('50) محضر DRAFT لا يغيّر received_quantity');
    } else fail('50) DRAFT receipt qty', check.rows[0]);
  }

  // 51) SERVICE استلام جزئي عشري 0.5 من 1.0 ثم POST
  {
    const po = await withTransaction(async (c) => {
      const p = await createPurchaseOrder(c, {
        supplier_account_id: account.id,
        order_date: fiscal.entryDate,
        lines: [
          {
            purchase_kind: 'SERVICE',
            description: 'خدمة عشرية',
            unit_of_measure: 'JOB',
            ordered_quantity: '1.000',
            unit_price: '200',
            expense_gl_account_id: expGl,
          },
        ],
        created_by: userId,
      });
      return approvePoInTx(c, p, userId);
    });
    const pl = (await withTransaction((c) => listPurchaseOrderLines(c, po.id)))[0]!;
    const posted = await withTransaction(async (c) => {
      const rc = await createPurchaseReceipt(c, {
        purchase_order_id: po.id,
        receipt_date: fiscal.entryDate,
        received_by: userId,
        lines: [{ purchase_order_line_id: pl.id, received_quantity: '0.5', accepted_quantity: '0.5' }],
        created_by: userId,
      });
      return postPurchaseReceipt(c, {
        id: rc.id,
        userId,
        version: rc.version,
        updated_at: rc.updated_at,
      });
    });
    const check = await query(
      `SELECT received_quantity::text r, status FROM accounts.purchase_order_lines WHERE id=$1`,
      [pl.id]
    );
    if (
      posted.receipt.status === 'POSTED' &&
      moneyEquals(String(check.rows[0]?.r), '0.500') &&
      check.rows[0]?.status === 'PARTIALLY_RECEIVED'
    ) {
      ok('51) SERVICE استلام جزئي عشري 0.5/1.0 POST');
    } else fail('51) service partial', { posted: posted.receipt.status, check: check.rows[0] });
  }

  // 52) fault after_first_po_line — rollback كامل (المحضر يبقى DRAFT وكمية الأمر بلا تغيير)
  {
    const po = await withTransaction(async (c) => {
      const p = await createPurchaseOrder(c, {
        supplier_account_id: account.id,
        order_date: fiscal.entryDate,
        lines: [
          {
            purchase_kind: 'SERVICE',
            description: 'fault first line',
            ordered_quantity: '2',
            unit_price: '10',
            expense_gl_account_id: expGl,
          },
        ],
        created_by: userId,
      });
      return approvePoInTx(c, p, userId);
    });
    const pl = (await withTransaction((c) => listPurchaseOrderLines(c, po.id)))[0]!;
    const rc = await withTransaction((c) =>
      createPurchaseReceipt(c, {
        purchase_order_id: po.id,
        receipt_date: fiscal.entryDate,
        received_by: userId,
        lines: [{ purchase_order_line_id: pl.id, received_quantity: '1', accepted_quantity: '1' }],
        created_by: userId,
      })
    );
    setPurchaseReceiptPostFaultForTests('after_first_po_line');
    try {
      await withTransaction((c) =>
        postPurchaseReceipt(c, {
          id: rc.id,
          userId,
          version: rc.version,
          updated_at: rc.updated_at,
        })
      );
      fail('52) fault after_first_po_line — توقّعنا فشلًا');
    } catch {
      const st = await query(`SELECT status FROM accounts.purchase_receipts WHERE id=$1`, [rc.id]);
      const plAfter = await query(
        `SELECT received_quantity::text r FROM accounts.purchase_order_lines WHERE id=$1`,
        [pl.id]
      );
      if (st.rows[0]?.status === 'DRAFT' && moneyEquals(String(plAfter.rows[0]?.r), '0.000')) {
        ok('52) fault after_first_po_line — rollback');
      } else fail('52) fault leftover', { st: st.rows[0], pl: plAfter.rows[0] });
    } finally {
      setPurchaseReceiptPostFaultForTests(null);
    }
  }

  // 53-55) فاتورة DRAFT لا تحجز، فاتورتان DRAFT معًا، POST الأولى ينجح والثانية تُرفض
  {
    const poInvFlow = await withTransaction(async (c) => {
      const p = await createPurchaseOrder(c, {
        supplier_account_id: account.id,
        order_date: fiscal.entryDate,
        lines: [
          {
            purchase_kind: 'SERVICE',
            description: 'invoice draft test',
            ordered_quantity: '4',
            unit_price: '25',
            expense_gl_account_id: expGl,
          },
        ],
        created_by: userId,
      });
      const app = await approvePoInTx(c, p, userId);
      const pl = (await listPurchaseOrderLines(c, app.id))[0]!;
      const rc = await createPurchaseReceipt(c, {
        purchase_order_id: app.id,
        receipt_date: fiscal.entryDate,
        received_by: userId,
        lines: [{ purchase_order_line_id: pl.id, received_quantity: '4', accepted_quantity: '4' }],
        created_by: userId,
      });
      await postPurchaseReceipt(c, {
        id: rc.id,
        userId,
        version: rc.version,
        updated_at: rc.updated_at,
      });
      return { poId: app.id, lineId: pl.id };
    });

    const draftA = await withTransaction((c) =>
      createSupplierInvoiceFromPurchaseOrder(c, {
        purchase_order_id: poInvFlow.poId,
        supplier_invoice_number: `VINV-${suffix}-DA`,
        invoice_date: fiscal.entryDate,
        lines: [{ purchase_order_line_id: poInvFlow.lineId, quantity: '3', unit_price: '25' }],
        created_by: userId,
      })
    );
    {
      const q = await query(
        `SELECT invoiced_quantity::text q FROM accounts.purchase_order_lines WHERE id=$1`,
        [poInvFlow.lineId]
      );
      if (moneyEquals(String(q.rows[0]?.q), '0.000')) {
        ok('53) فاتورة DRAFT لا تغيّر invoiced_quantity');
      } else fail('53) draft invoice qty', q.rows[0]);
    }

    const draftB = await withTransaction((c) =>
      createSupplierInvoiceFromPurchaseOrder(c, {
        purchase_order_id: poInvFlow.poId,
        supplier_invoice_number: `VINV-${suffix}-DB`,
        invoice_date: fiscal.entryDate,
        lines: [{ purchase_order_line_id: poInvFlow.lineId, quantity: '3', unit_price: '25' }],
        created_by: userId,
      })
    );
    if (draftA.invoice.status === 'DRAFT' && draftB.invoice.status === 'DRAFT') {
      ok('54) فاتورتان DRAFT معًا على نفس الكمية بدون خطأ');
    } else fail('54) two drafts', { a: draftA.invoice.status, b: draftB.invoice.status });

    const postedA = await withTransaction(async (c) => {
      await acquireJournalEntriesLock(c);
      const r = await postSupplierInvoice(c, {
        id: draftA.invoice.id,
        userId,
        version: draftA.invoice.version,
        updated_at: draftA.invoice.updated_at,
      });
      return r.invoice;
    });
    let postBFailed = false;
    try {
      await withTransaction(async (c) => {
        await acquireJournalEntriesLock(c);
        return postSupplierInvoice(c, {
          id: draftB.invoice.id,
          userId,
          version: draftB.invoice.version,
          updated_at: draftB.invoice.updated_at,
        });
      });
    } catch (e) {
      postBFailed = e instanceof AccountsHttpError && e.status === 409;
    }
    if (postedA.status === 'POSTED' && postBFailed) {
      ok('55) POST الأولى ينجح والثانية تُرفض (تجاوز المتاح)');
    } else fail('55) one post wins', { postedA: postedA.status, postBFailed });
  }

  // 56) فاتورة بسطرين بحسابي مصروف مختلفين
  {
    const poMulti = await withTransaction(async (c) => {
      const p = await createPurchaseOrder(c, {
        supplier_account_id: account.id,
        order_date: fiscal.entryDate,
        lines: [
          {
            purchase_kind: 'SERVICE',
            description: 'سطر1',
            ordered_quantity: '2',
            unit_price: '50',
            expense_gl_account_id: expGl,
          },
          {
            purchase_kind: 'SERVICE',
            description: 'سطر2',
            ordered_quantity: '3',
            unit_price: '30',
            expense_gl_account_id: expGl2,
          },
        ],
        created_by: userId,
      });
      const app = await approvePoInTx(c, p, userId);
      const lines = await listPurchaseOrderLines(c, app.id);
      for (const l of lines) {
        const rc = await createPurchaseReceipt(c, {
          purchase_order_id: app.id,
          receipt_date: fiscal.entryDate,
          received_by: userId,
          lines: [{ purchase_order_line_id: l.id, received_quantity: l.ordered_quantity, accepted_quantity: l.ordered_quantity }],
          created_by: userId,
        });
        await postPurchaseReceipt(c, {
          id: rc.id,
          userId,
          version: rc.version,
          updated_at: rc.updated_at,
        });
      }
      return { poId: app.id, lines };
    });
    const inv = await withTransaction((c) =>
      createSupplierInvoiceFromPurchaseOrder(c, {
        purchase_order_id: poMulti.poId,
        supplier_invoice_number: `VINV-${suffix}-MULTI`,
        invoice_date: fiscal.entryDate,
        lines: poMulti.lines.map((l) => ({
          purchase_order_line_id: l.id,
          quantity: l.ordered_quantity,
          unit_price: l.unit_price,
        })),
        created_by: userId,
      })
    );
    const glSet = new Set(inv.lines.map((l) => l.expense_gl_account_id));
    if (inv.lines.length === 2 && glSet.size === 2) {
      ok('56) فاتورة بسطرين بحسابي مصروف مختلفين');
    } else fail('56) multi-line invoice GLs', inv.lines.map((l) => l.expense_gl_account_id));
  }

  // 57-58) closePurchaseOrder يرفض مع كمية مفتوحة ثم ينجح بعد استلام كامل
  {
    const po = await withTransaction(async (c) => {
      const p = await createPurchaseOrder(c, {
        supplier_account_id: account.id,
        order_date: fiscal.entryDate,
        lines: [
          {
            purchase_kind: 'SERVICE',
            description: 'close test',
            ordered_quantity: '5',
            unit_price: '10',
            expense_gl_account_id: expGl,
          },
        ],
        created_by: userId,
      });
      return approvePoInTx(c, p, userId);
    });
    await expectHttp(
      '57) closePurchaseOrder يرفض مع كمية استلام مفتوحة',
      () =>
        withTransaction((c) =>
          closePurchaseOrder(c, { id: po.id, userId, version: po.version, updated_at: po.updated_at })
        ),
      409,
      'كميات مفتوحة'
    );
    const pl = (await withTransaction((c) => listPurchaseOrderLines(c, po.id)))[0]!;
    await withTransaction(async (c) => {
      const rc = await createPurchaseReceipt(c, {
        purchase_order_id: po.id,
        receipt_date: fiscal.entryDate,
        received_by: userId,
        lines: [{ purchase_order_line_id: pl.id, received_quantity: '5', accepted_quantity: '5' }],
        created_by: userId,
      });
      return postPurchaseReceipt(c, {
        id: rc.id,
        userId,
        version: rc.version,
        updated_at: rc.updated_at,
      });
    });
    const poRow = await query(`SELECT version, updated_at FROM accounts.purchase_orders WHERE id=$1`, [po.id]);
    const closed = await withTransaction((c) =>
      closePurchaseOrder(c, {
        id: po.id,
        userId,
        version: poRow.rows[0]!.version,
        updated_at: poRow.rows[0]!.updated_at,
      })
    );
    if (closed.status === 'CLOSED') ok('58) closePurchaseOrder ينجح بعد استلام كامل');
    else fail('58) close after full receive', closed.status);
  }

  // 59) verifyPurchasing({ strict: true })
  {
    const v = await withTransaction((c) => verifyPurchasing(c, { strict: true }));
    if (v.ok) ok('59) verifyPurchasing({ strict: true })');
    else fail('59) verifyPurchasing strict', v.mismatches.slice(0, 5));
  }

  // 60) رفض اعتماد طلب REJECTED
  {
    const req = await withTransaction(async (c) => {
      const r = await createPurchaseRequisition(c, {
        requisition_date: fiscal.entryDate,
        requested_by: userId,
        justification: 'REJECTED then approve',
        lines: [reqLine(expGl, '1', '5')],
        created_by: userId,
      });
      return submitPurchaseRequisition(c, {
        id: r.id,
        userId,
        version: r.version,
        updated_at: r.updated_at,
      });
    });
    const rejected = await withTransaction((c) =>
      rejectPurchaseRequisition(c, {
        id: req.id,
        userId,
        version: req.version,
        updated_at: req.updated_at,
        reason: 'اختبار',
      })
    );
    await expectHttp(
      '60) رفض اعتماد طلب REJECTED',
      () =>
        withTransaction((c) =>
          approvePurchaseRequisition(c, {
            id: rejected.id,
            userId,
            version: rejected.version,
            updated_at: rejected.updated_at,
          })
        ),
      409
    );
  }

  // 61) رفض تقديم أمر شراء بلا سطور
  {
    const po = await withTransaction((c) =>
      createPurchaseOrder(c, {
        supplier_account_id: account.id,
        order_date: fiscal.entryDate,
        lines: [
          {
            purchase_kind: 'SERVICE',
            description: 'no lines test',
            ordered_quantity: '1',
            unit_price: '1',
            expense_gl_account_id: expGl,
          },
        ],
        created_by: userId,
      })
    );
    await query(`DELETE FROM accounts.purchase_order_lines WHERE purchase_order_id=$1`, [po.id]);
    await expectHttp(
      '61) رفض تقديم أمر شراء بلا سطور',
      () =>
        withTransaction((c) =>
          submitPurchaseOrder(c, { id: po.id, userId, version: po.version, updated_at: po.updated_at })
        ),
      409,
      'بلا سطور'
    );
  }

  // 62) رفض سعر أقل خارج التسامح (نقص السعر يخضع لنفس التسامح — لا معاملة تفضيلية)
  {
    const po = await withTransaction(async (c) => {
      const p = await createPurchaseOrder(c, {
        supplier_account_id: account.id,
        order_date: fiscal.entryDate,
        lines: [
          {
            purchase_kind: 'SERVICE',
            description: 'price down',
            ordered_quantity: '2',
            unit_price: '80',
            expense_gl_account_id: expGl,
          },
        ],
        created_by: userId,
      });
      return approvePoInTx(c, p, userId);
    });
    const pl = (await withTransaction((c) => listPurchaseOrderLines(c, po.id)))[0]!;
    await withTransaction(async (c) => {
      const rc = await createPurchaseReceipt(c, {
        purchase_order_id: po.id,
        receipt_date: fiscal.entryDate,
        received_by: userId,
        lines: [{ purchase_order_line_id: pl.id, received_quantity: '2', accepted_quantity: '2' }],
        created_by: userId,
      });
      return postPurchaseReceipt(c, {
        id: rc.id,
        userId,
        version: rc.version,
        updated_at: rc.updated_at,
      });
    });
    await expectHttp(
      '62) رفض سعر أقل خارج التسامح',
      () =>
        withTransaction((c) =>
          createSupplierInvoiceFromPurchaseOrder(c, {
            purchase_order_id: po.id,
            supplier_invoice_number: `VINV-${suffix}-LOW`,
            invoice_date: fiscal.entryDate,
            lines: [{ purchase_order_line_id: pl.id, quantity: '1', unit_price: '60' }],
            created_by: userId,
          })
        ),
      409,
      'التسامح'
    );
  }

  // 63) رفض رفض(reject) طلب DRAFT — الرفض يتطلب حالة SUBMITTED
  {
    const req = await withTransaction((c) =>
      createPurchaseRequisition(c, {
        requisition_date: fiscal.entryDate,
        requested_by: userId,
        justification: 'reject draft',
        lines: [reqLine(expGl, '1', '5')],
        created_by: userId,
      })
    );
    await expectHttp(
      '63) رفض رفض(reject) طلب DRAFT',
      () =>
        withTransaction((c) =>
          rejectPurchaseRequisition(c, {
            id: req.id,
            userId,
            version: req.version,
            updated_at: req.updated_at,
            reason: 'x',
          })
        ),
      409
    );
  }

  // 64) رفض إلغاء PO له استلام (كمية مستلمة > 0)
  {
    const po = await withTransaction(async (c) => {
      const p = await createPurchaseOrder(c, {
        supplier_account_id: account.id,
        order_date: fiscal.entryDate,
        lines: [
          {
            purchase_kind: 'SERVICE',
            description: 'cancel blocked',
            ordered_quantity: '3',
            unit_price: '10',
            expense_gl_account_id: expGl,
          },
        ],
        created_by: userId,
      });
      return approvePoInTx(c, p, userId);
    });
    const pl = (await withTransaction((c) => listPurchaseOrderLines(c, po.id)))[0]!;
    await withTransaction(async (c) => {
      const rc = await createPurchaseReceipt(c, {
        purchase_order_id: po.id,
        receipt_date: fiscal.entryDate,
        received_by: userId,
        lines: [{ purchase_order_line_id: pl.id, received_quantity: '1', accepted_quantity: '1' }],
        created_by: userId,
      });
      return postPurchaseReceipt(c, {
        id: rc.id,
        userId,
        version: rc.version,
        updated_at: rc.updated_at,
      });
    });
    const poRow = await query(`SELECT version, updated_at FROM accounts.purchase_orders WHERE id=$1`, [po.id]);
    await expectHttp(
      '64) رفض إلغاء PO له استلام',
      () =>
        withTransaction((c) =>
          cancelPurchaseOrder(c, {
            id: po.id,
            userId,
            version: poRow.rows[0]!.version,
            updated_at: poRow.rows[0]!.updated_at,
            reason: 'محاولة',
          })
        ),
      409
    );
  }

  // 65) headerAmounts: subtotal/discount/tax/total محسوبة بشكل صحيح مع خصم وضريبة
  {
    const po = await withTransaction((c) =>
      createPurchaseOrder(c, {
        supplier_account_id: account.id,
        order_date: fiscal.entryDate,
        description: 'اختبار الإجماليات',
        lines: [
          {
            purchase_kind: 'SERVICE',
            description: 'سطر بخصم وضريبة',
            ordered_quantity: '3',
            unit_price: '100',
            discount_amount: '20',
            tax_amount: '10',
            expense_gl_account_id: expGl,
          },
        ],
        created_by: userId,
      })
    );
    if (
      moneyEquals(po.subtotal_amount, '300.000') &&
      moneyEquals(po.discount_amount, '20.000') &&
      moneyEquals(po.tax_amount, '10.000') &&
      moneyEquals(po.total_amount, '290.000')
    ) {
      ok('65) headerAmounts: subtotal/discount/tax/total صحيحة');
    } else fail('65) headerAmounts', po);
  }

  // 66) updatePurchaseRequisition يحدّث السطور ويعيد حساب total_estimated_amount
  {
    const req = await withTransaction((c) =>
      createPurchaseRequisition(c, {
        requisition_date: fiscal.entryDate,
        requested_by: userId,
        justification: 'update test',
        lines: [reqLine(expGl, '2', '10')],
        created_by: userId,
      })
    );
    const updated = await withTransaction((c) =>
      updatePurchaseRequisition(c, {
        id: req.id,
        userId,
        version: req.version,
        updated_at: req.updated_at,
        justification: 'update test — معدّل',
        lines: [reqLine(expGl, '5', '20')],
      })
    );
    const lines = await withTransaction((c) => listPurchaseRequisitionLines(c, req.id));
    if (
      updated.justification === 'update test — معدّل' &&
      moneyEquals(updated.total_estimated_amount, '100.000') &&
      lines.length === 1 &&
      moneyEquals(lines[0]!.estimated_total, '100.000')
    ) {
      ok('66) updatePurchaseRequisition يحدّث السطور ويعيد الحساب');
    } else fail('66) updatePurchaseRequisition', { updated, lines });
  }

  // 67) fault after_po_reverse عند VOID محضر مرحّل — rollback كامل
  {
    const po = await withTransaction(async (c) => {
      const p = await createPurchaseOrder(c, {
        supplier_account_id: account.id,
        order_date: fiscal.entryDate,
        lines: [
          {
            purchase_kind: 'SERVICE',
            description: 'void fault',
            ordered_quantity: '3',
            unit_price: '10',
            expense_gl_account_id: expGl,
          },
        ],
        created_by: userId,
      });
      return approvePoInTx(c, p, userId);
    });
    const pl = (await withTransaction((c) => listPurchaseOrderLines(c, po.id)))[0]!;
    const posted = await withTransaction(async (c) => {
      const rc = await createPurchaseReceipt(c, {
        purchase_order_id: po.id,
        receipt_date: fiscal.entryDate,
        received_by: userId,
        lines: [{ purchase_order_line_id: pl.id, received_quantity: '3', accepted_quantity: '3' }],
        created_by: userId,
      });
      return postPurchaseReceipt(c, {
        id: rc.id,
        userId,
        version: rc.version,
        updated_at: rc.updated_at,
      });
    });
    setPurchaseReceiptVoidFaultForTests('after_po_reverse');
    try {
      await withTransaction((c) =>
        voidPurchaseReceipt(c, {
          id: posted.receipt.id,
          userId,
          version: posted.receipt.version,
          updated_at: posted.receipt.updated_at,
          reason: 'اختبار عطل',
        })
      );
      fail('67) fault after_po_reverse — توقّعنا فشلًا');
    } catch {
      const st = await query(`SELECT status FROM accounts.purchase_receipts WHERE id=$1`, [posted.receipt.id]);
      const plAfter = await query(
        `SELECT received_quantity::text r FROM accounts.purchase_order_lines WHERE id=$1`,
        [pl.id]
      );
      if (st.rows[0]?.status === 'POSTED' && moneyEquals(String(plAfter.rows[0]?.r), '3.000')) {
        ok('67) fault after_po_reverse — rollback');
      } else fail('67) void fault leftover', { st: st.rows[0], pl: plAfter.rows[0] });
    } finally {
      setPurchaseReceiptVoidFaultForTests(null);
    }
  }

  console.log(
    `\n===== النتيجة: ${failCount ? 'فشل' : 'نجاح'} — نجح ${passCount} / فشل ${failCount} =====`
  );
}

function moneyIsPositiveSafe(v: string): boolean {
  return moneyToMillisSafe(v) > BigInt(0);
}
function moneyToMillisSafe(v: string): bigint {
  const p = normalizeMoneyInput(v).split('.');
  const i = BigInt(p[0] ?? '0');
  const f = BigInt((p[1] ?? '000').padEnd(3, '0').slice(0, 3));
  return i * BigInt(1000) + f;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    setPurchaseReceiptPostFaultForTests(null);
    setPurchaseReceiptVoidFaultForTests(null);
    setPurchaseInvoiceMatchPostFaultForTests(null);
    await closePool();
  });
