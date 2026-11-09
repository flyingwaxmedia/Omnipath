// Shared panel plumbing: the host every panel renders through, tabs, and small HTML helpers.
import type { GameController } from '../controller';
import type { DialogOption, DiscoveryCard } from '../dialogs';
import type { LogKind } from '../hud';
import { $$, esc } from '../util';

export interface PanelHost {
  readonly ctrl: GameController;
  readonly modal: HTMLElement;
  /** Per-panel UI state that survives re-renders (tabs, fuse sockets, selections). */
  readonly state: Record<string, unknown>;
  /** Renders a bottom sheet (centred on desktop) and returns its body element. */
  sheet(title: string, body: string, extraClass?: string): HTMLElement;
  open(name: string, arg?: string): void;
  /** Re-renders the current panel. */
  render(): void;
  close(): void;
  toast(msg: string): void;
  /** Speaker dialog (NPC talk, objects): text may hold <b>/<small>; options close it unless `keep`. */
  dialog(speaker: string, portrait: string, text: string, options: DialogOption[]): void;
  // v3 (docs/INTEGRATION-v3.md §2.6): members the UI facade already implements, so panels never need a cast.
  // Frozen while lanes run: a NEW member must already exist on UI (src/ui/ui.ts) or be optional.
  /** Queues a discovery / reward card (shown after the current panel or card). */
  discovery(card: DiscoveryCard): void;
  /** Big centre banner ("You are now a Pyroblade"). */
  headline(title: string, sub?: string, accent?: string): void;
  /** One line in the HUD log. */
  log(msg: string, kind?: LogKind): void;
  /** Re-renders the open panel and the skill bar. */
  refresh(): void;
}

export type PanelRender = (host: PanelHost, arg?: string) => void;

/** Tab bar HTML; wire it with wireTabs. */
export function tabsHtml(key: string, tabs: [string, string][], current: string): string {
  return `<div class="tabs" role="tablist" data-tabs="${key}">${tabs
    .map(([id, label]) => `<button class="tab ${id === current ? 'on' : ''}" role="tab" data-tab="${id}">${label}</button>`)
    .join('')}</div>`;
}

export function wireTabs(host: PanelHost, key: string): void {
  $$<HTMLButtonElement>(host.modal, `[data-tabs="${key}"] .tab`).forEach((b) =>
    b.addEventListener('click', () => {
      host.state[key] = b.dataset.tab;
      host.render();
    }),
  );
}

export function tab(host: PanelHost, key: string, fallback: string): string {
  return (host.state[key] as string | undefined) ?? fallback;
}

/** "✓ text" / "✗ text" requirement rows. */
export function reqList(reqs: { text: string; ok: boolean }[]): string {
  if (!reqs.length) return '';
  return `<ul class="reqs">${reqs.map((r) => `<li class="${r.ok ? 'ok' : 'no'}">${r.ok ? '✓' : '✗'} ${esc(r.text)}</li>`).join('')}</ul>`;
}

export function costText(cost?: { coins?: number; items?: Record<string, number> }, ctrl?: GameController): string {
  if (!cost) return 'Free';
  const parts: string[] = [];
  if (cost.coins) parts.push(`🪙${cost.coins}`);
  for (const [id, n] of Object.entries(cost.items ?? {})) {
    const it = ctrl?.reg.item(id);
    parts.push(`${it?.icon ?? ''}${n} ${esc(it?.name ?? id)}`);
  }
  return parts.join(' + ') || 'Free';
}

/** Two-tap confirmation for destructive buttons (native confirm() is unavailable in embedded webviews). */
export function armTwice(btn: HTMLButtonElement, armedText: string, action: () => void): void {
  const text = btn.textContent ?? '';
  let armed = 0;
  btn.addEventListener('click', () => {
    if (Date.now() < armed) {
      action();
      return;
    }
    armed = Date.now() + 4000;
    btn.textContent = armedText;
    setTimeout(() => {
      if (btn.isConnected && Date.now() >= armed) btn.textContent = text;
    }, 4100);
  });
}

/**
 * Small "Details" / "Hint" toggles (docs/UX-SIMPLE.md rule 7: closed by default): a `[data-hint]` or `[data-more]`
 * button shows / hides the element right after it.
 */
export function wireToggles(root: ParentNode): void {
  $$<HTMLButtonElement>(root, '[data-hint], [data-more]').forEach((b) =>
    b.addEventListener('click', () => {
      const box = b.nextElementSibling as HTMLElement | null;
      if (!box) return;
      const hidden = box.classList.toggle('hidden');
      b.setAttribute('aria-expanded', String(!hidden));
      b.classList.toggle('open', !hidden);
    }),
  );
}

/** "Details" toggle markup: a small button and its closed box (wire with wireToggles). */
export function detailsHtml(inner: string, label = 'Details'): string {
  if (!inner.trim()) return '';
  return `<div class="more"><button class="hint-t" data-more aria-expanded="false">${label}</button><div class="more-b hidden">${inner}</div></div>`;
}

/** A crisp pixel icon from a data URL (32 px art at `size` CSS px); falls back to the emoji glyph. */
export function iconHtml(src: string, fallback = '', size = 32): string {
  return src
    ? `<img class="px" src="${src}" width="${size}" height="${size}" alt="" draggable="false">`
    : fallback
      ? `<span class="glyph" aria-hidden="true">${fallback}</span>`
      : '';
}

/** Pixel icon of an ingredient ref ('skill:<id>', 'el:<id>', 'mod:<id>'), else the emoji fallback. */
export function refIconHtml(ctrl: GameController, ref: string, fallback: string, size = 32): string {
  const i = ref.indexOf(':');
  const kind = ref.slice(0, i);
  const id = ref.slice(i + 1);
  const k = kind === 'skill' ? 'skill' : kind === 'el' ? 'el' : kind === 'mod' ? 'mod' : null;
  let src = '';
  try {
    src = k ? ctrl.iconUrl(k, id) : '';
  } catch {
    src = '';
  }
  return iconHtml(src, fallback, size);
}
