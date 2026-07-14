/**
 * اختبارات صلاحيات Accounts Admin ورؤية الصناديق.
 * npm run test:accounts-access
 */
import bcrypt from 'bcrypt';
import { closePool, query } from '../lib/db';
import { AccountsHttpError } from '../lib/accounts/auth';
import {
  grantAccountsAdminRole,
  hasAccountsAdminAccess,
} from '../lib/accounts/accounts-access';
import { assertCanViewCashBox } from '../lib/accounts/cash-box-access';
import { withTransaction } from '../lib/accounts/with-transaction';

const TEST_USERS = {
  roleAdmin: 'acct_role_admin',
  roleAdminAlt: 'random_xyz_access',
  noRole: 'adminish',
} as const;

function ok(name: string) {
  console.log(`✅ ${name}`);
}
function fail(name: string, err?: unknown) {
  console.error(`❌ ${name}`, err ?? '');
  process.exitCode = 1;
}

async function expectHttp(
  name: string,
  fn: () => Promise<unknown>,
  status: number
) {
  try {
    await fn();
    fail(name, `توقّعنا ${status} لكن نجحت العملية`);
  } catch (e) {
    if (e instanceof AccountsHttpError && e.status === status) {
      ok(name);
      return;
    }
    fail(name, e);
  }
}

async function upsertTestUser(username: string): Promise<string> {
  const hash = await bcrypt.hash('test-access-pass', 10);
  const res = await query(
    `INSERT INTO student_affairs.users (username, email, full_name, password_hash, is_active)
     VALUES ($1, $2, $3, $4, TRUE)
     ON CONFLICT (username) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       is_active = TRUE
     RETURNING id`,
    [username, `${username}@test.local`, `اختبار ${username}`, hash]
  );
  return res.rows[0].id as string;
}

async function clearAccountsAdminRole(userId: string): Promise<void> {
  await query(
    `DELETE FROM platform.user_system_roles usr
     USING platform.systems ps, student_affairs.roles r
     WHERE usr.user_id = $1::uuid
       AND usr.system_id = ps.id AND ps.code = 'ACCOUNTS'
       AND usr.role_id = r.id AND r.code = 'accounts_admin'`,
    [userId]
  );
}

async function findAnyCashBoxId(): Promise<string | null> {
  const r = await query(
    `SELECT id FROM accounts.cash_boxes ORDER BY created_at LIMIT 1`
  );
  return (r.rows[0]?.id as string) ?? null;
}

async function main() {
  console.log('🔐 test:accounts-access\n');

  const roleAdminId = await upsertTestUser(TEST_USERS.roleAdmin);
  const roleAdminAltId = await upsertTestUser(TEST_USERS.roleAdminAlt);
  const noRoleId = await upsertTestUser(TEST_USERS.noRole);

  await clearAccountsAdminRole(roleAdminId);
  await clearAccountsAdminRole(roleAdminAltId);
  await clearAccountsAdminRole(noRoleId);

  await grantAccountsAdminRole(roleAdminId);
  await grantAccountsAdminRole(roleAdminAltId);

  if (await hasAccountsAdminAccess(null, roleAdminId)) {
    ok('hasAccountsAdminAccess=true لمستخدم acct_role_admin بدور رسمي');
  } else {
    fail('hasAccountsAdminAccess=true لمستخدم acct_role_admin بدور رسمي');
  }

  if (await hasAccountsAdminAccess(null, roleAdminAltId)) {
    ok('hasAccountsAdminAccess=true لـ random_xyz_access بدور (ليس legacy username)');
  } else {
    fail('hasAccountsAdminAccess=true لـ random_xyz_access بدور');
  }

  if (!(await hasAccountsAdminAccess(null, noRoleId))) {
    ok('hasAccountsAdminAccess=false لـ adminish بدون دور');
  } else {
    fail('hasAccountsAdminAccess=false لـ adminish بدون دور');
  }

  const cashBoxId = await findAnyCashBoxId();
  if (!cashBoxId) {
    console.log('⚠️ لا يوجد صندوق — تخطّي اختبار assertCanViewCashBox');
  } else {
    await expectHttp(
      'assertCanViewCashBox يرفض adminish غير أمين',
      () =>
        withTransaction(async (client) =>
          assertCanViewCashBox(client, {
            cashBoxId,
            userId: noRoleId,
          })
        ),
      403
    );

    await withTransaction(async (client) =>
      assertCanViewCashBox(client, {
        cashBoxId,
        userId: roleAdminId,
      })
    );
    ok('assertCanViewCashBox يسمح لـ Accounts Admin على أي صندوق');
  }

  console.log('\nانتهى test:accounts-access');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => closePool());
