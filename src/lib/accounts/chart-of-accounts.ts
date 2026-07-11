import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';
import { AccountsHttpError } from './auth';
import { normalizeCode } from './fiscal';

export type ChartAccountRow = {
  id: string;
  code: string;
  name_ar: string;
  name_en: string | null;
  account_type_id: string;
  parent_id: string | null;
  level: number;
  is_group: boolean;
  allow_posting: boolean;
  normal_balance: 'DEBIT' | 'CREDIT';
  requires_cost_center: boolean;
  is_active: boolean;
  description: string | null;
  source: 'SYSTEM' | 'USER';
  sort_order: number;
  account_type_code?: string;
  account_type_name_ar?: string;
  children_count?: number;
};

export async function getAccountTypeById(
  client: TxClient,
  typeId: string
): Promise<{ id: string; code: string; name_ar: string; normal_balance: 'DEBIT' | 'CREDIT' }> {
  const res = await txQuery<{
    id: string;
    code: string;
    name_ar: string;
    normal_balance: 'DEBIT' | 'CREDIT';
  }>(
    client,
    `SELECT id, code, name_ar, normal_balance
     FROM accounts.account_types
     WHERE id = $1 AND is_active = TRUE`,
    [typeId]
  );
  if (res.rows.length === 0) {
    throw new AccountsHttpError('نوع الحساب غير موجود أو غير نشط', 404);
  }
  return res.rows[0];
}

export async function computeChartAccountLevel(
  client: TxClient,
  parentId: string | null
): Promise<number> {
  if (!parentId) return 1;
  const parent = await txQuery<{ level: number }>(
    client,
    `SELECT level FROM accounts.chart_of_accounts WHERE id = $1`,
    [parentId]
  );
  if (parent.rows.length === 0) {
    throw new AccountsHttpError('الحساب الأب غير موجود', 404);
  }
  return parent.rows[0].level + 1;
}

async function fetchChartParentId(client: TxClient, id: string): Promise<string | null> {
  const result = await client.query(
    `SELECT parent_id FROM accounts.chart_of_accounts WHERE id = $1`,
    [id]
  );
  if (result.rows.length === 0) {
    throw new AccountsHttpError('الحساب غير موجود', 404);
  }
  return (result.rows[0] as { parent_id: string | null }).parent_id;
}

export async function assertNoChartCycle(
  client: TxClient,
  nodeId: string,
  newParentId: string | null
): Promise<void> {
  if (!newParentId) return;
  if (newParentId === nodeId) {
    throw new AccountsHttpError('لا يمكن أن يكون الحساب أباً لنفسه', 400);
  }

  let walkId: string | null = newParentId;
  const visited = new Set<string>();
  while (walkId) {
    if (walkId === nodeId) {
      throw new AccountsHttpError('لا يمكن إنشاء دورة في شجرة دليل الحسابات', 409);
    }
    if (visited.has(walkId)) {
      throw new AccountsHttpError('تم اكتشاف دورة غير صالحة في شجرة الحسابات', 409);
    }
    visited.add(walkId);
    walkId = await fetchChartParentId(client, walkId);
  }
}

export async function loadChartAccount(
  client: TxClient,
  id: string,
  forUpdate = false
): Promise<ChartAccountRow> {
  const res = await txQuery<ChartAccountRow>(
    client,
    `SELECT a.*, t.code AS account_type_code, t.name_ar AS account_type_name_ar,
            (SELECT COUNT(*)::int FROM accounts.chart_of_accounts c WHERE c.parent_id = a.id) AS children_count
     FROM accounts.chart_of_accounts a
     JOIN accounts.account_types t ON t.id = a.account_type_id
     WHERE a.id = $1
     ${forUpdate ? 'FOR UPDATE OF a' : ''}`,
    [id]
  );
  if (res.rows.length === 0) {
    throw new AccountsHttpError('الحساب غير موجود', 404);
  }
  return res.rows[0];
}

export async function assertValidParentForChild(
  client: TxClient,
  parentId: string | null,
  accountTypeId: string
): Promise<void> {
  if (!parentId) return;
  const parent = await loadChartAccount(client, parentId);
  if (!parent.is_group) {
    throw new AccountsHttpError('لا يمكن اختيار حساب تفصيلي كحساب أب', 409);
  }
  if (!parent.is_active) {
    throw new AccountsHttpError('الحساب الأب غير نشط', 409);
  }
  if (parent.account_type_id !== accountTypeId) {
    throw new AccountsHttpError('نوع الحساب يجب أن يطابق نوع الحساب الأب', 409);
  }
}

export function resolveGroupPostingFlags(isGroup: boolean): {
  is_group: boolean;
  allow_posting: boolean;
} {
  return isGroup
    ? { is_group: true, allow_posting: false }
    : { is_group: false, allow_posting: true };
}

export async function nextSiblingSortOrder(
  client: TxClient,
  parentId: string | null
): Promise<number> {
  const res = await txQuery<{ next: number }>(
    client,
    `SELECT COALESCE(MAX(sort_order), 0)::int + 1 AS next
     FROM accounts.chart_of_accounts
     WHERE parent_id IS NOT DISTINCT FROM $1::uuid`,
    [parentId]
  );
  return Number(res.rows[0]?.next || 1);
}

