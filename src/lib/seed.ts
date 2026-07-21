import bcrypt from 'bcrypt';
import { query } from './db';

// ط¯ط§ظ„ط© ظ„ط¥ظ†ط´ط§ط، ظ…ط³طھط®ط¯ظ… ط¥ط¯ط§ط±ظٹ ط£ظˆظ„ظٹ
export async function seedAdmin(): Promise<void> {
  try {
    console.log('ط¨ط¯ط، ط¥ظ†ط´ط§ط، ط§ظ„ظ…ط³طھط®ط¯ظ… ط§ظ„ط¥ط¯ط§ط±ظٹ...');

    // طھط´ظپظٹط± ظƒظ„ظ…ط© ط§ظ„ظ…ط±ظˆط±
    const password = 'admin123';
    const hashedPassword = await bcrypt.hash(password, 12);

    // ط¥ظ†ط´ط§ط، ط§ظ„ظ…ط³طھط®ط¯ظ… ط§ظ„ط¥ط¯ط§ط±ظٹ
    const userResult = await query(
      `INSERT INTO student_affairs.users 
       (id, username, password_hash, full_name, email, is_active, created_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW())
       ON CONFLICT (username) DO UPDATE SET
       password_hash = EXCLUDED.password_hash,
       full_name = EXCLUDED.full_name,
       email = EXCLUDED.email,
       is_active = EXCLUDED.is_active
       RETURNING id`,
      ['admin', hashedPassword, 'ط§ظ„ظ…ط¯ظٹط± ط§ظ„ط¹ط§ظ…', 'admin@college.edu', true]
    );

    const userId = userResult.rows[0].id;
    console.log(`طھظ… ط¥ظ†ط´ط§ط،/طھط­ط¯ظٹط« ط§ظ„ظ…ط³طھط®ط¯ظ… ط§ظ„ط¥ط¯ط§ط±ظٹ (ID: ${userId})`);

    // ط±ط¨ط· ط§ظ„ظ…ط³طھط®ط¯ظ… ط¨ط§ظ„ط£ظ†ط¸ظ…ط©
    const systems = ['STUDENT_AFFAIRS', 'EXAM_COMMITTEE'];
    
    for (const systemCode of systems) {
      // ط§ظ„ط­طµظˆظ„ ط¹ظ„ظ‰ system_id
      const systemResult = await query(
        'SELECT id FROM platform.systems WHERE code = $1',
        [systemCode]
      );

      if (systemResult.rows.length === 0) {
        console.log(`طھط­ط°ظٹط±: ط§ظ„ظ†ط¸ط§ظ… ${systemCode} ط؛ظٹط± ظ…ظˆط¬ظˆط¯`);
        continue;
      }

      const systemId = systemResult.rows[0].id;

      // ط§ظ„ط­طµظˆظ„ ط¹ظ„ظ‰ role_id (admin)
      const roleResult = await query(
        'SELECT id FROM student_affairs.roles WHERE code = $1',
        ['admin']
      );

      if (roleResult.rows.length === 0) {
        console.log(`طھط­ط°ظٹط±: ط§ظ„ط¯ظˆط± admin ط؛ظٹط± ظ…ظˆط¬ظˆط¯`);
        continue;
      }

      const roleId = roleResult.rows[0].id;

      // ط±ط¨ط· ط§ظ„ظ…ط³طھط®ط¯ظ… ط¨ط§ظ„ظ†ط¸ط§ظ…
      await query(
        `INSERT INTO platform.user_system_roles (user_id, system_id, role_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id, system_id) DO NOTHING`,
        [userId, systemId, roleId]
      );

      console.log(`طھظ… ط±ط¨ط· ط§ظ„ظ…ط³طھط®ط¯ظ… ط¨ط§ظ„ظ†ط¸ط§ظ… ${systemCode}`);
    }

    console.log('طھظ… ط¥ظ†ط´ط§ط، ط§ظ„ظ…ط³طھط®ط¯ظ… ط§ظ„ط¥ط¯ط§ط±ظٹ ط¨ظ†ط¬ط§ط­!');
    console.log('ط¨ظٹط§ظ†ط§طھ طھط³ط¬ظٹظ„ ط§ظ„ط¯ط®ظˆظ„:');
    console.log('ط§ط³ظ… ط§ظ„ظ…ط³طھط®ط¯ظ…: admin');
    console.log('ظƒظ„ظ…ط© ط§ظ„ظ…ط±ظˆط±: admin123');

  } catch (error) {
    console.error('ط®ط·ط£ ظپظٹ ط¥ظ†ط´ط§ط، ط§ظ„ظ…ط³طھط®ط¯ظ… ط§ظ„ط¥ط¯ط§ط±ظٹ:', error);
    throw error;
  }
}

