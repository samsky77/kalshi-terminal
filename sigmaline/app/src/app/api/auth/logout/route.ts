import { NextResponse } from 'next/server';
import { cookieOptions, SESSION_COOKIE } from '@/lib/session';
import { appUrl } from '@/lib/url';

export async function POST(req: Request) {
  const res = NextResponse.redirect(appUrl('/', req), 303);
  res.cookies.set(SESSION_COOKIE, '', cookieOptions(0));
  return res;
}
