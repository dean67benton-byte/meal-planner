import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/api';
import { short } from '../lib/dates';
import { AISLES, aisleFor, buildList, cartQuantity, fmtQty, krogerUnitPrice, money, type GroceryLine } from '../lib/grocery';
import { useStore } from '../lib/store';
import type { KrogerProduct, KrogerStatus } from '../lib/types';
import { Icon } from '../icons';
import { Sheet } from '../ui';
import { useKrogerPrices } from './extras';

export function GroceryScreen() {
  const store = useStore();
  const s = store.state!;
  const prices = useKrogerPrices(s);
  const list = buildList(s, prices);
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

  const toBuy = list.shop.filter((l) => !bought(l));
  const inCart = list.shop.filter(bought);
  const unlockedAll = list.unlocked + list.unlockedExtras;

  const row = (l: GroceryLine) => (
    <li key={l.key} class={bought(l) ? 'bought' : ''}>
      <button class="gline tick" role="checkbox" aria-checked={bought(l)} onClick={() => toggle(l)}>
        <span class="check" aria-hidden="true">{bought(l) && <Icon name="check" size={16} />}</span>
        <span class="gtext">
          <span><b>{l.name}</b> <span class="qty">{l.toBuy == null ? '' : `${fmtQty(l.toBuy)} ${l.unit}`}</span></span>
          <span class="small muted">
            {l.usedIn.join(', ')}
            {l.onHand > 0 && ` · have ${fmtQty(l.onHand)}`}
            {l.cost != null ? ` · ${money(l.cost)}` : ' · no price'}
            {l.store === 'Kroger' && l.item?.kroger_desc ? ` · ${l.item.kroger_desc}` : ''}
          </span>
        </span>
      </button>
      {s.features.kroger && l.store === 'Kroger' && kroger?.connected && !bought(l) && (
        <button class="btn tiny" onClick={() => setMatching(l)}>{l.item?.kroger_upc ? 'Change' : 'Match'}</button>
      )}
      <button class="btn tiny" aria-label={`Price and pantry for ${l.name}`} onClick={() => setEditing(l)}>{l.price == null ? '$ ?' : '$'}</button>
    </li>
  );

  return (
    <>
      <header class="top">
        <div class="top-title">
          <h1>Groceries</h1>
          <p class="muted">
            Week of {short(s.week_of)}
            {list.shop.length > 0 ? ` · ${inCart.length} of ${list.shop.length} in cart` : ''}
            {list.total > 0 ? ` · about ${money(list.total)}` : ''}
          </p>
        </div>
        <a class="btn" href="#/pantry">Prices</a>
      </header>

      {unlockedAll > 0 && (
        <p class="callout small">
          {list.unlocked > 0 && `${list.unlocked} ${list.unlocked === 1 ? 'meal' : 'meals'}`}
          {list.unlocked > 0 && list.unlockedExtras > 0 && ' and '}
          {list.unlockedExtras > 0 && `${list.unlockedExtras} ${list.unlockedExtras === 1 ? 'side or snack' : 'sides and snacks'}`}
          {unlockedAll === 1 ? " isn't" : " aren't"} locked in yet, so {unlockedAll === 1 ? "it's" : "they're"} not on this list. <a href="#/week">Lock them on the Week tab.</a>
        </p>
      )}
      {!list.lockedCount && !list.snackCount && <div class="empty">Lock in meals on the Week tab and their ingredients add up here.</div>}

      {list.shop.length > 0 && list.stores.length > 1 && list.total > 0 && (
        <div class="totals card">
          {list.stores.map((st) => (
            <div key={st}><span class="muted small">{st}</span><b>{money(list.shop.filter((l) => l.store === st).reduce((a, l) => a + (l.cost ?? 0), 0))}</b></div>
          ))}
        </div>
      )}
      {list.missingPrices > 0 && (
        <p class="small muted">{list.missingPrices} {list.missingPrices === 1 ? 'item has' : 'items have'} no price yet{list.total > 0 ? ', so the total is low' : ''}. Tap <b>$ ?</b> to add one{s.features.kroger ? ' or find it on Kroger' : ''}.</p>
      )}

      {s.features.kroger && kroger && !kroger.connected && krogerLines.length > 0 && (
        <p class="small muted">Connect Kroger on the <a href="#/more">More tab</a> to send this list to your cart.</p>
      )}
      {s.features.kroger && kroger?.connected && krogerLines.length > 0 && matched.length < krogerLines.length && (
        <p class="small muted">{matched.length} of {krogerLines.length} Kroger items are matched to a product. Tap "Match" on the others.</p>
      )}

      {list.stores.map((st) => {
        const lines = toBuy.filter((l) => l.store === st);
        if (!lines.length) return null;
        return (
          <section key={st}>
            <h2>{st}</h2>
            {AISLES.map((aisle) => {
              const here = lines.filter((l) => aisleFor(l.name, l.unit) === aisle);
              return here.length ? (
                <div key={aisle}>
                  <h3 class="aisle">{aisle}</h3>
                  <ul class="glist">{here.map(row)}</ul>
                </div>
              ) : null;
            })}
          </section>
        );
      })}
      {list.shop.length > 0 && !toBuy.length && <div class="empty">Everything's in the cart.</div>}

      {inCart.length > 0 && (
        <details class="in-cart">
          <summary>In cart ({inCart.length})</summary>
          <ul class="glist">{inCart.map(row)}</ul>
        </details>
      )}

      {s.features.kroger && kroger?.connected && matched.length > 0 && (
        <div class="action-bar">
          <button class="btn primary" disabled={sending} onClick={sendToCart}>
            <Icon name="cart" size={18} /> {sending ? 'Adding…' : `Add ${matched.length} to Kroger cart`}
          </button>
        </div>
      )}

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
  const [matching, setMatching] = useState(false);
  if (matching) return <MatchSheet line={line} onClose={onClose} />;
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
      {s.features.kroger && (
        <button class="btn wide" onClick={() => setMatching(true)}>
          <Icon name="search" size={18} /> {it?.kroger_upc ? 'Change Kroger product' : 'Find it on Kroger'}
        </button>
      )}
      {it?.kroger_desc && <p class="small muted">Kroger: {it.kroger_desc}</p>}
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
  // Picking a product sets the ingredient's price from Kroger's regular price, converted to the recipe's unit.
  const pick = async (p: KrogerProduct) => {
    onClose();
    const price = krogerUnitPrice(p.regular ?? p.price, p.size, line.unit);
    const ok = await store.run(() =>
      api.savePantry({
        ...(line.item ?? {}),
        key: line.key,
        name: line.name,
        unit: line.unit,
        store: 'Kroger',
        kroger_upc: p.upc,
        kroger_desc: [p.brand, p.description, p.size].filter(Boolean).join(' ').slice(0, 120),
        price: price ?? line.item?.price ?? null,
      }),
    );
    if (ok) {
      store.toast(price != null
        ? `Price set to ${money(price)} per ${line.unit}`
        : `Matched. Kroger sells it by ${p.size || 'the package'}, so set the price per ${line.unit} yourself.`);
    }
  };
  return (
    <Sheet title={`Kroger product for ${line.name}`} onClose={onClose} tall>
      <form class="row gap search-row" onSubmit={(e) => { e.preventDefault(); search(); }}>
        <input class="search" type="search" value={term} onInput={(e) => setTerm(e.currentTarget.value)} />
        <button class="btn" disabled={busy}>Search</button>
      </form>
      <p class="small muted">The app remembers your pick and uses its Kroger price from now on.</p>
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
