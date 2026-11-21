import { SPORTS } from '@sigmaline/core';
import { buildEdges, buildProps, buildSlate, FEED_KEYS, writeFeed } from '@sigmaline/db';
import type { Ctx } from './context';

/** Rebuild every cached feed the app reads (one row per slate / props board, one for edges). */
export async function buildFeedCache(ctx: Ctx): Promise<{ keys: number; edges: number }> {
  const now = ctx.now();
  let keys = 0;
  try {
    for (const s of SPORTS) {
      await writeFeed(ctx.db, FEED_KEYS.slate(s), await buildSlate(ctx.db, s, now), now);
      await writeFeed(ctx.db, FEED_KEYS.props(s), await buildProps(ctx.db, s, now), now);
      keys += 2;
    }
    const edges = await buildEdges(ctx.db, now);
    await writeFeed(ctx.db, FEED_KEYS.edges, edges, now);
    return { keys: keys + 1, edges: edges.rows.length };
  } catch (err) {
    ctx.log(`feed cache failed: ${(err as Error).message}`);
    return { keys, edges: 0 };
  }
}
