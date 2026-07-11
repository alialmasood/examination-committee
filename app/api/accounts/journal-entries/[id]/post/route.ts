import { NextRequest } from 'next/server';
import { runPostTransition } from '../../_transition';

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, context: Ctx) {
  const { id } = await context.params;
  return runPostTransition(request, id);
}
