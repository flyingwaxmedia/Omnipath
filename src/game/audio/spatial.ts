// Stereo pan and distance attenuation from a world position relative to the camera view (pure).
// The listener is the camera centre (it follows the player). Pan stays inside ±PAN_WIDTH: phone speakers sit close
// together and hard-panned hits sound thin; iPads get a gentle stereo field.

export interface View {
  /** Camera centre (world px). */
  cx: number;
  cy: number;
  /** Half the visible width / height (world px). */
  halfW: number;
  halfH: number;
}

export const PAN_WIDTH = 0.7;
/** Below this gain a sound is not worth a voice (far off-screen). */
export const MIN_SPATIAL_GAIN = 0.05;

export interface Spatial {
  pan: number;
  gain: number;
}

/** Pan from the horizontal offset; full volume on screen, fading out to silence ~1.6 views beyond the edge. */
export function spatialize(x: number, y: number, v: View): Spatial {
  const hw = Math.max(1, v.halfW);
  const hh = Math.max(1, v.halfH);
  const dx = x - v.cx;
  const dy = y - v.cy;
  const pan = Math.max(-1, Math.min(1, dx / (hw * 1.15))) * PAN_WIDTH;
  // Normalised distance: 1 = the edge of the view (an ellipse matching the screen's aspect).
  const nd = Math.hypot(dx / hw, dy / hh);
  const k = nd <= 1 ? 1 : Math.max(0, 1 - (nd - 1) / 1.6);
  return { pan: Number.isFinite(pan) ? pan : 0, gain: Number.isFinite(k) ? k * k : 0 };
}
