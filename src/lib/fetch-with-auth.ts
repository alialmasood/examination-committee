/**
 * fetch مع إرسال الكوكيز، وتجديد الجلسة تلقائياً عند 401 ثم إعادة المحاولة مرة واحدة.
 */
export async function fetchWithAuth(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const options: RequestInit = {
    ...init,
    credentials: 'include',
    headers: init?.headers,
  };

  let res = await fetch(input, options);

  if (res.status !== 401) {
    return res;
  }

  const refreshRes = await fetch('/api/auth/refresh', {
    method: 'POST',
    credentials: 'include',
  });

  if (!refreshRes.ok) {
    return res;
  }

  res = await fetch(input, options);
  return res;
}
