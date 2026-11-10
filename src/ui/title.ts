import type { WeaponType } from '../core/types';
import { GAME_DATA } from '../data';
import { SOLD_WEAPONS, WEAPONS } from '../data/weapons';
import { esc } from './util';
import { WEAPON_WORD, oneLine } from './words';

/** Weapons a new hero may start with: the smith's three, and Bare Hands once its basic attack is in the data. */
const START_WEAPONS: WeaponType[] = [...SOLD_WEAPONS, ...(GAME_DATA.skills.some((s) => s.id === WEAPONS.fists.basic) ? (['fists'] as const) : [])];

export interface TitleChoice {
  kind: 'continue' | 'new';
  name?: string;
  weapon?: WeaponType;
}

/** Title + character creation. Resolves when the player is ready to enter the world. */
export function showTitle(parent: HTMLElement, hasSave: boolean, savedName?: string): Promise<TitleChoice> {
  return new Promise((resolve) => {
    const el = document.createElement('div');
    el.className = 'title-screen';
    parent.appendChild(el);
    const done = (c: TitleChoice) => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 350);
      resolve(c);
    };

    const home = () => {
      el.innerHTML = `
        <div class="title-card">
          <div class="logo">OMNIPATH</div>
          <div class="tagline">Every skill you know, you discovered.</div>
          <div class="title-actions">
            ${hasSave ? `<button class="btn gold big cont">Continue${savedName ? ` as ${esc(savedName)}` : ''}</button>` : ''}
            <button class="btn ${hasSave ? '' : 'gold'} big new">New Adventure</button>
          </div>
          <p class="fine">Learn · Transform · Fuse · Discover</p>
        </div>`;
      el.querySelector('.cont')?.addEventListener('click', () => done({ kind: 'continue' }));
      el.querySelector('.new')!.addEventListener('click', () => create());
    };

    const create = () => {
      let weapon: WeaponType = 'sword';
      el.innerHTML = `
        <div class="title-card create">
          <h2>Who are you?</h2>
          <input class="name" maxlength="16" placeholder="Your name" value="" autocomplete="off" />
          <h3>Pick your first weapon</h3>
          <p class="fine">If a move uses a weapon, you need that weapon.</p>
          <div class="weapon-pick">
            ${START_WEAPONS
              .map(
                (w) => `<button class="wcard ${w === weapon ? 'on' : ''}" data-w="${w}">
                  <span class="ico">${WEAPONS[w].icon}</span><b>${WEAPON_WORD[w]}</b>
                  <small>${esc(oneLine(WEAPONS[w].blurb))}</small></button>`,
              )
              .join('')}
          </div>
          ${hasSave ? '<p class="warn">This erases your current hero.</p>' : ''}
          <div class="title-actions">
            <button class="btn back">Back</button>
            <button class="btn gold big go">Begin</button>
          </div>
        </div>`;
      const input = el.querySelector<HTMLInputElement>('.name')!;
      el.querySelectorAll<HTMLButtonElement>('.wcard').forEach((b) =>
        b.addEventListener('click', () => {
          weapon = b.dataset.w as WeaponType;
          el.querySelectorAll('.wcard').forEach((x) => x.classList.toggle('on', x === b));
        }),
      );
      el.querySelector('.back')!.addEventListener('click', home);
      el.querySelector('.go')!.addEventListener('click', () =>
        done({ kind: 'new', name: input.value.trim() || 'Wanderer', weapon }),
      );
    };

    home();
  });
}
