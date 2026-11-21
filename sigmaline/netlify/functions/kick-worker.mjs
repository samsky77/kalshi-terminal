/**
 * Netlify Scheduled Function: starts the Sigmaline worker (GitHub Actions workflow_dispatch) every
 * 15 minutes. GitHub's own every-15-minutes schedule is best-effort and in practice ran every 4-6 hours
 * (BASELINE B2), which missed most pre-game and closing windows. Netlify's scheduler is reliable,
 * free on every plan, and this function only makes one tiny API call, well inside its 30 s limit.
 *
 * Needs GH_DISPATCH_TOKEN in Netlify: a fine-grained GitHub token for this repository with
 * "Actions: read and write" only. Without it the function does nothing. The workflow's concurrency
 * group stops two ticks overlapping.
 */
export default async () => {
  const token = process.env.GH_DISPATCH_TOKEN;
  const repo = process.env.GH_REPO || 'samsky77/kalshi-terminal';
  const ref = process.env.GH_WORKFLOW_REF || 'main';
  if (!token) return new Response('GH_DISPATCH_TOKEN not set; skipping', { status: 200 });
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/sigmaline-worker.yml/dispatches`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'sigmaline-kick-worker' },
    body: JSON.stringify({ ref, inputs: { job: 'tick' } }),
  });
  const ok = res.status === 204;
  console.log(`kick-worker: dispatch ${ok ? 'ok' : `failed ${res.status}`}`);
  return new Response(ok ? 'dispatched' : `dispatch failed: ${res.status}`, { status: ok ? 200 : 502 });
};

export const config = { schedule: '*/15 * * * *' };
