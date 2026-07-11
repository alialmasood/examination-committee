import { AccountsHttpError } from './auth';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';
import { query } from '@/src/lib/db';

export const CASH_VARIANCE_GAIN_KEY = 'cash_variance_gain_account_id';
export const CASH_VARIANCE_LOSS_KEY = 'cash_variance_loss_account_id';

export type CashVarianceSettings = {
  cash_variance_gain_account_id: string | null;
  cash_variance_loss_account_id: string | null;
};

async function readSetting(key: string): Promise<string | null> {
  const r = await query(
    `SELECT setting_value FROM platform.system_settings WHERE LOWER(setting_key) = LOWER($1)`,
    [key]
  );
  const v = r.rows[0]?.setting_value;
  return v == null || v === '' ? null : String(v);
}

export async function getCashVarianceSettings(): Promise<CashVarianceSettings> {
  const [gain, loss] = await Promise.all([
    readSetting(CASH_VARIANCE_GAIN_KEY),
    readSetting(CASH_VARIANCE_LOSS_KEY),
  ]);
  return {
    cash_variance_gain_account_id: gain,
    cash_variance_loss_account_id: loss,
  };
}

async function assertPostingAccount(client: TxClient, accountId: string): Promise<void> {
  const r = await txQuery(
    client,
    `SELECT id FROM accounts.chart_of_accounts
     WHERE id = $1::uuid
       AND is_group = FALSE
       AND allow_posting = TRUE
       AND is_active = TRUE`,
    [accountId]
  );
  if (!r.rows[0]) {
    throw new AccountsHttpError(
      'حساب فروقات الجرد يجب أن يكون تفصيلياً وقابلاً للترحيل وفعّالاً',
      400
    );
  }
}

async function upsertSetting(
  client: TxClient,
  params: {
    key: string;
    value: string | null;
    userId: string;
    description: string;
  }
): Promise<void> {
  const existing = await txQuery(
    client,
    `SELECT id FROM platform.system_settings WHERE LOWER(setting_key) = LOWER($1)`,
    [params.key]
  );
  if (existing.rows[0]) {
    await txQuery(
      client,
      `UPDATE platform.system_settings SET
         setting_value = $2,
         value_type = 'uuid',
         description = $3,
         updated_by = $4::uuid,
         updated_at = NOW()
       WHERE id = $1::uuid`,
      [existing.rows[0].id, params.value, params.description, params.userId]
    );
  } else {
    await txQuery(
      client,
      `INSERT INTO platform.system_settings
         (setting_key, setting_value, value_type, description, created_by, updated_by)
       VALUES ($1, $2, 'uuid', $3, $4::uuid, $4::uuid)`,
      [params.key, params.value, params.description, params.userId]
    );
  }
}

/**
 * حفظ حسابات فروقات الجرد في platform.system_settings.
 * القيمة null تمسح المفتاح (يُخزَّن فارغاً).
 */
export async function setCashVarianceSettings(
  client: TxClient,
  params: {
    cash_variance_gain_account_id?: unknown;
    cash_variance_loss_account_id?: unknown;
    userId: string;
  }
): Promise<CashVarianceSettings> {
  const current = await getCashVarianceSettings();

  let gain = current.cash_variance_gain_account_id;
  let loss = current.cash_variance_loss_account_id;

  if (params.cash_variance_gain_account_id !== undefined) {
    if (
      params.cash_variance_gain_account_id === null ||
      params.cash_variance_gain_account_id === ''
    ) {
      gain = null;
    } else {
      gain = String(params.cash_variance_gain_account_id);
      await assertPostingAccount(client, gain);
    }
  }

  if (params.cash_variance_loss_account_id !== undefined) {
    if (
      params.cash_variance_loss_account_id === null ||
      params.cash_variance_loss_account_id === ''
    ) {
      loss = null;
    } else {
      loss = String(params.cash_variance_loss_account_id);
      await assertPostingAccount(client, loss);
    }
  }

  await upsertSetting(client, {
    key: CASH_VARIANCE_GAIN_KEY,
    value: gain,
    userId: params.userId,
    description: 'حساب زيادة فروقات جرد الصناديق',
  });
  await upsertSetting(client, {
    key: CASH_VARIANCE_LOSS_KEY,
    value: loss,
    userId: params.userId,
    description: 'حساب عجز فروقات جرد الصناديق',
  });

  return {
    cash_variance_gain_account_id: gain,
    cash_variance_loss_account_id: loss,
  };
}
