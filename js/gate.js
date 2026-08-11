/* ============================================================================
   gate.js — the password screen.

   READ THIS BEFORE DESCRIBING IT AS SECURITY.

   The repo is public, so this file is public, so the check below runs on the
   reader's own machine and can be stepped over by anyone who opens the dev
   tools. It is a deterrent, not a lock.

   What makes that acceptable here is where the journal actually lives:
   entries are written to localStorage on the device that typed them and are
   never uploaded. Nothing you write is in the repo, on GitHub, or on any
   server — so there is nothing behind this gate for a stranger who finds the
   URL to read. They would unlock it and see an empty journal, their own.

   The one thing it genuinely stops is the real risk: somebody picking up
   your unlocked phone and opening the app. That is why it re-locks when the
   app has been in the background for a few minutes, and why it covers the
   screen before anything else renders.

   The password is not stored here — a PBKDF2-SHA256 derivation of it is,
   200k iterations over a random salt. That means the file cannot be read
   backwards into the password, and guessing it costs real time per attempt.

   To change the password, run this and paste the two values in below:

     python3 - <<'PY'
     import hashlib, base64, os, getpass
     salt = os.urandom(16)
     pw = getpass.getpass('new password: ')
     dk = hashlib.pbkdf2_hmac('sha256', pw.encode(), salt, 200000, dklen=32)
     print('SALT_HEX =', salt.hex())
     print('HASH_B64 =', base64.b64encode(dk).decode())
     PY
   ========================================================================= */

import { el, icon } from './ui.js';

const SALT_HEX   = '7199cdbfe3dab58816867dbe51e86e08';
const HASH_B64   = 'S8Gjii1YTYXvR5Vm1IRz56HmeCgj3FvzZCX46b4yh3o=';
const ITERATIONS = 200000;

const SESSION_KEY = 'digijournal.unlocked';
const SEEN_KEY    = 'digijournal.lastSeen';

/** How long the app may sit in the background before it asks again. Long
 *  enough to answer a text mid-entry, short enough that a handed-over phone
 *  doesn't stay open. */
const GRACE_MS = 5 * 60 * 1000;

function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function bytesToB64(buf) {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s);
}

async function derive(password) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: hexToBytes(SALT_HEX), iterations: ITERATIONS, hash: 'SHA-256' },
    key, 256
  );
  return bytesToB64(bits);
}

async function check(password) {
  const got = await derive(password);
  /* Compare every byte regardless of where it diverges. Timing attacks are
     not a real threat model for a phone journal; doing it right costs one
     line and means nobody has to think about it again. */
  if (got.length !== HASH_B64.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ HASH_B64.charCodeAt(i);
  return diff === 0;
}

/* --------------------------------------------------------------- session */

function markSeen() {
  try { sessionStorage.setItem(SEEN_KEY, String(Date.now())); } catch { /* ignore */ }
}

function unlockedNow() {
  try {
    if (sessionStorage.getItem(SESSION_KEY) !== '1') return false;
    const seen = Number(sessionStorage.getItem(SEEN_KEY) || 0);
    return Date.now() - seen < GRACE_MS;
  } catch {
    return false;
  }
}

function setUnlocked() {
  try {
    sessionStorage.setItem(SESSION_KEY, '1');
    markSeen();
  } catch { /* private mode: the gate simply asks again next launch */ }
}

export function lock() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* ignore */ }
}

/* ------------------------------------------------------------------ view */

/** Resolves once the app is unlocked. Renders nothing if the session is
 *  still valid, so a resume inside the grace period goes straight in. */
export function requireUnlock() {
  if (unlockedNow()) {
    markSeen();
    watchBackground();
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const input = el('input.gate-input', {
      type: 'password',
      id: 'gate-input',
      autocomplete: 'current-password',
      'aria-describedby': 'gate-error',
      spellcheck: 'false',
      autocapitalize: 'off',
      placeholder: 'Password',
    });

    const error = el('p.gate-error#gate-error', { role: 'alert' });
    const form = el('form.gate-form.glass', { novalidate: true });
    const go = el('button.gate-go', { type: 'submit', 'aria-label': 'Unlock' }, icon('go'));

    form.append(input, go);

    const gate = el('div.gate', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Locked' },
      el('div.gate-inner',
        el('div.gate-mark', { 'aria-hidden': 'true' }, icon('book')),
        el('h1', 'Digijournal'),
        el('p', 'Private. Enter the password to continue.'),
        form,
        error,
      )
    );

    let busy = false;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (busy) return;

      const value = input.value;
      if (!value) { input.focus(); return; }

      if (!crypto?.subtle) {
        /* deriveBits only exists in a secure context. On GitHub Pages it
           always does; over plain http on a LAN address it does not. */
        error.textContent = 'This app needs to be opened over https.';
        return;
      }

      busy = true;
      go.disabled = true;
      error.textContent = '';

      const ok = await check(value).catch(() => false);
      busy = false;
      go.disabled = false;

      if (!ok) {
        input.value = '';
        error.textContent = 'That is not the password.';
        form.dataset.wrong = 'true';
        setTimeout(() => { delete form.dataset.wrong; }, 500);
        input.focus();
        return;
      }

      setUnlocked();
      watchBackground();
      gate.remove();
      resolve();
    });

    document.body.append(gate);

    /* Do not autofocus on touch: it throws the keyboard up over the app the
       instant it launches. On a desktop it is the right thing. */
    if (matchMedia('(hover: hover) and (pointer: fine)').matches) input.focus();
  });
}

/* Records when the app went away, and re-locks on return if it was gone too
   long. Registered once, on first unlock. */
let watching = false;

function watchBackground() {
  if (watching) return;
  watching = true;

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      markSeen();
    } else if (!unlockedNow()) {
      /* Reload rather than tear the UI down by hand: it is the one path that
         is guaranteed to leave nothing of the journal on screen behind the
         gate, and the editor has already flushed on hide. */
      location.reload();
    } else {
      markSeen();
    }
  });

  /* Keep the stamp fresh while the app is genuinely in use, so the grace
     period measures time away rather than time since unlocking. */
  setInterval(() => { if (document.visibilityState === 'visible') markSeen(); }, 30000);
}
