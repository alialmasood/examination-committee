import { Pool } from 'pg';

// إعداد اتصال قاعدة البيانات
export const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5440,
  database: process.env.DB_NAME || 'examination',
  user: process.env.DB_USER || 'exam_admin',
  password: process.env.DB_PASS || 'StrongPass!2025',
  // رفع الحد لتجنب timeout عند الطلبات المتوازية (لوحة الحسابات / المصادقة)
  max: 25,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
  // ضبط الجلسة عند إنشاء الاتصال دون سباق مع أول استعلام
  options: `-c search_path=student_affairs,platform,public -c client_encoding=UTF8`,
});

pool.on('error', (err) => {
  console.error('خطأ غير متوقع في اتصال قاعدة البيانات:', err);
});

/** تنفيذ استعلام مع أخذ اتصال من الـ pool ثم إعادته فوراً */
export async function query(text: string, params?: any[]) {
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return result;
  } finally {
    client.release();
  }
}

export async function closePool() {
  await pool.end();
}

// أنواع TypeScript للبيانات
export interface User {
  id: number;
  username: string;
  email?: string;
  full_name?: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface System {
  id: number;
  code: string;
  name_ar: string;
  base_path: string;
  is_active: boolean;
}

export interface UserSystem {
  user_id: number;
  system_id: number;
  system_code: string;
  system_name_ar: string;
  base_path: string;
}

export interface LoginAttempt {
  id: number;
  user_id?: number;
  username?: string;
  ip_address: string;
  success: boolean;
  attempted_at: Date;
}
