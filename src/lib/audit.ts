/**
 * دالة مساعدة لتسجيل العمليات في سجل العمليات (Audit Log)
 * للاستخدام في Server Components و API Routes فقط
 */

import 'server-only';
import { query } from './db';

interface AuditLogData {
  user_id: string;
  username: string;
  full_name?: string | null;
  action_type: string;
  entity_type: string;
  entity_id?: string;
  entity_name?: string;
  description: string;
  old_values?: Record<string, unknown> | null;
  new_values?: Record<string, unknown> | null;
  ip_address?: string;
  user_agent?: string;
}

/**
 * تسجيل عملية في سجل العمليات (للاستخدام من API routes)
 */
export async function logAuditDirect(data: AuditLogData): Promise<void> {
  try {
    console.log('📝 محاولة تسجيل العملية في سجل العمليات:', {
      action_type: data.action_type,
      entity_type: data.entity_type,
      entity_id: data.entity_id,
      username: data.username,
    });

    const insertQuery = `
      INSERT INTO platform.audit_log (
        user_id, username, full_name, action_type, entity_type, entity_id, entity_name,
        description, old_values, new_values, ip_address, user_agent
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id
    `;

    const result = await query(insertQuery, [
      data.user_id,
      data.username,
      data.full_name || null,
      data.action_type,
      data.entity_type,
      data.entity_id || null,
      data.entity_name || null,
      data.description,
      data.old_values ? JSON.stringify(data.old_values) : null,
      data.new_values ? JSON.stringify(data.new_values) : null,
      data.ip_address || null,
      data.user_agent || null,
    ]);

    console.log('✅ تم تسجيل العملية بنجاح في سجل العمليات:', result.rows[0]?.id);
  } catch (error) {
    // لا نريد أن تؤثر أخطاء التسجيل على العمليات الرئيسية
    console.error('❌ خطأ في تسجيل العملية في سجل العمليات:', error);
    if (error instanceof Error) {
      console.error('❌ تفاصيل الخطأ:', error.message);
      console.error('❌ Stack:', error.stack);
    }
  }
}

/**
 * تسجيل عملية في سجل العمليات (للاستخدام من Frontend)
 */
export async function logAudit(data: Omit<AuditLogData, 'user_id' | 'username' | 'full_name' | 'ip_address' | 'user_agent'>): Promise<void> {
  try {
    // تسجيل العملية عبر API
    await fetch('/api/audit-log', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });
  } catch (error) {
    // لا نريد أن تؤثر أخطاء التسجيل على العمليات الرئيسية
    console.error('خطأ في تسجيل العملية في سجل العمليات:', error);
  }
}


