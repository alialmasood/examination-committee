import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';
import { AccountsHttpError } from './auth';

export async function computeCostCenterLevel(
  client: TxClient,
  parentId: string | null
): Promise<number> {
  if (!parentId) return 1;
  const parent = await txQuery<{ level: number }>(
    client,
    `SELECT level FROM accounts.cost_centers WHERE id = $1`,
    [parentId]
  );
  if (parent.rows.length === 0) {
    throw new AccountsHttpError('مركز الكلفة الأب غير موجود', 404);
  }
  return parent.rows[0].level + 1;
}

async function fetchParentId(client: TxClient, id: string): Promise<string | null> {
  const result = await client.query(
    `SELECT parent_id FROM accounts.cost_centers WHERE id = $1`,
    [id]
  );
  if (result.rows.length === 0) {
    throw new AccountsHttpError('مركز الكلفة الأب غير موجود', 404);
  }
  return (result.rows[0] as { parent_id: string | null }).parent_id;
}

/** يمنع الدورات: لا يمكن أن يكون parentId من نسل nodeId */
export async function assertNoCostCenterCycle(
  client: TxClient,
  nodeId: string,
  newParentId: string | null
): Promise<void> {
  if (!newParentId) return;
  if (newParentId === nodeId) {
    throw new AccountsHttpError('لا يمكن أن يكون مركز الكلفة أباً لنفسه', 400);
  }

  let walkId: string | null = newParentId;
  const visited = new Set<string>();

  while (walkId) {
    if (walkId === nodeId) {
      throw new AccountsHttpError(
        'لا يمكن إنشاء دورة في شجرة مراكز الكلفة',
        409
      );
    }
    if (visited.has(walkId)) {
      throw new AccountsHttpError('تم اكتشاف دورة غير صالحة في شجرة مراكز الكلفة', 409);
    }
    visited.add(walkId);
    walkId = await fetchParentId(client, walkId);
  }
}

export async function recountSubtreeLevels(
  client: TxClient,
  rootId: string,
  rootLevel: number
): Promise<void> {
  await txQuery(
    client,
    `UPDATE accounts.cost_centers SET level = $2, updated_at = NOW() WHERE id = $1`,
    [rootId, rootLevel]
  );

  const children = await txQuery<{ id: string }>(
    client,
    `SELECT id FROM accounts.cost_centers WHERE parent_id = $1`,
    [rootId]
  );

  for (const child of children.rows) {
    await recountSubtreeLevels(client, child.id, rootLevel + 1);
  }
}
