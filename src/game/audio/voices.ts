// Voice limiting (pure; tests drive it with fake clocks). Every sound belongs to a group with a policy:
// how many may sound at once, the minimum gap between two starts, and a priority. A full group (or the global cap)
// steals its lowest-priority, oldest voice when the newcomer is at least as important, and drops the newcomer
// otherwise — so crits, level-ups and discoveries always beat status ticks and footsteps.

export interface VoicePolicy {
  /** Max voices of this group sounding at once. */
  max: number;
  /** Min ms between two starts in this group (simultaneous multi-hits collapse into one). */
  gap: number;
  /** Default priority of the group's sounds (higher wins; 0 = ticks / footsteps, 10 = fanfares). */
  priority: number;
}

export interface Voice {
  id: number;
  group: string;
  priority: number;
  start: number;
  end: number;
}

export interface Admission {
  id: number;
  /** Voices to stop (quick fade) to make room. */
  evict: Voice[];
}

/** Why a request was refused (debug hooks and tests). */
export type Refusal = 'gap' | 'group' | 'global';

export class VoiceLimiter {
  private voices: Voice[] = [];
  private readonly lastStart = new Map<string, number>();
  private nextId = 1;
  /** The last refusal reason (null after an admission). */
  lastRefusal: Refusal | null = null;

  constructor(readonly maxTotal: number) {}

  /**
   * Asks for a voice of `group` lasting `durMs` from `now`. Returns the admission (with the voices to evict) or null
   * when the request is dropped. `priority` overrides the group's (a crit layer in the hit group).
   */
  admit(group: string, policy: VoicePolicy, now: number, durMs: number, priority = policy.priority): Admission | null {
    this.prune(now);
    const last = this.lastStart.get(group);
    if (last !== undefined && now - last < policy.gap && priority <= policy.priority) {
      this.lastRefusal = 'gap';
      return null;
    }
    const evict: Voice[] = [];
    const mine = this.voices.filter((v) => v.group === group);
    if (mine.length >= policy.max) {
      const victim = weakest(mine);
      if (!victim || victim.priority > priority) {
        this.lastRefusal = 'group';
        return null;
      }
      evict.push(victim);
    }
    if (this.voices.length - evict.length >= this.maxTotal) {
      const victim = weakest(this.voices.filter((v) => !evict.includes(v)));
      if (!victim || victim.priority > priority) {
        this.lastRefusal = 'global';
        return null;
      }
      evict.push(victim);
    }
    if (evict.length) this.voices = this.voices.filter((v) => !evict.includes(v));
    const voice: Voice = { id: this.nextId++, group, priority, start: now, end: now + Math.max(1, durMs) };
    this.voices.push(voice);
    this.lastStart.set(group, now);
    this.lastRefusal = null;
    return { id: voice.id, evict };
  }

  /** A voice ended early (stopped, or its source fired `ended`). */
  release(id: number): void {
    const i = this.voices.findIndex((v) => v.id === id);
    if (i >= 0) this.voices.splice(i, 1);
  }

  /** Drops voices whose time is up. */
  prune(now: number): void {
    if (this.voices.some((v) => v.end <= now)) this.voices = this.voices.filter((v) => v.end > now);
  }

  /** Voices sounding at `now` (optionally of one group). */
  active(now: number, group?: string): number {
    this.prune(now);
    return group === undefined ? this.voices.length : this.voices.filter((v) => v.group === group).length;
  }

  /** Forgets every voice and gap (context suspended / closed). */
  reset(): void {
    this.voices = [];
    this.lastStart.clear();
  }
}

/** Lowest priority first, then the oldest. */
function weakest(vs: Voice[]): Voice | undefined {
  let best: Voice | undefined;
  for (const v of vs) {
    if (!best || v.priority < best.priority || (v.priority === best.priority && v.start < best.start)) best = v;
  }
  return best;
}
