'use client';

import { useState } from 'react';

export type Theme = 'light' | 'dark';

function readInitial(): Theme {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

/** Alterna e persiste o tema; a leitura inicial vem do atributo já aplicado
 * pelo script inline no <head> (evita flash de tema errado). */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(readInitial);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('theme', next);
    } catch {
      // ponytail: localStorage pode falhar (modo privado); tema só não persiste.
    }
    setTheme(next);
  }

  return { theme, toggle };
}

export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('theme');if(t!=='dark'&&t!=='light'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;
