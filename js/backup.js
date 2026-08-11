/* ============================================================================
   backup.js — getting the journal off the phone, and back onto it.

   THIS IS NOT A NICETY. Everything you write lives in localStorage on one
   device. iOS treats script-written storage as reclaimable: Safari clears it
   after roughly seven days without opening the app, "Clear Website Data"
   takes it instantly, and none of it is in an iCloud backup. A homescreen web
   app is used often enough that eviction is unlikely — but "unlikely" is not
   a promise you want holding a year of journal entries.

   So: export writes every entry to one small JSON file you can put in iCloud
   Drive, mail to yourself, or commit to the repo. Import merges one back,
   keeping whichever copy of an entry was edited later. Between them the
   journal is portable, and moving to a new phone is a two-tap operation.
   ========================================================================= */

import { toast } from './ui.js';
import * as store from './store.js';

function filename() {
  return `digijournal-${store.dayKey()}.json`;
}

export async function exportJournal() {
  const bundle = store.exportBundle();
  if (!bundle.entries.length) {
    toast('Nothing to export yet');
    return;
  }

  const json = JSON.stringify(bundle, null, 2);
  const name = filename();

  /* On iOS the share sheet is the only route to Files, iCloud Drive, or
     another device. Try it first, and only when it can genuinely take the
     file — canShare() with the file is the check that matters, since
     navigator.share exists on plenty of browsers that refuse attachments. */
  try {
    const file = new File([json], name, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Digijournal backup' });
      return;
    }
  } catch (err) {
    /* The user dismissing the share sheet lands here too — that is a
       cancellation, not a failure, and must not fall through to a download
       they did not ask for. */
    if (err?.name === 'AbortError') return;
  }

  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast(`Saved ${name}`);
}

export function importJournal(onDone) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.style.display = 'none';

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    input.remove();
    if (!file) return;

    try {
      const { added, updated } = store.importBundle(JSON.parse(await file.text()));
      if (!added && !updated) toast('Already up to date');
      else {
        const parts = [];
        if (added) parts.push(`${added} added`);
        if (updated) parts.push(`${updated} updated`);
        toast(parts.join(', '));
      }
      onDone?.();
    } catch (err) {
      console.error(err);
      toast(err instanceof SyntaxError ? 'That file is not readable JSON' : String(err.message || err));
    }
  });

  document.body.append(input);
  input.click();
}
