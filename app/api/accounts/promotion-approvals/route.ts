import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/src/lib/db';
import {
  isAuthFailure,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import {
  countPendingPromotionRequests,
  reviewPromotionRequest,
  stageLabel,
} from '@/src/lib/student-affairs/stage-promotion';

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const { searchParams } = new URL(request.url);
    const status = (searchParams.get('status') || 'pending').trim();

    const result = await query(
      `SELECT r.id, r.student_id, r.from_stage, r.to_stage, r.fee_year,
              r.remaining_amount, r.academic_year, r.department, r.status,
              r.requested_by_username, r.reviewed_by_username, r.notes,
              r.review_notes, r.created_at, r.reviewed_at,
              s.full_name_ar, s.full_name, s.university_id, s.major
       FROM student_affairs.stage_promotion_requests r
       JOIN student_affairs.students s ON s.id = r.student_id
       WHERE ($1::text = 'all' OR r.status = $1)
       ORDER BY r.created_at DESC
       LIMIT 200`,
      [status]
    );

    const pendingCount = await countPendingPromotionRequests();

    return NextResponse.json({
      success: true,
      pendingCount,
      data: result.rows.map((r) => ({
        id: r.id,
        studentId: r.student_id,
        studentName: r.full_name_ar || r.full_name || '',
        universityId: r.university_id,
        department: r.department || r.major || '',
        academicYear: r.academic_year,
        fromStage: r.from_stage,
        fromStageLabel: stageLabel(r.from_stage),
        toStage: r.to_stage,
        toStageLabel: stageLabel(r.to_stage),
        feeYear: Number(r.fee_year),
        remainingAmount: Number(r.remaining_amount || 0),
        status: r.status,
        requestedBy: r.requested_by_username,
        reviewedBy: r.reviewed_by_username,
        notes: r.notes,
        reviewNotes: r.review_notes,
        createdAt: r.created_at,
        reviewedAt: r.reviewed_at,
      })),
    });
  } catch (error) {
    console.error('promotion-approvals GET:', error);
    return NextResponse.json(
      { success: false, error: 'تعذر جلب طلبات الترحيل' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const body = await request.json();
    const requestId = String(body.requestId || '').trim();
    const action = String(body.action || '').trim() as 'approve' | 'reject';
    const reviewNotes = body.reviewNotes ? String(body.reviewNotes) : null;

    if (!requestId || (action !== 'approve' && action !== 'reject')) {
      return NextResponse.json(
        { success: false, error: 'requestId و action مطلوبة' },
        { status: 400 }
      );
    }

    const result = await reviewPromotionRequest({
      requestId,
      action,
      reviewNotes,
      actor: {
        userId: auth.user.id,
        username: auth.user.username,
        fullName: auth.user.full_name,
        ipAddress: auth.ipAddress,
        userAgent: auth.userAgent,
      },
    });

    if (!result.success) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true, message: result.message });
  } catch (error) {
    console.error('promotion-approvals POST:', error);
    return NextResponse.json(
      { success: false, error: 'تعذر معالجة الطلب' },
      { status: 500 }
    );
  }
}