export async function recountChartSubtreeLevels(
  client: TxClient,
  rootId: string,
  rootLevel: number
): Promise<void> {
  await txQuery(
    client,
    `UPDATE accounts.chart_of_accounts SET level = $2, updated_at = NOW() WHERE id = $1`,
    [rootId, rootLevel]
  );
  const children = await txQuery<{ id: string }>(
    client,
    `SELECT id FROM accounts.chart_of_accounts WHERE parent_id = $1`,
    [rootId]
  );
  for (const child of children.rows) {
    await recountChartSubtreeLevels(client, child.id, rootLevel + 1);
  }
}

/**
 * اقتراح الكود التالي تحت الأب بالاعتماد على أكواد الأبناء الحالية.
 */
export async function suggestNextAccountCode(
  client: TxClient,
  parentId: string | null
): Promise<{ suggested: string | null; reason: string }> {
  if (!parentId) {
    const roots = await txQuery<{ code: string }>(
      client,
      `SELECT code FROM accounts.chart_of_accounts WHERE parent_id IS NULL ORDER BY sort_order ASC, code ASC`
    );
    const nums = roots.rows
      .map((r) => Number(normalizeCode(r.code)))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (nums.length === 0) {
      return { suggested: '1000', reason: 'اقتراح افتراضي لجذر جديد' };
    }
    const max = Math.max(...nums);
    const step = inferStep(nums) || 1000;
    return { suggested: String(max + step), reason: 'بناءً على أعلى حساب جذري' };
  }

  const parent = await loadChartAccount(client, parentId);
  const children = await txQuery<{ code: string }>(
    client,
    `SELECT code FROM accounts.chart_of_accounts WHERE parent_id = $1 ORDER BY sort_order ASC, code ASC`,
    [parentId]
  );

  const parentCode = normalizeCode(parent.code);
  if (children.rows.length === 0) {
    // أول فرع: أضف رقماً مناسباً
    if (/^\d+$/.test(parentCode)) {
      if (parentCode.endsWith('00')) {
        const base = parentCode.slice(0, -2);
        return { suggested: `${base}10`, reason: 'أول فرع تحت الحساب الأب' };
      }
      if (parentCode.endsWith('0')) {
        return { suggested: `${parentCode.slice(0, -1)}1`, reason: 'أول فرع تحت الحساب الأب' };
      }
      return { suggested: `${parentCode}1`, reason: 'أول فرع تحت الحساب الأب' };
    }
    return { suggested: `${parentCode}-01`, reason: 'أول فرع نصي تحت الحساب الأب' };
  }

  const childCodes = children.rows.map((r) => normalizeCode(r.code));
  const numericChildren = childCodes
    .map((c) => ({ code: c, n: Number(c) }))
    .filter((x) => Number.isFinite(x.n));

  if (numericChildren.length > 0 && numericChildren.length === childCodes.length) {
    const nums = numericChildren.map((x) => x.n).sort((a, b) => a - b);
    const step = inferStep(nums) || 1;
    const next = Math.max(...nums) + step;
    return { suggested: String(next), reason: `نمط رقمي بخطوة ${step}` };
  }

  // نمط بادئة الأب + لاحقة رقمية
  const suffixes = childCodes
    .filter((c) => c.startsWith(parentCode))
    .map((c) => c.slice(parentCode.length))
    .filter((s) => /^\d+$/.test(s))
    .map((s) => ({ raw: s, n: Number(s), pad: s.length }));

  if (suffixes.length > 0) {
    const max = Math.max(...suffixes.map((s) => s.n));
    const pad = Math.max(...suffixes.map((s) => s.pad));
    const step = inferStep(suffixes.map((s) => s.n)) || 1;
    const next = String(max + step).padStart(pad, '0');
    return { suggested: `${parentCode}${next}`, reason: 'نمط لاحقة رقمية تحت كود الأب' };
  }

  return {
    suggested: null,
    reason: 'تعذر استنتاج نمط واضح؛ أدخل الكود يدوياً',
  };
}

function inferStep(sortedUniqueNums: number[]): number | null {
  const sorted = [...new Set(sortedUniqueNums)].sort((a, b) => a - b);
  if (sorted.length < 2) return null;
  const diffs: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const d = sorted[i] - sorted[i - 1];
    if (d > 0) diffs.push(d);
  }
  if (diffs.length === 0) return null;
  // الأكثر تكراراً
  const freq = new Map<number, number>();
  for (const d of diffs) freq.set(d, (freq.get(d) || 0) + 1);
  let best = diffs[0];
  let bestCount = 0;
  for (const [d, c] of freq) {
    if (c > bestCount || (c === bestCount && d < best)) {
      best = d;
      bestCount = c;
    }
  }
  return best;
}

export function buildAccountTree<
  T extends { id: string; parent_id: string | null; sort_order?: number; code?: string }
>(rows: T[]): Array<T & { children: Array<T & { children: unknown[] }> }> {
  type Node = T & { children: Node[] };
  const map = new Map<string, Node>();
  rows.forEach((r) => map.set(r.id, { ...r, children: [] }));
  const roots: Node[] = [];
  map.forEach((node) => {
    if (node.parent_id && map.has(node.parent_id)) {
      map.get(node.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  });

  const bySortThenCode = (a: Node, b: Node) => {
    const sa = Number(a.sort_order ?? 0);
    const sb = Number(b.sort_order ?? 0);
    if (sa !== sb) return sa - sb;
    return String(a.code || '').localeCompare(String(b.code || ''), undefined, { numeric: true });
  };

  const sortRecursive = (nodes: Node[]) => {
    nodes.sort(bySortThenCode);
    for (const n of nodes) sortRecursive(n.children);
  };
  sortRecursive(roots);

  return roots;
}
