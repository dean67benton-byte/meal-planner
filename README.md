# Meal Planner

Dean and Kinley's weekly meal planner. It replaces the "Household Meal Planner" spreadsheet and works on phones and computers.

- **Week**: suggestions for each slot (3 dinners and a work lunch by default). Lock in the meals you want, reroll the rest, or pick one yourself. The cooking is split between Dean and Kinley, and you can tap the cook badge to swap. Mark a meal eaten and it goes into history. Each dinner can have sides (tap "Add side" for a suggestion, then lock, reroll, or pick), and the optional Snacks list has the same lock, reroll, and pick, with a running price total.
- **Meals**: your library. Each meal has who cooks it (Dean, Kinley, or Either), a category, a protein, times, and ingredients. **Import** saves an Instagram, TikTok, or YouTube link to a list. Then tell Claude (in the Claude project) "Import my reels": Claude watches each video, adds the recipe to Meals, and clears the list. It costs nothing to run. The screen also opens at `#/import?url=<link>`, so an iPhone Shortcut can fill in the link.
- **Ideas**: 30 starter meals and 21 starter sides (quick, 10 or fewer ingredients, cheap), Claude meal ideas, a link to Import, and this week's Kroger sales.
- **Groceries**: ingredients from the locked meals, added up and grouped by store, with whatever's on hand subtracted. Check items off, or send the Kroger ones to your Kroger cart.
- **More**: household link, Kroger connection, meal history, and settings.

## How suggestions are picked

1. Only meals in the slot's category, and never one already used this week.
2. A meal must be past its repeat wait (21 days by default; each meal can set its own). If nothing else is left, a recent meal is used and flagged.
3. Dinners prefer a protein the other dinners aren't using.
4. Each cook gets about half the week. "Either" meals go to whoever has fewer.
5. Never-made meals come first, then the one made longest ago, then the quickest.

Changing a dinner's meal drops its unlocked sides.

### Sides (dinners only)

A side is a meal with the category "Side". Each dinner starts with none, and "Add side" suggests one:

1. Never a side already on that dinner, or one rerolled away from it.
2. Sides you've locked in with that meal before move up, and sides you rerolled away from it move down.
3. Until there's history, styles do the pairing: a Mexican side suits a Mexican meal (rice with tacos), BBQ and American mix (mashed potatoes with steak), and a side with no style (salad, green beans) goes with anything. A clashing style moves well down. A meal or side with no style set gets one from its name.
4. A side already on another dinner this week moves down a little. Ties go to the quicker side.
5. Once a meal has two or more favourite sides, about one suggestion in four is a fitting side you haven't had with it yet.

### Snacks

Snacks are products in Prices & pantry marked as snacks (Snacks ▸ Manage). They aren't tied to meals and have no repeat wait.

1. Never one already on this week's list, or one rerolled away from that spot.
2. Kroger snacks on sale come first. This needs the snack matched to a Kroger product.
3. Then the snacks you lock in most often.
4. Then A–Z, so rerolling walks through the rest.

Locked sides and snacks go on the grocery list. Snacks set to Costco are listed under Costco and stay out of the Kroger cart.

## Access

There are no passwords. A household link (`https://<site>/#/join/<code>`) gets a device in, and the site remembers it. Only a hash of the code is stored. The code is public on GitHub, but your data is not, and nobody can change it without the link.

## Hosting

One Cloudflare Worker serves the app and its `/api`, and the data lives in Cloudflare D1 (database `meal-planner`). Every push to `main` runs `.github/workflows/deploy.yml`, which builds the app, applies `migrations/`, and deploys. It needs the repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

## Optional features

These are added in Cloudflare under **Workers & Pages ▸ meal-planner ▸ Settings ▸ Variables and Secrets ▸ Add** (type: Secret). They stay in place across deploys.

### Claude ideas (paid)

1. Create a key at [console.anthropic.com](https://console.anthropic.com) ▸ API Keys. The account needs a few dollars of credit; each request costs a few cents.
2. Add the secret `ANTHROPIC_API_KEY`.

Importing videos doesn't need this; see Import above.

### Kroger cart and sales

1. Sign in at [developer.kroger.com](https://developer.kroger.com) and choose **Create App**.
2. Set the redirect URI to `https://<your site>/api/kroger/callback`, and turn on the Product, Cart, and Profile scopes.
3. Add the secrets `KROGER_CLIENT_ID` and `KROGER_CLIENT_SECRET`.
4. In the app, go to More ▸ Connect Kroger account, then pick your store by ZIP.

## Local development

```sh
npm install
npm run db:local                 # create the local database
npx wrangler d1 execute meal-planner --local --command \
  "INSERT OR REPLACE INTO settings VALUES ('household_key_hash', '\"$(printf %s devkey | sha256sum | cut -d' ' -f1)\"')"
npm run build && npm run worker  # http://localhost:8787/#/join/devkey
```

Put local secrets in `.dev.vars`, which is ignored by git.
