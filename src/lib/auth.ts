import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { query } from './db';
import { AuthUser, SystemAccess, LoginRequest, LoginResponse, JWTPayload, RefreshTokenPayload } from './types';

const JWT_SECRET = process.env.JWT_SECRET || 'please-change-this-key';
const ACCESS_TOKEN_TTL_MIN = Number(process.env.ACCESS_TOKEN_TTL_MIN) || 20;
const REFRESH_TOKEN_TTL_DAYS = Number(process.env.REFRESH_TOKEN_TTL_DAYS) || 30;

// دالة لتوليد JWT
export function generateAccessToken(userId: string, username: string): string {
  const payload: JWTPayload = {
    user_id: userId,
    username,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (ACCESS_TOKEN_TTL_MIN * 60)
  };
  
  return jwt.sign(payload, JWT_SECRET);
}

// دالة لتوليد Refresh Token
export function generateRefreshToken(userId: string, tokenId: string): string {
  const payload: RefreshTokenPayload = {
    user_id: userId,
    token_id: tokenId,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + (REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60)
  };
  
  return jwt.sign(payload, JWT_SECRET);
}

// دالة للتحقق من JWT
export function verifyAccessToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JWTPayload;
  } catch (error) {
    return null;
  }
}

// دالة للتحقق من Refresh Token
export function verifyRefreshToken(token: string): RefreshTokenPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as RefreshTokenPayload;
  } catch (error) {
    return null;
  }
}

// دالة لتسجيل الدخول
export async function authenticateUser(loginData: LoginRequest): Promise<LoginResponse> {
  try {
    // البحث عن المستخدم
    const userResult = await query(
      `SELECT id, username, email, full_name, password_hash, is_active 
       FROM student_affairs.users 
       WHERE username = $1 AND is_active = TRUE`,
      [loginData.username]
    );

    if (userResult.rows.length === 0) {
      // تسجيل محاولة دخول فاشلة
      await logLoginAttempt(loginData.username, null, false);
      return {
        success: false,
        message: 'اسم المستخدم أو كلمة المرور غير صحيحة'
      };
    }

    const user = userResult.rows[0];

    // التحقق من كلمة المرور
    const isPasswordValid = await bcrypt.compare(loginData.password, user.password_hash);
    if (!isPasswordValid) {
      // تسجيل محاولة دخول فاشلة
      await logLoginAttempt(loginData.username, user.id, false);
      return {
        success: false,
        message: 'اسم المستخدم أو كلمة المرور غير صحيحة'
      };
    }

    // الحصول على أنظمة المستخدم مع ترتيب STUDENT_AFFAIRS أولاً
    const systemsResult = await query(
      `SELECT s.code, s.name_ar, s.base_path
       FROM student_affairs.user_systems us
       JOIN student_affairs.systems s ON s.id = us.system_id AND s.is_active = TRUE
       WHERE us.user_id = $1
       ORDER BY CASE WHEN s.code = 'STUDENT_AFFAIRS' THEN 0 ELSE 1 END, s.code`,
      [user.id]
    );

    const systems: SystemAccess[] = systemsResult.rows;

    if (systems.length === 0) {
      return {
        success: false,
        message: 'ليس لديك صلاحية للوصول إلى أي نظام'
      };
    }

    // تسجيل محاولة دخول ناجحة
    await logLoginAttempt(loginData.username, user.id, true);

    // توليد الرموز
    const accessToken = generateAccessToken(user.id, user.username);
    const refreshTokenId = `${user.id}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const refreshToken = generateRefreshToken(user.id, refreshTokenId);

    // حفظ Refresh Token في قاعدة البيانات
    await saveRefreshToken(user.id, refreshTokenId, refreshToken);

    return {
      success: true,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        full_name: user.full_name,
        is_active: user.is_active
      },
      systems,
      access_token: accessToken,
      refresh_token: refreshToken
    };

  } catch (error) {
    console.error('خطأ في المصادقة:', error);
    return {
      success: false,
      message: 'حدث خطأ في النظام'
    };
  }
}

// دالة لحفظ Refresh Token
async function saveRefreshToken(userId: string, tokenId: string, token: string): Promise<void> {
  const hashedToken = await bcrypt.hash(token, 12);
  const expiresAt = new Date(Date.now() + (REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000));

  // إنشاء جدول sessions إذا لم يكن موجوداً
  await query(`
    CREATE TABLE IF NOT EXISTS student_affairs.sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES student_affairs.users(id) ON DELETE CASCADE,
      token_id VARCHAR(255) NOT NULL,
      token_hash TEXT NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_id, token_id)
    );
  `);

  await query(
    `INSERT INTO student_affairs.sessions (user_id, token_id, token_hash, expires_at, created_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (user_id, token_id) DO UPDATE SET
     token_hash = EXCLUDED.token_hash,
     expires_at = EXCLUDED.expires_at`,
    [userId, tokenId, hashedToken, expiresAt]
  );
}

// دالة لتسجيل محاولات الدخول
async function logLoginAttempt(username: string, userId: string | null, success: boolean): Promise<void> {
  // إنشاء جدول login_attempts إذا لم يكن موجوداً
  await query(`
    CREATE TABLE IF NOT EXISTS student_affairs.login_attempts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES student_affairs.users(id) ON DELETE SET NULL,
      username VARCHAR(255),
      ip_address INET,
      success BOOLEAN NOT NULL,
      attempted_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await query(
    `INSERT INTO student_affairs.login_attempts (user_id, username, ip_address, success, attempted_at)
     VALUES ($1, $2, $3, $4, NOW())`,
    [userId, username, '127.0.0.1', success] // TODO: الحصول على IP الحقيقي
  );
}

// دالة للتحقق من صحة المستخدم
export async function validateUser(userId: string): Promise<AuthUser | null> {
  try {
    const result = await query(
      `SELECT id, username, email, full_name, is_active 
       FROM student_affairs.users 
       WHERE id = $1 AND is_active = TRUE`,
      [userId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const user = result.rows[0];
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      full_name: user.full_name,
      is_active: user.is_active
    };
  } catch (error) {
    console.error('خطأ في التحقق من المستخدم:', error);
    return null;
  }
}

// دالة للحصول على أنظمة المستخدم
export async function getUserSystems(userId: string): Promise<SystemAccess[]> {
  try {
    const result = await query(
      `SELECT s.code, s.name_ar, s.base_path
       FROM student_affairs.user_systems us
       JOIN student_affairs.systems s ON s.id = us.system_id AND s.is_active = TRUE
       WHERE us.user_id = $1
       ORDER BY CASE WHEN s.code = 'STUDENT_AFFAIRS' THEN 0 ELSE 1 END, s.code`,
      [userId]
    );

    return result.rows;
  } catch (error) {
    console.error('خطأ في الحصول على أنظمة المستخدم:', error);
    return [];
  }
}
