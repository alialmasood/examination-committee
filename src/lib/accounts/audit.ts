import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

export type AuditAction =
  | 'fiscal_year.create'
  | 'fiscal_year.update'
  | 'fiscal_year.set_default'
  | 'fiscal_year.activate'
  | 'fiscal_year.close'
  | 'fiscal_year.delete'
  | 'fiscal_period.create'
  | 'fiscal_period.update'
  | 'fiscal_period.open'
  | 'fiscal_period.close'
  | 'fiscal_period.lock'
  | 'fiscal_period.reopen'
  | 'fiscal_period.delete'
  | 'cost_center.create'
  | 'cost_center.update'
  | 'cost_center.toggle_status'
  | 'cost_center.delete'
  | 'document_sequence.update';

export async function writeFinancialAudit(
  client: TxClient,
  params: {
    userId: string;
    action: AuditAction | string;
    entityType: string;
    entityId: string;
    oldValues?: unknown;
    newValues?: unknown;
    description?: string;
    ipAddress?: string;
    userAgent?: string;
  }
): Promise<void> {
  await txQuery(
    client,
    `INSERT INTO accounts.financial_audit_log
      (user_id, action, entity_type, entity_id, old_values, new_values, description, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9)`,
    [
      params.userId,
      params.action,
      params.entityType,
      params.entityId,
      params.oldValues == null ? null : JSON.stringify(params.oldValues),
      params.newValues == null ? null : JSON.stringify(params.newValues),
      params.description ?? null,
      params.ipAddress ?? null,
      params.userAgent ?? null,
    ]
  );
}
