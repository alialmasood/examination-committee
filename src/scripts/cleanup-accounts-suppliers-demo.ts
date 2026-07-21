/**
 * حذف بيانات تجريبية لوحدة الموردين/الذمم/الدفعات/المصروفات.
 * يغطي الصفحات:
 *  /accounts/suppliers
 *  /accounts/suppliers/invoices
 *  /accounts/suppliers/payments
 *  /accounts/suppliers/expenses
 *  /accounts/suppliers/invoice-types
 *  /accounts/suppliers/expense-types
 *
 * npm run cleanup:accounts-suppliers-demo
 */
import { closePool, query } from '../lib/db';

async function count(sql: string, params: any[] = []) {
  const r = await query(sql, params);
  return Number(r.rows[0]?.n ?? 0);
}

/** موردون تجريبيون: DEMO + أنماط اختبار التشغيل */
const SUPPLIER_IS_TEST = `
  (
    code ILIKE 'DEMO-SUP-%'
    OR code ILIKE 'SPY-%'
    OR code ILIKE 'PUR-SUP-%'
    OR code ILIKE 'SUP%'
    OR code ILIKE 'SITA-%'
    OR name_ar ILIKE '%DEMO%'
    OR name_ar ILIKE '%اختبار%'
    OR name_ar ILIKE '%مورد موازي%'
    OR name_ar ILIKE '%مشتريات%'
    OR name_ar ILIKE '%أصول اختبار%'
    OR name_ar ILIKE '%دفعات%'
    OR name_en ILIKE '%TEST%'
    OR name_en ILIKE '%DEMO%'
  )
`;

