import { create as createQR } from 'qrcode';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { StageShell, TimerLED } from '../StageShell';
import { sound } from '../audio/sound';
import { choices } from '../data/choices';
import { questions, type Letter } from '../data/questions';
import { points } from '../data/scoring';
import { useMasterRoom, type Entry } from './useMasterRoom';

function Invitation({ pin }: { pin: string }) {
  const href = new URL(`/?pin=${pin}`, location.origin).href;
  const { size, path } = useMemo(() => {
    const { modules } = createQR(href, { errorCorrectionLevel: 'M' });
    const path = Array.from(modules.data, (black, index) => black
      ? `M${index % modules.size + 4} ${Math.floor(index / modules.size) + 4}h1v1h-1z` : '').join('');
    return { size: modules.size + 8, path };
  }, [href]);

  return (
    <div className="master-invite master-panel">
      <div>
        <h1 className="master-label">PIN da sala</h1>
        <strong className="master-pin">{pin}</strong>
      </div>
      <svg className="master-qr" role="img" aria-label={`QR code da sala ${pin}`} data-url={href}
        viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges">
        <rect width={size} height={size} fill="white" />
        <path fill="#07132c" d={path} />
      </svg>
    </div>
  );
}

function Clock({ expiresAt, muted }: { expiresAt: number; muted: boolean }) {
  const seconds = () => Math.max(0, Math.ceil((expiresAt - performance.now()) / 1000));
  const [time, setTime] = useState(seconds);
  useEffect(() => {
    let last = seconds();
    setTime(last);
    const timer = window.setInterval(() => {
      const remaining = seconds();
      if (remaining === last) return;
      if (remaining < last && remaining > 0 && remaining <= 10) sound('tick', !muted);
      last = remaining;
      setTime(remaining);
    }, 100);
    return () => window.clearInterval(timer);
  }, [expiresAt, muted]);
  return <div role="timer" aria-label={`${time} segundos`}><TimerLED time={time} /></div>;
}

function Question({ index, text, options, correct, counts }: {
  index: number; text: string; options: Record<Letter, string>; correct?: Letter; counts?: Record<Letter, number>;
}) {
  return (
    <div className="master-question">
      <div className="question-panel">
        <span className="master-label">Pergunta {index} / {questions.length}</span>
        <h1 tabIndex={-1}>{text}</h1>
      </div>
      <ol className="master-answers" aria-label="Alternativas">
        {choices.map(({ letter, color }) => (
          <li key={letter} className={`answer${letter === correct ? ' correct' : ''}`}>
            <span className="answer-letter" style={{ backgroundColor: color }}>{letter}</span>
            <span className="answer-text">{options[letter]}</span>
            {counts && <span className="master-option-count" aria-label={`${counts[letter]} respostas`}>{counts[letter]}</span>}
            {letter === correct && <span className="master-check" role="img" aria-label="Resposta correta">✓</span>}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Score({ score }: { score: number }) {
  return <strong className="master-score">{points(score)} <small>pts</small></strong>;
}

function Ranking({ entries, podium = false }: { entries: Entry[]; podium?: boolean }) {
  const leaders = entries.slice(0, podium ? 3 : 5);
  return (
    <div className={`master-results${podium ? ' master-results-final' : ''}`}>
      <h1 tabIndex={-1}>{podium ? 'Pódio final' : 'Top 5'}</h1>
      <ol className={podium ? 'master-podium' : 'master-ranking'}>
        {leaders.map(entry => (
          <li key={entry.playerId} data-rank={entry.rank} className="master-panel">
            <span className="master-place">{entry.rank}º</span>
            <span className="master-entry-name">{entry.name}</span>
            <Score score={entry.score} />
          </li>
        ))}
      </ol>
    </div>
  );
}

export function MasterApp() {
  const room = useMasterRoom();
  const { view, connection } = room;
  const [muted, setMuted] = useState(true);
  const screen = useRef<HTMLElement>(null);
  const phase = view?.phase;
  const questionIndex = view?.questionIndex;
  const revealed = view?.phase === 'QUESTION_REVEAL' && !!view.reveal;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;

  useEffect(() => {
    screen.current?.querySelector('h1')?.focus({ preventScroll: true });
  }, [phase, questionIndex, revealed]);

  useEffect(() => {
    if (revealed) sound('correct', !mutedRef.current);
  }, [questionIndex, revealed]);

  const ready = connection === 'ready' && !room.pending;
  const action = (label: string, handler: () => void, disabled = false) => (
    <button type="button" className="primary master-action" onClick={connection === 'paused' ? room.resume : handler}
      disabled={connection !== 'paused' && (!ready || disabled)}>
      {connection === 'paused' ? 'Retomar sala' : connection === 'reconnecting' ? 'Reconectando…' : label}
    </button>
  );

  let content: ReactNode;
  if (!view || !room.pin) {
    content = (
      <div className="master-create master-panel">
        <span className="master-emblem" aria-hidden="true">✦</span>
        <h1 tabIndex={-1}>Sala ao vivo</h1>
        {room.pin ? action('Conectando…', room.resume) : (
          <button type="button" className="primary master-action" disabled={room.creating} onClick={room.create}>
            {room.creating ? 'Criando…' : 'Criar sala'}
          </button>
        )}
      </div>
    );
  } else if (view.phase === 'LOBBY') {
    content = (
      <div className="master-lobby">
        <Invitation pin={room.pin} />
        <div className="master-roster master-panel">
          <h2 className="master-label">Jogadores <strong aria-live="polite">{view.players.length}</strong></h2>
          <ul className="master-players" aria-label="Jogadores na sala" tabIndex={view.players.length ? 0 : undefined}>
            {view.players.map(player => (
              <li key={player.playerId}>
                <span className="master-presence" role="img" aria-label={player.connected ? 'Conectado' : 'Desconectado'}
                  data-connected={player.connected} />
                <span>{player.name}</span>
              </li>
            ))}
          </ul>
          {action('Iniciar partida', () => room.send('master.start'), view.players.length === 0)}
        </div>
      </div>
    );
  } else if (view.phase === 'QUESTION_OPEN') {
    content = (
      <div className="master-round">
        <div className="master-round-status">
          <Clock key={view.questionId} expiresAt={view.expiresAt} muted={muted} />
          <div className="master-panel master-count">
            <span className="master-label">Respostas</span>
            <strong>{view.answeredCount}<span> / {view.eligibleCount}</span></strong>
          </div>
        </div>
        <Question index={view.questionIndex} text={view.text} options={view.options} />
        <div className="master-round-control">{action('Encerrar pergunta', () => room.send('master.end_question'))}</div>
      </div>
    );
  } else if (view.phase === 'QUESTION_REVEAL') {
    const question = view.question ?? questions.find(item => item.id === view.questionId);
    content = question && (
      <div className="master-round master-reveal">
        <Question index={view.questionIndex} text={question.text} options={question.options}
          correct={view.reveal?.correct} counts={view.reveal?.counts} />
        <div className="master-round-control">
          {action('Ver ranking', () => room.send('master.show_leaderboard'), !view.reveal)}
        </div>
      </div>
    );
  } else {
    const final = view.phase === 'FINAL_PODIUM';
    content = (
      <>
        <Ranking entries={view.entries} podium={final} />
        {final && connection !== 'paused' ? (
          <button type="button" className="primary master-action" disabled={room.creating} onClick={room.create}>
            {room.creating ? 'Criando…' : 'Nova sala'}
          </button>
        ) : action(final ? 'Nova sala' : view.questionIndex === questions.length ? 'Ver pódio' : 'Próxima pergunta', () => room.send('master.next'))}
      </>
    );
  }

  return (
    <StageShell home muted={muted} onSound={() => { if (muted) sound('intro', true); setMuted(!muted); }}>
      <section ref={screen} className="screen master-screen" data-phase={phase ?? 'CREATE'}>
        {content}
        {room.error && <p className="master-error" role="alert">{room.error}</p>}
      </section>
    </StageShell>
  );
}
