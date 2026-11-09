// VFX settings (docs/VFX.md §8.6 item 5): "Reduce shake & flashes" (the ☰ menu's toggle, src/ui/hud/settings.ts,
// calls setReduceFlash). The runtime reads this object, so flipping it applies to every effect played afterwards
// (reduce-flash bakes: no contrast / blank / white frames; camera trauma x0.3; no screen flash). Persisted per device
// (localStorage, guarded: private windows and blocked storage fall back to the default).
const KEY = 'omnipath.vfx.reduceFlash';

function load(): boolean {
  try {
    // Only a stored choice overrides the device default (a fresh install follows prefers-reduced-motion).
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null;
    if (v === '1' || v === '0') return v === '1';
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

const listeners = new Set<(on: boolean) => void>();

/** Called when the setting changes (the runtime re-warms its bakes in the new variant); returns the unsubscribe. */
export function onReduceFlash(fn: (on: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Sets "Reduce shake & flashes" (and remembers it on this device). */
export function setReduceFlash(on: boolean): void {
  const changed = vfxSettings.reduceFlash !== on;
  vfxSettings.reduceFlash = on;
  if (changed) {
    for (const fn of listeners) {
      try {
        fn(on);
      } catch {
        /* a listener's failure never blocks the setting */
      }
    }
  }
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* storage blocked */
  }
}
