-- The SQLite schema from before projects (a "session" held the context), for local.migration.test.ts.
create table if not exists sessions (
  id integer primary key autoincrement,
  local_key text not null unique,
  name text not null default 'Session',
  status text not null default 'active',
  started_at text not null default ((strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))),
  ended_at text,
  remote_id integer,
  upload_status text not null default 'local',
  upload_error text,
  uploaded_at text
);
create table if not exists captures (
  id integer primary key autoincrement,
  session_id integer not null references sessions(id) on delete cascade,
  captured_at text not null default ((strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))),
  screenshot_path text not null,
  note text,
  app_name text,
  window_title text,
  url text,
  image_hash text,
  status text not null default 'pending',
  index_status text not null default 'pending',
  note_path text
);
create index if not exists captures_session_idx on captures (session_id, captured_at);
create table if not exists suggestion_sets (
  id integer primary key autoincrement,
  session_id integer not null references sessions(id) on delete cascade,
  capture_id integer references captures(id) on delete set null,
  generation_id integer not null,
  created_at text not null default ((strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))),
  status text not null default 'shown',
  topic text,
  suggestions text not null
);
create index if not exists suggestion_sets_session_idx on suggestion_sets (session_id, created_at);
create table if not exists actions (
  id integer primary key autoincrement,
  session_id integer not null references sessions(id) on delete cascade,
  capture_id integer references captures(id) on delete set null,
  suggestion_set_id integer references suggestion_sets(id) on delete set null,
  created_at text not null default ((strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))),
  kind text,
  prompt text not null,
  result text,
  status text not null default 'pending',
  blocks text,
  sources text,
  tokens_in integer,
  tokens_out integer,
  completed_at text
);
create index if not exists actions_session_idx on actions (session_id, created_at);
create table if not exists notes (
  id integer primary key autoincrement,
  session_id integer not null references sessions(id) on delete cascade,
  capture_id integer references captures(id) on delete set null,
  action_id integer references actions(id) on delete set null,
  provenance text not null check (provenance in ('observed', 'assistant')),
  topic text,
  body text not null,
  created_at text not null default ((strftime('%Y-%m-%dT%H:%M:%fZ', 'now')))
);
create index if not exists notes_session_idx on notes (session_id, created_at);
create virtual table if not exists notes_fts using fts5(
  body, content='notes', content_rowid='id', tokenize='porter unicode61'
);
create trigger if not exists notes_ai after insert on notes begin
  insert into notes_fts(rowid, body) values (new.id, new.body);
end;
create trigger if not exists notes_ad after delete on notes begin
  insert into notes_fts(notes_fts, rowid, body) values ('delete', old.id, old.body);
end;
create table if not exists screen_activity (
  time text not null,
  session_id integer not null references sessions(id) on delete cascade,
  capture_id integer,
  app_name text,
  window_title text,
  url text,
  topic text,
  changed integer not null default 0,
  dwell_ms integer not null default 0
);
create index if not exists screen_activity_session_idx on screen_activity (session_id, time);
-- Full pages sent by the Chrome extension (extension/, bridge.ts): the whole rendered text,
-- not just what a screenshot shows. One row per distinct version of a page.
create table if not exists pages (
  id integer primary key autoincrement,
  session_id integer not null references sessions(id) on delete cascade,
  captured_at text not null default ((strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))),
  url text not null,
  title text,
  description text,
  body text not null,
  text_hash text not null,
  truncated integer not null default 0,
  note_path text,
  index_status text not null default 'pending'
);
create index if not exists pages_session_idx on pages (session_id, captured_at);
create unique index if not exists pages_hash_idx on pages (session_id, text_hash);
-- Files the user chose to add from Downloads (downloads.ts, files.ts). The file is
-- copied into the session folder; body is its extracted text (or an image description).
create table if not exists files (
  id integer primary key autoincrement,
  session_id integer not null references sessions(id) on delete cascade,
  added_at text not null default ((strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))),
  name text not null,
  kind text not null,
  size integer not null,
  original_path text not null,
  stored_path text,
  sha1 text,
  body text not null default '',
  extract_status text not null,
  truncated integer not null default 0,
  note_path text,
  index_status text not null default 'pending'
);
create index if not exists files_session_idx on files (session_id, added_at);
-- TigerData sessions deleted here while TigerData was unreachable; removed on the next upload run.
create table if not exists pending_remote_deletes (remote_id integer primary key);
alter table captures add column page_id integer references pages(id) on delete set null;
alter table captures add column source text not null default 'auto';
alter table sessions add column slot integer;
alter table notes add column file_id integer references files(id) on delete set null;
