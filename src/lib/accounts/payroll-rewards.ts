/** مكافئات الرواتب — تسجيل يدوي مرتبط بأشخاص الكوادر */
import { AccountsHttpError } from './auth';
import { loadPayrollPerson } from './payroll-people';
import {
  dateStr,
  iso,
  nonNegativeMoney,
  requiredDate,
  requiredText,
} from './payroll-validation';
import { query } from '@/src/lib/db';
import type { TxClient } from './with-transaction';
import { txQuery } from './with-transaction';

const ALLOWED_PERSON_TYPES = new Set([
  'TEACHING_STAFF',
  'EXTERNAL_LECTURER',
  'EMPLOYEE',
  'DAILY_WORKER',
]);

export type PayrollRewardRow = {
  id: string;
  reward_code: string;
  payroll_person_id: string;
  details: string;
  paid_on: string | Date;
  amount: string | number;
  version: number;
  created_by: string;
  updated_by: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  person_code?: string;
  person_name_ar?: string;
  person_type?: string;
};

export async function ensurePayrollRewardsTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS accounts.payroll_rewards (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      reward_code VARCHAR(40) NOT NULL,
      payroll_person_id UUID NOT NULL
        REFERENCES accounts.payroll_people(id) ON DELETE RESTRICT,
      details VARCHAR(2000) NOT NULL,
      paid_on DATE NOT NULL,
      amount NUMERIC(18, 3) NOT NULL CHECK (amount >= 0),
      version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
      created_by UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE RESTRICT,
      updated_by UUID NULL REFERENCES student_affairs.users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT uq_payroll_rewards_code UNIQUE (reward_code)
    )
  `).catch(() => undefined);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_payroll_rewards_person
      ON accounts.payroll_rewards (payroll_person_id)
  `).catch(() => undefined);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_payroll_rewards_paid_on
      ON accounts.payroll_rewards (paid_on DESC)
  `).catch(() => undefined);
}

export function serializePayrollReward(row: PayrollRewardRow) {
  return {
    ...row,
    amount: String(row.amount ?? '0'),
    paid_on: dateStr(row.paid_on)!,
    created_at: iso(row.created_at)!,
    updated_at: iso(row.updated_at)!,
  };
}

function optionalUuid(v: unknown): string | null {
  const s = String(v ?? '').trim();
  if (!s) return null;
  if (!/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(s)) {
    throw new AccountsHttpError('معرّف غير صالح', 400);
  }
  return s;
}

function makeRewardCode(): string {
  const y = new Date().getFullYear();
  const rand = Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, '0');
  return `RWD-${y}-${rand}`;
}

async function nextUniqueRewardCode(client: TxClient): Promise<string> {
  for (let i = 0; i < 8; i++) {
    const code = makeRewardCode();
    const exists = await txQuery<{ id: string }>(
      client,
      `SELECT id FROM accounts.payroll_rewards WHERE reward_code = $1 LIMIT 1`,
      [code]
    );
    if (!exists.rows[0]) return code;
  }
  return `RWD-${Date.now()}`;
}

export async function createPayrollReward(
  client: TxClient,
  input: {
    payroll_person_id: unknown;
    details: unknown;
    paid_on: unknown;
    amount: unknown;
    created_by: string;
  }
): Promise<PayrollRewardRow> {
  await ensurePayrollRewardsTable();

  const personId = optionalUuid(input.payroll_person_id);
  if (!personId) throw new AccountsHttpError('الاسم مطلوب', 400);

  const person = await loadPayrollPerson(client, personId);
  if (person.status !== 'ACTIVE') {
    throw new AccountsHttpError('لا يمكن إضافة مكافئة لشخص غير نشط', 400);
  }
  if (!ALLOWED_PERSON_TYPES.has(person.person_type)) {
    throw new AccountsHttpError('الشخص المحدد خارج نطاق كوادر الرواتب المعتمدة', 400);
  }

  const details = requiredText(input.details, 2000, 'تفاصيل المكافئة');
  const paidOn = requiredDate(input.paid_on, 'تاريخ صرف المكافئة');
  const amount = nonNegativeMoney(input.amount, 'مبلغ المكافئة');
  if (Number(amount) <= 0) {
    throw new AccountsHttpError('مبلغ المكافئة يجب أن يكون أكبر من صفر', 400);
  }

  const code = await nextUniqueRewardCode(client);
  const r = await txQuery<PayrollRewardRow>(
    client,
    `INSERT INTO accounts.payroll_rewards
       (reward_code, payroll_person_id, details, paid_on, amount, created_by, updated_by)
     VALUES ($1, $2::uuid, $3, $4::date, $5::numeric, $6::uuid, $6::uuid)
     RETURNING *`,
    [code, personId, details, paidOn, amount, input.created_by]
  );
  return r.rows[0];
}

export async function listPayrollRewards(
  client: TxClient,
  p: {
    q?: string;
    page?: number;
    page_size?: number;
  }
): Promise<{ rows: PayrollRewardRow[]; total: number; page: number; page_size: number }> {
  await ensurePayrollRewardsTable();

  const page = Math.max(1, p.page ?? 1);
  const page_size = Math.min(200, Math.max(1, p.page_size ?? 50));
  const q = (p.q ?? '').trim();

  const n = await txQuery<{ total: number }>(
    client,
    `SELECT COUNT(*)::int AS total
     FROM accounts.payroll_rewards r
     JOIN accounts.payroll_people p ON p.id = r.payroll_person_id
     WHERE ($1 = '' OR r.reward_code ILIKE '%'||$1||'%'
            OR r.details ILIKE '%'||$1||'%'
            OR p.full_name_ar ILIKE '%'||$1||'%'
            OR p.person_code ILIKE '%'||$1||'%')`,
    [q]
  );

  const r = await txQuery<PayrollRewardRow>(
    client,
    `SELECT r.*,
            p.person_code,
            p.full_name_ar AS person_name_ar,
            p.person_type
     FROM accounts.payroll_rewards r
     JOIN accounts.payroll_people p ON p.id = r.payroll_person_id
     WHERE ($1 = '' OR r.reward_code ILIKE '%'||$1||'%'
            OR r.details ILIKE '%'||$1||'%'
            OR p.full_name_ar ILIKE '%'||$1||'%'
            OR p.person_code ILIKE '%'||$1||'%')
     ORDER BY r.paid_on DESC, r.created_at DESC
     LIMIT $2 OFFSET $3`,
    [q, page_size, (page - 1) * page_size]
  );

  return {
    rows: r.rows,
    total: n.rows[0]?.total ?? 0,
    page,
    page_size,
  };
}
