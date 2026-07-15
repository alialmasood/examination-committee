/**
 * بيانات عرض 6.A — موردون وذمم دائنة DEMO (idempotent).
 */
import { query } from '../lib/db';
import { createSupplierAccount } from '../lib/accounts/supplier-accounts';
import { createSupplierInvoiceType } from '../lib/accounts/supplier-invoice-types';
import {
  createSupplierInvoice,
  postSupplierInvoice,
  voidSupplierInvoice,
} from '../lib/accounts/supplier-invoices';
import { createSupplier } from '../lib/accounts/suppliers';
import {
  acquireJournalEntriesLock,
  withTransaction,
} from '../lib/accounts/with-transaction';

const M = {
  payablesGl: 'DEMO-AP-GL',
  expenseServices: 'DEMO-EXP-SERVICES',
  expenseMaint: 'DEMO-EXP-MAINT',
  typeServices: 'DEMO-SIT-SERVICES',
  typeMaint: 'DEMO-SIT-MAINT',
  typeRent: 'DEMO-SIT-RENT',
  suppliers: [
    { code: 'DEMO-SUP-01', name: 'مورد خدمات DEMO', type: 'SERVICE_PROVIDER' as const },
    { code: 'DEMO-SUP-02', name: 'مورد صيانة DEMO', type: 'LOCAL' as const },
    { code: 'DEMO-SUP-03', name: 'مورد رصيد صفر DEMO', type: 'OTHER' as const },
  ],
  invPosted: 'DEMO-SIN-POSTED',
  invDraft: 'DEMO-SIN-DRAFT',
  invVoid: 'DEMO-SIN-VOID',
} as const;

async function ensureInvoiceType(params: {
  code: string;
  name_ar: string;
  expenseGlId: string;
  costCenterId: string | null;
  userId: string;
  requires_cost_center?: boolean;
}): Promise<string> {
  const existing = await query(
    `SELECT id FROM accounts.supplier_invoice_types WHERE LOWER(code)=LOWER($1)`,
    [params.code]
  );
  if (existing.rows[0]) return existing.rows[0].id as string;
  const row = await withTransaction((client) =>
    createSupplierInvoiceType(client, {
      code: params.code,
      name_ar: params.name_ar,
      default_expense_gl_account_id: params.expenseGlId,
      default_cost_center_id: params.costCenterId,
      requires_cost_center: params.requires_cost_center ?? false,
      created_by: params.userId,
    })
  );
  console.log(`✓ نوع فاتورة مورد: ${params.code}`);
  return row.id;
}

async function ensureSupplier(params: {
  code: string;
  name_ar: string;
  supplier_type: string;
  userId: string;
}): Promise<string> {
  const existing = await query(
    `SELECT id FROM accounts.suppliers WHERE code = $1 LIMIT 1`,
    [params.code]
  );
  if (existing.rows[0]) return existing.rows[0].id as string;
  const row = await withTransaction((client) =>
    createSupplier(client, {
      code: params.code,
      name_ar: params.name_ar,
      supplier_type: params.supplier_type,
      created_by: params.userId,
    })
  );
  console.log(`✓ مورد DEMO: ${params.code} → ${row.supplier_number}`);
  return row.id;
}

async function ensureSupplierAccount(params: {
  supplierId: string;
  payableGlId: string;
  userId: string;
}): Promise<{ id: string; account_number: string }> {
  const existing = await query(
    `SELECT id, account_number FROM accounts.supplier_accounts
     WHERE supplier_id = $1::uuid AND currency_code = 'IQD' LIMIT 1`,
    [params.supplierId]
  );
  if (existing.rows[0]) {
    return {
      id: existing.rows[0].id as string,
      account_number: existing.rows[0].account_number as string,
    };
  }
  const row = await withTransaction((client) =>
    createSupplierAccount(client, {
      supplier_id: params.supplierId,
      payable_gl_account_id: params.payableGlId,
      notes: 'حساب DEMO 6.A',
      created_by: params.userId,
    })
  );
  console.log(`✓ حساب مورد: ${row.account_number}`);
  return { id: row.id, account_number: row.account_number };
}

async function findInvoiceByExt(ref: string) {
  const r = await query(
    `SELECT id, status, version, updated_at, invoice_number
     FROM accounts.supplier_invoices
     WHERE external_reference = $1
     LIMIT 1`,
    [ref]
  );
  return r.rows[0] as
    | {
        id: string;
        status: string;
        version: number;
        updated_at: string;
        invoice_number: string;
      }
    | undefined;
}

