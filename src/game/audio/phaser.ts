// Phaser's own sound manager is never used (every sound lives in src/game/audio), but by default Phaser opens a
// second AudioContext when the game is constructed — outside any user gesture — and keeps it running once its
// unlock handlers fire: the audio hardware then stays awake while the engine has suspended its own context (hidden /
// muted / idle), costing battery on phones. This swaps it for Phaser's no-audio manager before any scene boots.
// (The render lane can make this a no-op by setting `audio: { noAudio: true }` in the game config.)
import Phaser from 'phaser';

/** Closes Phaser's unused WebAudio context and installs the no-audio manager. Returns true when it did. */
export function retirePhaserSound(game: Phaser.Game | undefined): boolean {
  const sm = game?.sound;
  if (!game || !sm || !(sm instanceof Phaser.Sound.WebAudioSoundManager)) return false;
  // A context handed in through the config, or sounds already added: not ours to close.
  if (game.config.audio?.context || sm.getAllPlaying().length || (sm as unknown as { sounds?: unknown[] }).sounds?.length) return false;
  try {
    // BaseSoundManager registers destroy() once on the game's DESTROY and never removes it: a second destroy on
    // game.destroy() would throw on the already-released nodes.
    game.events.off(Phaser.Core.Events.DESTROY, sm.destroy, sm);
    sm.destroy();
  } catch (error) {
    console.warn('[omnipath] could not retire Phaser sound:', error);
    return false;
  }
  const none = new Phaser.Sound.NoAudioSoundManager(game);
  game.sound = none;
  // Scenes already booted keep a reference to the manager they were given.
  for (const scene of game.scene?.scenes ?? []) {
    const sys = scene.sys as unknown as { sound?: unknown };
    if (sys.sound === sm) sys.sound = none;
    if ((scene as unknown as { sound?: unknown }).sound === sm) (scene as unknown as { sound: unknown }).sound = none;
  }
  return true;
}
