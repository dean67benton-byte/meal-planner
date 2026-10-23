import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ComponentChildren }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', onKey);
    document.body.classList.add('noscroll');
    return () => {
      removeEventListener('keydown', onKey);
      document.body.classList.remove('noscroll');
    };
  }, [onClose]);
  return (
    <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div class="sheet-head">
          <h2>{title}</h2>
          <button class="ghost" onClick={onClose}>Done</button>
        </div>
        <div class="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: {
  value: T;
  options: readonly T[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div class="seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button type="button" key={o} role="radio" aria-checked={value === o} class={value === o ? 'on' : ''} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}

export const cookClass = (c: string | null | undefined) => `cook cook-${(c ?? 'either').toLowerCase()}`;

/** Marks a meal nobody has cooked yet. */
export const NewBadge = () => <span class="new-badge">NEW</span>;

export function CookBadge({ cook }: { cook: string | null | undefined }) {
  return <span class={cookClass(cook)}>{cook ?? 'Either'}</span>;
}
