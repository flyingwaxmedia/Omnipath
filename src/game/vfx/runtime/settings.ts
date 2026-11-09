// VFX settings (docs/VFX.md §8.6 item 5): "Reduce shake & flashes". The UI toggle comes later; the runtime reads this
// object, so flipping it applies to every effect played afterwards (reduce-flash bakes: no contrast / blank / white
// frames; camera trauma x0.3; no screen flash). Persisted per device (localStorage, guarded: private windows and
// blocked storage fall back to the default).
const KEY = 'omnipath.vfx.reduceFlash';

function load(): boolean {
  try {
    if (typeof localStorage !== 'undefined') return localStorage.getItem(KEY) === '1';
  } catch {
    /* storage blocked */
  }
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export const vfxSettings = {
  reduceFlash: load(),
};

/** Sets "Reduce shake & flashes" (and remembers it on this device). */
export function setReduceFlash(on: boolean): void {
  vfxSettings.reduceFlash = on;
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* storage blocked */
  }
}
