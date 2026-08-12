/* ============================================================================
   config.js — where the journal syncs to.

   Both of these are meant to be public. The anon key is not a secret: it
   identifies the project, not a person, and every copy of the app carries it.
   What keeps the journal private is the row-level security policy in
   supabase/schema.sql — with it on, this key gets a stranger as far as "prove
   who you are" and no further. If that policy is ever dropped, this key
   becomes a skeleton key to every entry. It is the only thing standing there.

   The service_role key must NEVER appear in this repo. It bypasses RLS by
   design and belongs in the Supabase dashboard alone.

   Empty either string and the app is what it was before any of this: a purely
   local journal, with the Settings screen saying sync isn't configured.
   ========================================================================= */

export const SUPABASE_URL = 'https://uwfskykrayezjcazmlrw.supabase.co';

export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV3ZnNreWtyYXllempjYXptbHJ3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY1NjA5NTMsImV4cCI6MjEwMjEzNjk1M30.CBKEieaJEdSGa0CumbMCpRuERkLtoOrBgMopl7VuNMU';

export const configured = () => !!(SUPABASE_URL && SUPABASE_ANON_KEY);
