// Kroger public API: store search, product search, and "add to cart" for the household's Kroger account.
// Docs: https://developer.kroger.com/documentation/public/getting-started/quick-start
import type { KrogerDeal, KrogerProduct, KrogerStatus } from '../src/lib/types';
import { HttpError, json, type Env } from './http';

const API = 'https://api.kroger.com/v1';
const now = () => Math.floor(Date.now() / 1000);

async function getKV(env: Env, key: string) {
  const row = await env.DB.prepare('SELECT value, expires_at FROM kroger WHERE key = ?').bind(key).first<{
    value: string;
    expires_at: number | null;
  }>();
  if (!row || (row.expires_at && row.expires_at < now())) return null;
  return row.value;
}

const putKV = (env: Env, key: string, value: string, ttl?: number) =>
  env.DB.prepare(
    'INSERT INTO kroger (key, value, expires_at) VALUES (?1, ?2, ?3) ON CONFLICT(key) DO UPDATE SET value = ?2, expires_at = ?3',
  ).bind(key, value, ttl ? now() + ttl : null);

function requireConfig(env: Env) {
  if (!env.KROGER_CLIENT_ID || !env.KROGER_CLIENT_SECRET) {
    throw new HttpError(503, 'Kroger is off until the Kroger developer keys are added.');
  }
  return { id: env.KROGER_CLIENT_ID, secret: env.KROGER_CLIENT_SECRET };
}

const redirectUri = (url: URL) => `${url.origin}/api/kroger/callback`;

async function tokenRequest(env: Env, params: Record<string, string>) {
  const { id, secret } = requireConfig(env);
  const res = await fetch(`${API}/connect/oauth2/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${btoa(`${id}:${secret}`)}`,
    },
    body: new URLSearchParams(params),
  });
  if (!res.ok) throw new HttpError(502, `Kroger sign-in failed (${res.status}).`);
  return (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number };
}

/** App-level token for store and product search. */
async function appToken(env: Env) {
  const cached = await getKV(env, 'app_access');
  if (cached) return cached;
  const t = await tokenRequest(env, { grant_type: 'client_credentials', scope: 'product.compact' });
  await putKV(env, 'app_access', t.access_token, t.expires_in - 60).run();
  return t.access_token;
}

/** The household's own token, needed to touch their cart. */
async function userToken(env: Env) {
  const cached = await getKV(env, 'user_access');
  if (cached) return cached;
  const refresh = await getKV(env, 'user_refresh');
  if (!refresh) throw new HttpError(409, 'Connect your Kroger account first (More tab).');
  const t = await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: refresh });
  await env.DB.batch([
    putKV(env, 'user_access', t.access_token, t.expires_in - 60),
    ...(t.refresh_token ? [putKV(env, 'user_refresh', t.refresh_token)] : []),
  ]);
  return t.access_token;
}

async function krogerGet(token: string, path: string) {
  const res = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${token}`, accept: 'application/json' } });
  if (!res.ok) throw new HttpError(502, `Kroger search failed (${res.status}).`);
  return (await res.json()) as { data: any[] };
}

// Kroger has no "all weekly deals" endpoint, so check the everyday staples we cook with for promo prices.
const DEAL_TERMS = [
  'chicken breast', 'chicken thighs', 'ground beef', 'ground turkey', 'pork chops', 'pork tenderloin', 'italian sausage',
  'kielbasa', 'bacon', 'salmon', 'shrimp', 'tilapia', 'steak', 'rotisserie chicken', 'deli turkey',
  'bell pepper', 'broccoli', 'potatoes', 'asparagus', 'spinach', 'avocado', 'mushrooms', 'zucchini',
  'shredded cheese', 'pasta', 'rice', 'tortillas', 'eggs', 'marinara sauce', 'black beans',
];

export async function deals(env: Env): Promise<KrogerDeal[]> {
  requireConfig(env);
  const loc = await getKV(env, 'location');
  if (!loc) throw new HttpError(409, 'Pick your Kroger store on the More tab to see its sales.');
  const cached = await getKV(env, 'deals');
  if (cached) return JSON.parse(cached);
  const locationId = (JSON.parse(loc) as { id: string }).id;
  const token = await appToken(env);
  const perTerm = await Promise.all(
    DEAL_TERMS.map(async (term) => {
      const r = await krogerGet(token, `/products?filter.term=${encodeURIComponent(term)}&filter.locationId=${locationId}&filter.limit=20`).catch(
        () => ({ data: [] as any[] }),
      );
      return r.data
        .map((p) => ({ p, price: p.items?.[0]?.price ?? {} }))
        .filter(({ price }) => price.promo > 0 && price.regular > price.promo)
        .sort((a, b) => b.price.regular - b.price.promo - (a.price.regular - a.price.promo))
        .slice(0, 2)
        .map(({ p, price }): KrogerDeal => ({
          term,
          upc: p.upc,
          description: [p.brand, p.description].filter(Boolean).join(' '),
          size: p.items?.[0]?.size ?? '',
          regular: price.regular,
          promo: price.promo,
        }));
    }),
  );
  const found = perTerm.flat();
  await putKV(env, 'deals', JSON.stringify(found), 6 * 3600).run();
  return found;
}

export async function callback(env: Env, url: URL) {
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state') ?? '';
  const done = (msg: string) => Response.redirect(`${url.origin}/#/more?kroger=${encodeURIComponent(msg)}`, 302);
  if (!code || !state || !(await getKV(env, `state:${state}`))) return done('Kroger sign-in expired. Try again.');
  await env.DB.prepare('DELETE FROM kroger WHERE key = ?').bind(`state:${state}`).run();
  try {
    const t = await tokenRequest(env, { grant_type: 'authorization_code', code, redirect_uri: redirectUri(url) });
    await env.DB.batch([
      putKV(env, 'user_access', t.access_token, t.expires_in - 60),
      putKV(env, 'user_refresh', t.refresh_token ?? ''),
    ]);
    return done('connected');
  } catch {
    return done('Kroger sign-in failed. Try again.');
  }
}

