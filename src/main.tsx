import React from "react";
import { createRoot } from "react-dom/client";
import { useEffect, useRef, useState } from "react";
import { StageShell, TimerLED } from "./StageShell";
import { MasterApp } from "./master/MasterApp";
import { useGame } from "./useGame";
import { questions, type Letter } from "./data/questions";
import { points, scoring } from "./data/scoring";
import { sound } from "./audio/sound";
import {
  clearProgress,
  loadProgress,
  type GameMode,
  type ProgressState,
} from "./storage/progress";
import "./styles/tokens.css";
import "./styles/main.css";
import "./master/master.css";
const letters: Letter[] = ["A", "B", "C", "D", "E"];
function Logo({
  small = false,
  opening = false,
}: {
  small?: boolean;
  opening?: boolean;
}) {
  return (
    <div className={"logo " + (small ? "logo-small" : "")} aria-label="Sinapse">
      <div>
        <div className="logo-name">SINAPSE</div>
        {!opening && (
          <div className="logo-sub">
            <i /> O GRANDE QUIZ <i />
          </div>
        )}
      </div>
    </div>
  );
}
function ScoreLadder({ index }: { index: number }) {
  return (
    <aside className="ladder">
      <div className="panel-heading">
        <span>A ESCALADA</span>
        <b>
          <span className="ladder-star">★</span>
          <span className="ladder-current-value">{points(scoring[index])}</span>
        </b>
      </div>
      <div className="ladder-list">
        {scoring.map((s, i) => (
          <div
            key={s}
            aria-current={i === index ? "step" : undefined}
            aria-label={`${i + 1}: ${points(s)}`}
            title={`${i + 1}: ${points(s)}`}
            className={
              "step " +
              (i === index ? "current " : i < index ? "won " : "") +
              (i === 4 || i === 9 ? "safe" : "")
            }
          >
            <span>{String(i + 1).padStart(2, "0")}</span>
            <b>{points(s)}</b>
            <small>{i === 4 || i === 9 ? "◆" : ""}</small>
          </div>
        ))}
      </div>
    </aside>
  );
}
function Modal({
  onClose,
  titleId,
  className = "",
  children,
}: {
  onClose: () => void;
  titleId: string;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocus = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => {
    const dialog = ref.current!;
    dialog.showModal();
    return () => {
      dialog.close();
      returnFocus.current?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={"modal " + className}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          const r = e.currentTarget.getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            onClose();
        }
      }}
    >
      <button className="close" aria-label="Fechar" onClick={onClose}>
        ×
      </button>
      {children}
    </dialog>
  );
}
function App() {
  const g = useGame();
  const [rules, setRules] = useState(false);
  const [savedGame, setSavedGame] = useState<ProgressState | null>(null);
  const chooseMode = (mode: GameMode) => {
    const saved = loadProgress(mode);
    if (saved) {
      setSavedGame(saved);
    } else {
      g.setMode(mode);
      g.setScreen("setup");
    }
  };
  const q = questions[g.index];
  const isEnd = g.screen === "end";
  const winner =
    g.scores[0] === g.scores[1]
      ? "Empate!"
      : `${g.names[g.scores[0] > g.scores[1] ? 0 : 1]} venceu!`;
  return (
    <>
      <StageShell
        muted={g.muted}
        onSound={() => {
          g.setMuted(!g.muted);
          if (g.muted) sound("intro", true);
        }}
      >
        {" "}
        {g.screen === "opening" && (
          <section className="opening screen">
            <div className="opening-content">
              <Logo opening />
              <button
                className="primary start"
                onClick={() => {
                  g.setScreen("menu");
                  sound("intro", !g.muted);
                }}
              >
                JOGAR AGORA
              </button>
              <div className="opening-note">PRESSIONE PARA COMEÇAR</div>
            </div>
          </section>
        )}
        {g.screen === "menu" && (
          <section className="menu screen">
            <div className="menu-brand">
              <Logo />
            </div>
            <div className="menu-card">
              <div className="card-kicker">BEM-VINDO AO SHOW</div>
              <h1>Vamos jogar?</h1>
              <p>Escolha um modo para começar.</p>
              <div className="menu-actions">
                <button className="primary" onClick={() => chooseMode("solo")}>
                  <span className="button-icon">★</span>
                  <span>
                    <b>MODO SOLO</b>
                    <small>Você contra as 17 perguntas</small>
                  </span>
                  <span className="arrow">→</span>
                </button>
                <button
                  className="secondary"
                  onClick={() => chooseMode("multi")}
                >
                  <span className="button-icon">♟</span>
                  <span>
                    <b>DOIS JOGADORES</b>
                    <small className="keyboard-hint">
                      Uma disputa no mesmo teclado
                    </small>
                  </span>
                  <span className="arrow">→</span>
                </button>
                <a className="secondary master-menu-link" href="/?master=1">
                  <span className="button-icon" aria-hidden="true">✦</span>
                  <b>SALA AO VIVO</b>
                  <span className="arrow" aria-hidden="true">→</span>
                </a>
                <button className="text-button" onClick={() => setRules(true)}>
                  ⓘ &nbsp; COMO JOGAR
                </button>
              </div>
            </div>
          </section>
        )}
        {g.screen === "setup" && (
          <section className="center-screen screen">
            <div className="setup-card">
              <div className="card-kicker">PREPARE-SE PARA ENTRAR NO AR</div>
              <h1>
                {g.mode === "solo" ? "Quem vai jogar?" : "Conheça os jogadores"}
              </h1>
              <p>
                Como devemos chamar {g.mode === "solo" ? "você" : "vocês"} no
                palco?
              </p>
              <div className="fields">
                {(g.mode === "solo" ? [0] : [0, 1]).map((i) => (
                  <label key={i}>
                    JOGADOR {i + 1}
                    <input
                      maxLength={20}
                      value={g.names[i]}
                      onChange={(e) =>
                        g.setNames(
                          g.names.map((n, j) => (i === j ? e.target.value : n)),
                        )
                      }
                      placeholder={`Jogador ${i + 1}`}
                    />
                    {g.mode === "multi" && (
                      <small className="keyboard-hint">
                        TECLAS: {i === 0 ? "Q  W  E  R  T" : "Y  U  I  O  P"}
                      </small>
                    )}
                  </label>
                ))}
              </div>
              <button
                className="primary full"
                onClick={() => {
                  g.setNames(
                    g.names.map((n, i) => n.trim() || `Jogador ${i + 1}`),
                  );
                  g.start();
                }}
              >
                COMEÇAR O JOGO <span>→</span>
              </button>
              <button
                className="text-button"
                onClick={() => g.setScreen("menu")}
              >
                ← VOLTAR AO MENU
              </button>
            </div>
          </section>
        )}
        {g.screen === "game" && (
          <section className="game screen">
            <div className="game-main">
              <div className="game-meta">
                <div aria-hidden="true" className="game-meta-spacer" />
                <div>
                  PERGUNTA <b>{String(g.index + 1).padStart(2, "0")}</b>{" "}
                  <span className="muted">/ 17</span>
                </div>
                <div className="difficulty">
                  {["FÁCIL", "MÉDIA", "DIFÍCIL", "MUITO DIFÍCIL"][q.level - 1]}
                </div>
              </div>
              <div className="question-panel">
                <div className="question-top">
                  <span>✦ &nbsp; {q.category.toUpperCase()}</span>
                  <span>QUESTÃO {String(g.index + 1).padStart(2, "0")}</span>
                </div>
                <h1>{q.text}</h1>
                <div className="question-deco">✦</div>
              </div>
              <div className="answer-section">
                <div className="answer-header">
                  <span>ESCOLHA A RESPOSTA CORRETA</span>
                  <span className="keyboard-hint">
                    {g.mode === "solo"
                      ? "A–E OU 1–5 + ENTER"
                      : "CADA JOGADOR USA SUAS TECLAS"}
                  </span>
                </div>
                <div
                  className={
                    "answers " + (g.mode === "multi" ? "keyboard-answers" : "")
                  }
                >
                  {letters.map((letter, i) => {
                    const state = g.feedback
                      ? letter === g.feedback.correct
                        ? "correct"
                        : letter === g.feedback.selected &&
                            g.feedback.winner === null
                          ? "incorrect"
                          : ""
                      : g.selection === letter
                        ? "selected"
                        : "";
                    return (
                      <button
                        key={letter}
                        className={"answer " + state}
                        disabled={!!g.feedback || g.mode === "multi"}
                        onClick={() => g.answer(0, letter)}
                      >
                        <span className="answer-letter">{letter}</span>
                        <span className="answer-text">{q.options[letter]}</span>
                        {g.mode === "multi" && (
                          <span className="key-hints">
                            <kbd>{"QWERT"[i]}</kbd>
                            <kbd>{"YUIOP"[i]}</kbd>
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                {g.mode === "multi" && (
                  <div className="touch-players">
                    {[0, 1].map((player) => (
                      <div
                        key={player}
                        className={"player-controls player-" + player}
                        role="group"
                        aria-labelledby={"player-label-" + player}
                      >
                        <div
                          className="player-label"
                          id={"player-label-" + player}
                        >
                          {g.names[player]}{" "}
                          {g.locked[player] ? "· BLOQUEADO" : ""}
                        </div>
                        <div className="answers">
                          {letters.map((letter) => (
                            <button
                              key={letter}
                              className={
                                "answer " +
                                (g.feedback && letter === g.feedback.correct
                                  ? "correct"
                                  : "")
                              }
                              disabled={!!g.feedback || g.locked[player]}
                              onClick={() => g.answer(player, letter)}
                            >
                              <span className="answer-letter">{letter}</span>
                              <span className="answer-text">
                                {q.options[letter]}
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {g.mode === "solo" && !g.feedback && (
                  <button
                    className="confirm"
                    disabled={!g.selection}
                    onClick={g.confirm}
                  >
                    CONFIRMAR RESPOSTA →
                  </button>
                )}
                {g.gradingError && <p role="alert">{g.gradingError}</p>}
                {g.feedback && (
                  <div
                    className={
                      "feedback " +
                      (g.feedback.winner === null ? "bad" : "good")
                    }
                    role="status"
                  >
                    <div>
                      <b>{g.feedback.message}</b>
                      <p>{g.feedback.explanation}</p>
                    </div>
                    <button className="primary" onClick={g.next}>
                      {(g.mode === "solo" && g.feedback.winner === null) ||
                      g.index === 16
                        ? "VER RESULTADO"
                        : "PRÓXIMA"}{" "}
                      →
                    </button>
                  </div>
                )}
              </div>
            </div>
            <aside className="game-side">
              <TimerLED time={g.time} />
              <div className="scores">
                {(g.mode === "solo" ? [0] : [0, 1]).map((i) => (
                  <div className={"score player-" + i} key={i}>
                    <span>
                      {g.names[i]} {g.locked[i] ? "· BLOQUEADO" : ""}
                    </span>
                    <b>
                      {points(g.scores[i])} <small>PTS</small>
                    </b>
                    {g.mode === "multi" && (
                      <em className="keyboard-hint">
                        {i === 0 ? "Q W E R T" : "Y U I O P"}
                      </em>
                    )}
                  </div>
                ))}
              </div>
              <ScoreLadder index={g.index} />
            </aside>
          </section>
        )}
        {isEnd && (
          <section className="center-screen screen">
            <div className="result-card">
              <h1>{g.mode === "solo" ? "Foi um grande show!" : winner}</h1>
              <p>
                {g.mode === "solo"
                  ? "Sua pontuação final"
                  : "Placar final da disputa"}
              </p>
              <div className="final-scores">
                {(g.mode === "solo" ? [0] : [0, 1]).map((i) => (
                  <div key={i}>
                    <span>{g.names[i]}</span>
                    <strong>{points(g.scores[i])}</strong>
                    <small>PONTOS</small>
                  </div>
                ))}
              </div>
              <button className="primary full" onClick={g.start}>
                {g.mode === "solo" ? "JOGAR DE NOVO" : "REVANCHE"} →
              </button>
              <button
                className="text-button"
                onClick={() => g.setScreen("menu")}
              >
                VOLTAR AO MENU PRINCIPAL
              </button>
            </div>
          </section>
        )}
        {savedGame && (
          <Modal
            onClose={() => setSavedGame(null)}
            titleId="resume-title"
            className="resume-modal"
          >
            <h1 id="resume-title">Continuar jogo?</h1>
            <div className="resume-summary">
              <p>
                Pergunta {savedGame.questionIndex + 1} de {questions.length}
              </p>
              {(savedGame.mode === "solo" ? [0] : [0, 1]).map((i) => (
                <p key={i}>
                  {savedGame.names[i]} · {points(savedGame.scores[i])} pontos
                </p>
              ))}
            </div>
            <div className="resume-actions">
              <button
                className="primary full"
                onClick={() => {
                  g.resume(savedGame);
                  setSavedGame(null);
                }}
              >
                CONTINUAR
              </button>
              <button
                className="secondary full"
                onClick={() => {
                  clearProgress(savedGame.mode);
                  g.setMode(savedGame.mode);
                  g.setScreen("setup");
                  setSavedGame(null);
                }}
              >
                NOVO JOGO
              </button>
            </div>
          </Modal>
        )}
        {rules && (
          <Modal onClose={() => setRules(false)} titleId="rules-title">
            <div className="card-kicker">AS REGRAS DO SHOW</div>
            <h1 id="rules-title">Como jogar</h1>
            <div className="rules-list">
              <p>
                <b>01 &nbsp; 17 perguntas.</b> Cada uma tem cinco alternativas e
                30 segundos no relógio.
              </p>
              <p>
                <b>02 &nbsp; No modo solo.</b> Escolha com A–E, 1–5 ou mouse e
                confirme com Enter. Ao errar ou esgotar o tempo, você leva os
                pontos do último degrau acertado.
              </p>
              <p>
                <b>03 &nbsp; Na disputa.</b>{" "}
                <span className="keyboard-hint">
                  Jogador 1 usa Q W E R T; jogador 2 usa Y U I O P. Cada tecla
                  corresponde a uma alternativa de A a E.{" "}
                </span>
                Quem acerta primeiro ganha os pontos da rodada e até 300 pontos
                de bônus por velocidade. Quem erra fica bloqueado até a próxima
                pergunta.
              </p>
              <p>
                <b>04 &nbsp; O resultado.</b> Após 17 perguntas, vence quem
                tiver mais pontos. Em caso de igualdade, há empate.
              </p>
            </div>
            <button className="primary full" onClick={() => setRules(false)}>
              ENTENDI, VAMOS LÁ!
            </button>
          </Modal>
        )}
      </StageShell>
    </>
  );
}

const master = new URLSearchParams(location.search).get('master') === '1';
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {master ? <MasterApp /> : <App />}
  </React.StrictMode>,
);
