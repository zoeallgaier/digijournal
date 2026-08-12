/* ============================================================================
   settings.js — everything about the app that is not an entry.

   Two things live here and they are deliberately in this order:

     Colour   which of the eight palettes the app is wearing. On this phone
              only — a palette is a property of the device, not of the
              journal, so it does not sync and signing out does not undo it.
     Sync     signed out it is a sign-in form; signed in it is a status line
              and two buttons.

   Colour first because it is the one that always has something to do. Sync
   is the deeper of the two and it is the one that can be not configured at
   all, so it sits underneath rather than greeting you with a password field.

   Sign-in is DELIBERATELY NOT A GATE. The app opens straight onto the list
   whether or not anyone has ever signed in, exactly as it did before sync
   existed — a cold launch shows the journal, not a password field. Signing in
   starts mirroring; it does not stand between the icon and the entries.

   The primary action borrows the composer bar, the same way the editor
   borrows it for Publish. Same capsule, same position, same thumb.
   ========================================================================= */

import { el, icon, iconButton, toast } from './ui.js';
import * as net from './net.js';
import * as sync from './sync.js';
import * as theme from './theme.js';
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

  /* -------------------------------------------------------------- colour
     A radiogroup, the same pattern and the same manners as the mood control
     on an entry: one tab stop, arrows move within it, and the choice is
     never carried by colour alone — every swatch is named beside itself and
     the chosen one takes a tick.

     Each swatch is painted BY the stylesheet, from a data-palette of its
     own, so this file names the eight and knows none of their colours. That
     is also why the picker cannot drift out of step with the app: a swatch
     is showing the same tokens the page would be wearing. */

  const swatchRow = el('div.palette-row', {
    role: 'radiogroup',
    'aria-label': 'Colour',
  });

  const swatches = theme.PALETTES.map(({ id, name }) =>
    el('button.palette-opt', {
      type: 'button',
      role: 'radio',
      'data-palette': id,
      onclick: () => choose(id),
    },
      el('span.palette-swatch', icon('check')),
      el('span.palette-name', name),
    )
  );

  swatchRow.append(...swatches);

  function paintPalette() {
    const now = theme.current();
    swatches.forEach((btn, i) => {
      const checked = theme.PALETTES[i].id === now;
      btn.setAttribute('aria-checked', String(checked));
      /* Roving tabindex: the group is one stop, arrows move within it. */
      btn.tabIndex = checked ? 0 : -1;
    });
  }

  function choose(id, { focus = false } = {}) {
    theme.set(id);
    paintPalette();
    if (focus) swatches[theme.PALETTES.findIndex((p) => p.id === id)]?.focus();
  }

  swatchRow.addEventListener('keydown', (e) => {
    const i = theme.PALETTES.findIndex((p) => p.id === theme.current());
    const last = theme.PALETTES.length - 1;
    const at = (n) => choose(theme.PALETTES[Math.max(0, Math.min(last, n))].id, { focus: true });

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); at(i + 1); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); at(i - 1); }
    else if (e.key === 'Home') { e.preventDefault(); at(0); }
    else if (e.key === 'End') { e.preventDefault(); at(last); }
  });

  paintPalette();

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
      el('h1.account-title', 'Settings'),
    ),

    el('section.set-section',
      el('h2.set-title', 'Colour'),
      swatchRow,
    ),

    /* No heading of its own: the fields are labelled, the email and the two
       buttons say what they are. The name is kept for a screen reader, which
       is the one reader that cannot see the section from its contents. */
    el('section.set-section', { 'aria-label': 'Sync' },

      /* The only prose left on the screen, and it is a state rather than an
         explanation: without it this section is empty. */
      !configured()
        ? el('p.account-note',
            'This copy of the app has no Supabase project configured, so the ' +
            'journal stays on this device only.')

      : signedIn
        ? [
            el('p.account-email', net.currentEmail() || ''),
            status,
            actions,
          ]
        : form,
    ),
  );

  if (signedIn) paint();

  return {
    node,
    title: 'Settings',
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
