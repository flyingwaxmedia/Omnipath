// World map (docs/CLIENT-v2.md §7) — minimal foundation version: a region grid of map cells by `worldCell`
// (visited / seen / unknown, level bands, current position). The hud-maps stage replaces this with the full
// region graph (gate pins, dungeon floor popovers) and a 1:1 local map with fog.
import { portalKey } from '../core/world/graph';
import type { MapDef } from '../core/world/types';
import { MAPS, REGIONS } from '../data/world';
import type { GameController } from './controller';
import { bandText, esc } from './util';

export type CellState = 'visited' | 'seen' | 'unknown';

/** Whether the player has seen a portal leading into `mapId`. */
function seenInto(ctrl: GameController, mapId: string): boolean {
  const w = ctrl.world();
  for (const m of MAPS) {
    for (const p of m.portals) if (p.to.map === mapId && w.seenPortals.includes(portalKey(m.id, p.id)) && w.visited.includes(m.id)) return true;
  }
  return false;
}

export function mapState(ctrl: GameController, def: MapDef): CellState {
  const w = ctrl.world();
  if (w.visited.includes(def.id)) return 'visited';
  return seenInto(ctrl, def.id) ? 'seen' : 'unknown';
}

/** Region grids as HTML (cells hold every map sharing that worldCell, e.g. dungeon floors). */
export function worldMapHtml(ctrl: GameController): string {
  const here = ctrl.map().def.id;
  return REGIONS.map((r) => {
    const maps = r.maps.map((id) => MAPS.find((m) => m.id === id)).filter((m): m is MapDef => !!m);
    const cols = Math.max(...maps.map((m) => m.worldCell.x)) + 1;
    const rows = Math.max(...maps.map((m) => m.worldCell.y)) + 1;
    if (!maps.some((m) => mapState(ctrl, m) !== 'unknown')) return '';
    const cells: string[] = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const at = maps.filter((m) => m.worldCell.x === x && m.worldCell.y === y);
        const shown = at.map((m) => ({ m, st: mapState(ctrl, m) })).filter((e) => e.st !== 'unknown');
        if (!shown.length) {
          cells.push('<div class="wcell empty"></div>');
          continue;
        }
        const cur = at.some((m) => m.id === here);
        cells.push(
          `<div class="wcell ${cur ? 'here' : ''} ${shown.every((e) => e.st === 'seen') ? 'seen' : ''}">${shown
            .map(({ m, st }) =>
              st === 'visited'
                ? `<b>${esc(m.name)}</b><small>${bandText(m) || 'safe'}</small>`
                : '<b>?</b><small>unexplored</small>',
            )
            .join('')}${cur ? '<span class="pin">📍</span>' : ''}</div>`,
        );
      }
    }
    return `<h3>${esc(r.name)} <small>Lv ${r.levelBand[0]}–${r.levelBand[1]}</small></h3>
      <div class="wgrid" style="grid-template-columns:repeat(${cols},1fr)">${cells.join('')}</div>`;
  }).join('');
}
