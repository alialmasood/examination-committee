/**
 * تحقق خفيف للقطة الاحتساب 9.A.2.2 — بلا Schema Engine.
 */
import { AccountsHttpError } from './auth';

/** مفاتيح محظورة (case-insensitive) في snapshot_json / details_json بأي عمق. */
export const PAYROLL_SNAPSHOT_SENSITIVE_KEY_RE =
  /^(bank_account|iban|card_number|payment_details|password|token|authorization|request_body|stack|sql|ip_address|user_agent|account_number|national_id|ssn|secret)$/i;

export function findSensitiveJsonKeys(obj: unknown, path = ''): string[] {
  if (obj == null || typeof obj !== 'object') return [];
  if (Array.isArray(obj)) {
    return obj.flatMap((v, i) => findSensitiveJsonKeys(v, path ? `${path}[${i}]` : `[${i}]`));
  }
  const hit: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const p = path ? `${path}.${k}` : k;
    if (PAYROLL_SNAPSHOT_SENSITIVE_KEY_RE.test(k)) hit.push(p);
    hit.push(...findSensitiveJsonKeys(v, p));
  }
  return hit;
}

export function assertNoSensitiveJson(
  value: unknown,
  label: string
): void {
  const keys = findSensitiveJsonKeys(value);
  if (keys.length) {
    throw new AccountsHttpError(
      `${label} يحتوي مفاتيح حسّاسة محظورة: ${keys.slice(0, 5).join(', ')}`,
      400
    );
  }
}

/** يفرض أن القيمة كائن JSON (وليس Array/NULL/primitive). */
export function assertSnapshotJsonObject(snap: unknown): asserts snap is Record<string, unknown> {
  if (snap == null || typeof snap !== 'object' || Array.isArray(snap)) {
    throw new AccountsHttpError('snapshot_json مطلوب ويجب أن يكون كائنًا', 400);
  }
}

/**
 * تحقق شكل أساسي لحالة CALCULATED فقط.
 * يقبل component_assignment_ids (النوع المجمّد) أو component_assignments.
 */
export function assertCalculatedSnapshotShape(snap: Record<string, unknown>): void {
  const required = [
    'schema_version',
    'calculation_date',
    'currency_code',
    'person',
    'contract',
    'assignments',
    'scope',
  ] as const;
  for (const k of required) {
    if (!(k in snap) || snap[k] === undefined) {
      throw new AccountsHttpError(`لقطة CALCULATED ناقصة الحقل: ${k}`, 400);
    }
  }
  const hasComp =
    'component_assignment_ids' in snap || 'component_assignments' in snap;
  if (!hasComp) {
    throw new AccountsHttpError(
      'لقطة CALCULATED ناقصة الحقل: component_assignment_ids',
      400
    );
  }
  if (snap.contract == null || typeof snap.contract !== 'object' || Array.isArray(snap.contract)) {
    throw new AccountsHttpError('لقطة CALCULATED تتطلب عقدًا في snapshot_json.contract', 400);
  }
  if (!Array.isArray(snap.assignments)) {
    throw new AccountsHttpError('لقطة CALCULATED تتطلب assignments كمصفوفة', 400);
  }
  if (snap.person == null || typeof snap.person !== 'object' || Array.isArray(snap.person)) {
    throw new AccountsHttpError('لقطة CALCULATED تتطلب person ككائن', 400);
  }
  if (snap.scope == null || typeof snap.scope !== 'object' || Array.isArray(snap.scope)) {
    throw new AccountsHttpError('لقطة CALCULATED تتطلب scope ككائن', 400);
  }
}
