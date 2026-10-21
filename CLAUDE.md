# Meal Planner

- Preact + Vite + TypeScript PWA (hash routes) served by one Cloudflare Worker (`worker/`) with D1. Deploys come from `.github/workflows/deploy.yml` on push to `main`.
- Shared types are in `src/lib/types.ts`. Suggestion rules are in `src/lib/planner.ts`; keep README's "How suggestions are picked" in sync with them.
- Schema changes go in a new `migrations/NNNN_*.sql`; never edit an applied migration.
- Auth is the household key (header `x-household-key`); D1 stores its SHA-256 in `settings.household_key_hash`. Never commit the key.
- Optional Worker secrets: `ANTHROPIC_API_KEY` (model `claude-opus-5-5`, `worker/ai.ts`), `KROGER_CLIENT_ID` / `KROGER_CLIENT_SECRET` (`worker/kroger.ts`).
- Owners: Dean and Kinley. Both use iPhones. They want quick meals with few ingredients that don't cost much, and they order from Kroger online.
- Run `npm run build` (it type-checks the app and the worker) before committing.
