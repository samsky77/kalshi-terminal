export class HttpError extends Error {
  constructor(public status: number, message: string, public headers?: Headers) { super(message); }
}

/** GET JSON with a timeout and up to 2 retries on network errors / 5xx (never on 4xx: quota). */
export async function getJson<T>(url: string, init: { headers?: Record<string, string>; timeoutMs?: number } = {}): Promise<{ body: T; headers: Headers }> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), init.timeoutMs ?? 20000);
    try {
      const res = await fetch(url, { headers: { accept: 'application/json', ...(init.headers ?? {}) }, signal: ctl.signal });
      if (res.status >= 500) throw new HttpError(res.status, `HTTP ${res.status}`, res.headers);
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new HttpError(res.status, `HTTP ${res.status}: ${text.slice(0, 200)}`, res.headers);
      }
      return { body: (await res.json()) as T, headers: res.headers };
    } catch (e) {
      lastErr = e;
      if (e instanceof HttpError && e.status < 500) throw e;
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr;
}

/** Strip secrets from URLs before logging. */
export function redact(url: string): string {
  return url.replace(/(apiKey|api_key|key)=[^&]+/gi, '$1=***');
}
