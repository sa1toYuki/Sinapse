import { StageShell } from '../StageShell';
import { FinalRanking } from './FinalRanking';

export function RankingApp() {
  const rankingId = new URLSearchParams(location.search).get('game') ?? undefined;
  return (
    <StageShell home>
      <section className="screen master-screen">
        <FinalRanking rankingId={rankingId} />
      </section>
    </StageShell>
  );
}
