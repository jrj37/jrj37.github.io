/**
 * Renders a synthetic price chart + 50-period moving average.
 * Mirrors the kind of view served by the bot_trading dashboard
 * (Yahoo Finance close + MM50). Deterministic so the visual is identical
 * across reloads.
 */

type CurvePoints = {
  line: string;
  area: string;
  ma: string;
  end: { x: number; y: number };
};

const WIDTH = 600;
const HEIGHT = 220;
const N_POINTS = 160;
const PAD_Y = 18;
const MA_WINDOW = 24;

function generatePoints(seed = 11): CurvePoints {
  let state = seed;
  const rand = (): number => {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280;
  };

  // Biased random walk with occasional dips — feels more like a real
  // index close than a clean upward sweep.
  const values: number[] = [];
  let v = 100;
  for (let i = 0; i < N_POINTS; i++) {
    const drift = 0.22;
    const vol = 1.9;
    v += drift + (rand() - 0.5) * vol;
    if (i > 0 && i % 14 === 0) v -= rand() * 4;
    if (i > 0 && i % 47 === 0) v -= rand() * 6 + 2;
    values.push(v);
  }

  // Trailing simple moving average — first MA_WINDOW points use the
  // window-so-far so the dashed line starts with the price.
  const ma: number[] = values.map((_, i) => {
    const start = Math.max(0, i - MA_WINDOW + 1);
    const slice = values.slice(start, i + 1);
    return slice.reduce((s, x) => s + x, 0) / slice.length;
  });

  const allVals = [...values, ...ma];
  const min = Math.min(...allVals);
  const max = Math.max(...allVals);
  const range = max - min || 1;

  const project = (val: number, i: number): { x: number; y: number } => ({
    x: (i / (N_POINTS - 1)) * WIDTH,
    y: HEIGHT - PAD_Y - ((val - min) / range) * (HEIGHT - PAD_Y * 2),
  });

  const points = values.map(project);
  const maPoints = ma.map(project);

  const toPath = (pts: { x: number; y: number }[]): string =>
    pts
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
      .join(' ');

  const line = toPath(points);
  const maLine = toPath(maPoints);
  const area = `${line} L${WIDTH} ${HEIGHT} L0 ${HEIGHT} Z`;

  return { line, area, ma: maLine, end: points[points.length - 1] };
}

export function initEquityCurve(svg: SVGSVGElement): void {
  const line = svg.querySelector<SVGPathElement>('#curve-line');
  const area = svg.querySelector<SVGPathElement>('#curve-area');
  const maLine = svg.querySelector<SVGPathElement>('#curve-ma');
  const dot = svg.querySelector<SVGCircleElement>('#curve-dot');
  if (!line || !area || !dot) return;

  const { line: lineD, area: areaD, ma: maD, end } = generatePoints();

  line.setAttribute('d', lineD);
  area.setAttribute('d', areaD);
  if (maLine) maLine.setAttribute('d', maD);
  dot.setAttribute('cx', end.x.toString());
  dot.setAttribute('cy', end.y.toString());

  const length = line.getTotalLength();
  line.style.strokeDasharray = `${length}`;
  line.style.strokeDashoffset = `${length}`;
  line.getBoundingClientRect();
  line.style.transition = 'stroke-dashoffset 2.4s cubic-bezier(0.4, 0, 0.2, 1) 0.6s';
  line.style.strokeDashoffset = '0';

  if (maLine) {
    const maLength = maLine.getTotalLength();
    maLine.style.strokeDasharray = `${maLength}`;
    maLine.style.strokeDashoffset = `${maLength}`;
    maLine.getBoundingClientRect();
    maLine.style.transition = 'stroke-dashoffset 2.8s cubic-bezier(0.4, 0, 0.2, 1) 1s';
    maLine.style.strokeDashoffset = '0';
  }
}
