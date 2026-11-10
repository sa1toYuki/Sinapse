import { useEffect, useState, type ReactNode } from 'react';
import { points } from '../data/scoring';
import type { RankingEntry, RankingResult } from './types';

function formatTime(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function RankingTable({ entries }: { entries: RankingEntry[] }) {
  return (
    <table className="final-ranking-table master-panel" aria-label="Ranking final">
      <thead>
        <tr>
          <th scope="col" aria-label="Posição">#</th>
          <th scope="col">Nome</th>
          <th scope="col">Pontuação</th>
          <th scope="col">Tempo</th>
        </tr>
      </thead>
      <tbody>
        {entries.map(entry => (
          <tr key={entry.rank}>
            <td>{entry.rank}º</td>
            <th scope="row">{entry.name}</th>
            <td>{points(entry.score)}</td>
            <td>{formatTime(entry.responseTimeMs)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function FinalRanking({ rankingId, persisted = true, podium = false, children }: {
  rankingId?: string; persisted?: boolean; podium?: boolean; children?: ReactNode;
}) {
  const [result, setResult] = useState<RankingResult | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!persisted) return;
    const controller = new AbortController();
    const query = rankingId === undefined ? '' : `?${new URLSearchParams({ game: rankingId })}`;

    async function load() {
      try {
        const response = await fetch(`/api/ranking${query}`, { signal: controller.signal });
        if (response.status === 404) {
          if (!controller.signal.aborted) setError('Partida não encontrada.');
          return;
        }
        if (!response.ok) throw new Error('Ranking unavailable');
        const ranking: RankingResult = await response.json();
        if (!controller.signal.aborted) setResult(ranking);
      } catch {
        if (!controller.signal.aborted) setError('Ranking indisponível.');
      }
    }
    void load();
    return () => controller.abort();
  }, [rankingId, persisted, attempt]);

  return (
    <div className="master-results master-results-final">
      <h1 tabIndex={-1}>{podium ? 'Pódio final' : 'Ranking final'}</h1>
      {podium && !!result?.entries.length && (
        <ol className="master-podium" aria-label="Pódio">
          {result.entries.slice(0, 3).map(entry => (
            <li key={entry.rank} data-rank={entry.rank} className="master-panel">
              <span className="master-place">{entry.rank}º</span>
              <span className="master-entry-name">{entry.name}</span>
              <strong className="master-score">{points(entry.score)} <small>pts</small></strong>
            </li>
          ))}
        </ol>
      )}
      {(children || (podium && result?.rankingId)) && (
        <div className="final-ranking-actions">
          {podium && result?.rankingId && (
            <a className="secondary final-ranking-link" href={`/ranking?${new URLSearchParams({ game: result.rankingId })}`}>
              Ranking público
            </a>
          )}
          {children}
        </div>
      )}
      {error ? (
        <div className="final-ranking-status">
          <p role="alert">{error}</p>
          <button type="button" className="secondary" onClick={() => { setError(''); setAttempt(value => value + 1); }}>Tentar novamente</button>
        </div>
      ) : result ? (
        result.entries.length ? <RankingTable entries={result.entries} /> : <p role="status">Sem resultados.</p>
      ) : <p role="status">{persisted ? 'Carregando ranking…' : 'Salvando ranking…'}</p>}
    </div>
  );
}
