/**
 * Scrolling logo strip — companies Jean-Raphaël has worked with.
 *
 * Each logo has a `treatment` flag that drives the CSS class used to
 * normalise it against the dark/cobalt/solar palette:
 *   • 'invert-alpha' : transparent PNG with dark elements
 *                      → brightness(0) invert(1) gives a pure white silhouette
 *   • 'screen'       : JPG with a dark background and light logo
 *                      → mix-blend-mode: screen drops the background
 *   • 'invert-mono'  : JPG with white background and dark/colored elements
 *                      → invert + grayscale gives a clean mono silhouette
 */

type LogoTreatment = 'native';

type Logo = {
  src: string;
  name: string;
  treatment: LogoTreatment;
};

const LOGOS: Logo[] = [
  { src: '/logos/thales.png',         name: 'Thales',          treatment: 'native' },
  { src: '/logos/norsys.png',         name: 'Norsys',          treatment: 'native' },
  { src: '/logos/dibsteur.jpg',       name: 'Dibsteur',        treatment: 'native' },
  { src: '/logos/dronedeschamps.png', name: 'Drone DesChamps', treatment: 'native' },
];

function renderLogo(logo: Logo): string {
  const slug = logo.src
    .replace(/^\/logos\//, '')
    .replace(/\.[a-z]+$/, '');
  return `
    <span class="ticker__item ticker__item--logo" title="${logo.name}">
      <img
        class="ticker__logo ticker__logo--${logo.treatment} ticker__logo--${slug}"
        src="${logo.src}"
        alt="${logo.name}"
        loading="eager"
        decoding="async"
        draggable="false"
      />
    </span>
    <span class="ticker__sep" aria-hidden="true">◇</span>
  `;
}

export function initTicker(el: HTMLElement): void {
  // 4 copies so the seamless loop (CSS translateX(-25%)) always has
  // enough content to cover any viewport, even when zoomed in.
  const items = [...LOGOS, ...LOGOS, ...LOGOS, ...LOGOS]
    .map(renderLogo)
    .join('');
  el.innerHTML = items;
}
