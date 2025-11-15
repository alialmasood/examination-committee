import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';
import { verifyAccessToken, validateUser } from '@/src/lib/auth';

// POST /api/audit-log - تسجيل عملية جديدة
export async function POST(request: NextRequest) {
  try {
    // التحقق من المصادقة
    const accessToken = request.cookies.get('access_token')?.value;
    if (!accessToken) {
      return NextResponse.json(
        { success: false, error: 'غير مصرح' },
        { status: 401 }
      );
    }

    const payload = verifyAccessToken(accessToken);
    if (!payload) {
      return NextResponse.json(
        { success: false, error: 'رمز المصادقة غير صالح' },
        { status: 401 }
      );
    }

    const user = await validateUser(payload.user_id);
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'المستخدم غير موجود' },
        { status: 401 }
      );
    }

    const body = await request.json();
    const {
      action_type,
      entity_type,
      entity_id,
      entity_name,
      description,
      old_values,
      new_values,
    } = body;

    // التحقق من البيانات المطلوبة
    if (!action_type || !entity_type || !description) {
      return NextResponse.json(
        { success: false, error: 'بيانات غير مكتملة' },
        { status: 400 }
      );
    }

    // الحصول على IP address و User Agent
    const ip_address = request.headers.get('x-forwarded-for') || 
                      request.headers.get('x-real-ip') || 
                      'unknown';
    const user_agent = request.headers.get('user-agent') || 'unknown';

    // إدراج السجل
    const insertQuery = `
      INSERT INTO platform.audit_log (
        user_id, username, full_name, action_type, entity_type, entity_id, entity_name,
        description, old_values, new_values, ip_address, user_agent
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id, created_at
    `;

    const result = await query(insertQuery, [
      user.id,
      user.username,
      user.full_name || null,
      action_type,
      entity_type,
      entity_id || null,
      entity_name || null,
      description,
      old_values ? JSON.stringify(old_values) : null,
      new_values ? JSON.stringify(new_values) : null,
      ip_address,
      user_agent,
    ]);

    return NextResponse.json({
      success: true,
      data: {
        id: result.rows[0].id,
        created_at: result.rows[0].created_at,
      },
    });
  } catch (error) {
    console.error('خطأ في تسجيل العملية:', error);
    return NextResponse.json(
      { success: false, error: 'خطأ في تسجيل العملية' },
      { status: 500 }
    );
  }
}

// GET /api/audit-log - جلب سجل العمليات
export async function GET(request: NextRequest) {
  try {
    // التحقق من المصادقة
    const accessToken = request.cookies.get('access_token')?.value;
    if (!accessToken) {
      return NextResponse.json(
        { success: false, error: 'غير مصرح' },
        { status: 401 }
      );
    }

    const payload = verifyAccessToken(accessToken);
    if (!payload) {
      return NextResponse.json(
        { success: false, error: 'رمز المصادقة غير صالح' },
        { status: 401 }
      );
    }

    const user = await validateUser(payload.user_id);
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'المستخدم غير موجود' },
        { status: 401 }
      );
    }

    // الحصول على معاملات البحث والتصفية
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = (page - 1) * limit;
    const action_type = searchParams.get('action_type');
    const entity_type = searchParams.get('entity_type');
    const user_id = searchParams.get('user_id');
    const start_date = searchParams.get('start_date');
    const end_date = searchParams.get('end_date');
    const search = searchParams.get('search');

    // بناء الاستعلام
    let whereConditions: string[] = [];
    let queryParams: unknown[] = [];
    let paramIndex = 1;

    if (action_type) {
      whereConditions.push(`action_type = $${paramIndex}`);
      queryParams.push(action_type);
      paramIndex++;
    }

    if (entity_type) {
      whereConditions.push(`entity_type = $${paramIndex}`);
      queryParams.push(entity_type);
      paramIndex++;
    }

    if (user_id) {
      whereConditions.push(`user_id = $${paramIndex}`);
      queryParams.push(user_id);
      paramIndex++;
    }

    if (start_date) {
      whereConditions.push(`created_at >= $${paramIndex}`);
      queryParams.push(start_date);
      paramIndex++;
    }

    if (end_date) {
      whereConditions.push(`created_at <= $${paramIndex}`);
      queryParams.push(end_date + ' 23:59:59');
      paramIndex++;
    }

    if (search) {
      whereConditions.push(`(
        description ILIKE $${paramIndex} OR
        entity_name ILIKE $${paramIndex} OR
        username ILIKE $${paramIndex} OR
        full_name ILIKE $${paramIndex}
      )`);
      queryParams.push(`%${search}%`);
      paramIndex++;
    }

    const whereClause = whereConditions.length > 0 
      ? `WHERE ${whereConditions.join(' AND ')}`
      : '';

    // جلب السجلات
    const selectQuery = `
      SELECT 
        id, user_id, username, full_name, action_type, entity_type, entity_id, entity_name,
        description, old_values, new_values, ip_address, user_agent, created_at
      FROM platform.audit_log
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    queryParams.push(limit, offset);

    const result = await query(selectQuery, queryParams);

    // جلب العدد الإجمالي
    const countQuery = `
      SELECT COUNT(*) as total
      FROM platform.audit_log
      ${whereClause}
    `;
    const countResult = await query(countQuery, queryParams.slice(0, -2));
    const total = parseInt(countResult.rows[0].total);

    return NextResponse.json({
      success: true,
      data: result.rows.map(row => ({
        id: row.id,
        user_id: row.user_id,
        username: row.username,
        full_name: row.full_name,
        action_type: row.action_type,
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        entity_name: row.entity_name,
        description: row.description,
        old_values: row.old_values,
        new_values: row.new_values,
        ip_address: row.ip_address,
        user_agent: row.user_agent,
        created_at: row.created_at,
      })),
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('خطأ في جلب سجل العمليات:', error);
    return NextResponse.json(
      { success: false, error: 'خطأ في جلب سجل العمليات' },
      { status: 500 }
    );
  }
}

