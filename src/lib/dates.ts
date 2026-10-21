// Dates are local calendar days as YYYY-MM-DD strings.

export const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const parse = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

export const addDays = (s: string, n: number) => {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return iso(d);
};

export const today = () => iso(new Date());

export const daysBetween = (a: string, b: string) => Math.round((parse(b).getTime() - parse(a).getTime()) / 86_400_000);

/** The week being eaten starts on the Sunday you shop. On Saturdays you're planning next week. */
export function defaultWeek(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dow = d.getDay();
  d.setDate(d.getDate() + (dow === 6 ? 1 : -dow));
  return iso(d);
}

export const short = (s: string) => parse(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
export const weekday = (s: string) => parse(s).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
