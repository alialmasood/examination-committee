import { NextRequest, NextResponse } from 'next/server';
import {
  deleteNewRegistration,
  getNewRegistrationById,
  updateNewRegistration,
} from '@/src/lib/new-registrations';
import type { ApplicationSnapshot } from '@/src/lib/student-application-print';
import { createPublicApplication } from '@/src/lib/public-applications';
import { archiveApplicationPackage } from '@/src/lib/application-archive';
import { buildPublicApplicationUrl, getRequestSiteOrigin } from '@/src/lib/site-url';
import { validateDepartmentPreferences } from '@/src/lib/student-affairs/branch-departments';
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

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const row = await getNewRegistrationById(id);
    if (!row) {
      return NextResponse.json({ success: false, error: 'الطلب غير موجود' }, { status: 404 });
    }
    return NextResponse.json({ success: true, data: row });
  } catch (error) {
    console.error('new-registrations GET id:', error);
    return NextResponse.json({ success: false, error: 'تعذر جلب الطلب' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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

    const birthDate = String(payload?.personalData?.birthDate || '').trim();
    if (birthDate) {
      const today = new Date();
      const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      if (birthDate > todayIso) {
        return NextResponse.json(
          { success: false, error: 'تاريخ الميلاد لا يمكن أن يكون في المستقبل' },
          { status: 400 }
        );
      }
    }

    const branch = String(payload?.secondaryEducation?.branch || '').trim();
    const prefsCheck = validateDepartmentPreferences(preferences, branch);
    if (!prefsCheck.ok) {
      return NextResponse.json(
        { success: false, error: prefsCheck.error },
        { status: 400 }
      );
    }
    const prefs = prefsCheck.prefs;

    const row = await updateNewRegistration(id, {
      payload: { ...payload, departmentPreferences: prefs },
      preferences: prefs,
    });
    if (!row) {
      return NextResponse.json({ success: false, error: 'الطلب غير موجود' }, { status: 404 });
    }

    const fullPayload = { ...payload, departmentPreferences: prefs } as ApplicationSnapshot;
    let publicUrl = '';
    try {
      await createPublicApplication(fullPayload, row.code);
      publicUrl = buildPublicApplicationUrl(getRequestSiteOrigin(request), row.code);
    } catch (e) {
      console.warn('تعذر مزامنة النسخة العامة بعد التحديث:', e);
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
      console.warn('تعذر أرشفة الاستمارة بعد التحديث:', e);
    }

    return NextResponse.json({
      success: true,
      data: row,
      archive,
      message: archive
        ? `تم تحديث الطلب وأرشفة الاستمارة في ${archive.folderRelative}`
        : 'تم تحديث الطلب بنجاح',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'تعذر تحديث الطلب';
    console.error('new-registrations PUT:', error);
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const existing = await getNewRegistrationById(id);
    if (!existing) {
      return NextResponse.json({ success: false, error: 'الطلب غير موجود' }, { status: 404 });
    }
    if (existing.status === 'confirmed') {
      return NextResponse.json(
        { success: false, error: 'لا يمكن حذف طلب مثبت' },
        { status: 400 }
      );
    }
    const ok = await deleteNewRegistration(id);
    if (!ok) {
      return NextResponse.json({ success: false, error: 'تعذر الحذف' }, { status: 400 });
    }
    return NextResponse.json({ success: true, message: 'تم حذف الطلب' });
  } catch (error) {
    console.error('new-registrations DELETE:', error);
    return NextResponse.json({ success: false, error: 'تعذر حذف الطلب' }, { status: 500 });
  }
}
