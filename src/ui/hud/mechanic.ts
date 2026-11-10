// The class mechanic widget (HUD lane; docs/SPEC-v4.md §3.6, §11.7, §12): ONE small pixel widget above the skill bar
// for the worn class's signature mechanic. Its only label is the mechanic's own name ("Heat", "Pinned Shadow").
// One look per kind, readable at a glance:
//   gauge  → a bar that fills (gold when its next skill gets something)
//   combo  → round pips, one per step toward the finisher
//   marks  → diamond pips on your target and their count
//   stance → a two-sided toggle (a button when the class swaps by tap)
//   zone   → small squares, one per thing you may have out
// Pure HTML builders (tests/hud.test.ts) + the adapter that reads GameController.mechanicView() (optional on the
// interface: a controller without it, or one that returns anything odd, simply hides the widget).
import type { GameController } from '../controller';
import { esc } from '../util';

/** What the widget needs (the core's MechanicView, plus what the game lane may add). */
export interface MechWidgetView {
  kind: 'gauge' | 'combo' | 'marks' | 'stance' | 'zone';
  /** The mechanic's own name; for a stance, the stance you are in. */
  name: string;
  widget: 'bar' | 'pips' | 'sides' | 'count';
  value: number;
  /** Null for an open-ended gauge. */
  max: number | null;
  ready: boolean;
  stance?: 0 | 1;
  /** Stance: both names, and whether a tap swaps it. */
  names?: readonly [string, string];
  tap?: boolean;
  /** The class colour, '#rrggbb'. */
  color?: string;
  /** One-line first-time hint written by the class data, if any. */
  hint?: string;
}


const KINDS = ['gauge', 'combo', 'marks', 'stance', 'zone'];
const WIDGETS = ['bar', 'pips', 'sides', 'count'];

/** A view object from the controller, checked field by field (anything else hides the widget). */
export function asMechView(raw: unknown): MechWidgetView | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.kind !== 'string' || !KINDS.includes(v.kind)) return null;
  if (typeof v.name !== 'string' || !v.name) return null;
  const widget = typeof v.widget === 'string' && WIDGETS.includes(v.widget) ? v.widget : v.kind === 'gauge' ? 'bar' : v.kind === 'stance' ? 'sides' : v.kind === 'zone' ? 'count' : 'pips';
  const names = Array.isArray(v.names) && v.names.length === 2 && v.names.every((n) => typeof n === 'string') ? (v.names as [string, string]) : undefined;
  return {
    kind: v.kind as MechWidgetView['kind'],
    name: v.name,
    widget: widget as MechWidgetView['widget'],
    value: Number.isFinite(v.value) ? Math.max(0, Number(v.value)) : 0,
    max: typeof v.max === 'number' && Number.isFinite(v.max) ? v.max : null,
    ready: !!v.ready,
    ...(v.stance === 0 || v.stance === 1 ? { stance: v.stance } : {}),
    ...(names ? { names } : {}),
    ...(v.tap ? { tap: true } : {}),
    ...(typeof v.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(v.color) ? { color: v.color } : {}),
    ...(typeof v.hint === 'string' && v.hint ? { hint: v.hint } : {}),
  };
}

/** The worn class's mechanic as the controller reports it, or null (no class, no mechanic, older controller). */
export function mechanicOf(ctrl: GameController): MechWidgetView | null {
  try {
    return asMechView(ctrl.mechanicView ? ctrl.mechanicView() : null);
  } catch {
    return null;
  }
}

/** Tapping the stance toggle: asks the game to swap. Null when the controller cannot. */
export function mechanicTap(ctrl: GameController): { ok: boolean; message?: string } | null {
  try {
    return ctrl.mechanicTap ? ctrl.mechanicTap() : null;
  } catch {
    return null;
  }
}

/** The one-line hint shown the first time a kind of widget appears (docs/UX-SIMPLE.md rule 9). */
export function mechanicHint(v: MechWidgetView): string {
  if (v.hint) return v.hint;
  const n = `<b>${esc(v.name)}</b>`;
  switch (v.kind) {
    case 'gauge':
      return `${n} fills as you fight. Full, it powers your next class skill.`;
    case 'combo':
      return `${n}: chain different skills. The last one hits hardest.`;
    case 'marks':
      return `${n}: your hits mark a foe. Cash the marks in with a class skill.`;
    case 'stance':
      return `${n}: tap to switch. Your class skills change with it.`;
    case 'zone':
      return `${n}: place them and fight near them.`;
  }
}

function pips(n: number, on: number, cls: string): string {
  let out = '';
  for (let i = 0; i < n; i++) out += `<i class="${i < on ? 'on' : ''}"></i>`;
  return `<span class="${cls}" aria-hidden="true">${out}</span>`;
}

/** What a screen reader hears ("Heat 3 of 10"). */
export function mechanicLabel(v: MechWidgetView): string {
  if (v.widget === 'sides') return v.tap ? `${v.name}: tap to switch` : v.name;
  return `${v.name} ${v.value}${v.max !== null ? ` of ${v.max}` : ''}${v.ready ? ', ready' : ''}`;
}

/** The widget's HTML: the name and ONE meter, in the class colour (`color`, '#rrggbb'). */
export function mechanicHtml(v: MechWidgetView, color = '#e9c46a'): string {
  const cap = v.max !== null ? Math.max(1, Math.round(v.max)) : null;
  const val = cap !== null ? Math.min(cap, v.value) : v.value;
  let meter: string;
  if (v.widget === 'bar') {
    const pct = cap !== null ? Math.round((100 * val) / cap) : Math.min(100, val * 10);
    meter = `<span class="mech-bar" aria-hidden="true"><i style="width:${pct}%"></i></span><em class="num">${Math.floor(val)}</em>`;
  } else if (v.widget === 'sides') {
    const side = v.stance ?? (val >= 1 ? 1 : 0);
    const a = v.names?.[0];
    const b = v.names?.[1];
    meter = `<span class="mech-sides" aria-hidden="true"><i class="${side === 0 ? 'on' : ''}">${a && side !== 0 ? esc(a) : ''}</i><i class="${side === 1 ? 'on' : ''}">${b && side !== 1 ? esc(b) : ''}</i></span>`;
  } else if (v.widget === 'count') {
    meter = `${pips(Math.min(8, cap ?? Math.max(1, val)), val, 'mech-cells')}<em class="num">${Math.floor(val)}</em>`;
  } else {
    // pips: a combo's steps (round), or the marks on your target (diamonds, with their count).
    const n = Math.min(8, cap ?? Math.max(1, val));
    meter = v.kind === 'marks' ? `${pips(n, val, 'mech-pips marks')}<em class="num">${Math.floor(val)}</em>` : pips(n, val, 'mech-pips');
  }
  const cls = `mech mech-${v.kind}${v.ready ? ' ready' : ''}`;
  const inner = `<b class="mech-n">${esc(v.name)}</b>${meter}`;
  const label = esc(mechanicLabel(v));
  return v.widget === 'sides' && v.tap
    ? `<button class="${cls} tap" style="--cc:${esc(color)}" aria-label="${label}">${inner}</button>`
    : `<div class="${cls}" style="--cc:${esc(color)}" role="status" aria-label="${label}">${inner}</div>`;
}
