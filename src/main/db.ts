import { Pool } from 'pg'

// TigerData (Postgres) holds the canonical session records.
export const db = new Pool({ connectionString: process.env.DATABASE_URL })

// Deleting a session cascades to its captures and actions.
const schema = `
create table if not exists sessions (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
create table if not exists captures (
  id bigint generated always as identity primary key,
  session_id bigint not null references sessions(id) on delete cascade,
  captured_at timestamptz not null default now(),
  screenshot_path text not null,
  note text
);
create index if not exists captures_session_idx on captures (session_id, captured_at);
create table if not exists actions (
  id bigint generated always as identity primary key,
  session_id bigint not null references sessions(id) on delete cascade,
  capture_id bigint references captures(id) on delete set null,
  created_at timestamptz not null default now(),
  prompt text not null,
  result text
);
create index if not exists actions_session_idx on actions (session_id, created_at);
`

export async function migrate(): Promise<void> {
  await db.query(schema)
}