async function main() {
  console.log('===== تنظيف بيانات DEMO/اختبار — وحدة الموردين =====');

  const before = {
    suppliers: await count(`SELECT COUNT(*)::int n FROM accounts.suppliers`),
    invoices: await count(`SELECT COUNT(*)::int n FROM accounts.supplier_invoices`),
    payments: await count(`SELECT COUNT(*)::int n FROM accounts.supplier_payments`),
    expenses: await count(`SELECT COUNT(*)::int n FROM accounts.direct_expenses`),
    invoice_types: await count(`SELECT COUNT(*)::int n FROM accounts.supplier_invoice_types`),
    expense_types: await count(`SELECT COUNT(*)::int n FROM accounts.direct_expense_types`),
  };
  console.log('قبل:', before);

  const suppliers = await query(
    `SELECT id::text FROM accounts.suppliers WHERE ${SUPPLIER_IS_TEST}`
  );
  let supplierIds = suppliers.rows.map((r) => r.id);

  // إن كان كل الموردين تجريبيين (لا إنتاج واضح) — امسح الكل
  const totalSuppliers = before.suppliers;
  if (supplierIds.length >= totalSuppliers && totalSuppliers > 0) {
    console.log(`كل الموردين (${totalSuppliers}) تجريبيون — حذف شامل`);
    supplierIds = (
      await query(`SELECT id::text FROM accounts.suppliers`)
    ).rows.map((r) => r.id);
  }
  console.log(`موردون مستهدفون: ${supplierIds.length}`);

  if (!supplierIds.length) {
    // ما زال نحذف أنواع DEMO وأنواع اختبار حتى لو لا موردين
    await cleanupTypesOnly();
    await printAfter();
    await closePool();
    return;
  }

  const accountIds = (
    await query(
      `SELECT id::text FROM accounts.supplier_accounts WHERE supplier_id = ANY($1::uuid[])`,
      [supplierIds]
    )
  ).rows.map((r) => r.id);

  const invoiceIds = (
    await query(
      `SELECT id::text FROM accounts.supplier_invoices
       WHERE supplier_id = ANY($1::uuid[])
          OR external_reference ILIKE 'DEMO-%'
          OR external_reference ILIKE 'SPY-%'
          OR supplier_invoice_number ILIKE 'EXT-DEMO-%'
          OR supplier_invoice_number ILIKE 'VINV-%'
          OR description ILIKE '%DEMO%'
          OR description ILIKE '%اختبار%'`,
      [supplierIds]
    )
  ).rows.map((r) => r.id);

  // —— 1) تخصيصات الدفعات ——
  await query(
    `DELETE FROM accounts.supplier_payment_allocations
     WHERE supplier_payment_id IN (
       SELECT id FROM accounts.supplier_payments
       WHERE supplier_id = ANY($1::uuid[])
          OR supplier_account_id = ANY($2::uuid[])
          OR external_reference ILIKE 'DEMO-%'
          OR external_reference ILIKE 'SPY-%'
          OR description ILIKE '%DEMO%'
          OR description ILIKE '%اختبار%'
     )
     OR supplier_invoice_id = ANY($3::uuid[])`,
    [supplierIds, accountIds.length ? accountIds : ['00000000-0000-0000-0000-000000000000'], invoiceIds.length ? invoiceIds : ['00000000-0000-0000-0000-000000000000']]
  );

  // —— 2) دفعات ——
  await query(
    `UPDATE accounts.supplier_payments
     SET cash_voucher_id = NULL, bank_voucher_id = NULL, journal_entry_id = NULL
     WHERE supplier_id = ANY($1::uuid[])
        OR supplier_account_id = ANY($2::uuid[])
        OR external_reference ILIKE 'DEMO-%'
        OR external_reference ILIKE 'SPY-%'`,
    [supplierIds, accountIds.length ? accountIds : ['00000000-0000-0000-0000-000000000000']]
  ).catch(async () => {
    // بعض الأعمدة قد لا توجد
    await query(
      `DELETE FROM accounts.supplier_payments
       WHERE supplier_id = ANY($1::uuid[])
          OR external_reference ILIKE 'DEMO-%'
          OR external_reference ILIKE 'SPY-%'`,
      [supplierIds]
    );
  });
  await query(
    `DELETE FROM accounts.supplier_payments
     WHERE supplier_id = ANY($1::uuid[])
        OR supplier_account_id = ANY($2::uuid[])
        OR external_reference ILIKE 'DEMO-%'
        OR external_reference ILIKE 'SPY-%'
        OR description ILIKE '%DEMO%'
        OR description ILIKE '%اختبار%'`,
    [supplierIds, accountIds.length ? accountIds : ['00000000-0000-0000-0000-000000000000']]
  );

  // —— 3) مصروفات مباشرة ——
  await query(
    `UPDATE accounts.direct_expenses
     SET cash_voucher_id = NULL, bank_voucher_id = NULL, journal_entry_id = NULL
     WHERE external_reference ILIKE 'DEMO-%'
        OR external_reference ILIKE 'SPY-%'
        OR external_reference ILIKE 'DEX-%'
        OR description ILIKE '%DEMO%'
        OR description ILIKE '%اختبار%'
        OR beneficiary_name ILIKE '%DEMO%'
        OR beneficiary_name ILIKE '%اختبار%'`
  ).catch(() => undefined);
  await query(
    `DELETE FROM accounts.direct_expenses
     WHERE external_reference ILIKE 'DEMO-%'
        OR external_reference ILIKE 'SPY-%'
        OR external_reference ILIKE 'DEX-%'
        OR description ILIKE '%DEMO%'
        OR description ILIKE '%اختبار%'
        OR beneficiary_name ILIKE '%DEMO%'
        OR beneficiary_name ILIKE '%اختبار%'
        OR expense_number ILIKE 'DEX-%'
        OR description ILIKE '%fault%'
        OR beneficiary_name ILIKE '%fault%'
        OR expense_type_id IN (
          SELECT id FROM accounts.direct_expense_types
          WHERE code ILIKE 'DEMO-%' OR code ILIKE 'DEX-%' OR name_ar ILIKE '%DEMO%' OR name_ar ILIKE '%اختبار%'
        )`
  );

  // —— 4) رسملة أصول من أسطر الفواتير ——
  if (invoiceIds.length) {
    await query(
      `DELETE FROM accounts.asset_capitalization_sources
       WHERE supplier_invoice_id = ANY($1::uuid[])
          OR supplier_invoice_line_id IN (
            SELECT id FROM accounts.supplier_invoice_lines WHERE supplier_invoice_id = ANY($1::uuid[])
          )`,
      [invoiceIds]
    ).catch(() => undefined);

    await query(
      `UPDATE accounts.fixed_assets SET supplier_id = NULL
       WHERE supplier_id = ANY($1::uuid[])`,
      [supplierIds]
    ).catch(() => undefined);

    await query(
      `DELETE FROM accounts.supplier_invoice_lines WHERE supplier_invoice_id = ANY($1::uuid[])`,
      [invoiceIds]
    );
  }

  // —— 5) فواتير ——
  await query(
    `UPDATE accounts.supplier_invoices
     SET journal_entry_id = NULL, reversal_journal_entry_id = NULL, purchase_order_id = NULL
     WHERE id = ANY($1::uuid[])`,
    [invoiceIds.length ? invoiceIds : ['00000000-0000-0000-0000-000000000000']]
  ).catch(() => undefined);

  await query(
    `DELETE FROM accounts.supplier_invoices
     WHERE supplier_id = ANY($1::uuid[])
        OR external_reference ILIKE 'DEMO-%'
        OR external_reference ILIKE 'SPY-%'
        OR supplier_invoice_number ILIKE 'EXT-DEMO-%'
        OR supplier_invoice_number ILIKE 'VINV-%'
        OR description ILIKE '%DEMO%'
        OR description ILIKE '%اختبار%'`,
    [supplierIds]
  );

  // —— 6) دفتر المورد ——
  if (accountIds.length) {
    await query(
      `DELETE FROM accounts.supplier_ledger_entries WHERE supplier_account_id = ANY($1::uuid[])`,
      [accountIds]
    );
  }

  // —— 7) أوامر شراء / استلامات مرتبطة بموردي الاختبار ——
  const poIds = (
    await query(
      `SELECT id::text FROM accounts.purchase_orders WHERE supplier_id = ANY($1::uuid[])`,
      [supplierIds]
    )
  ).rows.map((r) => r.id);

  if (poIds.length) {
    await query(
      `UPDATE accounts.fixed_assets
       SET purchase_order_id = NULL, purchase_order_line_id = NULL
       WHERE purchase_order_id = ANY($1::uuid[])
          OR purchase_order_line_id IN (
            SELECT id FROM accounts.purchase_order_lines WHERE purchase_order_id = ANY($1::uuid[])
          )`,
      [poIds]
    ).catch(() => undefined);

    await query(
      `DELETE FROM accounts.asset_capitalization_sources
       WHERE purchase_order_id = ANY($1::uuid[])
          OR purchase_order_line_id IN (
            SELECT id FROM accounts.purchase_order_lines WHERE purchase_order_id = ANY($1::uuid[])
          )
          OR purchase_receipt_id IN (
            SELECT id FROM accounts.purchase_receipts WHERE purchase_order_id = ANY($1::uuid[])
          )`,
      [poIds]
    ).catch(() => undefined);

    await query(
      `UPDATE accounts.supplier_invoices SET purchase_order_id = NULL
       WHERE purchase_order_id = ANY($1::uuid[])`,
      [poIds]
    ).catch(() => undefined);

    await query(
      `UPDATE accounts.supplier_invoice_lines SET purchase_order_line_id = NULL
       WHERE purchase_order_line_id IN (
         SELECT id FROM accounts.purchase_order_lines WHERE purchase_order_id = ANY($1::uuid[])
       )`,
      [poIds]
    ).catch(() => undefined);

    await query(
      `DELETE FROM accounts.purchase_receipt_lines
       WHERE receipt_id IN (
         SELECT id FROM accounts.purchase_receipts WHERE purchase_order_id = ANY($1::uuid[])
       )
          OR purchase_order_line_id IN (
            SELECT id FROM accounts.purchase_order_lines WHERE purchase_order_id = ANY($1::uuid[])
          )`,
      [poIds]
    );
    await query(
      `DELETE FROM accounts.purchase_receipts WHERE purchase_order_id = ANY($1::uuid[])`,
      [poIds]
    );
    await query(
      `DELETE FROM accounts.purchase_order_lines WHERE purchase_order_id = ANY($1::uuid[])`,
      [poIds]
    );
    await query(`DELETE FROM accounts.purchase_orders WHERE id = ANY($1::uuid[])`, [poIds]);
  }

  await query(
    `UPDATE accounts.purchase_requisition_lines SET suggested_supplier_id = NULL
     WHERE suggested_supplier_id = ANY($1::uuid[])`,
    [supplierIds]
  ).catch(() => undefined);

  // —— 8) حسابات الموردين ثم الموردون ——
  if (accountIds.length) {
    await query(`DELETE FROM accounts.supplier_accounts WHERE id = ANY($1::uuid[])`, [accountIds]);
  }
  await query(`DELETE FROM accounts.suppliers WHERE id = ANY($1::uuid[])`, [supplierIds]);

  await cleanupTypesOnly();
  await printAfter();
  await closePool();
}

