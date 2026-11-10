CREATE TABLE games (
  game_id TEXT PRIMARY KEY NOT NULL,
  pin TEXT NOT NULL CHECK (length(pin) = 6 AND pin NOT GLOB '*[^0-9]*'),
  started_at INTEGER NOT NULL,
  finished_at INTEGER NOT NULL,
  question_set_version TEXT NOT NULL,
  player_count INTEGER NOT NULL CHECK (player_count BETWEEN 0 AND 150),
  status TEXT NOT NULL CHECK (status = 'finished')
);

CREATE TABLE game_results (
  game_id TEXT NOT NULL REFERENCES games(game_id) ON DELETE CASCADE,
  player_id TEXT NOT NULL,
  name TEXT NOT NULL,
  rank INTEGER NOT NULL CHECK (rank BETWEEN 1 AND 150),
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 17000),
  response_time_ms INTEGER NOT NULL CHECK (response_time_ms BETWEEN 0 AND 510000),
  PRIMARY KEY (game_id, player_id),
  UNIQUE (game_id, rank)
);
