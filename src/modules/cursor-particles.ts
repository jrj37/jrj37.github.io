/**
 * Nébuleuse au curseur — trainée fluide de fumée colorée dans la palette du
 * site (cobalt → pourpre → magenta → solar, le même chemin que --grad-aurora).
 *
 * Stratégie : un canvas demi-résolution, accumulé en feedback (fondu lent par
 * destination-out), des puffs déplacés dans un champ de turbulence pseudo-curl
 * pour le mouvement vraiment fluide, puis blur + saturate en CSS pour le grain
 * vaporeux. La boucle rAF s'endort dès qu'il ne reste plus rien à dessiner.
 *
 * Désactivé sur écrans tactiles et prefers-reduced-motion.
 */

type Puff = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  decay: number;
  radius: number;
  color: readonly [number, number, number];
};

// Palette indexée sur --grad-aurora, légèrement éclaircie pour rester vive
// sous le 'lighter' composite (qui tend à délaver les tons sombres).
const PALETTE: ReadonlyArray<readonly [number, number, number]> = [
  [58, 163, 220],   // cobalt vif
  [120, 75, 180],   // pourpre profond
  [185, 65, 130],   // magenta vineux
  [232, 80, 60],    // solar vif
];

// Le canvas est rendu en demi-résolution et adouci par CSS blur ; ça divise
// le coût de remplissage par ~4 et améliore en prime le rendu vaporeux.
const SCALE = 0.5;

export function initCursorParticles(canvas: HTMLCanvasElement): void {
  if (typeof window === 'undefined') return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!window.matchMedia('(pointer: fine)').matches) return;

  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;

  let bufWidth = 0;
  let bufHeight = 0;

  const resize = (): void => {
    const cssW = window.innerWidth;
    const cssH = window.innerHeight;
    bufWidth = Math.max(1, Math.floor(cssW * SCALE));
    bufHeight = Math.max(1, Math.floor(cssH * SCALE));
    canvas.width = bufWidth;
    canvas.height = bufHeight;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
  };
  resize();
  window.addEventListener('resize', resize, { passive: true });

  const puffs: Puff[] = [];
  let lastX = -1;
  let lastY = -1;
  let lastEmit = 0;
  let rafId = 0;
  let running = false;

  const emit = (cx: number, cy: number, dx: number, dy: number): void => {
    const speed = Math.hypot(dx, dy);
    const count = Math.min(2, 1 + Math.floor(speed / 30));

    for (let i = 0; i < count; i++) {
      // Vitesse perpendiculaire au déplacement = étalement latéral du nuage.
      const perpX = -dy;
      const perpY = dx;
      const perpMag = Math.hypot(perpX, perpY) || 1;
      const sideways = (Math.random() - 0.5) * 0.35;

      puffs.push({
        x: cx + (Math.random() - 0.5) * 6,
        y: cy + (Math.random() - 0.5) * 6,
        vx: dx * 0.04 + (perpX / perpMag) * sideways,
        vy: dy * 0.04 + (perpY / perpMag) * sideways,
        life: 1,
        decay: 0.025 + Math.random() * 0.015,   // ~0.4 – 0.7 s
        radius: 5 + Math.random() * 8,
        color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
      });
    }
  };

  const tick = (): void => {
    // Fondu cumulatif : on retire de l'alpha au calque précédent pour
    // laisser une trainée qui s'estompe au lieu de tout effacer.
    ctx.globalCompositeOperation = 'destination-out';
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(0, 0, bufWidth, bufHeight);

    if (puffs.length === 0) {
      ctx.clearRect(0, 0, bufWidth, bufHeight);
      running = false;
      return;
    }

    // source-over (au lieu de 'lighter') : les puffs s'alpha-blendent au
    // lieu de s'additionner, donc les superpositions ne tirent plus vers
    // le blanc — elles gardent leurs teintes.
    ctx.globalCompositeOperation = 'source-over';
    const t = performance.now();

    for (let i = puffs.length - 1; i >= 0; i--) {
      const p = puffs[i];

      // Pseudo-curl à coût ridicule — deux sin/cos décalés donnent un champ
      // tourbillonnaire suffisamment cohérent pour évoquer un fluide.
      const cx = Math.sin(p.y * 0.022 + t * 0.0005) - Math.cos(p.x * 0.018 - t * 0.0007);
      const cy = Math.cos(p.x * 0.022 - t * 0.0005) - Math.sin(p.y * 0.018 + t * 0.0007);

      p.vx = p.vx * 0.94 + cx * 0.05;
      p.vy = p.vy * 0.94 + cy * 0.05 - 0.008;  // léger biais vers le haut
      p.x += p.vx;
      p.y += p.vy;
      p.life -= p.decay;
      p.radius += 0.08;

      if (p.life <= 0 || p.x < -80 || p.x > bufWidth + 80 || p.y < -80 || p.y > bufHeight + 80) {
        puffs.splice(i, 1);
        continue;
      }

      const [r, g, b] = p.color;
      const alpha = p.life * 0.22;
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius);
      grad.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
      grad.addColorStop(0.45, `rgba(${r},${g},${b},${alpha * 0.45})`);
      grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = grad;
      ctx.fillRect(p.x - p.radius, p.y - p.radius, p.radius * 2, p.radius * 2);
    }

    ctx.globalCompositeOperation = 'source-over';
    rafId = requestAnimationFrame(tick);
  };

  const ensureRunning = (): void => {
    if (running) return;
    running = true;
    rafId = requestAnimationFrame(tick);
  };

  window.addEventListener(
    'pointermove',
    (ev) => {
      if (ev.pointerType !== 'mouse' && ev.pointerType !== 'pen') return;
      const now = performance.now();
      if (now - lastEmit < 16) return;
      lastEmit = now;

      const x = ev.clientX * SCALE;
      const y = ev.clientY * SCALE;
      const dx = lastX < 0 ? 0 : x - lastX;
      const dy = lastY < 0 ? 0 : y - lastY;

      emit(x, y, dx, dy);
      lastX = x;
      lastY = y;
      ensureRunning();
    },
    { passive: true },
  );

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(rafId);
      running = false;
      puffs.length = 0;
      ctx.clearRect(0, 0, bufWidth, bufHeight);
    }
  });
}
