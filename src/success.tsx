// A one-time "done" animation: "Success Check" by Pranav Patil from LottieFiles (Lottie Simple License).
// The player loads only when the animation first plays, and the animation file comes from LottieFiles' CDN.
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from './icons';

const ANIMATION_URL = 'https://assets-v2.lottiefiles.com/a/20e4a6f2-116f-11ee-b864-bf9e43a0b86d/gjvNK2B3cD.json';

let animation: Promise<object> | null = null;

/** Starts downloading the animation so it's ready when it plays. */
export function preloadSuccess() {
  animation ??= fetch(ANIMATION_URL)
    .then((r) => (r.ok ? (r.json() as Promise<object>) : Promise.reject(new Error(`HTTP ${r.status}`))))
    .catch((e) => {
      animation = null;
      throw e;
    });
  return animation;
}

/** Plays the check once over the screen with a label, then calls onDone. A plain check shows if it can't load. */
export function SuccessBurst({ label, onDone }: { label: string; onDone: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [fallback, setFallback] = useState(false);
  useEffect(() => {
    let destroy = () => {};
    let gone = false;
    const timers: number[] = [];
    const finish = (after: number) => timers.push(window.setTimeout(onDone, after));
    finish(4000); // never leave the overlay up
    Promise.all([import('lottie-web/build/player/lottie_light'), preloadSuccess()])
      .then(([{ default: lottie }, animationData]) => {
        if (gone || !box.current) return;
        const anim = lottie.loadAnimation({ container: box.current, renderer: 'svg', loop: false, autoplay: true, animationData });
        anim.addEventListener('complete', () => finish(500));
        destroy = () => anim.destroy();
      })
      .catch(() => {
        setFallback(true);
        finish(1400);
      });
    return () => {
      gone = true;
      timers.forEach(clearTimeout);
      destroy();
    };
  }, []);
  return (
    <div class="success-burst" role="status" onClick={onDone}>
      <div class="success-card">
        <div ref={box} class="success-anim">{fallback && <Icon name="check" size={72} />}</div>
        <p>{label}</p>
      </div>
    </div>
  );
}
