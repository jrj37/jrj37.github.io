export function initClock(el: HTMLElement): void {
  const update = (): void => {
    const now = new Date();
    const h = now.getHours().toString().padStart(2, '0');
    const m = now.getMinutes().toString().padStart(2, '0');
    const s = now.getSeconds().toString().padStart(2, '0');
    el.textContent = `${h}:${m}:${s}`;
  };
  update();
  setInterval(update, 1000);
}
