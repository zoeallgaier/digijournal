/* ============================================================================
   account.js — the one screen that knows there is a server.

   Signed out it is a sign-in form; signed in it is a status line and two
   buttons. Nothing else in the app has an opinion about accounts, which is
   the point: sync is something the journal does, not something it is.

   Sign-in is DELIBERATELY NOT A GATE. The app opens straight onto the list
   whether or not anyone has ever signed in, exactly as it did before sync
   existed — a cold launch shows the journal, not a password field. Signing in
   starts mirroring; it does not stand between the icon and the entries.

   The primary action borrows the composer bar, the same way the editor
   borrows it for Publish. Same capsule, same position, same thumb.
   ========================================================================= */

import { el, iconButton, toast } from './ui.js';
import * as store from './store.js';
import * as net from './net.js';
import * as sync from './sync.js';
import { configured } from './config.js';

/** "just now" / "4 minutes ago" / "at 14:32". Only this screen shows it, so
 *  it stays here rather than in ui.js's shared vocabulary. */
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

function ago(ts) {
  if (!ts) return 'not yet';
  const mins = Math.floor((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins === 1) return 'a minute ago';
  if (mins < 60) return `${mins} minutes ago`;
  return `at ${timeFmt.format(new Date(ts))}`;
}

/* Supabase's wording is written for developers. These are the two answers a
   person can actually act on; anything else is passed through as it came,
   because an unexpected fault is more useful verbatim than paraphrased. */
function humanise(message) {
  const m = String(message || '');
  if (/invalid login credentials/i.test(m)) return 'That email and password don’t match.';
  if (/email not confirmed/i.test(m)) return 'That account still needs confirming in Supabase.';
  return m || 'Could not sign in.';
}

export function view(_params, api) {
  const signedIn = net.signedIn();
  const status = el('p.account-status');
  const problem = el('p.account-problem', { role: 'alert' });

  /* --------------------------------------------------------- signed out */

  const email = el('input.field', {
    type: 'email',
    id: 'account-email',
    autocomplete: 'username',
    inputmode: 'email',
    autocapitalize: 'none',
    autocorrect: 'off',
    spellcheck: 'false',
    enterkeyhint: 'next',
  });

  const password = el('input.field', {
    type: 'password',
    id: 'account-password',
    autocomplete: 'current-password',
    enterkeyhint: 'go',
  });

  let busy = false;

  const ready = () => !busy && email.value.trim() !== '' && password.value !== '';

  async function submit() {
    if (!ready()) return;
    busy = true;
    problem.textContent = '';
    api.refreshBar();
    try {
      await net.signIn(email.value, password.value);
      password.value = '';
      toast('Signed in');
      /* A full round: this is either the phone that already holds the journal
         seeding the server, or a new device restoring from it. */
      sync.afterSignIn();
      api.go('#/', { replace: true });
    } catch (err) {
      problem.textContent = err?.offline
        ? 'No connection — sign-in needs the network, just this once.'
        : humanise(err?.message);
      busy = false;
      api.refreshBar();
      password.focus();
    }
  }

  const form = el('form.account-form', {
    onsubmit: (e) => { e.preventDefault(); submit(); },
  },
    el('label.field-label', { for: 'account-email' }, 'Email'),
    email,
    el('label.field-label', { for: 'account-password' }, 'Password'),
    password,
    problem,
    /* Enter on the phone's keyboard has to submit, and the visible button is
       down in the composer bar outside this form. A real submit button here
       is what makes the Go key work; it is a control, so it stays reachable
       rather than being hidden from the keyboard too. */
    el('button.sr-only', { type: 'submit' }, 'Sign in'),
  );

  for (const field of [email, password]) {
    field.addEventListener('input', () => api.refreshBar());
  }

  /* ---------------------------------------------------------- signed in */

  async function doSignOut() {
    await net.signOut();
    sync.afterSignOut();
    toast('Signed out');
    api.go('#/', { replace: true });
  }

  const actions = el('div.account-actions',
    el('button.account-btn', {
      type: 'button',
      onclick: () => { sync.now(); },
    }, 'Sync now'),
    el('button.account-btn', {
      type: 'button',
      'data-tone': 'quiet',
      onclick: doSignOut,
    }, 'Sign out'),
  );

  function paint() {
    const s = sync.state();
    if (s.status === 'syncing') status.textContent = 'Syncing…';
    else if (s.status === 'offline') status.textContent = 'No connection — it will catch up on its own.';
    else if (s.status === 'error') status.textContent = s.detail;
    else status.textContent = `Last synced ${ago(s.lastSyncedAt)}.`;
    status.dataset.tone = s.status === 'error' ? 'problem' : '';
  }

  const onSync = () => paint();
  window.addEventListener('dj:sync', onSync);

  /* ---------------------------------------------------------------- node */

  const node = el('div.screen-inner',
    el('header.account-head',
      el('h1.account-title', 'Sync'),
    ),

    !configured()
      ? el('p.account-note',
          'This copy of the app has no Supabase project configured, so the ' +
          'journal stays on this device only.')

    : signedIn
      ? [
          el('p.account-note',
            'This journal is mirrored to your account. Entries written on any ' +
            'signed-in device appear on the others when the app is opened.'),
          el('p.account-email', net.currentEmail() || ''),
          status,
          actions,
          el('p.account-note',
            'Signing out stops the mirroring. The entries already on this ' +
            'device stay on it, and everything synced so far stays in your ' +
            'account.'),
        ]
      : [
          el('p.account-note',
            'Signing in mirrors this journal to your account, so it survives ' +
            'a lost phone and appears on any other device you sign in on. ' +
            'Until then the entries live on this device alone.'),
          form,
        ],
  );

  if (signedIn) paint();

  return {
    node,
    title: 'Sync',
    get bar() {
      if (signedIn || !configured()) return 'hidden';
      return {
        mode: 'publish',
        label: busy ? 'Signing in…' : 'Sign in',
        disabled: !ready(),
        side: null,
        onSelect: submit,
      };
    },
    get toolbarLeft() {
      return iconButton('back', 'Back', () => api.back());
    },
    onLeave() {
      window.removeEventListener('dj:sync', onSync);
    },
  };
}
