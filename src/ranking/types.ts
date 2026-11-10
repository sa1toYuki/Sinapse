export type RankingEntry = { name: string; rank: number; score: number; responseTimeMs: number };
export type RankingResult = { rankingId: string | null; entries: RankingEntry[] };
