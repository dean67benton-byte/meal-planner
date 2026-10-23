import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/api';
import { short } from '../lib/dates';
import { useStore } from '../lib/store';
import type { ImportLink } from '../lib/types';
import { Icon } from '../icons';

/** #/import?url=… saves Instagram, TikTok, and YouTube links for Claude to turn into meals. */
export function ImportScreen({ query }: { query: URLSearchParams }) {
  const store = useStore();
  const [url, setUrl] = useState(query.get('url') ?? '');
  const [note, setNote] = useState('');
  const [links, setLinks] = useState<ImportLink[] | null>(null);

  const load = () => api.imports().then(setLinks, (e) => store.toast(e instanceof Error ? e.message : 'Could not load links'));
  useEffect(() => void load(), []);

  const paste = async () => {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      if (text) setUrl(text.match(/https:\/\/\S+/)?.[0] ?? text);
    } catch {
      store.toast('Long-press the box and choose Paste');
    }
  };

  const save = async () => {
    if (await store.run(() => api.addImport(url.trim(), note.trim()))) {
      setUrl('');
      setNote('');
      store.toast('Saved for Claude');
      load();
    }
  };

  const remove = async (id: number) => {
    if (await store.run(() => api.deleteImport(id))) load();
  };

  return (
    <>
      <header class="top">
        <div class="top-title">
          <h1>Import a recipe</h1>
          <p class="muted">From an Instagram, TikTok, or YouTube video</p>
        </div>
      </header>

      <section class="card">
        <label class="field">
          <span>Video link</span>
          <input type="url" value={url} onInput={(e) => setUrl(e.currentTarget.value)} placeholder="https://www.instagram.com/reel/…" />
        </label>
        <button class="btn wide paste" onClick={paste}>Paste link</button>
        <label class="field">
          <span>Note for Claude (optional)</span>
          <input value={note} onInput={(e) => setNote(e.currentTarget.value)} placeholder="e.g. Kinley wants to cook this one" />
        </label>
        <button class="btn primary wide" disabled={!url.trim()} onClick={save}><Icon name="plus" size={18} /> Save for Claude</button>
      </section>

      <div class="callout small">
        <b>Then tell Claude: "Import my reels."</b> Claude watches each saved video, adds the recipe to Meals (kept quick, cheap, and short on ingredients), and clears it from this list.
      </div>

      <h2>Waiting to import</h2>
      {links === null ? (
        <div class="loading">Loading…</div>
      ) : links.length ? (
        <ul class="list cards">
          {links.map((l) => (
            <li key={l.id} class="card row between">
              <span>
                <a href={l.url} target="_blank" rel="noopener noreferrer">{l.url.replace(/^https:\/\/(www\.)?/, '').slice(0, 40)}…</a>
                <br /><span class="small muted">{[l.added_by, short(l.created_at.slice(0, 10)), l.note].filter(Boolean).join(' · ')}</span>
              </span>
              <button class="icon" aria-label="Remove link" onClick={() => remove(l.id)}><Icon name="trash" size={18} /></button>
            </li>
          ))}
        </ul>
      ) : (
        <div class="empty">Nothing waiting.</div>
      )}
    </>
  );
}
