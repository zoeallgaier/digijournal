/* ============================================================================
   net.js — Supabase over plain fetch. The whole client, by hand.

   Supabase ships a JavaScript library. This app has no dependencies and that
   is deliberate, not an accident of never having needed one — so this file is
   the requests the journal actually makes, written out:

     sign in            POST /auth/v1/token?grant_type=password
     stay signed in     POST /auth/v1/token?grant_type=refresh_token
     sign out           POST /auth/v1/logout
     read my entries    GET  /rest/v1/entries
     write my entries   POST /rest/v1/entries   (upsert)
     read my ratings    GET  /rest/v1/days
     write my ratings   POST /rest/v1/days      (upsert)

   What the library would have added on top is a websocket for live sync —
   entries appearing on the iPad as they are typed on the phone. Not worth a
   dependency for a journal: syncing when the app comes to the foreground is
   the same thing a second later, and update.js already knows that moment.

   Every request carries the anon key, which identifies the project. What
   identifies the PERSON is the bearer token below, and the row-level security
   policy is what reads it. See supabase/schema.sql.

   TOKENS. An access token lasts an hour; the refresh token that renews it is
   long-lived and is rotated on every use, so the new one has to be written
   down before the next request or the session is lost. That is the whole
   reason refreshing is funnelled through one promise here: two overlapping
   refreshes would spend the same refresh token twice, and the second would be
   told — correctly — that it is invalid.
   ========================================================================= */

import { SUPABASE_URL, SUPABASE_ANON_KEY, configured } from './config.js';
import * as store from './store.js';

const TIMEOUT = 15_000;

/* Renew this long before the hour is up, so a sync never opens with a request
   that is about to be refused for a token that expired in flight. */
const RENEW_MARGIN = 5 * 60 * 1000;

/** Distinguishes "the network never answered" from "the server said no".
 *  The first is a phone in a lift and must change nothing; the second may
 *  mean the session is over. Conflating them signs you out on the Tube. */
export class NetError extends Error {
  constructor(message, { status = 0, offline = false } = {}) {
    super(message);
    this.name = 'NetError';
    this.status = status;
    this.offline = offline;
  }
}

function timeout() {
  /* AbortSignal.timeout is Safari 16+. If it is missing, the request simply
     runs without one — slower to fail, never wrong. */
  try { return AbortSignal.timeout(TIMEOUT); } catch { return undefined; }
}

