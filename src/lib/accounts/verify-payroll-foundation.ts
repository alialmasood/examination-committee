/**
 * تحقق أساس الرواتب 9.A.1 — سلامة السجل التأسيسي (بلا احتساب أو تشغيل رواتب).
 * منطق التحقق فقط — يشغّله src/scripts/verify-payroll-foundation.ts.
 *
 * mismatch = فشل دائماً. strict يرقّي warnings/unexplained إلى فشل أيضاً.
 *
 * الفحوصات:
 *  - أكثر من عقد ACTIVE للشخص نفسه.
 *  - عقد ACTIVE لشخص غير ACTIVE.
 *  - Assignment مرتبط بعقد لا يعود لنفس الشخص.
 *  - Component Assignment مرتبط بشخص/عقد/تكليف غير متطابق أو بعقدٍ وتكليفٍ معاً.
 *  - effective_to قبل effective_from (كل الجداول ذات التأريخ).
 *  - Component بطريقة CUSTOM_FORMULA مستخدمة فعلياً (component أو override).
 *  - Mapping غامض: نفس النطاق والمميّزات والأولوية وفترة متداخلة.
 *  - Mapping/Contract/Component مرتبط بحساب غير Posting أو غير فعّال أو نوع غير مناسب.
 *  - تكرار: person_code / contract_number / assignment_code / component_code / calendar code / mapping_code.
 *  - سجلات orphan (مراجع مفقودة).
 *  - version < 1.
 *  - بيانات مصرفية غير مقنّعة (تحتوي أرقاماً طويلة بلا تقنيع).
 *  - Document Sequence types المطلوبة غير موجودة (تحذير — تُنشأ عند أول ترقيم).
 */
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type PayrollVerifyIssue = { kind: string; detail: string; entity_id?: string };

export type PayrollVerifyResult = {
  ok: boolean;
  strict: boolean;
  mismatches: PayrollVerifyIssue[];
  warnings: PayrollVerifyIssue[];
  unexplained: PayrollVerifyIssue[];
  summary: {
    calendars: number;
    people: number;
    contracts: number;
    contracts_active: number;
    assignments: number;
    components: number;
    component_assignments: number;
    mappings: number;
  };
};

export type VerifyPayrollOptions = { strict?: boolean };

