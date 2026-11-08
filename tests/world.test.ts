import { describe, expect, it } from 'vitest';
import { TILE, generateWorld, isWalkable } from '../src/game/world/map';
import { findPath } from '../src/game/world/pathfinding';

const world = generateWorld();

function reachable(): Set<number> {
  const seen = new Set<number>();
  const sx = Math.floor(world.spawnPoint.x / TILE);
  const sy = Math.floor(world.spawnPoint.y / TILE);
  const q: [number, number][] = [[sx, sy]];
  seen.add(sy * world.w + sx);
  while (q.length) {
    const [x, y] = q.pop()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      const k = ny * world.w + nx;
      if (!seen.has(k) && isWalkable(world, nx, ny)) {
        seen.add(k);
        q.push([nx, ny]);
      }
    }
  }
  return seen;
}

describe('world', () => {
  const seen = reachable();
  const near = (tx: number, ty: number, r = 2) => {
    for (let y = ty - r; y <= ty + r; y++) for (let x = tx - r; x <= tx + r; x++) if (seen.has(y * world.w + x)) return true;
    return false;
  };

  it('is deterministic', () => {
    expect(generateWorld().props.length).toBe(world.props.length);
  });

  it('spawns the player on walkable ground', () => {
    expect(isWalkable(world, Math.floor(world.spawnPoint.x / TILE), Math.floor(world.spawnPoint.y / TILE))).toBe(true);
  });

  it('lets the player reach every interactable', () => {
    for (const i of world.interactables) {
      expect(near(Math.floor(i.x / TILE), Math.floor(i.y / TILE)), i.id).toBe(true);
    }
  });

  it('lets the player reach every monster zone', () => {
    for (const z of world.spawns) expect(near(z.cx, z.cy, z.r), z.id).toBe(true);
  });

  it('finds a path from town to the boss plateau', () => {
    const boss = world.spawns.find((s) => s.id === 'boss')!;
    const path = findPath(world, world.spawnPoint.x, world.spawnPoint.y, boss.cx * TILE, boss.cy * TILE, 20000);
    expect(path).not.toBeNull();
    expect(path!.length).toBeGreaterThan(0);
  });
});
