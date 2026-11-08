import type { WeaponType } from '../core/types';
import { WEAPONS } from '../data/weapons';
import { esc } from './ui';

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
          <p class="fine">Master · Morph · Fuse · Discover</p>
        </div>`;
      el.querySelector('.cont')?.addEventListener('click', () => done({ kind: 'continue' }));
      el.querySelector('.new')!.addEventListener('click', () => create());
    };

    const create = () => {
      let weapon: WeaponType = 'sword';
      el.innerHTML = `
        <div class="title-card create">
          <h2>Who are you?</h2>
          <input class="name" maxlength="16" placeholder="Name" value="" autocomplete="off" />
          <h3>Choose your first weapon</h3>
          <p class="fine">It decides your first basic attack — and every skill grows from there.</p>
          <div class="weapon-pick">
            ${(Object.keys(WEAPONS) as WeaponType[])
              .map(
                (w) => `<button class="wcard ${w === weapon ? 'on' : ''}" data-w="${w}">
                  <span class="ico">${WEAPONS[w].icon}</span><b>${w[0].toUpperCase() + w.slice(1)}</b>
                  <small>${esc(WEAPONS[w].blurb)}</small></button>`,
              )
              .join('')}
          </div>
          ${hasSave ? '<p class="warn">Starting a new adventure will erase your current character.</p>' : ''}
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
