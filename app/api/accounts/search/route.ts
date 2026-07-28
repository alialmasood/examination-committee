import { NextRequest } from 'next/server';
import {
  isAuthFailure,
  jsonError,
  jsonSuccess,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import { searchAccountsSystem } from '@/src/lib/accounts/global-search';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const q = request.nextUrl.searchParams.get('q')?.trim() || '';
    if (q.length < 2) {
      return jsonSuccess({ results: [], total: 0 });
    }

    const data = await searchAccountsSystem(q);
    return jsonSuccess({
      results: data.results,
      total: data.total,
    });
  } catch (error) {
    console.error('خطأ في البحث العام للحسابات:', error);
    return jsonError(
      'تعذر تنفيذ البحث: ' +
        (error instanceof Error ? error.message : String(error)),
      500
    );
  }
}
