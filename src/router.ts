import { useEffect, useState } from 'preact/hooks';

export const parseHash = () => {
  const [path, query = ''] = location.hash.replace(/^#/, '').split('?');
  return { parts: (path || '/week').split('/').filter(Boolean), query: new URLSearchParams(query) };
};

export function useRoute() {
  const [route, setRoute] = useState(parseHash);
  useEffect(() => {
    const on = () => {
      setRoute(parseHash());
      window.scrollTo(0, 0);
    };
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return route;
}

export const go = (path: string) => {
  location.hash = path;
};
