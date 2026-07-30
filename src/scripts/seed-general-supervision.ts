import {
  ensureGeneralSupervisionUser,
  GENERAL_SUPERVISION_USERNAME,
  GENERAL_SUPERVISION_FULL_NAME,
  GENERAL_SUPERVISION_SYSTEM_CODE,
  GENERAL_SUPERVISION_BASE_PATH,
} from '../lib/general-supervision';
import { query } from '../lib/db';

async function main() {
  await ensureGeneralSupervisionUser();

  const hasName = await query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'student_affairs' AND table_name = 'systems' AND column_name = 'name'
     LIMIT 1`
  );

  if (hasName.rows.length > 0) {
    await query(
      `INSERT INTO student_affairs.systems (code, name, name_ar, base_path, is_active)
       VALUES ($1, 'General Supervision', $2, $3, TRUE)
       ON CONFLICT (code) DO UPDATE SET
         name_ar = EXCLUDED.name_ar,
         base_path = EXCLUDED.base_path,
         is_active = TRUE`,
      [
        GENERAL_SUPERVISION_SYSTEM_CODE,
        GENERAL_SUPERVISION_FULL_NAME,
        GENERAL_SUPERVISION_BASE_PATH,
      ]
    );
  } else {
    await query(
      `INSERT INTO student_affairs.systems (code, name_ar, base_path, is_active)
       VALUES ($1, $2, $3, TRUE)
       ON CONFLICT (code) DO UPDATE SET
         name_ar = EXCLUDED.name_ar,
         base_path = EXCLUDED.base_path,
         is_active = TRUE`,
      [
        GENERAL_SUPERVISION_SYSTEM_CODE,
        GENERAL_SUPERVISION_FULL_NAME,
        GENERAL_SUPERVISION_BASE_PATH,
      ]
    );
  }

  const user = await query(
    `SELECT id, username, full_name, is_active
     FROM student_affairs.users WHERE username = $1`,
    [GENERAL_SUPERVISION_USERNAME]
  );
  const system = await query(
    `SELECT id FROM student_affairs.systems WHERE code = $1`,
    [GENERAL_SUPERVISION_SYSTEM_CODE]
  );

  if (user.rows[0] && system.rows[0]) {
    await query(
      `INSERT INTO student_affairs.user_systems (user_id, system_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id, system_id) DO NOTHING`,
      [user.rows[0].id, system.rows[0].id]
    );
  }

  console.log('تم تهيئة حساب الإشراف العامة:', user.rows[0] || null);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