export async function verifyPayrollFoundation(
  client: TxClient,
  options: VerifyPayrollOptions = {}
): Promise<PayrollVerifyResult> {
  const strict = options.strict === true;
  const mismatches: PayrollVerifyIssue[] = [];
  const warnings: PayrollVerifyIssue[] = [];
  const unexplained: PayrollVerifyIssue[] = [];
  const fail = (kind: string, detail: string, entity_id?: string) => mismatches.push({ kind, detail, entity_id });
  const warn = (kind: string, detail: string, entity_id?: string) => warnings.push({ kind, detail, entity_id });
  const unexp = (kind: string, detail: string, entity_id?: string) => unexplained.push({ kind, detail, entity_id });

  // ── دليل الحسابات (للتحقق من الحسابات المرتبطة) ───────────────────
  const gls = await txQuery<{
    id: string; code: string; is_active: boolean; is_group: boolean;
    allow_posting: boolean; account_type_code: string;
  }>(
    client,
    `SELECT a.id, a.code, a.is_active, a.is_group, a.allow_posting, t.code AS account_type_code
     FROM accounts.chart_of_accounts a
     JOIN accounts.account_types t ON t.id = a.account_type_id`
  );
  const glById = new Map(gls.rows.map((g) => [g.id, g] as const));

  const checkPostingAccount = (id: string | null, label: string, entityId: string) => {
    if (!id) return;
    const gl = glById.get(id);
    if (!gl) {
      fail('gl_not_found', `${label} (${id}) غير موجود بدليل الحسابات`, entityId);
      return;
    }
    if (!gl.is_active || gl.is_group || !gl.allow_posting) {
      fail('gl_posting', `${label} (${gl.code}) يجب أن يكون تفصيلياً قابلاً للترحيل وفعّالاً`, entityId);
    }
  };

  const costCenters = await txQuery<{ id: string; is_active: boolean; code: string }>(
    client,
    `SELECT id, is_active, code FROM accounts.cost_centers`
  );
  const ccById = new Map(costCenters.rows.map((c) => [c.id, c] as const));
  const checkCostCenter = (id: string | null, label: string, entityId: string) => {
    if (!id) return;
    const cc = ccById.get(id);
    if (!cc) { fail('cc_not_found', `${label} (${id}) غير موجود`, entityId); return; }
    if (!cc.is_active) fail('cc_inactive', `${label} (${cc.code}) غير فعّال`, entityId);
  };

  // ── تكرار الأكواد ─────────────────────────────────────────────────
  const dupChecks: Array<[string, string, string]> = [
    ['accounts.payroll_calendars', 'code', 'calendar_code_dup'],
    ['accounts.payroll_people', 'person_code', 'person_code_dup'],
    ['accounts.payroll_contracts', 'contract_number', 'contract_number_dup'],
    ['accounts.payroll_assignments', 'assignment_code', 'assignment_code_dup'],
    ['accounts.payroll_components', 'component_code', 'component_code_dup'],
    ['accounts.payroll_account_mappings', 'mapping_code', 'mapping_code_dup'],
  ];
  for (const [table, col, kind] of dupChecks) {
    const r = await txQuery<{ v: string; n: number }>(
      client,
      `SELECT ${col} AS v, COUNT(*)::int n FROM ${table} GROUP BY ${col} HAVING COUNT(*) > 1`
    );
    for (const row of r.rows) fail(kind, `${col} مكرر (${row.v}) بعدد ${row.n}`);
  }

  // ── التأريخ الفعّال (effective_to < effective_from) ────────────────
  const dateTables = [
    'accounts.payroll_calendars',
    'accounts.payroll_people',
    'accounts.payroll_contracts',
    'accounts.payroll_assignments',
    'accounts.payroll_components',
    'accounts.payroll_component_assignments',
    'accounts.payroll_account_mappings',
  ];
  for (const table of dateTables) {
    const r = await txQuery<{ id: string }>(
      client,
      `SELECT id FROM ${table} WHERE effective_to IS NOT NULL AND effective_to < effective_from`
    );
    for (const row of r.rows) fail('effective_range', `${table}: نهاية السريان قبل بدايته`, row.id);
  }

  // ── version < 1 ───────────────────────────────────────────────────
  for (const table of dateTables) {
    const r = await txQuery<{ id: string; version: number }>(
      client,
      `SELECT id, version FROM ${table} WHERE version < 1`
    );
    for (const row of r.rows) fail('bad_version', `${table}: version غير صالح (${row.version})`, row.id);
  }

  // ── الأشخاص: البيانات المصرفية غير المقنّعة ───────────────────────
  const people = await txQuery<{ id: string; status: string; bank_account_identifier_masked: string | null }>(
    client,
    `SELECT id, status, bank_account_identifier_masked FROM accounts.payroll_people`
  );
  for (const p of people.rows) {
    const m = p.bank_account_identifier_masked;
    if (m && /\d{6,}/.test(m.replace(/\*/g, ''))) {
      fail('bank_unmasked', 'المعرّف المصرفي غير مقنّع (يحتوي أرقاماً طويلة ظاهرة)', p.id);
    }
  }
  const peopleStatus = new Map(people.rows.map((p) => [p.id, p.status] as const));

  // ── العقود: عقد ACTIVE واحد، حالة الشخص، الحسابات، orphan ─────────
  const contracts = await txQuery<{
    id: string; payroll_person_id: string; status: string;
    default_expense_account_id: string | null; payable_account_id: string | null; default_cost_center_id: string | null;
  }>(
    client,
    `SELECT id, payroll_person_id, status, default_expense_account_id, payable_account_id, default_cost_center_id
     FROM accounts.payroll_contracts`
  );
  const activeByPerson = new Map<string, number>();
  let contractsActive = 0;
  for (const c of contracts.rows) {
    if (!peopleStatus.has(c.payroll_person_id)) fail('contract_orphan', 'عقد مرتبط بشخص غير موجود', c.id);
    if (c.status === 'ACTIVE') {
      contractsActive += 1;
      activeByPerson.set(c.payroll_person_id, (activeByPerson.get(c.payroll_person_id) ?? 0) + 1);
      const ps = peopleStatus.get(c.payroll_person_id);
      if (ps && ps !== 'ACTIVE') fail('active_contract_inactive_person', `عقد ACTIVE لشخص حالته ${ps}`, c.id);
    }
    checkPostingAccount(c.default_expense_account_id, 'حساب مصروف العقد', c.id);
    checkPostingAccount(c.payable_account_id, 'حساب ذمم العقد', c.id);
    checkCostCenter(c.default_cost_center_id, 'مركز كلفة العقد', c.id);
  }
  for (const [pid, n] of activeByPerson) {
    if (n > 1) fail('multiple_active_contracts', `الشخص لديه ${n} عقود ACTIVE`, pid);
  }

  // ── التكليفات: تطابق العقد مع الشخص، orphan ───────────────────────
  const contractPerson = new Map(contracts.rows.map((c) => [c.id, c.payroll_person_id] as const));
  const assignments = await txQuery<{
    id: string; payroll_person_id: string; payroll_contract_id: string | null;
    cost_center_id: string | null;
  }>(
    client,
    `SELECT id, payroll_person_id, payroll_contract_id, cost_center_id FROM accounts.payroll_assignments`
  );
  for (const a of assignments.rows) {
    if (!peopleStatus.has(a.payroll_person_id)) fail('assignment_orphan', 'تكليف مرتبط بشخص غير موجود', a.id);
    if (a.payroll_contract_id) {
      if (!contractPerson.has(a.payroll_contract_id)) {
        fail('assignment_contract_orphan', 'تكليف مرتبط بعقد غير موجود', a.id);
      } else if (contractPerson.get(a.payroll_contract_id) !== a.payroll_person_id) {
        fail('assignment_contract_mismatch', 'تكليف مرتبط بعقد لا يعود لنفس الشخص', a.id);
      }
    }
    checkCostCenter(a.cost_center_id, 'مركز كلفة التكليف', a.id);
  }

  // ── المكوّنات: CUSTOM_FORMULA، الحسابات، min/max ──────────────────
  const components = await txQuery<{
    id: string; component_code: string; calculation_method: string;
    expense_account_id: string | null; liability_account_id: string | null; default_cost_center_id: string | null;
    minimum_amount: string | null; maximum_amount: string | null;
  }>(
    client,
    `SELECT id, component_code, calculation_method, expense_account_id, liability_account_id,
            default_cost_center_id, minimum_amount, maximum_amount
     FROM accounts.payroll_components`
  );
  const componentIds = new Set(components.rows.map((c) => c.id));
  for (const c of components.rows) {
    if (c.calculation_method === 'CUSTOM_FORMULA') {
      fail('custom_formula_used', `المكوّن ${c.component_code} يستخدم CUSTOM_FORMULA المحجوزة`, c.id);
    }
    checkPostingAccount(c.expense_account_id, 'حساب مصروف المكوّن', c.id);
    checkPostingAccount(c.liability_account_id, 'حساب التزام المكوّن', c.id);
    checkCostCenter(c.default_cost_center_id, 'مركز كلفة المكوّن', c.id);
    if (c.minimum_amount != null && c.maximum_amount != null && Number(c.minimum_amount) > Number(c.maximum_amount)) {
      fail('min_max', `المكوّن ${c.component_code}: الحد الأدنى أكبر من الأعلى`, c.id);
    }
  }

  // ── إسنادات المكوّنات: تطابق الروابط، CUSTOM_FORMULA، عقد+تكليف معاً ─
  const compAssignments = await txQuery<{
    id: string; payroll_person_id: string; payroll_contract_id: string | null;
    payroll_assignment_id: string | null; payroll_component_id: string; override_calculation_method: string | null;
  }>(
    client,
    `SELECT id, payroll_person_id, payroll_contract_id, payroll_assignment_id,
            payroll_component_id, override_calculation_method
     FROM accounts.payroll_component_assignments`
  );
  const assignmentPerson = new Map(assignments.rows.map((a) => [a.id, a.payroll_person_id] as const));
  for (const ca of compAssignments.rows) {
    if (!peopleStatus.has(ca.payroll_person_id)) fail('ca_orphan', 'إسناد مكوّن مرتبط بشخص غير موجود', ca.id);
    if (!componentIds.has(ca.payroll_component_id)) fail('ca_component_orphan', 'إسناد مكوّن مرتبط بمكوّن غير موجود', ca.id);
    if (ca.payroll_contract_id && ca.payroll_assignment_id) {
      fail('ca_contract_and_assignment', 'إسناد مكوّن مرتبط بعقد وتكليف معاً', ca.id);
    }
    if (ca.payroll_contract_id) {
      if (!contractPerson.has(ca.payroll_contract_id)) fail('ca_contract_orphan', 'إسناد مكوّن مرتبط بعقد غير موجود', ca.id);
      else if (contractPerson.get(ca.payroll_contract_id) !== ca.payroll_person_id) fail('ca_contract_mismatch', 'إسناد مكوّن: العقد لا يعود لنفس الشخص', ca.id);
    }
    if (ca.payroll_assignment_id) {
      if (!assignmentPerson.has(ca.payroll_assignment_id)) fail('ca_assignment_orphan', 'إسناد مكوّن مرتبط بتكليف غير موجود', ca.id);
      else if (assignmentPerson.get(ca.payroll_assignment_id) !== ca.payroll_person_id) fail('ca_assignment_mismatch', 'إسناد مكوّن: التكليف لا يعود لنفس الشخص', ca.id);
    }
    if (ca.override_calculation_method === 'CUSTOM_FORMULA') {
      fail('ca_custom_formula', 'إسناد مكوّن يستخدم CUSTOM_FORMULA المحجوزة', ca.id);
    }
  }

  // ── التقويمات: الحسابات لا شيء؛ لكن نفحص orphan للمكوّن/التقويم في الخرائط ─
  const calendars = await txQuery<{ id: string }>(client, `SELECT id FROM accounts.payroll_calendars`);
  const calendarIds = new Set(calendars.rows.map((c) => c.id));

  // ── الخرائط: الحسابات، شكل النطاق، الغموض، orphan ─────────────────
  const mappings = await txQuery<{
    id: string; mapping_code: string; mapping_scope: string; priority: number;
    payroll_component_id: string | null; person_type: string | null; payroll_calendar_id: string | null;
    expense_account_id: string | null; liability_account_id: string | null; payable_account_id: string | null;
    rounding_account_id: string | null; cost_center_id: string | null; is_active: boolean;
    effective_from: string; effective_to: string | null;
  }>(
    client,
    `SELECT id, mapping_code, mapping_scope, priority, payroll_component_id, person_type, payroll_calendar_id,
            expense_account_id, liability_account_id, payable_account_id, rounding_account_id, cost_center_id,
            is_active, effective_from::text AS effective_from, effective_to::text AS effective_to
     FROM accounts.payroll_account_mappings`
  );
  for (const m of mappings.rows) {
    checkPostingAccount(m.expense_account_id, 'حساب مصروف الخريطة', m.id);
    checkPostingAccount(m.liability_account_id, 'حساب التزام الخريطة', m.id);
    checkPostingAccount(m.payable_account_id, 'حساب ذمم الخريطة', m.id);
    checkPostingAccount(m.rounding_account_id, 'حساب تقريب الخريطة', m.id);
    checkCostCenter(m.cost_center_id, 'مركز كلفة الخريطة', m.id);
    if (m.payroll_component_id && !componentIds.has(m.payroll_component_id)) fail('mapping_component_orphan', 'خريطة مرتبطة بمكوّن غير موجود', m.id);
    if (m.payroll_calendar_id && !calendarIds.has(m.payroll_calendar_id)) fail('mapping_calendar_orphan', 'خريطة مرتبطة بتقويم غير موجود', m.id);
    // شكل النطاق
    if (m.mapping_scope === 'COMPONENT' && !m.payroll_component_id) fail('mapping_scope_shape', 'نطاق COMPONENT بلا مكوّن', m.id);
    if (m.mapping_scope === 'PERSON_TYPE' && !m.person_type) fail('mapping_scope_shape', 'نطاق PERSON_TYPE بلا نوع شخص', m.id);
    if (m.mapping_scope === 'CALENDAR' && !m.payroll_calendar_id) fail('mapping_scope_shape', 'نطاق CALENDAR بلا تقويم', m.id);
    if (m.mapping_scope === 'ROUNDING' && !m.rounding_account_id) fail('mapping_scope_shape', 'نطاق ROUNDING بلا حساب تقريب', m.id);
    const hasAccount = Boolean(m.expense_account_id || m.liability_account_id || m.payable_account_id || m.rounding_account_id);
    if (!hasAccount) fail('mapping_no_account', 'خريطة بلا أي حساب محاسبي', m.id);
  }

  // الغموض: خرائط فعّالة بنفس النطاق والمميّزات والأولوية وفترة متداخلة
  const ambiguous = await txQuery<{ a: string; b: string }>(
    client,
    `SELECT m1.id AS a, m2.id AS b
     FROM accounts.payroll_account_mappings m1
     JOIN accounts.payroll_account_mappings m2
       ON m1.id < m2.id
      AND m1.is_active AND m2.is_active
      AND m1.mapping_scope = m2.mapping_scope
      AND m1.priority = m2.priority
      AND COALESCE(m1.payroll_component_id,'00000000-0000-0000-0000-000000000000'::uuid)
          = COALESCE(m2.payroll_component_id,'00000000-0000-0000-0000-000000000000'::uuid)
      AND COALESCE(m1.person_type,'') = COALESCE(m2.person_type,'')
      AND COALESCE(m1.payroll_calendar_id,'00000000-0000-0000-0000-000000000000'::uuid)
          = COALESCE(m2.payroll_calendar_id,'00000000-0000-0000-0000-000000000000'::uuid)
      AND daterange(m1.effective_from, m1.effective_to, '[]') && daterange(m2.effective_from, m2.effective_to, '[]')`
  );
  for (const row of ambiguous.rows) fail('mapping_ambiguous', `خريطتان متعارضتان بنفس النطاق/المميّزات/الأولوية وفترة متداخلة (${row.a} ↔ ${row.b})`);

  // ── Document Sequence types المطلوبة ──────────────────────────────
  const seqTypes = await txQuery<{ document_type: string }>(
    client,
    `SELECT DISTINCT document_type FROM accounts.document_sequences
     WHERE document_type IN ('PAYROLL_PERSON','PAYROLL_CONTRACT','PAYROLL_ASSIGNMENT')`
  );
  const presentSeq = new Set(seqTypes.rows.map((s) => s.document_type));
  for (const t of ['PAYROLL_PERSON', 'PAYROLL_CONTRACT', 'PAYROLL_ASSIGNMENT']) {
    if (!presentSeq.has(t)) warn('sequence_missing', `تسلسل ${t} غير مُنشأ بعد (يُنشأ عند أول ترقيم)`);
  }

  // ── مكوّنات فعّالة بلا أي خريطة تخدمها (تحذير — قد يكون مقصوداً) ───
  const activeComponentsNoMapping = await txQuery<{ id: string; component_code: string }>(
    client,
    `SELECT c.id, c.component_code
     FROM accounts.payroll_components c
     WHERE c.is_active = TRUE
       AND NOT EXISTS (
         SELECT 1 FROM accounts.payroll_account_mappings m
         WHERE m.is_active = TRUE
           AND (m.mapping_scope = 'DEFAULT'
                OR (m.mapping_scope = 'COMPONENT' AND m.payroll_component_id = c.id))
       )`
  );
  for (const row of activeComponentsNoMapping.rows) {
    unexp('component_without_mapping', `المكوّن الفعّال ${row.component_code} بلا خريطة DEFAULT أو COMPONENT تخدمه`, row.id);
  }

  const summary = {
    calendars: calendars.rows.length,
    people: people.rows.length,
    contracts: contracts.rows.length,
    contracts_active: contractsActive,
    assignments: assignments.rows.length,
    components: components.rows.length,
    component_assignments: compAssignments.rows.length,
    mappings: mappings.rows.length,
  };

  const ok = mismatches.length === 0 && (!strict || (warnings.length === 0 && unexplained.length === 0));
  return { ok, strict, mismatches, warnings, unexplained, summary };
}
