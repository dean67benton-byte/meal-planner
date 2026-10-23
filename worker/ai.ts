import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import type { KrogerDeal, Meal, MealDraft, PantryItem } from '../src/lib/types';
import { HttpError, type Env } from './http';

const IngredientSchema = z.object({
  name: z.string().describe('Generic grocery name, e.g. "Yellow onion", "Chicken thighs"'),
  qty: z.number().nullable(),
  unit: z.string().describe('One of: each, lb, oz, cup, tbsp, tsp, can, jar, pkg, bag, box, bunch, clove, slice, dozen'),
});

const MealSchema = z.object({
  name: z.string(),
  category: z.enum(['Dinner', 'Work Lunch']),
  protein: z.enum(['Chicken', 'Beef / Deer', 'Pork', 'Seafood', 'Vegetarian', 'Other']),
  servings: z.number().int().nullable(),
  prep_min: z.number().int().nullable(),
  cook_min: z.number().int().nullable(),
  ingredients: z.array(IngredientSchema),
  steps: z.array(z.string()).describe('Short numbered-style steps, plain sentences'),
  why: z.string().describe('One sentence on why it fits: time, cost, or ingredient count'),
});

const HOUSE_RULES = `You plan meals for a two-person household (Dean and Kinley) who want weeknight meals that are:
- quick: about 30 minutes hands-on or less
- simple: ideally 10 or fewer ingredients, not counting salt, pepper, oil, and common spices
- budget-friendly: everyday Kroger groceries, no specialty items
Use US units. Assume salt, pepper, and cooking oil are on hand and leave them out of the ingredient list.
Quantities should feed the stated servings (default 4, so there are leftovers).`;

type RawMeal = z.infer<typeof MealSchema>;

function client(env: Env) {
  if (!env.ANTHROPIC_API_KEY) throw new HttpError(503, 'AI features are off until a Claude API key is added.');
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}

function toDraft(m: RawMeal, source: string): MealDraft {
  return {
    name: m.name,
    category: m.category,
    protein: m.protein,
    cook: 'Either',
    servings: m.servings,
    prep_min: m.prep_min,
    cook_min: m.cook_min,
    recipe: m.steps.map((s, i) => `${i + 1}. ${s}`).join('\n'),
    notes: m.why,
    source,
    ingredients: m.ingredients.map((i) => ({ name: i.name, qty: i.qty, unit: i.unit })),
  };
}

async function ask<T extends z.ZodType>(env: Env, schema: T, prompt: Anthropic.MessageParam['content']): Promise<z.infer<T>> {
  try {
    const response = await client(env).messages.parse({
      model: 'claude-opus-5-5',
      max_tokens: 16000,
      output_config: { effort: 'low', format: zodOutputFormat(schema) },
      system: HOUSE_RULES,
      messages: [{ role: 'user', content: prompt }],
    });
    if (response.stop_reason === 'refusal') throw new HttpError(422, 'Claude could not help with that one.');
    if (!response.parsed_output) throw new HttpError(502, 'Claude returned an unexpected answer. Try again.');
    return response.parsed_output;
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (e instanceof Anthropic.AuthenticationError) throw new HttpError(503, 'The Claude API key was rejected.');
    if (e instanceof Anthropic.RateLimitError) throw new HttpError(429, 'Claude is busy. Try again in a minute.');
    if (e instanceof Anthropic.APIError) throw new HttpError(502, `Claude API error: ${e.message}`);
    throw e;
  }
}

export async function aiIdeas(
  env: Env,
  meals: Meal[],
  b: { count?: number; request?: string },
  extras: { onHand?: PantryItem[]; deals?: KrogerDeal[] } = {},
) {
  const count = Math.min(Math.max(b.count ?? 5, 1), 8);
  const have = meals.filter((m) => !m.archived).map((m) => `${m.name} (${m.protein})`);
  const parts = [
    `Suggest ${count} new meals we have not tried.`,
    have.length
      ? `Meals we already have (don't repeat these or close variants):\n${have.join('\n')}`
      : 'We have no meals saved yet, so give a varied starter mix.',
    b.request ? `What we're in the mood for: ${b.request.slice(0, 500)}` : 'Vary the proteins and cuisines.',
  ];
  if (extras.onHand?.length) {
    parts.push(
      `Already in our kitchen. Use these where it makes sense:\n${extras.onHand.map((p) => `${p.on_hand} ${p.unit} ${p.name}`).join('\n')}`,
    );
  }
  if (extras.deals?.length) {
    parts.push(
      `On sale at our Kroger this week. Build most meals around these savings and say which sale item each uses in "why":\n${extras.deals
        .map((d) => `${d.description} ${d.size}: $${d.promo} (normally $${d.regular})`)
        .join('\n')}`,
    );
  }
  const prompt = parts.join('\n\n');
  const out = await ask(env, z.object({ meals: z.array(MealSchema) }), prompt);
  return { meals: out.meals.map((m) => toDraft(m, 'ai')) };
}

