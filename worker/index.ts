import type { AppState, Ingredient, Meal, PantryItem, Settings, SidePair, Slot, SnackPick } from '../src/lib/types';
import { itemKey } from '../src/lib/types';
import { aiIdeas, aiFromReel } from './ai';
import * as kroger from './kroger';
import { HttpError, json, type Env } from './http';


async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function checkKey(req: Request, env: Env) {
  const key = req.headers.get('x-household-key') ?? '';
  // The hash comes from wrangler.jsonc; a settings row can override it (e.g. for local dev).
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = 'household_key_hash'").first<{ value: string }>();
  const expected = row ? (JSON.parse(row.value) as string) : env.HOUSEHOLD_KEY_HASH;
  if (!expected || !key || expected !== (await sha256(key))) {
    throw new HttpError(401, 'This device needs the household link.');
  }
}

async function body<T>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

const SETTINGS_KEYS = ['slots', 'repeat_days', 'categories', 'proteins', 'stores', 'units', 'cooks', 'styles'] as const;

async function loadSettings(env: Env): Promise<Settings> {
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  const out: Record<string, unknown> = {};
  for (const r of results) if ((SETTINGS_KEYS as readonly string[]).includes(r.key)) out[r.key] = JSON.parse(r.value);
  return out as unknown as Settings;
}

async function loadMeals(env: Env): Promise<Meal[]> {
  const [meals, ings] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM meals ORDER BY name COLLATE NOCASE'),
    env.DB.prepare('SELECT meal_id, name, qty, unit FROM meal_ingredients ORDER BY meal_id, sort, id'),
  ]);
  const byMeal = new Map<string, Ingredient[]>();
  for (const i of ings.results as (Ingredient & { meal_id: string })[]) {
    const list = byMeal.get(i.meal_id) ?? [];
    list.push({ name: i.name, qty: i.qty, unit: i.unit });
    byMeal.set(i.meal_id, list);
  }
  return (meals.results as Omit<Meal, 'ingredients'>[]).map((m) => ({ ...m, ingredients: byMeal.get(m.id) ?? [] }));
}

function parseSlot(row: Record<string, unknown>): Slot {
  return {
    ...(row as unknown as Slot),
    skipped: JSON.parse((row.skipped as string) || '[]'),
    sides: JSON.parse((row.sides as string) || '[]'),
  };
}

async function loadState(env: Env, weekOf: string): Promise<AppState> {
  const [settings, meals] = await Promise.all([loadSettings(env), loadMeals(env)]);
  const [pantry, slots, last, history, checks, week, prev, counts, pairs] = await env.DB.batch([
    env.DB.prepare('SELECT * FROM pantry_items ORDER BY name COLLATE NOCASE'),
    env.DB.prepare('SELECT * FROM week_slots WHERE week_of = ? ORDER BY slot').bind(weekOf),
    env.DB.prepare('SELECT meal_id, MAX(date) AS date FROM history WHERE meal_id IS NOT NULL GROUP BY meal_id'),
    env.DB.prepare('SELECT * FROM history ORDER BY date DESC, id DESC LIMIT 200'),
    env.DB.prepare('SELECT key, bought FROM grocery_checks WHERE week_of = ?').bind(weekOf),
    env.DB.prepare('SELECT snacks FROM weeks WHERE week_of = ?').bind(weekOf),
    env.DB.prepare("SELECT snacks FROM weeks WHERE week_of < ? AND snacks <> '[]' ORDER BY week_of DESC LIMIT 1").bind(weekOf),
    env.DB.prepare(
      `SELECT json_extract(j.value, '$.key') AS key, COUNT(*) AS n FROM weeks w, json_each(w.snacks) j
       WHERE w.week_of <> ? AND json_extract(j.value, '$.locked') = 1 GROUP BY 1`,
    ).bind(weekOf),
    env.DB.prepare('SELECT * FROM side_pairs'),
  ]);
  const snacksOf = (r: D1Result) => JSON.parse((r.results[0] as { snacks?: string } | undefined)?.snacks || '[]') as SnackPick[];
  return {
    settings,
    meals,
    pantry: pantry.results as unknown as PantryItem[],
    week_of: weekOf,
    slots: (slots.results as Record<string, unknown>[]).map(parseSlot),
    last_eaten: Object.fromEntries((last.results as { meal_id: string; date: string }[]).map((r) => [r.meal_id, r.date])),
    history: history.results as unknown as AppState['history'],
    checks: Object.fromEntries((checks.results as { key: string; bought: number }[]).map((r) => [r.key, r.bought])),
    snacks: snacksOf(week),
    prev_snacks: snacksOf(prev),
    snack_counts: Object.fromEntries((counts.results as { key: string; n: number }[]).map((r) => [r.key, r.n])),
    side_pairs: pairs.results as unknown as SidePair[],
    features: { ai: !!env.ANTHROPIC_API_KEY, kroger: !!(env.KROGER_CLIENT_ID && env.KROGER_CLIENT_SECRET) },
  };
}

