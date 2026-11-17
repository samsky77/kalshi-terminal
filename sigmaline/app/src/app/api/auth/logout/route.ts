import { NextResponse } from 'next/server';
import { cookieOptions, SESSION_COOKIE } from '@/lib/session';

export async function POST(req: Request) {
  const res = NextResponse.redirect(new URL('/', req.url), 303);
  res.cookies.set(SESSION_COOKIE, '', cookieOptions(0));
  return res;
}
