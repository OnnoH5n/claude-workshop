import { svg } from './dom.ts';

/** 2px line, no axes — context for a stat tile's value, not a readable chart. */
export function sparkline(values: number[], width = 72, height = 22): SVGSVGElement {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const points = values
    .map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`)
    .join(' ');

  const root = svg('svg', { class: 'spark', width, height, viewBox: `0 0 ${width} ${height}`, 'aria-hidden': 'true' });
  root.append(
    svg('polyline', {
      points,
      fill: 'none',
      stroke: 'var(--series-1)',
      'stroke-width': 2,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    }),
  );
  return root;
}
