import { useState } from 'preact/hooks';
import { setKey } from '../lib/api';

export function JoinScreen({ onJoined }: { onJoined: () => void }) {
  const [val, setVal] = useState('');
  return (
    <main class="screen join">
      <h1>Meal Planner</h1>
      <p>Open your household link on this device to get in. It looks like <code>…/#/join/…</code>.</p>
      <p class="muted small">Lost it? Paste the code from the end of the link:</p>
      <form class="row gap" onSubmit={(e) => {
        e.preventDefault();
        const code = val.trim().split('/join/').pop()!;
        if (code) { setKey(code); onJoined(); }
      }}>
        <input value={val} onInput={(e) => setVal(e.currentTarget.value)} placeholder="Household link or code" aria-label="Household link or code" />
        <button class="btn primary">Go</button>
      </form>
    </main>
  );
}

export function WhoScreen({ onPicked }: { onPicked: (who: string) => void }) {
  const pick = onPicked;
  return (
    <main class="screen join">
      <h1>Who's using this device?</h1>
      <p class="muted">So the history shows who logged what. You can change it later on the More tab.</p>
      <div class="row gap">
        <button class="btn primary big" onClick={() => pick('Dean')}>Dean</button>
        <button class="btn primary big" onClick={() => pick('Kinley')}>Kinley</button>
      </div>
    </main>
  );
}
