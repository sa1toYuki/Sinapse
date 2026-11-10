import type { ReactNode } from "react";

export function StageShell({
  muted = true,
  onSound,
  children,
  home = false,
}: {
  muted?: boolean;
  onSound?: () => void;
  children: ReactNode;
  home?: boolean;
}) {
  return (
    <div className="app is-stage">
      <div className="stage-lights" aria-hidden="true" />
      <div className="scanlines" aria-hidden="true" />
      <main className="frame">
        <div className="stage-decor" aria-hidden="true">
          <div className="opening-stars">
            <i>✦</i>
            <i>✦</i>
            <i>✦</i>
            <i>✦</i>
            <i>✦</i>
            <i>✦</i>
          </div>
        </div>
        <header className="topbar">
          {home && <a className="stage-home" href="/" aria-label="Sinapse, início">SINAPSE</a>}
          {onSound && <button
            className="sound"
            onClick={onSound}
            aria-label={muted ? "Ativar som" : "Desativar som"}
            aria-pressed={!muted}
          >
            <span aria-hidden="true">{muted ? "♪" : "♫"}</span>
            <span className="sound-label">
              {muted ? " SOM DESLIGADO" : " SOM LIGADO"}
            </span>
          </button>}
        </header>
        {children}
        <footer>
          <span className="opening-credit">
            <span>By Sa1toYK</span>
            <span className="credit-separator" aria-hidden="true">
              |
            </span>
            <span>Baseado em 'Show do Milhão'</span>
          </span>
        </footer>
      </main>
    </div>
  );
}

export function TimerLED({ time }: { time: number }) {
  return (
    <div
      className={
        "timer " + (time <= 5 ? "danger" : time <= 10 ? "warning" : "")
      }
    >
      <span>TEMPO</span>
      <strong>{String(time).padStart(2, "0")}</strong>
      <small>SEGUNDOS</small>
      <div className="timer-track">
        <i style={{ width: `${(time / 30) * 100}%` }} />
      </div>
    </div>
  );
}