async function request(path, { method = 'GET', token = null, body = null, headers = {} } = {}) {
  if (!configured()) throw new NetError('Sync is not configured.');

  let res;
  try {
    res = await fetch(`${SUPABASE_URL}${path}`, {
      method,
      signal: timeout(),
      headers: {
        apikey: SUPABASE_ANON_KEY,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    /* DNS, no route, aborted, offline — anything where no server was heard
       from. Never a reason to touch the session. */
    throw new NetError('No connection.', { offline: true });
  }

  const text = await res.text();
  const payload = text ? safeParse(text) : null;

  if (!res.ok) {
    throw new NetError(messageOf(payload) || `Request failed (${res.status}).`,
      { status: res.status });
  }
  return payload;
}

function safeParse(text) {
  try { return JSON.parse(text); } catch { return null; }
}

/* GoTrue and PostgREST do not agree on where the human-readable reason goes,
   and GoTrue's own answer has changed across versions. Try all of them. */
function messageOf(payload) {
  if (!payload) return '';
  return payload.error_description
      || payload.msg
      || payload.message
      || payload.error
      || '';
}

/* -------------------------------------------------------------------- auth */

/** GoTrue's answer, in the shape the app keeps it in. `expiresAt` is stored
 *  as our own clock plus the lifetime rather than the server's `expires_at`:
 *  we compare it against Date.now(), so it has to be measured on the same
 *  clock, or a phone a few minutes out never refreshes — or refreshes on
 *  every single request. */
function toSession(payload) {
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token,
    expiresAt: Date.now() + (Number(payload.expires_in) || 3600) * 1000,
    userId: payload.user?.id || null,
    email: payload.user?.email || null,
  };
}

export async function signIn(email, password) {
  const payload = await request('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email: String(email).trim(), password: String(password) },
  });
  const session = toSession(payload);
  store.setSession(session);
  return session;
}

export async function signOut() {
  const session = store.session();
  store.setSession(null);
  if (!session?.accessToken) return;
  /* Best effort. The session is already gone from this device, which is what
     signing out means here; telling the server is a courtesy that must not
     fail the action if the phone is offline. */
  try {
    await request('/auth/v1/logout', { method: 'POST', token: session.accessToken });
  } catch { /* nothing to do about it, and nothing to say */ }
}

let refreshing = null;

async function renew(session) {
  const payload = await request('/auth/v1/token?grant_type=refresh_token', {
    method: 'POST',
    body: { refresh_token: session.refreshToken },
  });
  const next = toSession(payload);
  /* Written down before this function returns, and therefore before anything
     can spend the rotated refresh token a second time. */
  store.setSession(next);
  return next;
}

/** A usable access token, renewing first if the current one is near its end.
 *  Returns null when there is no session at all. Throws NetError with
 *  `offline` when the phone simply couldn't reach anyone — the session is
 *  still good, we just can't prove it this minute. */
export async function accessToken() {
  const session = store.session();
  if (!session?.accessToken) return null;
  if (Date.now() < session.expiresAt - RENEW_MARGIN) return session.accessToken;
  if (!session.refreshToken) return session.accessToken;

  if (!refreshing) {
    refreshing = renew(session)
      .catch((err) => {
        /* A refused refresh token is a session that is genuinely over —
           the password was changed, or it was revoked. Anything else, most
           of all being offline, leaves the session alone to try again. */
        if (err instanceof NetError && !err.offline && err.status >= 400 && err.status < 500) {
          store.setSession(null);
        }
        throw err;
      })
      .finally(() => { refreshing = null; });
  }
  return (await refreshing).accessToken;
}

export function signedIn() {
  return !!store.session()?.accessToken;
}

export function currentEmail() {
  return store.session()?.email || null;
}

export function currentUserId() {
  return store.session()?.userId || null;
}

/* -------------------------------------------------------------------- data */

/* Two tables, and the same two requests against each: the entries, and the
   day ratings that used to be a column on them. */
const ENTRIES = '/rest/v1/entries';
const DAYS = '/rest/v1/days';

/** Rows changed since a watermark, oldest first so a partial page still
 *  advances the watermark safely. */
async function selectFrom(table, token, since, limit) {
  const query = new URLSearchParams({
    select: '*',
    order: 'updated_at.asc',
    limit: String(limit),
  });
  /* PostgREST's filter syntax: column=operator.value. */
  if (since > 0) query.set('updated_at', `gt.${since}`);
  return (await request(`${table}?${query}`, { token })) || [];
}

/** Insert-or-update, keyed on the table's primary key.
 *  `resolution=merge-duplicates` is PostgREST's upsert; `return=minimal` asks
 *  it not to echo the rows back, which on a first sync of a full journal is
 *  the difference between a small request and a round trip twice the size. */
async function upsertInto(table, token, rows) {
  if (!rows.length) return;
  await request(table, {
    method: 'POST',
    token,
    body: rows,
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
  });
}

export const selectSince = (token, since, limit = 1000) =>
  selectFrom(ENTRIES, token, since, limit);

export const upsert = (token, rows) => upsertInto(ENTRIES, token, rows);

export const selectDaysSince = (token, since, limit = 1000) =>
  selectFrom(DAYS, token, since, limit);

export const upsertDays = (token, rows) => upsertInto(DAYS, token, rows);

/** True for the one error that means the `days` table has not been created
 *  yet — the SQL in supabase/schema.sql was run before the ratings existed
 *  and has not been re-run since. Everything else about sync still works, so
 *  this is a thing to step over rather than to fail a round for. PostgREST
 *  answers 404 with PGRST205; the message check is the belt to that braces. */
export function isMissingTable(err) {
  return err?.status === 404 || /Could not find the table/i.test(err?.message || '');
}
