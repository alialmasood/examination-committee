import { redirect } from 'next/navigation';

/** المسار القديم داخل شؤون الطلبة لم يعد مستخدماً. */
export default function LegacySystemsAdminGone() {
  redirect('/student-affairs');
}
