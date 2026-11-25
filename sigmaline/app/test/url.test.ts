import { afterEach, describe, expect, it } from 'vitest';
import { appUrl } from '../src/lib/url';

// Netlify hands functions the deploy permalink as req.url; redirects must stay on the public domain
// or the session cookie set during the Whop callback is lost.
const permalink = 'https://6b020ffc4a3808ba84a2e98c--sigmaline.netlify.app/api/auth/callback?code=x';
const saved = process.env.APP_URL;
afterEach(() => { if (saved === undefined) delete process.env.APP_URL; else process.env.APP_URL = saved; });

describe('appUrl', () => {
  it('uses APP_URL, not the deploy permalink in req.url', () => {
    process.env.APP_URL = 'https://sigmaline.netlify.app/';
    expect(appUrl('/slate', new Request(permalink)).href).toBe('https://sigmaline.netlify.app/slate');
  });
  it('falls back to the forwarded host, then req.url', () => {
    delete process.env.APP_URL;
    const fwd = new Request(permalink, { headers: { 'x-forwarded-host': 'sigmaline.netlify.app', 'x-forwarded-proto': 'https' } });
    expect(appUrl('/login?error=state', fwd).href).toBe('https://sigmaline.netlify.app/login?error=state');
    expect(appUrl('/', new Request('http://localhost:3000/api/auth/logout')).href).toBe('http://localhost:3000/');
  });
});