const intOrNull = (v: unknown) => (v === '' || v == null || isNaN(Number(v)) ? null : Math.round(Number(v)));
const numOrNull = (v: unknown) => (v === '' || v == null || isNaN(Number(v)) ? null : Number(v));
const str = (v: unknown, max = 4000) => String(v ?? '').trim().slice(0, max);

async function saveMeal(env: Env, input: Partial<Meal>) {
  const name = str(input.name, 200);
  if (!name) throw new HttpError(400, 'Meal name is required');
  const id = input.id || crypto.randomUUID();
  const cook = ['Dean', 'Kinley', 'Either'].includes(input.cook as string) ? input.cook : 'Either';
  const ingredients = (input.ingredients ?? []).filter((i) => str(i.name));
  const stmts = [
    env.DB.prepare(
      `INSERT INTO meals (id, name, category, protein, cook, servings, prep_min, cook_min, repeat_days, recipe, notes, source, archived, style)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
       ON CONFLICT(id) DO UPDATE SET name=?2, category=?3, protein=?4, cook=?5, servings=?6, prep_min=?7, cook_min=?8,
         repeat_days=?9, recipe=?10, notes=?11, archived=?13, style=?14`,
    ).bind(
      id, name, str(input.category, 50) || 'Dinner', str(input.protein, 50), cook,
      intOrNull(input.servings), intOrNull(input.prep_min), intOrNull(input.cook_min), intOrNull(input.repeat_days),
      str(input.recipe, 20000), str(input.notes), str(input.source, 20) || 'manual', input.archived ? 1 : 0,
      str(input.style, 30),
    ),
    env.DB.prepare('DELETE FROM meal_ingredients WHERE meal_id = ?').bind(id),
    ...ingredients.map((i, n) =>
      env.DB.prepare('INSERT INTO meal_ingredients (meal_id, name, qty, unit, sort) VALUES (?, ?, ?, ?, ?)').bind(
        id, str(i.name, 100), numOrNull(i.qty), str(i.unit, 20) || 'each', n,
      ),
    ),
    ...ingredients.map((i) =>
      env.DB.prepare('INSERT OR IGNORE INTO pantry_items (key, name, unit) VALUES (?, ?, ?)').bind(
        itemKey(i.name, i.unit || 'each'), str(i.name, 100), str(i.unit, 20) || 'each',
      ),
    ),
  ];
  await env.DB.batch(stmts);
  return id;
}

async function savePantry(env: Env, p: Partial<PantryItem>) {
  const name = str(p.name, 100);
  const unit = str(p.unit, 20) || 'each';
  if (!name) throw new HttpError(400, 'Ingredient name is required');
  const key = p.key || itemKey(name, unit);
  await env.DB.prepare(
    `INSERT INTO pantry_items (key, name, unit, store, price, staple, restock, on_hand, kroger_upc, kroger_desc, snack)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
     ON CONFLICT(key) DO UPDATE SET name=?2, unit=?3, store=?4, price=?5, staple=?6, restock=?7, on_hand=?8,
       kroger_upc=?9, kroger_desc=?10, snack=?11`,
  )
    .bind(
      key, name, unit, str(p.store, 30) || 'Kroger', numOrNull(p.price), p.staple ? 1 : 0, p.restock ? 1 : 0,
      numOrNull(p.on_hand) ?? 0, p.kroger_upc || null, p.kroger_desc || null, p.snack ? 1 : 0,
    )
    .run();
}

