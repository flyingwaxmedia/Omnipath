// Small DOM/text helpers shared by every UI module (HUD, dialogs, panels, maps).
import type { Registry } from '../core/registry';
import type { SkillShape } from '../core/types';
import type { MapDef } from '../core/world/types';

/** HTML-escapes text for innerHTML templates. */
export const esc = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** querySelector with a cast (the templates guarantee the element exists). */
export const $ = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string): T => root.querySelector(sel) as T;

/** All matches as an array. */
export const $$ = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string): T[] =>
  Array.from(root.querySelectorAll<T>(sel));

/** 0xRRGGBB -> '#rrggbb'. */
export const hex = (n: number): string => `#${n.toString(16).padStart(6, '0')}`;

/** "Lv 3–6" for a level band (empty for safe maps). */
export function bandText(def: Pick<MapDef, 'levelBand'>): string {
  const b = def.levelBand;
  if (!b) return '';
  return b[0] === b[1] ? `Lv ${b[0]}` : `Lv ${b[0]}–${b[1]}`;
}

/** Short human text for a skill shape. */
export function shapeText(s: SkillShape): string {
  switch (s.kind) {
    case 'strike':
      return `Melee arc · ${s.arc}°${s.hits && s.hits > 1 ? ` · ${s.hits} hits` : ''}`;
    case 'spin':
      return `Spin around you · radius ${s.radius}${s.pulses && s.pulses > 1 ? ` · ${s.pulses} pulses` : ''}`;
    case 'projectile':
      return `Projectile${s.count && s.count > 1 ? ` ×${s.count}` : ''}${s.radial ? ' (all directions)' : ''}${
        s.pierce ? ` · pierce ${s.pierce >= 99 ? '∞' : s.pierce}` : ''
      }`;
    case 'dash':
      return `Dash ${s.distance}px${s.width ? ' · hits along the path' : ''}`;
    case 'nova':
      return `Burst at range ${s.range} · radius ${s.radius}`;
    case 'chain':
      return `Chains to ${s.jumps} more foes`;
    case 'buff':
      return `+${s.amount}${s.stat === 'regen' ? '% HP/s' : s.stat === 'crit' ? ' crit' : '%'} ${
        s.stat === 'regen' ? '' : s.stat.toUpperCase()
      } for ${s.duration / 1000}s`;
  }
}

/** Where a skill/element came from, for logs and the grimoire. */
export function sourceText(src: string, reg: Registry): string {
  const [kind, rest = ''] = src.includes(':') ? [src.slice(0, src.indexOf(':')), src.slice(src.indexOf(':') + 1)] : [src, ''];
  switch (kind) {
    case 'morph':
      return `Morphed from ${reg.skill(rest)?.name ?? '?'}`;
    case 'spark':
      return `Sparked from ${reg.skill(rest)?.name ?? '?'} mid-fight`;
    case 'echo':
      return `Echo of the ${reg.monster(rest)?.name ?? 'monsters'}`;
    case 'fusion': {
      const [a, b] = rest.split('+');
      return b ? `Fusion of ${reg.refName(a)} + ${reg.refName(b)}` : 'Fusion';
    }
    case 'class':
      return `Signature of the ${reg.classDef(rest)?.name ?? '?'}`;
    case 'lesson': {
      const l = reg.lesson(rest);
      return l ? `Taught at ${l.trainer.title}` : 'A lesson';
    }
    case 'tome':
      return `Read from the ${reg.item(rest)?.name ?? 'tome'}`;
    default:
      return src.charAt(0).toUpperCase() + src.slice(1);
  }
}

/** Throttles a function to at most once per `ms`. */
export function gate(ms: number): () => boolean {
  let next = 0;
  return () => {
    const now = performance.now();
    if (now < next) return false;
    next = now + ms;
    return true;
  };
}
