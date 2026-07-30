import { NextRequest } from 'next/server';
import {
  isAuthFailure,
  jsonSuccess,
  mapPgError,
  requireAccountsAccess,
} from '@/src/lib/accounts/auth';
import { getAccountsDashboardStats } from '@/src/lib/accounts/accounts-dashboard';
import { buildStudentsFinanceSummary } from '@/src/lib/accounts/students-finance-summary';
export async function GET(request: NextRequest) {
  const auth = await requireAccountsAccess(request);
  if (isAuthFailure(auth)) return auth.response;

  try {
    const stats = await getAccountsDashboardStats();

    // إثراء الذمم/المقبوضات من وصولات التسديد — خارج المعاملة حتى لا تتعطّل اللوحة
    try {
      const finance = await buildStudentsFinanceSummary();
      stats.tuition.collected_amount = String(finance.collected_amount);
      stats.students.total_receivable_balance = String(finance.debt_amount);
      stats.students.posted_collections = finance.receipts_count;
      stats.students.collections_total = String(finance.collected_amount);
      stats.students.pending_installments = finance.partial_paid_count;
      stats.students.overdue_installments = finance.unpaid_count;
    } catch (financeErr) {
      console.error('تعذر إثراء لوحة الحسابات بملخص التسديد:', financeErr);
    }

    return jsonSuccess({ stats });
  } catch (error) {
    return mapPgError(error);
  }
}
