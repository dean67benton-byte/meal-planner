# Meal Planner

Dean and Kinley's weekly meal planner. It replaces the "Household Meal Planner" spreadsheet and works on phones and computers.

- **Week**: suggestions for each slot (3 dinners and a work lunch by default). Lock in the meals you want, reroll the rest, or pick one yourself. The cooking is split between Dean and Kinley, and you can tap the cook badge to swap. Mark a meal eaten and it goes into history.
- **Meals**: your library. Each meal has who cooks it (Dean, Kinley, or Either), a category, a protein, times, and ingredients.
- **Ideas**: 30 starter meals (quick, 10 or fewer ingredients, cheap), Claude meal ideas, Instagram reel → recipe, and this week's Kroger sales.
- **Groceries**: ingredients from the locked meals, added up and grouped by store, with whatever's on hand subtracted. Check items off, or send the Kroger ones to your Kroger cart.
- **More**: household link, Kroger connection, meal history, and settings.

## How suggestions are picked

1. Only meals in the slot's category, and never one already used this week.
2. A meal must be past its repeat wait (21 days by default; each meal can set its own). If nothing else is left, a recent meal is used and flagged.
3. Dinners prefer a protein the other dinners aren't using.
4. Each cook gets about half the week. "Either" meals go to whoever has fewer.
5. Never-made meals come first, then the one made longest ago, then the quickest.

## Access

There are no passwords. A household link (`https://<site>/#/join/<code>`) gets a device in, and the site remembers it. Only a hash of the code is stored. The code is public on GitHub, but your data is not, and nobody can change it without the link.

## Hosting

One Cloudflare Worker serves the app and its `/api`, and the data lives in Cloudflare D1 (database `meal-planner`). Every push to `main` runs `.github/workflows/deploy.yml`, which builds the app, applies `migrations/`, and deploys. It needs the repo secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

## Optional features

These are added in Cloudflare under **Workers & Pages ▸ meal-planner ▸ Settings ▸ Variables and Secrets ▸ Add** (type: Secret). They stay in place across deploys.

### Claude ideas and reel recipes

1. Create a key at [console.anthropic.com](https://console.anthropic.com) ▸ API Keys. The account needs a few dollars of credit; each request costs a few cents.
2. Add the secret `ANTHROPIC_API_KEY`.

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
