import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

/**
 * A bottom sheet. `tall` sheets (the ones with a search box) open at full height, so the search box sits at the
 * top and results run down from it. The backdrop follows the visible viewport, so on iPhone the open keyboard
 * shrinks the sheet instead of covering it.
 */
export function Sheet({ title, onClose, tall, children }: { title: string; onClose: () => void; tall?: boolean; children: ComponentChildren }) {
  const backdrop = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', onKey);
    document.body.classList.add('noscroll');
    return () => {
      removeEventListener('keydown', onKey);
      document.body.classList.remove('noscroll');
    };
  }, [onClose]);
  useEffect(() => {
    const vv = window.visualViewport;
    const el = backdrop.current;
    if (!vv || !el) return;
    const fit = () => {
      el.style.top = `${vv.offsetTop}px`;
      el.style.height = `${vv.height}px`;
    };
    fit();
    vv.addEventListener('resize', fit);
    vv.addEventListener('scroll', fit);
    return () => {
      vv.removeEventListener('resize', fit);
      vv.removeEventListener('scroll', fit);
    };
  }, []);
  return (
    <div ref={backdrop} class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class={`sheet ${tall ? 'tall' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
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
