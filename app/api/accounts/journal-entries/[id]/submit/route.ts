import { NextRequest } from 'next/server';
import { runJournalTransition } from '../../_transition';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Ctx) {
  const { id } = await context.params;
  return runJournalTransition(request, id, 'submit', { requireStrictBalance: true });
}
