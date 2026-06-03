// Hash-based view router for the tabbed portfolio.
//
// Toggles the active `[data-view]` container, syncs the nav pill highlight, and
// resolves project anchors (#bot-trading, …) — which live inside the Projets
// view — to that view plus a scroll to the section.

const VIEWS = ['about', 'cv', 'projets', 'repos', 'blog'] as const;
type ViewName = (typeof VIEWS)[number];

// Project section ids rendered inside the Projets view. Jumping to one (from a
// galaxy star or a legend button) activates Projets and scrolls to it.
const PROJECT_ANCHORS = new Set([
  'bot-trading',
  'journal-sport',
  'tumor-detection',
  'command-voice',
]);

function isView(id: string): id is ViewName {
  return (VIEWS as readonly string[]).includes(id);
}

type Target = { view: ViewName; scrollTo: string | null };

function resolve(hash: string): Target {
  const id = hash.replace(/^#\/?/, '');
  if (isView(id)) return { view: id, scrollTo: null };
  if (PROJECT_ANCHORS.has(id)) return { view: 'projets', scrollTo: id };
  return { view: 'about', scrollTo: null };
}

export function initRouter(): void {
  const views = Array.from(document.querySelectorAll<HTMLElement>('[data-view]'));
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('.nav__link'));
  if (views.length === 0) return;

  const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function apply(animateScroll: boolean): void {
    const { view, scrollTo } = resolve(location.hash);

    for (const el of views) el.classList.toggle('is-active', el.dataset.view === view);
    for (const a of links) a.classList.toggle('is-active', a.dataset.nav === view);

    if (scrollTo) {
      // Defer one frame so the freshly-shown view is laid out before scrolling.
      requestAnimationFrame(() => {
        const target = document.getElementById(scrollTo);
        target?.scrollIntoView({
          behavior: prefersReduced || !animateScroll ? 'auto' : 'smooth',
          block: 'start',
        });
      });
    } else {
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
  }

  window.addEventListener('hashchange', () => apply(true));
  apply(false); // resolve the initial URL (deep links land on the right view)
}
