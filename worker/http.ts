export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  HOUSEHOLD_KEY_HASH?: string;
  ANTHROPIC_API_KEY?: string;
  KROGER_CLIENT_ID?: string;
  KROGER_CLIENT_SECRET?: string;
}