export async function seedSupplierPayablesDemo(params: {
  userId: string;
  entryDate: string;
  ensureAccount: (p: {
    code: string;
    nameAr: string;
    typeCode: string;
    userId: string;
  }) => Promise<{ id: string }>;
}): Promise<void> {
  const { userId, entryDate, ensureAccount } = params;

  const payablesGl = await ensureAccount({
    code: M.payablesGl,
    nameAr: 'ذمم دائنة موردين DEMO',
    typeCode: 'LIABILITY',
    userId,
  });
  const expenseServices = await ensureAccount({
    code: M.expenseServices,
    nameAr: 'مصروف خدمات DEMO',
    typeCode: 'EXPENSE',
    userId,
  });
  const expenseMaint = await ensureAccount({
    code: M.expenseMaint,
    nameAr: 'مصروف صيانة DEMO',
    typeCode: 'EXPENSE',
    userId,
  });

  const cc = await query(
    `SELECT id FROM accounts.cost_centers WHERE LOWER(code)=LOWER('DEMO-CC-01') LIMIT 1`
  );
  const costCenterId = (cc.rows[0]?.id as string | undefined) ?? null;

  const typeServices = await ensureInvoiceType({
    code: M.typeServices,
    name_ar: 'خدمات DEMO',
    expenseGlId: expenseServices.id,
    costCenterId,
    userId,
  });
  await ensureInvoiceType({
    code: M.typeMaint,
    name_ar: 'صيانة DEMO',
    expenseGlId: expenseMaint.id,
    costCenterId,
    userId,
  });
  await ensureInvoiceType({
    code: M.typeRent,
    name_ar: 'إيجار DEMO',
    expenseGlId: expenseServices.id,
    costCenterId,
    userId,
    requires_cost_center: Boolean(costCenterId),
  });

  const supplierIds: string[] = [];
  for (const s of M.suppliers) {
    supplierIds.push(
      await ensureSupplier({
        code: s.code,
        name_ar: s.name,
        supplier_type: s.type,
        userId,
      })
    );
  }

  const accounts: Array<{ id: string; account_number: string }> = [];
  for (const sid of supplierIds) {
    accounts.push(
      await ensureSupplierAccount({
        supplierId: sid,
        payableGlId: payablesGl.id,
        userId,
      })
    );
  }

  // فاتورة POSTED — رصيد مستحق للمورد الأول
  let posted = await findInvoiceByExt(M.invPosted);
  if (!posted) {
    const created = await withTransaction(async (client) => {
      await acquireJournalEntriesLock(client);
      const inv = await createSupplierInvoice(client, {
        supplier_account_id: accounts[0].id,
        supplier_invoice_number: 'EXT-DEMO-POSTED-001',
        invoice_type_id: typeServices,
        invoice_date: entryDate,
        subtotal_amount: '150000',
        discount_amount: '0',
        tax_amount: '0',
        expense_gl_account_id: expenseServices.id,
        cost_center_id: costCenterId,
        description: 'فاتورة خدمات DEMO مرحّلة',
        external_reference: M.invPosted,
        created_by: userId,
      });
      const { invoice } = await postSupplierInvoice(client, {
        id: inv.id,
        userId,
        version: inv.version,
        updated_at: inv.updated_at,
      });
      return invoice;
    });
    console.log(`✓ فاتورة POSTED: ${created.invoice_number}`);
    posted = {
      id: created.id,
      status: created.status,
      version: created.version,
      updated_at: String(created.updated_at),
      invoice_number: created.invoice_number,
    };
  } else {
    console.log(`○ فاتورة POSTED موجودة: ${posted.invoice_number}`);
  }

  // مسودة
  const draft = await findInvoiceByExt(M.invDraft);
  if (!draft) {
    const inv = await withTransaction((client) =>
      createSupplierInvoice(client, {
        supplier_account_id: accounts[1].id,
        supplier_invoice_number: 'EXT-DEMO-DRAFT-001',
        invoice_type_id: typeServices,
        invoice_date: entryDate,
        subtotal_amount: '75000',
        expense_gl_account_id: expenseServices.id,
        cost_center_id: costCenterId,
        description: 'مسودة فاتورة DEMO',
        external_reference: M.invDraft,
        created_by: userId,
      })
    );
    console.log(`✓ فاتورة DRAFT: ${inv.invoice_number}`);
  } else {
    console.log(`○ فاتورة DRAFT موجودة: ${draft.invoice_number}`);
  }

  // VOID مع أصل وعكس — رصيد صافٍ صفر على المورد الثالث
  let voided = await findInvoiceByExt(M.invVoid);
  if (!voided) {
    const created = await withTransaction(async (client) => {
      await acquireJournalEntriesLock(client);
      const inv = await createSupplierInvoice(client, {
        supplier_account_id: accounts[2].id,
        supplier_invoice_number: 'EXT-DEMO-VOID-001',
        invoice_type_id: typeServices,
        invoice_date: entryDate,
        subtotal_amount: '40000',
        expense_gl_account_id: expenseServices.id,
        cost_center_id: costCenterId,
        description: 'فاتورة DEMO ستُلغى',
        external_reference: M.invVoid,
        created_by: userId,
      });
      const { invoice: postedInv } = await postSupplierInvoice(client, {
        id: inv.id,
        userId,
        version: inv.version,
        updated_at: inv.updated_at,
      });
      return voidSupplierInvoice(client, {
        id: postedInv.id,
        userId,
        version: postedInv.version,
        updated_at: postedInv.updated_at,
        reason: 'إلغاء عرض DEMO 6.A',
      });
    });
    console.log(`✓ فاتورة VOID: ${created.invoice_number}`);
    voided = {
      id: created.id,
      status: created.status,
      version: created.version,
      updated_at: String(created.updated_at),
      invoice_number: created.invoice_number,
    };
  } else {
    console.log(`○ فاتورة VOID موجودة: ${voided.invoice_number}`);
  }

  console.log('\n——— روابط عرض الموردين 6.A ———');
  console.log('  /accounts/suppliers');
  console.log('  /accounts/suppliers/list');
  console.log('  /accounts/suppliers/invoices');
  console.log('  /accounts/suppliers/invoice-types');
  if (posted) console.log(`  فاتورة مرحّلة: ${posted.invoice_number}`);
  if (voided) console.log(`  فاتورة ملغاة: ${voided.invoice_number}`);
}
