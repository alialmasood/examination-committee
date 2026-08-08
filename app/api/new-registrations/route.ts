import { NextRequest, NextResponse } from 'next/server';
import { createNewRegistration, listNewRegistrations } from '@/src/lib/new-registrations';
import type { ApplicationSnapshot } from '@/src/lib/student-application-print';
import { createPublicApplication } from '@/src/lib/public-applications';
import { buildPublicApplicationUrl, getRequestSiteOrigin } from '@/src/lib/site-url';
import { archiveApplicationPackage } from '@/src/lib/application-archive';
import { query } from '@/src/lib/db';

async function persistArchiveMeta(
  rowId: string,
  archive: {
    folderRelative: string;
    formRelative: string;
    attachments: string[];
  }
) {
  await query(
    `UPDATE student_affairs.new_registrations
     SET payload = COALESCE(payload, '{}'::jsonb) || $2::jsonb,
         updated_at = NOW()
     WHERE id = $1::uuid`,
    [
      rowId,
      JSON.stringify({
        archiveFolder: archive.folderRelative,
        archiveForm: archive.formRelative,
        archiveAttachments: archive.attachments,
        archivedAt: new Date().toISOString(),
      }),
    ]
  );
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const data = await listNewRegistrations({
      search: searchParams.get('search') || '',
      department: searchParams.get('department') || '',
      studyType: searchParams.get('study_type') || '',
      academicYear: searchParams.get('academic_year') || '',
      page: parseInt(searchParams.get('page') || '1', 10),
      limit: parseInt(searchParams.get('limit') || '40', 10),
    });
    return NextResponse.json({ success: true, ...data });
  } catch (error) {
    console.error('new-registrations GET:', error);
    return NextResponse.json(
      { success: false, error: 'تعذر جلب طلبات التسجيل الجديد' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const payload = body?.payload as ApplicationSnapshot | undefined;
    const preferences = body?.preferences as
      | { first?: string; second?: string; third?: string }
      | undefined;

    if (!payload?.personalData?.fullName) {
      return NextResponse.json(
        { success: false, error: 'بيانات الاستمارة غير مكتملة' },
        { status: 400 }
      );
    }
    if (!preferences?.first || !preferences?.second || !preferences?.third) {
      return NextResponse.json(
        { success: false, error: 'يجب اختيار ثلاث رغبات أقسام' },
        { status: 400 }
      );
    }
    const prefs = {
      first: preferences.first,
      second: preferences.second,
      third: preferences.third,
    };
    if (new Set([prefs.first, prefs.second, prefs.third]).size < 3) {
      return NextResponse.json(
        { success: false, error: 'يجب أن تكون الرغبات الثلاث أقساماً مختلفة' },
        { status: 400 }
      );
    }

    const fullPayload = { ...payload, departmentPreferences: prefs } as ApplicationSnapshot;
    const row = await createNewRegistration({
      payload: fullPayload,
      preferences: prefs,
    });

    let publicUrl = '';
    try {
      const publicCode = await createPublicApplication(fullPayload, row.code);
      publicUrl = buildPublicApplicationUrl(getRequestSiteOrigin(request), publicCode);
    } catch (e) {
      console.warn('تعذر إنشاء رابط عام للطلب:', e);
    }

    let archive: Awaited<ReturnType<typeof archiveApplicationPackage>> | null = null;
    try {
      archive = await archiveApplicationPackage({
        fullName: row.full_name || payload.personalData.fullName,
        code: row.code,
        payload: fullPayload,
        publicUrl: publicUrl || undefined,
      });
      await persistArchiveMeta(row.id, archive);
    } catch (e) {
      console.warn('تعذر أرشفة الاستمارة والمرفقات:', e);
    }

    return NextResponse.json({
      success: true,
      data: row,
      publicUrl,
      archive,
      message: archive
        ? `تم حفظ طلب التسجيل وأرشفة الاستمارة باسم الطالب في ${archive.folderRelative}`
        : 'تم حفظ طلب التسجيل الجديد بنجاح',
    });
  } catch (error) {
    console.error('new-registrations POST:', error);
    return NextResponse.json(
      { success: false, error: 'تعذر حفظ طلب التسجيل الجديد' },
      { status: 500 }
    );
  }
}
