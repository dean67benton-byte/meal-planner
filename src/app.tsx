import { useEffect, useState } from 'preact/hooks';
import { getKey, getWho, setKey, setWho } from './lib/api';
import { StoreContext, useStoreState } from './lib/store';
import { go, useRoute } from './router';
import { Icon } from './icons';
import { WeekScreen } from './screens/week';
import { MealsScreen } from './screens/meals';
import { MealEditor } from './screens/meal-editor';
import { IdeasScreen } from './screens/ideas';
import { GroceryScreen } from './screens/grocery';
import { PantryScreen } from './screens/pantry';
import { SnacksScreen } from './screens/snacks';
import { MoreScreen } from './screens/more';
import { JoinScreen, WhoScreen } from './screens/join';

const TABS = [
  { id: 'week', label: 'Week', icon: 'calendar' },
  { id: 'meals', label: 'Meals', icon: 'book' },
  { id: 'ideas', label: 'Ideas', icon: 'spark' },
  { id: 'groceries', label: 'Groceries', icon: 'cart' },
  { id: 'more', label: 'More', icon: 'more' },
] as const;

export function App() {
  const route = useRoute();
  const store = useStoreState();
  const [screen, arg] = route.parts;
  const [who, setWhoState] = useState(getWho());

  // A household link looks like /#/join/<key>. Save it on this device, then start.
  useEffect(() => {
    if (screen === 'join' && arg) {
      setKey(decodeURIComponent(arg));
      history.replaceState(null, '', location.pathname + '#/week');
      go('/week');
      store.refresh();
    }
  }, [screen, arg]);

  if (!getKey() || store.needsKey) return <JoinScreen onJoined={store.refresh} />;
  if (!who) return <WhoScreen onPicked={(w) => { setWho(w); setWhoState(w); }} />;

  let body;
  if (store.error && !store.state) body = <div class="empty">Couldn't load: {store.error}. <button class="link" onClick={store.refresh}>Try again</button></div>;
  else if (!store.state) body = <div class="loading">Loading…</div>;
  else if (screen === 'meals' && arg) body = <MealEditor id={arg} />;
  else if (screen === 'meals') body = <MealsScreen />;
  else if (screen === 'ideas') body = <IdeasScreen />;
  else if (screen === 'groceries') body = <GroceryScreen />;
  else if (screen === 'pantry') body = <PantryScreen />;
  else if (screen === 'snacks') body = <SnacksScreen />;
  else if (screen === 'more') body = <MoreScreen query={route.query} />;
  else body = <WeekScreen />;

  const active = screen === 'pantry' ? 'groceries' : screen === 'snacks' ? 'week' : screen || 'week';
  return (
    <StoreContext.Provider value={store}>
      <main class="screen">{body}</main>
      {store.toastMsg && <div class="toast" role="status">{store.toastMsg}</div>}
      <nav class="tabbar">
        {TABS.map((t) => (
          <a key={t.id} href={`#/${t.id}`} class={active === t.id ? 'on' : ''} aria-current={active === t.id ? 'page' : undefined}>
            <Icon name={t.icon} />
            <span>{t.label}</span>
          </a>
        ))}
      </nav>
    </StoreContext.Provider>
  );
}