async function cleanupTypesOnly() {
  await query(
    `DELETE FROM accounts.direct_expenses
     WHERE external_reference ILIKE 'DEMO-%'
        OR external_reference ILIKE 'SPY-%'
        OR external_reference ILIKE 'DEX-%'
        OR expense_number ILIKE 'DEX-%'
        OR description ILIKE '%DEMO%'
        OR description ILIKE '%fault%'
        OR beneficiary_name ILIKE '%DEMO%'
        OR beneficiary_name ILIKE '%fault%'
        OR expense_type_id IN (
          SELECT id FROM accounts.direct_expense_types
          WHERE code ILIKE 'DEMO-%' OR code ILIKE 'DEX-%' OR name_ar ILIKE '%DEMO%'
        )`
  ).catch(() => undefined);

  // أنواع فواتير تجريبية
  await query(
    `DELETE FROM accounts.supplier_invoice_types
     WHERE code ILIKE 'DEMO-%'
        OR code ILIKE 'SIT-%'
        OR code ILIKE 'SITCC-%'
        OR code ILIKE 'SITH3-%'
        OR code ILIKE 'SPY-SIT-%'
        OR name_ar ILIKE '%DEMO%'
        OR name_ar ILIKE '%اختبار%'`
  );
  // أنواع مصروف تجريبية
  await query(
    `DELETE FROM accounts.direct_expense_types
     WHERE code ILIKE 'DEMO-%'
        OR code ILIKE 'DEX-%'
        OR name_ar ILIKE '%DEMO%'
        OR name_ar ILIKE '%اختبار%'`
  );
}

