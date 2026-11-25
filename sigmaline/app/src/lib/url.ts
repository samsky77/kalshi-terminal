/**
 * Absolute URL on the site's public origin, for redirects from route handlers.
 *
 * On Netlify, `req.url` inside a function is the deploy permalink
 * (https://<deploy-id>--sigmaline.netlify.app), not the domain the visitor is on. Redirecting there
 * moves the browser to another host, so the session cookie just set on the real domain is missing
 * and sign-in looks like it failed. Use APP_URL (the same value the OAuth redirect_uri uses), then
 * the forwarded host, and only then req.url.
 */
export function appUrl(path: string, req: Request): URL {
  const configured = process.env.APP_URL?.replace(/\/$/, '');
  if (configured) return new URL(path, configured);
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (host) {
    const proto = req.headers.get('x-forwarded-proto') ?? new URL(req.url).protocol.replace(':', '');
    return new URL(path, `${proto}://${host}`);
  }
  return new URL(path, req.url);
}
