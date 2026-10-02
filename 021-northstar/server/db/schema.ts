// SQL migrations. Each entry runs once inside a transaction; never edit an applied migration — add a new one.
export interface Migration { version: number; name: string; sql: string }

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "initial",
    sql: `
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX workspaces_owner ON workspaces(owner_user_id);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  user_agent TEXT NOT NULL DEFAULT ''
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE api_tokens (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes_json TEXT NOT NULL DEFAULT '["read"]',
  created_at TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at TEXT
);

CREATE TABLE goals (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  level TEXT NOT NULL CHECK (level IN ('vision','year','quarter','month','week')),
  parent_id TEXT REFERENCES goals(id) ON DELETE SET NULL,
  start_date TEXT,
  end_date TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','achieved','dropped','archived')),
  priority INTEGER NOT NULL DEFAULT 3,
  success_definition TEXT NOT NULL DEFAULT '',
  why TEXT NOT NULL DEFAULT '',
  progress_mode TEXT NOT NULL DEFAULT 'manual' CHECK (progress_mode IN ('manual','milestone','binary','linked_outcomes')),
  progress_manual INTEGER NOT NULL DEFAULT 0,
  is_north_star INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX goals_ws ON goals(workspace_id, status, level);
CREATE INDEX goals_parent ON goals(parent_id);

CREATE TABLE goal_progress_log (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  progress INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX goal_progress_log_goal ON goal_progress_log(goal_id, date);

CREATE TABLE outcomes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','achieved','dropped')),
  due_date TEXT,
  achieved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX outcomes_goal ON outcomes(goal_id);

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  outcome TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'idea' CHECK (status IN ('idea','active','waiting','completed','paused','dropped')),
  next_action TEXT NOT NULL DEFAULT '',
  deadline TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX projects_ws ON projects(workspace_id, status);

CREATE TABLE decisions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  decided_at TEXT NOT NULL,
  context TEXT NOT NULL DEFAULT '',
  options_json TEXT NOT NULL DEFAULT '[]',
  decision TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  assumptions_json TEXT NOT NULL DEFAULT '[]',
  expected_outcome TEXT NOT NULL DEFAULT '',
  risks TEXT NOT NULL DEFAULT '',
  confidence INTEGER NOT NULL DEFAULT 50,
  review_date TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','abandoned')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX decisions_ws ON decisions(workspace_id, status, review_date);

CREATE TABLE decision_reviews (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  decision_id TEXT NOT NULL REFERENCES decisions(id) ON DELETE CASCADE,
  reviewed_at TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('better','as_expected','worse','too_early','abandoned')),
  result TEXT NOT NULL DEFAULT '',
  lessons TEXT NOT NULL DEFAULT '',
  snapshot_json TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'web',
  created_at TEXT NOT NULL
);
CREATE INDEX decision_reviews_decision ON decision_reviews(decision_id);

CREATE TABLE people (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  organization TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  relationship_type TEXT NOT NULL DEFAULT 'other',
  importance INTEGER NOT NULL DEFAULT 3,
  tags_json TEXT NOT NULL DEFAULT '[]',
  how_met TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  last_contact_at TEXT,
  next_follow_up_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX people_ws ON people(workspace_id, importance);

CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'meeting',
  summary TEXT NOT NULL DEFAULT '',
  next_step TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX contacts_person ON contacts(person_id, date);

CREATE TABLE promises (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  direction TEXT NOT NULL CHECK (direction IN ('mine','theirs')),
  text TEXT NOT NULL,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','dropped')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX promises_ws ON promises(workspace_id, status, due_date);

CREATE TABLE follow_ups (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  contact_id TEXT REFERENCES contacts(id) ON DELETE SET NULL,
  due_date TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','dropped')),
  done_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX follow_ups_ws ON follow_ups(workspace_id, status, due_date);

CREATE TABLE knowledge_items (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'article',
  source_url TEXT NOT NULL DEFAULT '',
  source_title TEXT NOT NULL DEFAULT '',
  captured_at TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  key_ideas_json TEXT NOT NULL DEFAULT '[]',
  personal_meaning TEXT NOT NULL DEFAULT '',
  next_action TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'captured' CHECK (status IN ('captured','processed','applied','archived')),
  applied_at TEXT,
  applied_note TEXT NOT NULL DEFAULT '',
  raw_content TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX knowledge_ws ON knowledge_items(workspace_id, status, captured_at);

CREATE TABLE actions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'task' CHECK (kind IN ('task','open_loop','waiting','follow_up')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','dropped')),
  due_date TEXT,
  scheduled_date TEXT,
  done_at TEXT,
  goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL,
  outcome_id TEXT REFERENCES outcomes(id) ON DELETE SET NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
  decision_id TEXT REFERENCES decisions(id) ON DELETE SET NULL,
  knowledge_id TEXT REFERENCES knowledge_items(id) ON DELETE SET NULL,
  waiting_on TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX actions_ws ON actions(workspace_id, status, kind, due_date);
CREATE INDEX actions_goal ON actions(goal_id);
CREATE INDEX actions_project ON actions(project_id);

CREATE TABLE big3_items (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  week_start TEXT NOT NULL,
  rank INTEGER NOT NULL CHECK (rank BETWEEN 1 AND 3),
  title TEXT NOT NULL,
  goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  action_id TEXT REFERENCES actions(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','done','dropped')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX big3_week ON big3_items(workspace_id, week_start);

CREATE TABLE daily_focus (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  one_thing_title TEXT NOT NULL DEFAULT '',
  action_id TEXT REFERENCES actions(id) ON DELETE SET NULL,
  goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL,
  why TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, date)
);

CREATE TABLE captures (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  raw_text TEXT NOT NULL,
  type TEXT,
  suggested_type TEXT,
  status TEXT NOT NULL DEFAULT 'inbox' CHECK (status IN ('inbox','processed','dismissed')),
  processed_into_type TEXT,
  processed_into_id TEXT,
  source TEXT NOT NULL DEFAULT 'web',
  client_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX captures_ws ON captures(workspace_id, status, created_at);
CREATE UNIQUE INDEX captures_client ON captures(workspace_id, client_id) WHERE client_id IS NOT NULL;

CREATE TABLE reviews (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('daily','weekly','monthly','quarterly','yearly')),
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  template_id TEXT NOT NULL DEFAULT 'general',
  answers_json TEXT NOT NULL DEFAULT '{}',
  summary_json TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','completed')),
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, kind, period_start)
);

CREATE TABLE relations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  from_type TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_type TEXT NOT NULL,
  to_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'linked',
  created_at TEXT NOT NULL,
  UNIQUE (workspace_id, from_type, from_id, to_type, to_id, kind)
);
CREATE INDEX relations_from ON relations(from_type, from_id);
CREATE INDEX relations_to ON relations(to_type, to_id);

CREATE TABLE principles (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('principle','anti_goal')),
  text TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  period_start TEXT,
  period_end TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE experiments (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  hypothesis TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL DEFAULT '',
  period_start TEXT,
  period_end TEXT,
  success_signal TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planned',
  result TEXT NOT NULL DEFAULT '',
  lesson TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE metrics (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT NOT NULL
);
CREATE TABLE metric_entries (
  id TEXT PRIMARY KEY,
  metric_id TEXT NOT NULL REFERENCES metrics(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  value REAL NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  UNIQUE (metric_id, date)
);

CREATE TABLE calendar_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'manual',
  uid TEXT,
  title TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  all_day INTEGER NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT 'unclassified',
  goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL,
  project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX calendar_ws ON calendar_events(workspace_id, start_at);
CREATE UNIQUE INDEX calendar_uid ON calendar_events(workspace_id, uid) WHERE uid IS NOT NULL;

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '',
  scheduled_for TEXT NOT NULL,
  delivered_at TEXT,
  read_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (workspace_id, dedupe_key)
);
CREATE INDEX notifications_ws ON notifications(workspace_id, read_at, scheduled_for);

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  keys_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE ai_usage (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX ai_usage_ws ON ai_usage(workspace_id, created_at);

CREATE TABLE ai_messages (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  citations_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE INDEX ai_messages_ws ON ai_messages(workspace_id, created_at);

CREATE TABLE embeddings (
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  dims INTEGER NOT NULL,
  vector BLOB NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (entity_type, entity_id)
);
CREATE INDEX embeddings_ws ON embeddings(workspace_id, entity_type);

CREATE TABLE imports (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  file_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'preview',
  preview_json TEXT NOT NULL,
  result_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE connectors (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_configured',
  config_json TEXT NOT NULL DEFAULT '{}',
  last_sync_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (workspace_id, type)
);

CREATE TABLE activity_log (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  event TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  at TEXT NOT NULL
);
CREATE INDEX activity_ws ON activity_log(workspace_id, at);
CREATE INDEX activity_entity ON activity_log(entity_type, entity_id);

-- Full-text search: external-content FTS5 (trigram tokenizer handles Japanese without word boundaries).
CREATE TABLE search_docs (
  rowid INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  UNIQUE (entity_type, entity_id)
);
CREATE INDEX search_docs_ws ON search_docs(workspace_id, entity_type);
CREATE VIRTUAL TABLE search_fts USING fts5(title, body, content='search_docs', content_rowid='rowid', tokenize='trigram');
CREATE TRIGGER search_docs_ai AFTER INSERT ON search_docs BEGIN
  INSERT INTO search_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;
CREATE TRIGGER search_docs_ad AFTER DELETE ON search_docs BEGIN
  INSERT INTO search_fts(search_fts, rowid, title, body) VALUES ('delete', old.rowid, old.title, old.body);
END;
CREATE TRIGGER search_docs_au AFTER UPDATE ON search_docs BEGIN
  INSERT INTO search_fts(search_fts, rowid, title, body) VALUES ('delete', old.rowid, old.title, old.body);
  INSERT INTO search_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
END;
`,
  },
  {
    version: 2,
    name: "perf_indexes",
    sql: `
CREATE INDEX IF NOT EXISTS actions_ws_done ON actions(workspace_id, done_at);
CREATE INDEX IF NOT EXISTS outcomes_ws_achieved ON outcomes(workspace_id, achieved_at);
CREATE INDEX IF NOT EXISTS knowledge_ws_applied ON knowledge_items(workspace_id, applied_at);
CREATE INDEX IF NOT EXISTS knowledge_ws_captured ON knowledge_items(workspace_id, captured_at);
CREATE INDEX IF NOT EXISTS decision_reviews_ws_date ON decision_reviews(workspace_id, reviewed_at);
CREATE INDEX IF NOT EXISTS decisions_ws_decided ON decisions(workspace_id, decided_at);
CREATE INDEX IF NOT EXISTS contacts_ws_date ON contacts(workspace_id, date);
CREATE INDEX IF NOT EXISTS reviews_ws_kind_start ON reviews(workspace_id, kind, period_start);
CREATE INDEX IF NOT EXISTS people_ws_lastcontact ON people(workspace_id, importance, last_contact_at);
CREATE INDEX IF NOT EXISTS calendar_ws_category ON calendar_events(workspace_id, category, start_at);
`,
  },
];

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
