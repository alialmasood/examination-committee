import { Pool } from 'pg';

// إعداد اتصال قاعدة البيانات
export const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5440,
  database: process.env.DB_NAME || 'examination',
  user: process.env.DB_USER || 'exam_admin',
  password: process.env.DB_PASS || 'StrongPass!2025',
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  client_encoding: 'utf8',
});

// ضبط search_path عند كل اتصال
pool.on('connect', (client) => {
  client.query(`SET search_path TO student_affairs,platform,public;`);
  client.query(`SET client_encoding TO 'UTF8';`);
});

// دالة لتنفيذ الاستعلامات
export async function query(text: string, params?: any[]) {
  const client = await pool.connect();
  try {
    const result = await client.query(text, params);
    return result;
  } finally {
    client.release();
  }
}

// دالة لإغلاق الاتصال
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
