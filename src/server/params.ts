import { SPORTS, type Sport } from '@/core/types';
export function parseSport(v: string | null | undefined): Sport | null {
  return v && (SPORTS as string[]).includes(v) ? (v as Sport) : null;
}
export const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });
