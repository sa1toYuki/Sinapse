import { useEffect, useState, type FormEvent } from 'react';
import { choices } from '../data/choices';
import { points } from '../data/scoring';
import { normalizeName, validPin } from '../rooms/identity';
import { messageId, openRoomSocket } from '../rooms/socket';
import { usePlayerRoom } from './usePlayerRoom';

const entryErrors: Record<string, string> = {
  INVALID_PIN: 'PIN inválido.',
  INVALID_PAYLOAD: 'Nome inválido.',
  WRONG_PHASE: 'Partida já iniciada.',
  ROOM_FULL: 'Sala cheia.',
  KICKED: 'Removido da sala.',
  ROOM_EXPIRED: 'Sessão encerrada.',
  CONNECTION: 'Conexão indisponível.',
};

function useNameTaken(pin: string, name: string, enabled: boolean) {
  const [taken, setTaken] = useState<{ pin: string; name: string } | null>(null);

  useEffect(() => {
    setTaken(null);
    if (!enabled || !validPin(pin) || !name) return;
    let socket: WebSocket | undefined;
    let timeout: number | undefined;
    let disposed = false;
    const debounce = window.setTimeout(() => {
      const ws = openRoomSocket(pin);
      socket = ws;
      const requestId = messageId();
      timeout = window.setTimeout(() => ws.close(), 5000);
      ws.addEventListener('open', () => {
        ws.send(JSON.stringify({ v: 1, type: 'player.check_name', pin, name, requestId }));
      });
      ws.addEventListener('message', event => {
        if (disposed) return;
        let frame;
        try { frame = JSON.parse(event.data); } catch { return; }
        if (frame?.v !== 1 || frame.requestId !== requestId) return;
        if (frame.type === 'name_status' && frame.available === false) setTaken({ pin, name });
        ws.close();
      });
      ws.addEventListener('close', () => window.clearTimeout(timeout));
    }, 250);

    return () => {
      disposed = true;
      window.clearTimeout(debounce);
      window.clearTimeout(timeout);
      socket?.close();
    };
  }, [pin, name, enabled]);

  return enabled && taken?.pin === pin && taken.name === name;
}

function ReconnectIcon({ resume }: { resume?: () => void }) {
  const icon = (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6v5h-5M20 11a8 8 0 1 0-1 6" />
    </svg>
  );
  return resume
    ? <button className="player-connection" type="button" onClick={resume} aria-label="Retomar conexão">{icon}</button>
    : <div className="player-connection player-reconnecting" role="status" aria-label="Reconectando">{icon}</div>;
}

function Score({ value, rank, gained = false }: { value: number; rank: number; gained?: boolean }) {
  return (
    <div className="player-score">
      <strong>{gained ? '+' : ''}{points(value)} <small>pts</small></strong>
      <strong>{rank}º <small>lugar</small></strong>
    </div>
  );
}

export function PlayerApp({ initialPin }: { initialPin: string }) {
  const [pin, setPin] = useState(initialPin);
  const [name, setName] = useState('');
  const room = usePlayerRoom(initialPin);
  const { view, connection } = room;
  const normalized = normalizeName(name);
  const checking = connection === 'idle';
  const taken = useNameTaken(pin, normalized?.name ?? '', checking);
  const nameError = taken || room.error === 'NAME_TAKEN';
  const joining = connection === 'joining';
  const expiresAt = view?.phase === 'QUESTION_OPEN' ? view.expiresAt : null;
  const [expiredAt, setExpiredAt] = useState<number | null>(null);

  useEffect(() => {
    if (expiresAt === null) return;
    const timer = window.setTimeout(() => setExpiredAt(expiresAt), Math.max(0, expiresAt - performance.now()));
    return () => window.clearTimeout(timer);
  }, [expiresAt]);

  function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (validPin(pin) && normalized) room.join(pin, normalized.name);
  }

  return (
    <main className="app frame player-frame" data-phase={view?.phase ?? 'JOIN'}>
      {connection === 'reconnecting' && <ReconnectIcon />}
      {connection === 'replaced' && <ReconnectIcon resume={room.resume} />}
      <section className="player-screen">
        {!view && (connection === 'idle' || joining) && (
          <form className="player-join" onSubmit={join}>
            <h1>Entrar na sala</h1>
            <label htmlFor="player-pin">PIN</label>
            <input id="player-pin" className="player-pin" type="text" inputMode="numeric" pattern="[0-9]{6}"
              maxLength={6} autoComplete="off" required disabled={joining} value={pin} aria-invalid={room.error === 'INVALID_PIN'}
              onChange={event => { setPin(event.target.value.replace(/[^0-9]/g, '')); room.clearError(); }} />
            <label htmlFor="player-name">Nome</label>
            <input id="player-name" type="text" autoComplete="nickname" maxLength={160} required disabled={joining} value={name}
              aria-invalid={nameError} aria-describedby={nameError ? 'player-name-error' : undefined}
              onChange={event => { setName(event.target.value); room.clearError(); }} />
            {nameError && <p id="player-name-error" className="player-error" role="alert">Nome em uso.</p>}
            {room.error && room.error !== 'NAME_TAKEN' && (
              <p className="player-error" role="alert">{entryErrors[room.error] ?? 'Entrada indisponível.'}</p>
            )}
            <button type="submit" className="primary player-enter" disabled={joining || !validPin(pin) || !normalized}>
              {joining ? 'Entrando…' : 'Entrar'}
            </button>
          </form>
        )}
        {view?.phase === 'LOBBY' && <h1 role="status">Aguardando início</h1>}
        {view?.phase === 'QUESTION_OPEN' && (view.answered ? <h1 role="status">Enviado</h1> : (
          <div className="player-choices" role="group" aria-label="Alternativas" aria-busy={room.pending}>
            {choices.map(({ letter, color }) => (
              <button key={letter} type="button" style={{ backgroundColor: color }}
                disabled={connection !== 'ready' || room.pending || expiredAt === expiresAt} onClick={() => room.answer(letter)}>
                {letter}
              </button>
            ))}
          </div>
        ))}
        {view?.phase === 'QUESTION_REVEAL' && view.result && (
          <div className="player-result" role="status" data-outcome={view.result.outcome}>
            <h1>{view.result.outcome}</h1>
            <Score gained value={view.result.points} rank={view.result.rank} />
          </div>
        )}
        {(view?.phase === 'LEADERBOARD' || view?.phase === 'FINAL_PODIUM') && (
          <>
            <div className="player-result" role="status">
              {view.phase === 'FINAL_PODIUM' && <h1>Fim</h1>}
              <Score value={view.myScore} rank={view.myRank} />
            </div>
            {view.phase === 'FINAL_PODIUM' && (
              <button className="secondary player-enter" type="button" onClick={() => {
                setPin('');
                room.resetRoom();
                if (new URLSearchParams(location.search).has('pin')) history.replaceState(null, '', '/?player=1');
              }}>Outra sala</button>
            )}
          </>
        )}
      </section>
    </main>
  );
}
