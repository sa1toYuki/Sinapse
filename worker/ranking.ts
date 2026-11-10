import type { RankingEntry, RankingResult } from '../src/ranking/types';

export const rankingId = (pin: string, finishedAt: number) => `${pin}-${finishedAt}`;

export function parseRankingId(id: string) {
  const match = /^([0-9]{6})-([0-9]{1,16})$/.exec(id);
  if (!match) return null;
  const finishedAt = Number(match[2]);
  return Number.isSafeInteger(finishedAt) ? { pin: match[1], finishedAt } : null;
}

export async function readFinalRanking(db: D1Database, selected: ReturnType<typeof parseRankingId>): Promise<RankingResult | null> {
  const game = await (selected === null
    ? db.prepare("SELECT game_id, pin, finished_at FROM games WHERE status = 'finished' ORDER BY finished_at DESC, game_id DESC LIMIT 1")
    : db.prepare("SELECT game_id, pin, finished_at FROM games WHERE status = 'finished' AND pin = ? AND finished_at = ? ORDER BY game_id DESC LIMIT 1")
      .bind(selected.pin, selected.finishedAt))
    .first<{ game_id: string; pin: string; finished_at: number }>();

  if (!game) return selected === null ? { rankingId: null, entries: [] } : null;

  const { results } = await db.prepare(`
    SELECT name, rank, score, response_time_ms AS responseTimeMs
    FROM game_results
    WHERE game_id = ?
    ORDER BY score DESC, response_time_ms ASC, rank ASC
  `).bind(game.game_id).all<RankingEntry>();

  return { rankingId: rankingId(game.pin, game.finished_at), entries: results };
}
