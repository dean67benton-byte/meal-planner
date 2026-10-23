import { useState } from 'preact/hooks';
import { api } from '../lib/api';
import { useStore } from '../lib/store';
import type { MealDraft } from '../lib/types';
import { DraftCard } from './ideas';

/** #/import?url=… turns an Instagram, TikTok, or YouTube video into a meal draft. */
export function ImportScreen({ query }: { query: URLSearchParams }) {
  const store = useStore();
  const s = store.state!;
  const [url, setUrl] = useState(query.get('url') ?? '');
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<MealDraft | null>(null);

  const paste = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text) setUrl(text.match(/https:\/\/\S+/)?.[0] ?? text);
    } catch {
      store.toast('Long-press the box and choose Paste');
    }
  };

  const run = async () => {
    setBusy(true);
    setDraft(null);
    try {
      setDraft((await api.aiReel(url.trim(), caption.trim())).meal);
    } catch (e) {
      store.toast(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header class="top">
        <div class="top-title">
          <h1>Import a recipe</h1>
          <p class="muted">From an Instagram, TikTok, or YouTube video</p>
        </div>
      </header>

      {!s.features.ai ? (
        <div class="callout small">
          <b>Importing needs a Claude API key.</b> See More ▸ Setup.
        </div>
      ) : (
        <section class="card ai">
          <label class="field">
            <span>Video link</span>
            <input type="url" value={url} onInput={(e) => setUrl(e.currentTarget.value)} placeholder="https://www.instagram.com/reel/…" />
          </label>
          <button class="btn wide" onClick={paste}>Paste link</button>
          <label class="field">
            <span>What's in the video (optional; helps when the caption has no recipe)</span>
            <textarea rows={3} value={caption} onInput={(e) => setCaption(e.currentTarget.value)} placeholder="e.g. ham, salami, provolone, lettuce, pickles, mayo, eaten from a chip bag" />
          </label>
          <button class="btn primary wide" disabled={busy || (!url.trim() && !caption.trim())} onClick={run}>
            {busy ? 'Reading the video… (about 20 seconds)' : 'Turn into a recipe'}
          </button>
          <p class="small muted">Claude reads the caption and cover photo, then keeps it quick, cheap, and to 10 ingredients or fewer. Check the recipe before you add it.</p>
          {draft && (
            <ul class="list cards">
              <DraftCard draft={draft} why={draft.notes} />
            </ul>
          )}
        </section>
      )}
    </>
  );
}
