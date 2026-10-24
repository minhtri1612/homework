-- Database schema. Every statement is "IF NOT EXISTS", so running it again on
-- an existing database (npm run db:init) changes nothing.
--
-- Conventions:
--   * Times are UTC text in ISO 8601 form, e.g. 2026-10-24T16:45:00.000Z.
--   * Booleans are INTEGER 0/1.
--   * A homework's questions belong to a version. Editing a homework that
--     already has submissions adds a new version, so every submission keeps
--     pointing at the exact questions the student saw.

CREATE TABLE IF NOT EXISTS teachers (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Login sessions. id is a hash of the cookie value, never the value itself,
-- so a leaked database cannot be used to log in.
CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  teacher_id INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_teacher ON sessions(teacher_id);

CREATE TABLE IF NOT EXISTS homeworks (
  id                INTEGER PRIMARY KEY,
  teacher_id        INTEGER NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  title             TEXT NOT NULL CHECK (trim(title) <> ''),
  -- 6 characters without look-alikes (no 0/O, 1/I/L), used in /h/<code>.
  share_code        TEXT NOT NULL UNIQUE,
  -- When students see the correct answers. The score is always shown.
  reveal_mode       TEXT NOT NULL DEFAULT 'after_submit'
                    CHECK (reveal_mode IN ('never', 'after_submit', 'after_deadline')),
  deadline          TEXT,  -- NULL = no deadline
  shuffle_questions INTEGER NOT NULL DEFAULT 0 CHECK (shuffle_questions IN (0, 1)),
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (reveal_mode <> 'after_deadline' OR deadline IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS homeworks_teacher ON homeworks(teacher_id);

-- The highest number is the current version.
CREATE TABLE IF NOT EXISTS homework_versions (
  id          INTEGER PRIMARY KEY,
  homework_id INTEGER NOT NULL REFERENCES homeworks(id) ON DELETE CASCADE,
  number      INTEGER NOT NULL CHECK (number >= 1),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (homework_id, number)
);

CREATE TABLE IF NOT EXISTS questions (
  id              INTEGER PRIMARY KEY,
  version_id      INTEGER NOT NULL REFERENCES homework_versions(id) ON DELETE CASCADE,
  position        INTEGER NOT NULL,  -- 1, 2, 3… in the order the teacher wrote them
  text            TEXT NOT NULL DEFAULT '',  -- may be '' ("1. A. cat B. dog …")
  shuffle_answers INTEGER NOT NULL DEFAULT 0 CHECK (shuffle_answers IN (0, 1)),
  UNIQUE (version_id, position)
);

CREATE TABLE IF NOT EXISTS answers (
  id          INTEGER PRIMARY KEY,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL,  -- 1 = A, 2 = B, …
  text        TEXT NOT NULL CHECK (trim(text) <> ''),
  is_correct  INTEGER NOT NULL DEFAULT 0 CHECK (is_correct IN (0, 1)),
  UNIQUE (question_id, position),
  UNIQUE (id, question_id)  -- target of the check in submission_answers
);
-- At most one correct answer per question. "At least one" and "2 to 6
-- answers" are checked by the app (validateQuestion) before saving.
CREATE UNIQUE INDEX IF NOT EXISTS answers_one_correct
  ON answers(question_id) WHERE is_correct = 1;

CREATE TABLE IF NOT EXISTS submissions (
  id            INTEGER PRIMARY KEY,
  homework_id   INTEGER NOT NULL REFERENCES homeworks(id) ON DELETE CASCADE,
  version_id    INTEGER NOT NULL REFERENCES homework_versions(id) ON DELETE CASCADE,
  student_name  TEXT NOT NULL CHECK (trim(student_name) <> ''),
  -- The name lower-cased with spaces collapsed: one attempt per name.
  student_key   TEXT NOT NULL,
  started_at    TEXT,
  submitted_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  correct_count INTEGER NOT NULL CHECK (correct_count >= 0),
  total_count   INTEGER NOT NULL CHECK (total_count >= correct_count),
  score         REAL NOT NULL CHECK (score BETWEEN 0 AND 10),  -- steps of 0.25
  UNIQUE (homework_id, student_key)
);

-- One row per question of the version. answer_id is NULL when left blank.
-- The two-column reference makes sure the chosen answer belongs to the question.
CREATE TABLE IF NOT EXISTS submission_answers (
  submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  question_id   INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  answer_id     INTEGER,
  PRIMARY KEY (submission_id, question_id),
  FOREIGN KEY (answer_id, question_id) REFERENCES answers(id, question_id)
);
