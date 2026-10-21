import { useState } from 'preact/hooks';
import { api } from '../lib/api';
import { IDEAS } from '../lib/ideas';
import { useStore } from '../lib/store';
import type { KrogerDeal, Meal, MealDraft } from '../lib/types';
import { money } from '../lib/grocery';
import { Icon } from '../icons';
import { Seg } from '../ui';
import { openDraft } from './meal-editor';

type MaxTime = 'Any' | '≤ 20 min' | '≤ 30 min';

export function IdeasScreen() {
  const store = useStore();
  const s = store.state!;
  const [maxTime, setMaxTime] = useState<MaxTime>('≤ 30 min');
  const [protein, setProtein] = useState('All');
  const have = new Set(s.meals.map((m) => m.name.toLowerCase()));
  const limit = maxTime === '≤ 20 min' ? 20 : maxTime === '≤ 30 min' ? 30 : Infinity;
  // Slow-cooker meals count only their hands-on prep time.
  const handsOn = (i: MealDraft) => ((i.cook_min ?? 0) > 60 ? (i.prep_min ?? 0) : (i.prep_min ?? 0) + (i.cook_min ?? 0));
  const starters = IDEAS.filter(
    (i) => !have.has(i.name.toLowerCase()) && handsOn(i) <= limit && (protein === 'All' || i.protein === protein),
  );

  return (
    <>
      <header class="top">
        <div class="top-title">
          <h1>Ideas</h1>
          <p class="muted">Quick, simple, and cheap meals you haven't tried</p>
        </div>
      </header>

      {s.features.kroger && <SalesPanel />}

      {s.features.ai ? <AiPanel /> : (
        <div class="callout small">
          <b>Instagram reels and Claude ideas</b> turn on once a Claude API key is added. See More ▸ Setup.
        </div>
      )}

      <h2>Starter ideas</h2>
      <div class="filters">
        <Seg label="Time" value={maxTime} options={['≤ 20 min', '≤ 30 min', 'Any'] as const} onChange={setMaxTime} />
        <Seg label="Protein" value={protein} options={['All', ...new Set(IDEAS.map((i) => i.protein))]} onChange={setProtein} />
      </div>
      <p class="small muted">Slow-cooker meals count only their hands-on time.</p>
      <ul class="list cards">
        {starters.map((d) => <DraftCard key={d.name} draft={d} />)}
      </ul>
      {!starters.length && <div class="empty">You've added every starter idea that matches. Nice.</div>}
    </>
  );
}

function DraftCard({ draft, why }: { draft: MealDraft; why?: string }) {
  const store = useStore();
  const [added, setAdded] = useState(false);
  const quickAdd = async () => {
    if (await store.run(() => api.saveMeal(draft))) {
      setAdded(true);
      store.toast(`Added ${draft.name}`);
    }
  };
  return (
    <li class="card idea">
      <div class="row between">
        <span class="meal-name">{draft.name}</span>
        <span class="small muted">{draft.category}</span>
      </div>
      <span class="meta">
        {[draft.protein, `${draft.prep_min ?? '?'} min prep`, draft.cook_min ? `${draft.cook_min} min cook` : '', `${draft.ingredients.length} ingredients`].filter(Boolean).join(' · ')}
      </span>
      {why && <p class="small">{why}</p>}
      <details>
        <summary class="small">Ingredients and steps</summary>
        <ul class="ings small">{draft.ingredients.map((i, n) => <li key={n}>{i.qty ?? ''} {i.unit} {i.name}</li>)}</ul>
        <p class="pre small">{draft.recipe}</p>
      </details>
      <div class="row gap">
        <button class="btn primary" disabled={added} onClick={quickAdd}>{added ? 'Added ✓' : <><Icon name="plus" size={18} /> Add to meals</>}</button>
        <button class="btn" onClick={() => openDraft(draft)}>Edit first</button>
      </div>
    </li>
  );
}

function AiPanel() {
  const store = useStore();
  const [mode, setMode] = useState<'Ideas from Claude' | 'From a reel'>('Ideas from Claude');
  const [mood, setMood] = useState('');
  const [url, setUrl] = useState('');
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<MealDraft[]>([]);
  const [useOnHand, setUseOnHand] = useState(false);
  const [useDeals, setUseDeals] = useState(false);
  const s = store.state!;
  const onHandCount = s.pantry.filter((p) => p.on_hand > 0 && !p.staple).length;

  const run = async () => {
    setBusy(true);
    try {
      if (mode === 'From a reel') {
        const r = await api.aiReel(url.trim(), caption.trim());
        setResults([r.meal]);
      } else {
        const r = await api.aiIdeas(mood.trim(), { useOnHand, useDeals });
        setResults(r.meals);
      }
    } catch (e) {
      store.toast(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section class="card ai">
      <Seg label="AI mode" value={mode} options={['Ideas from Claude', 'From a reel'] as const} onChange={(m) => { setMode(m); setResults([]); }} />
      {mode === 'Ideas from Claude' ? (
        <>
          <label class="field">
            <span>In the mood for anything? (optional)</span>
            <input value={mood} onInput={(e) => setMood(e.currentTarget.value)} placeholder="e.g. something with ground turkey, no oven" />
          </label>
          {onHandCount > 0 && (
            <label class="toggle"><input type="checkbox" checked={useOnHand} onChange={(e) => setUseOnHand(e.currentTarget.checked)} /> Use what we have at home ({onHandCount} items)</label>
          )}
          {s.features.kroger && (
            <label class="toggle"><input type="checkbox" checked={useDeals} onChange={(e) => setUseDeals(e.currentTarget.checked)} /> Build around this week's Kroger sales</label>
          )}
        </>
      ) : (
        <>
          <label class="field">
            <span>Reel link</span>
            <input type="url" value={url} onInput={(e) => setUrl(e.currentTarget.value)} placeholder="https://www.instagram.com/reel/…" />
          </label>
          <label class="field">
            <span>Caption (paste it if the link alone doesn't work)</span>
            <textarea rows={3} value={caption} onInput={(e) => setCaption(e.currentTarget.value)} />
          </label>
        </>
      )}
      <button class="btn primary wide" disabled={busy || (mode === 'From a reel' && !url.trim() && !caption.trim())} onClick={run}>
        {busy ? 'Thinking… (about 20 seconds)' : mode === 'From a reel' ? 'Turn into a recipe' : 'Suggest 5 meals'}
      </button>
      <p class="small muted">Kept to about 30 minutes, 10 ingredients or fewer, and budget-friendly.</p>
      {results.length > 0 && (
        <ul class="list cards">
          {results.map((d) => <DraftCard key={d.name} draft={d} why={d.notes} />)}
        </ul>
      )}
    </section>
  );
}

/** Matches a sale to library meals by the staple it was found under ("ground beef" ⊂ "Lean ground beef"). */
const usesDeal = (m: Meal, d: KrogerDeal) => m.ingredients.some((i) => i.name.toLowerCase().includes(d.term));

function SalesPanel() {
  const store = useStore();
  const s = store.state!;
  const [deals, setDeals] = useState<KrogerDeal[] | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    try {
      setDeals(await api.kroger.deals());
    } catch (e) {
      store.toast(e instanceof Error ? e.message : 'Could not load sales');
    } finally {
      setBusy(false);
    }
  };
  const onHand = s.pantry.filter((p) => p.on_hand > 0 && !p.staple);
  const usesOnHand = (m: Meal) => m.ingredients.filter((i) => onHand.some((p) => p.name.toLowerCase() === i.name.toLowerCase())).length;
  const active = s.meals.filter((m) => !m.archived);
  const saleMeals = deals ? active.filter((m) => deals.some((d) => usesDeal(m, d))) : [];
  const homeMeals = active.map((m) => ({ m, n: usesOnHand(m) })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 6);

  return (
    <section class="card">
      <h2>Save money this week</h2>
      {homeMeals.length > 0 && (
        <>
          <p class="small"><b>Your meals that use what's at home:</b></p>
          <ul class="ings small">{homeMeals.map(({ m, n }) => <li key={m.id}><a href={`#/meals/${m.id}`}>{m.name}</a> ({n} on hand)</li>)}</ul>
        </>
      )}
      {!deals ? (
        <button class="btn wide" disabled={busy} onClick={load}>{busy ? 'Checking your Kroger…' : "See what's on sale at Kroger"}</button>
      ) : (
        <>
          {saleMeals.length > 0 && (
            <>
              <p class="small"><b>Your meals with sale ingredients:</b></p>
              <ul class="ings small">
                {saleMeals.map((m) => (
                  <li key={m.id}><a href={`#/meals/${m.id}`}>{m.name}</a>: {deals.filter((d) => usesDeal(m, d)).map((d) => d.term).join(', ')}</li>
                ))}
              </ul>
            </>
          )}
          <details open={!saleMeals.length}>
            <summary class="small">{deals.length} staples on sale</summary>
            <ul class="ings small">
              {deals.map((d) => (
                <li key={d.upc}>{d.description} {d.size}: <b>{money(d.promo)}</b> <s class="muted">{money(d.regular)}</s></li>
              ))}
            </ul>
          </details>
          {s.features.ai && <p class="small muted">Tip: tick "Build around this week's Kroger sales" below for new meal ideas that use these.</p>}
        </>
      )}
    </section>
  );
}
