import './style.css';
import { initTicker } from './modules/ticker';
import { initClock } from './modules/clock';
import { initEquityCurve } from './modules/equity-curve';
import { initCloud, type CloudMarker } from './modules/cloud';
import { initCursorParticles } from './modules/cursor-particles';

// Positions chosen to sit on the two logarithmic spiral arms (N_ARMS = 2,
// ARM_TIGHTNESS = 0.55 in cloud.ts). For arm 0: theta = log(r) / 0.52.
// For arm 1: same + π. Each marker picks a distinct (r, arm) so they read
// as separate clusters in 3D regardless of rotation.
const PROJECT_MARKERS: CloudMarker[] = [
  {
    // arm 0, r ≈ 0.65 — front of the galaxy
    pos: { x: 0.44, y: 0.02, z: -0.48 },
    color: '#d14836',
    rgb: [209, 72, 54],
    label: 'BOT TRADING',
    href: '#bot-trading',
  },
  {
    // arm 1, r ≈ 0.50 — opposite side, slightly forward in y
    pos: { x: -0.12, y: -0.04, z: 0.49 },
    color: '#5dd3a1',
    rgb: [93, 211, 161],
    label: 'JOURNAL SPORT',
    href: '#journal-sport',
  },
  {
    // arm 1 outer, r ≈ 0.80 — back of the galaxy
    pos: { x: -0.73, y: 0.05, z: 0.34 },
    color: '#4a9bc9',
    rgb: [74, 155, 201],
    label: 'TUMOR DETECTION',
    href: '#tumor-detection',
  },
  {
    // arm 0 inner, r ≈ 0.35 — close to the core, opposite of bot trading
    pos: { x: -0.12, y: -0.03, z: -0.33 },
    color: '#8b5cf6',
    rgb: [139, 92, 246],
    label: 'COMMAND VOICE',
    href: '#command-voice',
  },
];

function boot(): void {
  const tickerEl = document.getElementById('ticker-track');
  if (tickerEl) initTicker(tickerEl);

  const clockEl = document.getElementById('clock');
  if (clockEl) initClock(clockEl);

  const cloudEl = document.getElementById('cloud-canvas');
  if (cloudEl instanceof HTMLCanvasElement) initCloud(cloudEl, PROJECT_MARKERS);

  const curveEl = document.getElementById('equity-curve');
  if (curveEl instanceof SVGSVGElement) initEquityCurve(curveEl);

  const fxEl = document.getElementById('cursor-fx');
  if (fxEl instanceof HTMLCanvasElement) initCursorParticles(fxEl);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
