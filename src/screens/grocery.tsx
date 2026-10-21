import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/api';
import { short } from '../lib/dates';
import { buildList, cartQuantity, fmtQty, money, PACKAGE_UNITS, type GroceryLine } from '../lib/grocery';
import { useStore } from '../lib/store';
import type { KrogerProduct, KrogerStatus } from '../lib/types';
import { Icon } from '../icons';
import { Sheet } from '../ui';

export function GroceryScreen() {
  const store = useStore();
  const s = store.state!;
  const list = buildList(s);
  const [editing, setEditing] = useState<GroceryLine | null>(null);
  const [matching, setMatching] = useState<GroceryLine | null>(null);
  const [kroger, setKroger] = useState<KrogerStatus | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (s.features.kroger) api.kroger.status().then(setKroger).catch(() => {});
  }, [s.features.kroger]);

  const bought = (l: GroceryLine) => !!s.checks[l.key];
  const toggle = (l: GroceryLine) =>
    store.run(() => api.check(s.week_of, l.key, !bought(l)), (st) => ({ ...st, checks: { ...st.checks, [l.key]: bought(l) ? 0 : 1 } }));

  const krogerLines = list.shop.filter((l) => l.store === 'Kroger' && !bought(l));
  const matched = krogerLines.filter((l) => l.item?.kroger_upc);
  const sendToCart = async () => {
    setSending(true);
    try {
      const r = await api.kroger.cart(matched.map((l) => ({ upc: l.item!.kroger_upc!, quantity: cartQuantity(l) })));
      await Promise.all(matched.map((l) => api.check(s.week_of, l.key, true)));
      await store.refresh();
      store.toast(`Added ${r.added} items to your Kroger cart`);
    } catch (e) {
      store.toast(e instanceof Error ? e.message : 'Kroger cart failed');
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <header class="top">
        <div class="top-title">
          <h1>Groceries</h1>
          <p class="muted">Week of {short(s.week_of)} · {list.lockedCount} locked meals{list.snackCount ? ` · ${list.snackCount} snacks` : ''}</p>
        </div>
        <a class="btn" href="#/pantry">Prices & pantry</a>
      </header>

      {list.unlocked > 0 && (
        <div class="callout small">
          {list.unlocked} {list.unlocked === 1 ? "meal isn't" : "meals aren't"} locked in yet, so {list.unlocked === 1 ? "it's" : "they're"} not on this list. <a href="#/week">Lock them on the Week tab.</a>
        </div>
      )}
      {list.unlockedExtras > 0 && (
        <div class="callout small">
          {list.unlockedExtras} {list.unlockedExtras === 1 ? "side or snack isn't" : "sides and snacks aren't"} locked in yet. <a href="#/week">Lock them on the Week tab.</a>
        </div>
      )}
      {!list.lockedCount && !list.snackCount && <div class="empty">Lock in meals on the Week tab and their ingredients add up here.</div>}

      {list.shop.length > 0 && (
        <div class="totals card">
          <div><span class="muted small">Estimated</span><b>{money(list.total)}</b></div>
          {list.stores.map((st) => (
            <div key={st}><span class="muted small">{st}</span><b>{money(list.shop.filter((l) => l.store === st).reduce((a, l) => a + (l.cost ?? 0), 0))}</b></div>
          ))}
          {list.missingPrices > 0 && <p class="small muted full">{list.missingPrices} items have no price yet, so the total is low. Tap an item to add one.</p>}
        </div>
      )}

      {s.features.kroger && kroger && krogerLines.length > 0 && (
        <div class="card kroger">
          {!kroger.connected ? (
            <p class="small">Connect Kroger on the <a href="#/more">More tab</a> to send this list to your cart.</p>
          ) : (
            <>
              <p class="small">
                {matched.length} of {krogerLines.length} Kroger items are matched to a product.
                {matched.length < krogerLines.length && ' Tap "Match" on the others.'}
              </p>
              <button class="btn primary wide" disabled={!matched.length || sending} onClick={sendToCart}>
                <Icon name="cart" size={18} /> {sending ? 'Adding…' : `Add ${matched.length} to Kroger cart`}
              </button>
            </>
          )}
        </div>
      )}

      {list.stores.map((st) => (
        <section key={st}>
          <h2>{st}</h2>
          <ul class="glist">
            {list.shop.filter((l) => l.store === st).map((l) => (
              <li key={l.key} class={bought(l) ? 'bought' : ''}>
                <button class="check" role="checkbox" aria-checked={bought(l)} aria-label={`Bought ${l.name}`} onClick={() => toggle(l)}>
                  {bought(l) && <Icon name="check" size={16} />}
                </button>
                <button class="gline" onClick={() => setEditing(l)}>
                  <span><b>{l.name}</b> <span class="qty">{l.toBuy == null ? '' : `${fmtQty(l.toBuy)} ${l.unit}`}</span></span>
                  <span class="small muted">
                    {l.usedIn.join(', ')}
                    {l.onHand > 0 && ` · have ${fmtQty(l.onHand)}`}
                    {l.cost != null ? ` · ${money(l.cost)}` : ' · no price'}
                    {l.store === 'Kroger' && l.item?.kroger_desc ? ` · ${l.item.kroger_desc}` : ''}
                  </span>
                </button>
                {s.features.kroger && l.store === 'Kroger' && kroger?.connected && (
                  <button class="btn tiny" onClick={() => setMatching(l)}>{l.item?.kroger_upc ? 'Change' : 'Match'}</button>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {list.covered.length > 0 && (
        <details>
          <summary>Already have enough ({list.covered.length})</summary>
          <ul class="glist">{list.covered.map((l) => <li key={l.key}><button class="gline" onClick={() => setEditing(l)}><b>{l.name}</b><span class="small muted">need {fmtQty(l.needed)} {l.unit}, have {fmtQty(l.onHand)}</span></button></li>)}</ul>
        </details>
      )}
      {list.staples.length > 0 && (
        <details>
          <summary>Pantry staples, not on the list ({list.staples.length})</summary>
          <ul class="glist">{list.staples.map((l) => <li key={l.key}><button class="gline" onClick={() => setEditing(l)}><b>{l.name}</b><span class="small muted">{l.usedIn.join(', ')}</span></button></li>)}</ul>
        </details>
      )}

      {editing && <ItemSheet line={editing} onClose={() => setEditing(null)} />}
      {matching && <MatchSheet line={matching} onClose={() => setMatching(null)} />}
    </>
  );
}

export function ItemSheet({ line, onClose }: { line: Pick<GroceryLine, 'name' | 'unit' | 'key' | 'item'>; onClose: () => void }) {
  const store = useStore();
  const s = store.state!;
  const it = line.item;
  const [price, setPrice] = useState(it?.price?.toString() ?? '');
  const [onHand, setOnHand] = useState(it?.on_hand ? String(it.on_hand) : '');
  const [storeName, setStore] = useState(it?.store ?? 'Kroger');
  const [staple, setStaple] = useState(!!it?.staple);
  const [restock, setRestock] = useState(!!it?.restock);
  const save = async () => {
    onClose();
    await store.run(() =>
      api.savePantry({
        ...(it ?? {}),
        key: line.key,
        name: line.name,
        unit: line.unit,
        price: price === '' ? null : Number(price),
        on_hand: onHand === '' ? 0 : Number(onHand),
        store: storeName,
        staple: staple ? 1 : 0,
        restock: restock ? 1 : 0,
      }),
    );
  };
  return (
    <Sheet title={`${line.name} (${line.unit})`} onClose={onClose}>
      <div class="grid2">
        <label class="field"><span>Price per {line.unit}</span><input inputMode="decimal" value={price} placeholder="$" onInput={(e) => setPrice(e.currentTarget.value)} /></label>
        <label class="field"><span>Have at home</span><input inputMode="decimal" value={onHand} placeholder="0" onInput={(e) => setOnHand(e.currentTarget.value)} /></label>
      </div>
      <label class="field">
        <span>Buy at</span>
        <select value={storeName} onChange={(e) => setStore(e.currentTarget.value)}>{s.settings.stores.map((x) => <option key={x}>{x}</option>)}</select>
      </label>
      <label class="toggle"><input type="checkbox" checked={staple} onChange={(e) => setStaple(e.currentTarget.checked)} /> Pantry staple (salt, spices, oil…), usually left off the list</label>
      {staple && <label class="toggle"><input type="checkbox" checked={restock} onChange={(e) => setRestock(e.currentTarget.checked)} /> Running low: put it on the list</label>}
      <button class="btn primary wide" onClick={save}>Save</button>
    </Sheet>
  );
}

export function MatchSheet({ line, onClose }: { line: Pick<GroceryLine, 'name' | 'unit' | 'key' | 'item'>; onClose: () => void }) {
  const store = useStore();
  const [term, setTerm] = useState(line.name);
  const [results, setResults] = useState<KrogerProduct[] | null>(null);
  const [busy, setBusy] = useState(false);
  const search = async () => {
    setBusy(true);
    try {
      setResults(await api.kroger.products(term));
    } catch (e) {
      store.toast(e instanceof Error ? e.message : 'Search failed');
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    search();
  }, []);
  const pick = async (p: KrogerProduct) => {
    onClose();
    await store.run(() =>
      api.savePantry({
        ...(line.item ?? {}),
        key: line.key,
        name: line.name,
        unit: line.unit,
        store: 'Kroger',
        kroger_upc: p.upc,
        kroger_desc: [p.brand, p.description, p.size].filter(Boolean).join(' ').slice(0, 120),
        price: line.item?.price ?? (PACKAGE_UNITS.has(line.unit.toLowerCase()) ? p.price : null),
      }),
    );
  };
  return (
    <Sheet title={`Kroger product for ${line.name}`} onClose={onClose}>
      <form class="row gap" onSubmit={(e) => { e.preventDefault(); search(); }}>
        <input class="search" type="search" value={term} onInput={(e) => setTerm(e.currentTarget.value)} />
        <button class="btn" disabled={busy}>Search</button>
      </form>
      <p class="small muted">The app remembers your pick for next time.</p>
      {busy && <p class="muted">Searching…</p>}
      <ul class="list">
        {results?.map((p) => (
          <li key={p.upc}>
            <button class="list-item product" onClick={() => pick(p)}>
              {p.image ? <img src={p.image} alt="" width={48} height={48} loading="lazy" /> : <span class="noimg" />}
              <span>
                <span>{p.description}</span>
                <span class="small muted">{[p.brand, p.size, p.price != null ? money(p.price) : ''].filter(Boolean).join(' · ')}</span>
              </span>
            </button>
          </li>
        ))}
        {results && !results.length && <li class="muted">No products found. Try a simpler word.</li>}
      </ul>
    </Sheet>
  );
}