type Platform = 'instagram' | 'tiktok' | 'youtube' | 'facebook';
type VideoInfo = { text: string; image: string };

const PLATFORMS: [RegExp, Platform][] = [
  [/^https:\/\/(www\.)?instagram\.com\//i, 'instagram'],
  [/^https:\/\/(www\.|vm\.|m\.)?tiktok\.com\//i, 'tiktok'],
  [/^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i, 'youtube'],
  [/^https:\/\/(www\.|m\.)?(facebook\.com|fb\.watch)\//i, 'facebook'],
];

const decode = (s: string) =>
  s.replace(/&quot;/g, '"').replace(/&#039;|&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));

/** Reads a public video page's link-preview tags: caption text and cover image (best effort; sites often block this). */
async function pageInfo(url: string): Promise<VideoInfo> {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)' },
      redirect: 'follow',
    });
    if (!res.ok) return { text: '', image: '' };
    const html = (await res.text()).slice(0, 400_000);
    const metas = [...html.matchAll(/<meta[^>]+(?:property|name)="(og:title|og:description|description|og:image)"[^>]+content="([^"]*)"/gi)];
    const text = [...new Set(metas.filter((m) => m[1] !== 'og:image').map((m) => decode(m[2])))].join('\n');
    const image = decode(metas.find((m) => m[1] === 'og:image')?.[2] ?? '');
    return { text, image };
  } catch {
    return { text: '', image: '' };
  }
}

/** TikTok and YouTube publish captions and thumbnails through oEmbed, which is more reliable than scraping the page. */
async function oembed(endpoint: string, url: string): Promise<VideoInfo> {
  try {
    const res = await fetch(`${endpoint}?format=json&url=${encodeURIComponent(url)}`);
    if (!res.ok) return { text: '', image: '' };
    const o = (await res.json()) as { title?: string; author_name?: string; thumbnail_url?: string };
    return { text: [o.title, o.author_name && `By ${o.author_name}`].filter(Boolean).join('\n'), image: o.thumbnail_url ?? '' };
  } catch {
    return { text: '', image: '' };
  }
}

async function videoInfo(url: string, platform: Platform): Promise<VideoInfo> {
  const sources = [pageInfo(url)];
  if (platform === 'tiktok') sources.push(oembed('https://www.tiktok.com/oembed', url));
  if (platform === 'youtube') sources.push(oembed('https://www.youtube.com/oembed', url));
  const found = await Promise.all(sources);
  return {
    text: [...new Set(found.map((f) => f.text).filter(Boolean))].join('\n').slice(0, 6000),
    image: found.map((f) => f.image).find(Boolean) ?? '',
  };
}

type ImageType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

/** Downloads the cover image so Claude can see the finished dish. Skipped if it fails or is too big. */
async function coverImage(src: string): Promise<{ data: string; type: ImageType } | null> {
  if (!/^https:\/\//i.test(src)) return null;
  try {
    const res = await fetch(src);
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim() as ImageType;
    if (!res.ok || !['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(type)) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.length > 3_500_000) return null;
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { data: btoa(bin), type };
  } catch {
    return null;
  }
}

export async function aiFromReel(env: Env, b: { url?: string; caption?: string }) {
  const url = (b.url ?? '').trim();
  const platform = url ? PLATFORMS.find(([re]) => re.test(url))?.[1] : undefined;
  if (url && !platform) throw new HttpError(400, 'Paste an Instagram, TikTok, YouTube, or Facebook link.');
  client(env); // fail fast when AI is off, before fetching anything
  const info = platform ? await videoInfo(url, platform) : { text: '', image: '' };
  const caption = [b.caption?.slice(0, 6000), info.text].filter(Boolean).join('\n---\n');
  if (!caption.trim()) {
    throw new HttpError(
      422,
      "Couldn't read that video's caption. Open it, copy the caption (or type what's in the video), and paste it in the box.",
    );
  }
  const cover = await coverImage(info.image);
  const prompt = `Turn this food video into a recipe we can cook. The text is the video's caption and may be messy, partial, or full of hashtags.${
    cover ? ' The image is the video\'s cover; use it to tell what the dish is and roughly what goes in it.' : ''
  }
If it's too long or pricey, simplify it to fit our rules and say what you changed in "why".
If the caption has no real recipe, make your best version of the dish it describes.

${caption}`;
  const out = await ask(
    env,
    MealSchema,
    cover ? [{ type: 'image', source: { type: 'base64', media_type: cover.type, data: cover.data } }, { type: 'text', text: prompt }] : prompt,
  );
  const meal = toDraft(out, platform ?? 'instagram');
  if (url) meal.recipe += `\n\nFrom: ${url}`;
  return { meal };
}