export async function route(req: Request, env: Env, url: URL, path: string): Promise<Response> {
  const m = req.method;

  if (path === '/status' && m === 'GET') {
    const configured = !!(env.KROGER_CLIENT_ID && env.KROGER_CLIENT_SECRET);
    const loc = await getKV(env, 'location');
    const parsed = loc ? (JSON.parse(loc) as { id: string; name: string }) : null;
    const status: KrogerStatus = {
      configured,
      connected: configured && !!(await getKV(env, 'user_refresh')),
      location_id: parsed?.id ?? null,
      location_name: parsed?.name ?? null,
    };
    return json(status);
  }

  if (path === '/start' && m === 'POST') {
    const { id } = requireConfig(env);
    const state = crypto.randomUUID();
    await putKV(env, `state:${state}`, '1', 600).run();
    const q = new URLSearchParams({
      scope: 'cart.basic:write profile.compact',
      response_type: 'code',
      client_id: id,
      redirect_uri: redirectUri(url),
      state,
    });
    return json({ url: `${API}/connect/oauth2/authorize?${q}` });
  }

  if (path === '/disconnect' && m === 'POST') {
    await env.DB.prepare("DELETE FROM kroger WHERE key IN ('user_access', 'user_refresh')").run();
    return json({ ok: true });
  }

  if (path === '/locations' && m === 'GET') {
    const zip = (url.searchParams.get('zip') ?? '').trim();
    if (!/^\d{5}$/.test(zip)) throw new HttpError(400, 'Enter a 5-digit ZIP code.');
    const r = await krogerGet(await appToken(env), `/locations?filter.zipCode.near=${zip}&filter.limit=10`);
    return json(
      r.data.map((l) => ({
        id: l.locationId,
        name: `${l.name} – ${l.address?.addressLine1 ?? ''}, ${l.address?.city ?? ''}`,
      })),
    );
  }

  if (path === '/location' && m === 'PUT') {
    const b = (await req.json()) as { id: string; name: string };
    await env.DB.batch([
      putKV(env, 'location', JSON.stringify({ id: String(b.id), name: String(b.name).slice(0, 200) })),
      env.DB.prepare("DELETE FROM kroger WHERE key = 'deals'"),
    ]);
    return json({ ok: true });
  }

  if (path === '/deals' && m === 'GET') return json(await deals(env));

  if (path === '/products' && m === 'GET') {
    const term = (url.searchParams.get('term') ?? '').trim().slice(0, 80);
    if (term.length < 2) throw new HttpError(400, 'Search for at least 2 letters.');
    const loc = await getKV(env, 'location');
    const locParam = loc ? `&filter.locationId=${(JSON.parse(loc) as { id: string }).id}` : '';
    const r = await krogerGet(await appToken(env), `/products?filter.term=${encodeURIComponent(term)}&filter.limit=12${locParam}`);
    const products: KrogerProduct[] = r.data.map((p) => {
      const item = p.items?.[0] ?? {};
      const front = (p.images ?? []).find((i: any) => i.perspective === 'front') ?? p.images?.[0];
      const img = front?.sizes?.find((s: any) => s.size === 'thumbnail') ?? front?.sizes?.[0];
      return {
        upc: p.upc,
        description: p.description ?? '',
        brand: p.brand ?? '',
        size: item.size ?? '',
        price: item.price?.promo || item.price?.regular || null,
        image: img?.url ?? null,
      };
    });
    return json(products);
  }

  if (path === '/cart' && m === 'POST') {
    const b = (await req.json()) as { items: { upc: string; quantity: number }[] };
    const items = (b.items ?? [])
      .filter((i) => i.upc)
      .map((i) => ({ upc: String(i.upc), quantity: Math.max(1, Math.round(Number(i.quantity) || 1)) }));
    if (!items.length) throw new HttpError(400, 'Nothing to add. Match items to Kroger products first.');
    const res = await fetch(`${API}/cart/add`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${await userToken(env)}`, 'content-type': 'application/json' },
      body: JSON.stringify({ items }),
    });
    if (res.status === 401) {
      await env.DB.prepare("DELETE FROM kroger WHERE key = 'user_access'").run();
      throw new HttpError(409, 'Kroger needs you to sign in again (More tab).');
    }
    if (!res.ok) throw new HttpError(502, `Kroger didn't accept the cart (${res.status}).`);
    return json({ added: items.length });
  }

  throw new HttpError(404, 'Not found');
}