const slotUpdate = (env: Env, s: Slot) =>
  env.DB.prepare(
    `INSERT INTO week_slots (week_of, slot, label, category, meal_id, locked, cook, skipped, eaten_date, sides)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
     ON CONFLICT(week_of, slot) DO UPDATE SET label=?3, category=?4, meal_id=?5, locked=?6, cook=?7, skipped=?8, eaten_date=?9,
       sides=?10`,
  ).bind(
    s.week_of, s.slot, str(s.label, 50), str(s.category, 50), s.meal_id || null, s.locked ? 1 : 0, s.cook || null,
    JSON.stringify(s.skipped ?? []), s.eaten_date || null, JSON.stringify(s.sides ?? []),
  );

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function api(req: Request, env: Env, url: URL): Promise<Response> {
  const path = url.pathname.replace(/^\/api/, '');
  const m = req.method;

  // Kroger redirects the browser here, so it is authorised by the OAuth state instead of the key.
  if (path === '/kroger/callback' && m === 'GET') return kroger.callback(env, url);

  await checkKey(req, env);

  if (path === '/state' && m === 'GET') {
    const week = url.searchParams.get('week') ?? '';
    if (!DATE_RE.test(week)) throw new HttpError(400, 'week=YYYY-MM-DD required');
    return json(await loadState(env, week));
  }

  if (path === '/meals' && m === 'POST') {
    const id = await saveMeal(env, await body<Partial<Meal>>(req));
    return json({ id });
  }

  if (path === '/pantry' && m === 'PUT') {
    await savePantry(env, await body<Partial<PantryItem>>(req));
    return json({ ok: true });
  }
  let match = path.match(/^\/pantry\/(.+)$/);
  if (match && m === 'DELETE') {
    await env.DB.prepare('DELETE FROM pantry_items WHERE key = ?').bind(decodeURIComponent(match[1])).run();
    return json({ ok: true });
  }

  // Create a week's slots once; a second device racing to create gets the first device's rows.
  match = path.match(/^\/weeks\/(\d{4}-\d{2}-\d{2})\/init$/);
  if (match && m === 'POST') {
    const weekOf = match[1];
    const slots = await body<Slot[]>(req);
    await env.DB.batch([
      env.DB.prepare('INSERT OR IGNORE INTO weeks (week_of) VALUES (?)').bind(weekOf),
      ...slots.map((s) =>
        env.DB.prepare(
          `INSERT OR IGNORE INTO week_slots (week_of, slot, label, category, meal_id, locked, cook, skipped)
           VALUES (?, ?, ?, ?, ?, 0, ?, '[]')`,
        ).bind(weekOf, s.slot, str(s.label, 50), str(s.category, 50), s.meal_id || null, s.cook || null),
      ),
    ]);
    return json({ ok: true });
  }

  match = path.match(/^\/weeks\/(\d{4}-\d{2}-\d{2})\/slots$/);
  if (match && m === 'PUT') {
    const weekOf = match[1];
    const slots = await body<Slot[]>(req);
    await env.DB.batch(slots.map((s) => slotUpdate(env, { ...s, week_of: weekOf })));
    return json({ ok: true });
  }

  match = path.match(/^\/weeks\/(\d{4}-\d{2}-\d{2})\/slots\/(\d+)$/);
  if (match && m === 'DELETE') {
    await env.DB.prepare('DELETE FROM week_slots WHERE week_of = ? AND slot = ?').bind(match[1], Number(match[2])).run();
    return json({ ok: true });
  }

  match = path.match(/^\/weeks\/(\d{4}-\d{2}-\d{2})\/snacks$/);
  if (match && m === 'PUT') {
    const snacks = (await body<SnackPick[]>(req)).map((x) => ({
      key: str(x.key, 140),
      qty: Math.max(1, Math.round(Number(x.qty) || 1)),
      locked: x.locked ? 1 : 0,
      skipped: (x.skipped ?? []).map((k) => str(k, 140)).slice(-50),
    }));
    await env.DB.prepare('INSERT INTO weeks (week_of, snacks) VALUES (?1, ?2) ON CONFLICT(week_of) DO UPDATE SET snacks = ?2')
      .bind(match[1], JSON.stringify(snacks))
      .run();
    return json({ ok: true });
  }

  // Learn which sides go with which meals: +1 kept when a side is locked in (-1 when unlocked), +1 skipped on reroll.
  if (path === '/side-pairs' && m === 'POST') {
    const b = await body<{ meal_id: string; side_id: string; kept?: number; skipped?: number }>(req);
    const kept = Math.sign(Number(b.kept) || 0);
    const skipped = Math.sign(Number(b.skipped) || 0);
    await env.DB.prepare(
      `INSERT INTO side_pairs (meal_id, side_id, kept, skipped) VALUES (?1, ?2, max(?3, 0), max(?4, 0))
       ON CONFLICT(meal_id, side_id) DO UPDATE SET kept = max(kept + ?3, 0), skipped = max(skipped + ?4, 0)`,
    )
      .bind(str(b.meal_id, 60), str(b.side_id, 60), kept, skipped)
      .run();
    return json({ ok: true });
  }

  // Tick or untick "eaten": records the meal in history (once per meal + date).
  match = path.match(/^\/weeks\/(\d{4}-\d{2}-\d{2})\/slots\/(\d+)\/eaten$/);
  if (match && m === 'POST') {
    const [weekOf, slotNo] = [match[1], Number(match[2])];
    const b = await body<{ date: string | null; by?: string }>(req);
    const slot = await env.DB.prepare('SELECT * FROM week_slots WHERE week_of = ? AND slot = ?').bind(weekOf, slotNo).first();
    if (!slot) throw new HttpError(404, 'Slot not found');
    const s = parseSlot(slot);
    const stmts = [];
    if (s.eaten_date) {
      stmts.push(
        env.DB.prepare('DELETE FROM history WHERE week_of = ? AND slot = ? AND date = ?').bind(weekOf, slotNo, s.eaten_date),
      );
    }
    if (b.date) {
      if (!DATE_RE.test(b.date)) throw new HttpError(400, 'Bad date');
      if (!s.meal_id) throw new HttpError(400, 'No meal in this slot');
      const meal = await env.DB.prepare('SELECT name FROM meals WHERE id = ?').bind(s.meal_id).first<{ name: string }>();
      stmts.push(
        env.DB.prepare(
          `INSERT INTO history (date, meal_id, meal_name, week_of, slot, cook, added_by)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7
           WHERE NOT EXISTS (SELECT 1 FROM history WHERE meal_id = ?2 AND date = ?1)`,
        ).bind(b.date, s.meal_id, meal?.name ?? '', weekOf, slotNo, s.cook, str(b.by, 30) || null),
      );
    }
    stmts.push(
      env.DB.prepare('UPDATE week_slots SET eaten_date = ? WHERE week_of = ? AND slot = ?').bind(b.date || null, weekOf, slotNo),
    );
    await env.DB.batch(stmts);
    return json({ ok: true });
  }

  if (path === '/history' && m === 'POST') {
    const b = await body<{ date: string; meal_id: string; by?: string }>(req);
    if (!DATE_RE.test(b.date)) throw new HttpError(400, 'Bad date');
    const meal = await env.DB.prepare('SELECT name FROM meals WHERE id = ?').bind(b.meal_id).first<{ name: string }>();
    if (!meal) throw new HttpError(404, 'Meal not found');
    await env.DB.prepare('INSERT INTO history (date, meal_id, meal_name, added_by) VALUES (?, ?, ?, ?)')
      .bind(b.date, b.meal_id, meal.name, str(b.by, 30) || null)
      .run();
    return json({ ok: true });
  }
  match = path.match(/^\/history\/(\d+)$/);
  if (match && m === 'DELETE') {
    await env.DB.prepare('DELETE FROM history WHERE id = ?').bind(Number(match[1])).run();
    return json({ ok: true });
  }

  if (path === '/checks' && m === 'PUT') {
    const b = await body<{ week_of: string; key: string; bought: boolean }>(req);
    await env.DB.prepare(
      'INSERT INTO grocery_checks (week_of, key, bought) VALUES (?1, ?2, ?3) ON CONFLICT(week_of, key) DO UPDATE SET bought = ?3',
    )
      .bind(b.week_of, b.key, b.bought ? 1 : 0)
      .run();
    return json({ ok: true });
  }

  if (path === '/settings' && m === 'PUT') {
    const b = await body<{ key: string; value: unknown }>(req);
    if (!(SETTINGS_KEYS as readonly string[]).includes(b.key)) throw new HttpError(400, 'Unknown setting');
    await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2')
      .bind(b.key, JSON.stringify(b.value))
      .run();
    return json({ ok: true });
  }

  if (path === '/ai/ideas' && m === 'POST') {
    const b = await body<{ count?: number; request?: string; useOnHand?: boolean; useDeals?: boolean }>(req);
    const meals = await loadMeals(env);
    const onHand = b.useOnHand
      ? ((await env.DB.prepare('SELECT * FROM pantry_items WHERE on_hand > 0 AND staple = 0').all()).results as unknown as PantryItem[])
      : [];
    const deals = b.useDeals ? await kroger.deals(env) : [];
    return json(await aiIdeas(env, meals, b, { onHand, deals }));
  }
  if (path === '/ai/reel' && m === 'POST') {
    return json(await aiFromReel(env, await body<{ url?: string; caption?: string }>(req)));
  }

  if (path.startsWith('/kroger/')) return kroger.route(req, env, url, path.slice('/kroger'.length));

  throw new HttpError(404, 'Not found');
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    try {
      return await api(req, env, url);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error(e);
      return json({ error: e instanceof Error ? e.message : 'Server error' }, 500);
    }
  },
} satisfies ExportedHandler<Env>;