async function printAfter() {
  const after = {
    suppliers: await count(`SELECT COUNT(*)::int n FROM accounts.suppliers`),
    invoices: await count(`SELECT COUNT(*)::int n FROM accounts.supplier_invoices`),
    payments: await count(`SELECT COUNT(*)::int n FROM accounts.supplier_payments`),
    expenses: await count(`SELECT COUNT(*)::int n FROM accounts.direct_expenses`),
    invoice_types: await count(`SELECT COUNT(*)::int n FROM accounts.supplier_invoice_types`),
    expense_types: await count(`SELECT COUNT(*)::int n FROM accounts.direct_expense_types`),
    demo_suppliers: await count(
      `SELECT COUNT(*)::int n FROM accounts.suppliers WHERE code ILIKE 'DEMO-SUP-%'`
    ),
  };
  console.log('بعد:', after);
  if (
    after.demo_suppliers > 0 ||
    after.suppliers > 0 ||
    after.invoices > 0 ||
    after.payments > 0 ||
    after.expenses > 0
  ) {
    // إن بقي شيء غير DEMO قد يكون إنتاجاً — نبلّغ فقط
    console.log('ملاحظة: إن بقيت صفوف فقد تكون خارج أنماط التجربة أو تحتاج مراجعة يدوية');
  } else {
    console.log('✓ صفحات الموردين يجب أن تظهر فارغة الآن');
  }
  console.log('===== انتهى التنظيف =====');
}

main().catch(async (e) => {
  console.error('فشل التنظيف:', e);
  await closePool().catch(() => undefined);
  process.exit(1);
});
