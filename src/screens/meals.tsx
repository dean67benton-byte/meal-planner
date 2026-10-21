import { useState } from 'preact/hooks';
import { short } from '../lib/dates';
import { readyOn, totalMinutes } from '../lib/planner';
import { useStore } from '../lib/store';
import { Icon } from '../icons';
import { CookBadge, Seg } from '../ui';
import { MealMeta } from './week';

type Sort = 'A–Z' | 'Quickest' | 'Longest ago';

export function MealsScreen() {
  const s = useStore().state!;
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('All');
  const [cook, setCook] = useState('Anyone');
  const [sort, setSort] = useState<Sort>('A–Z');
  const [showArchived, setShowArchived] = useState(false);

  let list = s.meals.filter(
    (m) =>
      !!m.archived === showArchived &&
      (cat === 'All' || m.category === cat) &&
      (cook === 'Anyone' || m.cook === cook || m.cook === 'Either') &&
      (m.name + ' ' + m.protein + ' ' + m.ingredients.map((i) => i.name).join(' ')).toLowerCase().includes(q.toLowerCase()),
  );
  list = [...list].sort((a, b) =>
    sort === 'Quickest'
      ? (totalMinutes(a) || 999) - (totalMinutes(b) || 999)
      : sort === 'Longest ago'
        ? (s.last_eaten[a.id] ?? '').localeCompare(s.last_eaten[b.id] ?? '')
        : a.name.localeCompare(b.name),
  );
  const archivedCount = s.meals.filter((m) => m.archived).length;

  return (
    <>
      <header class="top">
        <div class="top-title">
          <h1>Meals</h1>
          <p class="muted">{s.meals.filter((m) => !m.archived).length} in your library</p>
        </div>
        <a class="btn primary" href="#/meals/new"><Icon name="plus" size={18} /> Add</a>
      </header>

      <input class="search" type="search" placeholder="Search meals or ingredients" value={q} onInput={(e) => setQ(e.currentTarget.value)} />
      <div class="filters">
        <Seg label="Category" value={cat} options={['All', ...s.settings.categories]} onChange={setCat} />
        <Seg label="Who can cook" value={cook} options={['Anyone', ...s.settings.cooks]} onChange={setCook} />
        <Seg label="Sort" value={sort} options={['A–Z', 'Quickest', 'Longest ago'] as const} onChange={setSort} />
      </div>

      <ul class="list cards">
        {list.map((m) => {
          const wait = readyOn(m, s, s.week_of);
          return (
            <li key={m.id}>
              <a class="list-item card" href={`#/meals/${m.id}`}>
                <span class="row between">
                  <span class="meal-name">{m.name}</span>
                  <CookBadge cook={m.cook} />
                </span>
                <MealMeta meal={m} last={s.last_eaten[m.id]} />
                <span class="small muted">
                  {m.category}
                  {wait ? ` · ready ${short(wait)}` : ''}
                  {!m.ingredients.length ? ' · ⚠ no ingredients yet' : ''}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
      {!list.length && (
        <div class="empty">
          {s.meals.length ? 'No meals match.' : 'No meals yet.'}{' '}
          <a href="#/meals/new">Add one</a> or <a href="#/ideas">browse ideas</a>.
        </div>
      )}
      {(archivedCount > 0 || showArchived) && (
        <p class="center">
          <button class="link" onClick={() => setShowArchived(!showArchived)}>
            {showArchived ? 'Back to library' : `Show ${archivedCount} archived`}
          </button>
        </p>
      )}
    </>
  );
}
