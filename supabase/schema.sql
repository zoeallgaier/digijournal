-- ============================================================================
-- Digijournal — the entire server side. One table, one policy.
--
-- Paste this into the Supabase SQL editor and run it once. It is idempotent:
-- running it again on an existing project changes nothing.
--
-- The shape mirrors js/store.js exactly, with two deliberate departures noted
-- below. Anything that disagrees with store.js is a bug in this file.
-- ============================================================================

create table if not exists public.entries (
  -- Filled in from the signed-in user's token, never sent by the client.
  user_id     uuid    not null default auth.uid()
                      references auth.users(id) on delete cascade,

  -- The app's own id ('e' + base36). Scoped per user so two accounts can
  -- never collide on one, however unlikely the generator makes it.
  id          text    not null,

  title       text    not null default '',
  body        text    not null default '',
  mood        smallint,

  -- DEPARTURE 1: `day` is text, not date.
  -- store.js builds 'YYYY-MM-DD' from the LOCAL calendar day on purpose —
  -- dayKey() avoids toISOString() precisely so an 11pm entry does not land on
  -- tomorrow. A `date` column would be read back through a timezone and could
  -- reintroduce exactly that drift. As text, the string that goes in is the
  -- string that comes out.
  day         text    not null,

  -- DEPARTURE 2: timestamps are bigint milliseconds, not timestamptz.
  -- These are Date.now() values, and updated_at is compared directly to decide
  -- which device's copy of an entry wins. Converting to timestamptz and back
  -- risks rounding at exactly the comparison that matters.
  created_at  bigint  not null,
  updated_at  bigint  not null,

  published   boolean not null default false,

  -- The tombstone. A deleted entry keeps a row so the other device learns it
  -- was deleted rather than never seen; without this, deleting on the phone
  -- gets undone by the next sync from the iPad.
  deleted_at  bigint,

  primary key (user_id, id),

  constraint mood_range check (mood is null or mood between 1 and 5),
  constraint day_shape  check (day ~ '^\d{4}-\d{2}-\d{2}$')
);

-- Every sync is "give me my rows changed since T", newest first.
create index if not exists entries_sync_idx
  on public.entries (user_id, updated_at desc);

-- ----------------------------------------------------------------------------
-- Row Level Security.
--
-- The anon key ships inside the app, in a public repo. Anyone can read it out
-- of the running page. RLS is the whole reason that is safe: with it on, the
-- key gets a stranger as far as "prove who you are" and no further.
--
-- Note that enabling RLS without the policy below denies EVERYTHING, including
-- to you. An empty-looking table after this line is the deny-by-default doing
-- its job, not a failure. The policy is the other half.
-- ----------------------------------------------------------------------------

alter table public.entries enable row level security;

drop policy if exists "own entries" on public.entries;

create policy "own entries" on public.entries
  for all
  to authenticated                      -- the anon role gets nothing at all
  using      (auth.uid() = user_id)     -- which rows you may read/update/delete
  with check (auth.uid() = user_id);    -- and what you may write into them