// ط¯ط§ظ„ط© ظ„ط¥ظ†ط´ط§ط، ط§ظ„ط£ظ†ط¸ظ…ط© ط§ظ„ط£ط³ط§ط³ظٹط©
export async function seedSystems(): Promise<void> {
  try {
    console.log('ط¨ط¯ط، ط¥ظ†ط´ط§ط، ط§ظ„ط£ظ†ط¸ظ…ط© ط§ظ„ط£ط³ط§ط³ظٹط©...');

    const systems = [
      {
        code: 'STUDENT_AFFAIRS',
        name_ar: 'ط´ط¤ظˆظ† ط§ظ„ط·ظ„ط¨ط© ظˆط§ظ„طھط³ط¬ظٹظ„',
        base_path: '/student-affairs',
        description: 'ظ†ط¸ط§ظ… ط¥ط¯ط§ط±ط© ط´ط¤ظˆظ† ط§ظ„ط·ظ„ط¨ط© ظˆط§ظ„طھط³ط¬ظٹظ„'
      },
      {
        code: 'EXAM_COMMITTEE',
        name_ar: 'ط§ظ„ظ„ط¬ظ†ط© ط§ظ„ط§ظ…طھط­ط§ظ†ظٹط©',
        base_path: '/exam-committee',
        description: 'ظ†ط¸ط§ظ… ط¥ط¯ط§ط±ط© ط§ظ„ظ„ط¬ظ†ط© ط§ظ„ط§ظ…طھط­ط§ظ†ظٹط©'
      },
      {
        code: 'ACCOUNTING',
        name_ar: 'ظ†ط¸ط§ظ… ط§ظ„ط­ط³ط§ط¨ط§طھ',
        base_path: '/accounts',
        description: 'ظ†ط¸ط§ظ… ط¥ط¯ط§ط±ط© ط§ظ„ط­ط³ط§ط¨ط§طھ ط§ظ„ظ…ط§ظ„ظٹط©'
      }
    ];

    for (const system of systems) {
      await query(
        `INSERT INTO platform.systems (code, name_ar, base_path, description, is_active, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
         ON CONFLICT (code) DO UPDATE SET
         name_ar = EXCLUDED.name_ar,
         base_path = EXCLUDED.base_path,
         description = EXCLUDED.description,
         is_active = EXCLUDED.is_active,
         updated_at = NOW()`,
        [system.code, system.name_ar, system.base_path, system.description, true]
      );

      console.log(`طھظ… ط¥ظ†ط´ط§ط،/طھط­ط¯ظٹط« ط§ظ„ظ†ط¸ط§ظ… ${system.code}`);
    }

    console.log('طھظ… ط¥ظ†ط´ط§ط، ط§ظ„ط£ظ†ط¸ظ…ط© ط§ظ„ط£ط³ط§ط³ظٹط© ط¨ظ†ط¬ط§ط­!');

  } catch (error) {
    console.error('ط®ط·ط£ ظپظٹ ط¥ظ†ط´ط§ط، ط§ظ„ط£ظ†ط¸ظ…ط© ط§ظ„ط£ط³ط§ط³ظٹط©:', error);
    throw error;
  }
}

// ط¯ط§ظ„ط© ظ„ط¥ظ†ط´ط§ط، ط§ظ„ط£ط¯ظˆط§ط± ط§ظ„ط£ط³ط§ط³ظٹط©
export async function seedRoles(): Promise<void> {
  try {
    console.log('ط¨ط¯ط، ط¥ظ†ط´ط§ط، ط§ظ„ط£ط¯ظˆط§ط± ط§ظ„ط£ط³ط§ط³ظٹط©...');

    const roles = [
      {
        code: 'admin',
        name_ar: 'ظ…ط¯ظٹط±',
        description: 'ظ…ط¯ظٹط± ط§ظ„ظ†ط¸ط§ظ…'
      },
      {
        code: 'user',
        name_ar: 'ظ…ط³طھط®ط¯ظ…',
        description: 'ظ…ط³طھط®ط¯ظ… ط¹ط§ط¯ظٹ'
      }
    ];

    for (const role of roles) {
      await query(
        `INSERT INTO student_affairs.roles (code, name_ar)
         VALUES ($1, $2)
         ON CONFLICT (code) DO UPDATE SET
         name_ar = EXCLUDED.name_ar`,
        [role.code, role.name_ar]
      );

      console.log(`طھظ… ط¥ظ†ط´ط§ط،/طھط­ط¯ظٹط« ط§ظ„ط¯ظˆط± ${role.code}`);
    }

    console.log('طھظ… ط¥ظ†ط´ط§ط، ط§ظ„ط£ط¯ظˆط§ط± ط§ظ„ط£ط³ط§ط³ظٹط© ط¨ظ†ط¬ط§ط­!');

  } catch (error) {
    console.error('ط®ط·ط£ ظپظٹ ط¥ظ†ط´ط§ط، ط§ظ„ط£ط¯ظˆط§ط± ط§ظ„ط£ط³ط§ط³ظٹط©:', error);
    throw error;
  }
}

