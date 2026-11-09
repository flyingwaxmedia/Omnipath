// Template registry (package P, docs/VFX.md §10.2): one Template<C> per ComponentId.
import type { ComponentId, TemplateMap, VfxPiece } from '../types';
import { afterimage } from './afterimage';
import { aura } from './aura';
import { bolt } from './bolt';
import { burst } from './burst';
import { decal } from './decal';
import { erupt } from './erupt';
import { missile } from './missile';
import { motes } from './motes';
import { nova } from './nova';
import { orb } from './orb';
import { puff } from './puff';
import { ring } from './ring';
import { sigil } from './sigil';
import { slash } from './slash';
import { status } from './status';
import { tell } from './tell';
import { thrust } from './thrust';

export const TEMPLATES: TemplateMap = {
  slash,
  thrust,
  orb,
  missile,
  bolt,
  burst,
  motes,
  puff,
  ring,
  decal,
  sigil,
  nova,
  erupt,
  status,
  aura,
  tell,
  afterimage,
};

/** Families whose small marks are matter chips (earth chips, magma crust): outlined like any matter. */
const MATTER_MARKS: ReadonlySet<string> = new Set(['earth', 'magma']);

/**
 * Where the #24180f OUTLINE index may appear (docs/VFX.md §11.1 index discipline): matter templates (missiles, chips,
 * crust, spikes, the freeze crystal, debris, earth / magma family marks, earth / steel blast rocks and chips), danger
 * keylines (dashed rings, danger tells) and pips. The biome keyline
 * option allows it everywhere.
 */
export function outlineAllowed(piece: VfxPiece, keyline = false): boolean {
  if (keyline) return true;
  switch (piece.component) {
    case 'missile':
      return true;
    case 'motes':
      return piece.params.kind === 'chip';
    case 'burst':
      return piece.params.cls === 'blunt' || piece.params.cls === 'star' || (piece.params.cls === 'magic' && MATTER_MARKS.has(piece.motif));
    case 'slash':
      return piece.params.tier >= 2 && MATTER_MARKS.has(piece.motif);
    case 'erupt':
      return ['lava-geyser', 'rock-spike', 'crystal-spike', 'ice-spike', 'debris'].includes(piece.params.unit);
    case 'status':
      return ['crystal', 'icicle', 'pip'].includes(piece.params.unit);
    case 'ring':
      return piece.params.style === 'dashed';
    case 'tell':
      return piece.params.danger || piece.params.piece === 'edge';
    case 'orb':
      return piece.params.orbit === 'shards';
    case 'nova':
      // Blast rocks (earth) and metal chips (steel) are matter.
      return piece.params.core === 'blast' && (piece.motif === 'earth' || piece.motif === 'steel' || piece.motif === 'danger');
    default:
      return false;
  }
}

/** Templates that remove lone pixels outside the last frames (QA: <= 2 orphans in non-final frames). */
export const ORPHAN_CHECKED: readonly ComponentId[] = ['slash', 'thrust', 'orb', 'missile', 'burst', 'nova', 'erupt'];
