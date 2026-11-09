// Dialogs, discovery cards and minigames (docs/CLIENT-v2.md §1/§7). Pure renderers into the shared modal element;
// the UI facade owns modal state (which panel is open, the discovery queue, pausing the world).
import { $, $$, esc } from './util';

export interface DialogOption {
  label: string;
  action?: () => void;
  /** Keep the dialog open after the action. */
  keep?: boolean;
  disabled?: boolean;
}

export interface DiscoveryCard {
  icon: string;
  kicker: string;
  title: string;
  body: string;
  accent?: string;
}

/** NPC / object dialog. `close` is called before an option's action unless the option keeps the dialog. */
export function renderDialog(
  modal: HTMLElement,
  speaker: string,
  portrait: string,
  text: string,
  options: DialogOption[],
  close: () => void,
): void {
  modal.innerHTML = `
    <div class="dialog">
      <div class="speaker"><span class="ico">${portrait}</span><b>${esc(speaker)}</b></div>
      <p>${text}</p>
      <div class="opts">${options
        .map((o, i) => `<button class="btn ${i === 0 ? 'gold' : ''}" data-opt="${i}" ${o.disabled ? 'disabled' : ''}>${o.label}</button>`)
        .join('')}</div>
    </div>`;
  $$<HTMLButtonElement>(modal, '[data-opt]').forEach((b) =>
    b.addEventListener('click', () => {
      const o = options[Number(b.dataset.opt)];
      if (!o.keep) close();
      o.action?.();
    }),
  );
}

export function renderDiscovery(modal: HTMLElement, card: DiscoveryCard, more: boolean, onOk: () => void): void {
  modal.innerHTML = `
    <div class="discovery" style="--accent:${card.accent ?? '#ffd76a'}">
      <div class="rays"></div>
      <div class="kicker">${card.kicker}</div>
      <div class="big-ico">${card.icon}</div>
      <h2>${esc(card.title)}</h2>
      <p>${card.body}</p>
      <button class="btn gold ok">${more ? 'Next' : 'Onward'}</button>
    </div>`;
  $(modal, '.ok').addEventListener('click', onOk);
}

/** Brann's forge: three strikes on a moving marker; resolves with the number of good strikes. */
export function runForge(modal: HTMLElement, done: (good: number) => void): void {
  modal.innerHTML = `
    <div class="dialog minigame">
      <div class="speaker"><span class="ico">🔨</span><b>The Forge</b></div>
      <p>Strike when the marker is in the <b class="hot">glowing zone</b>. Three strikes.</p>
      <div class="meter"><div class="zone"></div><div class="marker"></div></div>
      <div class="strikes"><span>·</span><span>·</span><span>·</span></div>
      <button class="btn gold strike">🔨 Strike!</button>
    </div>`;
  const marker = $(modal, '.marker');
  const zone = $(modal, '.meter .zone');
  const strikes = modal.querySelectorAll('.strikes span');
  let zoneStart = 0.35 + Math.random() * 0.3;
  const zoneW = 0.18;
  zone.style.left = `${zoneStart * 100}%`;
  zone.style.width = `${zoneW * 100}%`;
  let t = 0;
  let dir = 1;
  let speed = 1.1;
  let n = 0;
  let good = 0;
  let raf = 0;
  let last = performance.now();
  const tick = (now: number) => {
    const dt = (now - last) / 1000;
    last = now;
    t += dir * speed * dt;
    if (t > 1) {
      t = 1;
      dir = -1;
    } else if (t < 0) {
      t = 0;
      dir = 1;
    }
    marker.style.left = `${t * 100}%`;
    if (marker.isConnected) raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  $(modal, '.strike').addEventListener('click', () => {
    if (n >= 3) return;
    const hit = t >= zoneStart && t <= zoneStart + zoneW;
    strikes[n].textContent = hit ? '✦' : '✕';
    strikes[n].className = hit ? 'hit' : 'miss';
    if (hit) good++;
    n++;
    speed += 0.35;
    zoneStart = 0.15 + Math.random() * 0.65;
    zone.style.left = `${zoneStart * 100}%`;
    if (n >= 3) {
      cancelAnimationFrame(raf);
      setTimeout(() => done(good), 450);
    }
  });
}

/** Fishing: wait for the bite, then reel in within 900 ms. */
export function runFishing(modal: HTMLElement, done: (ok: boolean) => void): void {
  modal.innerHTML = `
    <div class="dialog minigame">
      <div class="speaker"><span class="ico">🎣</span><b>Fishing</b></div>
      <p class="fish-msg">Waiting for a bite...</p>
      <div class="pond"><span class="bob">🔴</span></div>
      <button class="btn gold reel">Reel in!</button>
    </div>`;
  const msg = $(modal, '.fish-msg');
  const bob = $(modal, '.bob');
  let biting = false;
  let finished = false;
  const finish = (ok: boolean, text: string) => {
    if (finished) return;
    finished = true;
    msg.textContent = text;
    setTimeout(() => done(ok), 700);
  };
  const biteAt = 1200 + Math.random() * 2600;
  const t1 = setTimeout(() => {
    biting = true;
    bob.classList.add('bite');
    msg.textContent = '❗ Something bites! Reel in!';
    setTimeout(() => {
      if (biting && !finished) finish(false, 'It got away...');
    }, 900);
  }, biteAt);
  $(modal, '.reel').addEventListener('click', () => {
    if (biting) finish(true, '🐟 Caught one!');
    else {
      clearTimeout(t1);
      finish(false, 'Too early — the fish swam off.');
    }
  });
}
