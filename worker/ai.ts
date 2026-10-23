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

async function ask<T extends z.ZodType>(env: Env, schema: T, prompt: string): Promise<z.infer<T>> {
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
