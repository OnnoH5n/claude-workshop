import { el, svg } from './dom.ts';
import { hideTooltip, showTooltip } from './tooltip.ts';

export type Bar = {
  key: string;
  value: number;
  /** Icon + short text under the axis label, so status never rides on colour. */
  sublabel?: { icon: string; text: string; role: string };
  /** Extra tooltip rows — the "why" behind the bar. */
  detail?: string[];
};

export type BarChartOptions = {
  bars: Bar[];
  /** Solid rule across the plot, e.g. a coverage policy floor. */
  threshold?: { value: number; label: string; axis: 'x' };
  valueSuffix?: string;
  /** Column header for the table-view twin. */
  keyHeader: string;
  valueHeader: string;
};

const W = 560;
const H = 212;
const PAD = { top: 22, right: 8, bottom: 46, left: 8 };
const GAP = 2; // Minimum surface gap between adjacent bars — never a border.
const BAR_FRACTION = 0.6; // Thin marks: saturated fills stay small, not large blocks.
const RADIUS = 4; // 4px rounded data-end, anchored to the baseline.

/** Path for a bar with only its top corners rounded, so it sits flat on the baseline. */
function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(RADIUS, w / 2, Math.max(0, h));
  if (h <= 0) return '';
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
}

export function barChart(options: BarChartOptions): { chart: SVGSVGElement; table: HTMLElement } {
  const { bars, threshold, valueSuffix = '', keyHeader, valueHeader } = options;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const max = Math.max(1, ...bars.map((b) => b.value));
  const band = plotW / bars.length;
  const barW = Math.max(6, Math.min(band - GAP, band * BAR_FRACTION));

  const root = svg('svg', {
    class: 'chart',
    viewBox: `0 0 ${W} ${H}`,
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
  });

  // Recessive hairline gridlines, solid — never dashed.
  for (let i = 1; i <= 3; i += 1) {
    const y = PAD.top + plotH - (plotH * i) / 3;
    root.append(svg('line', { class: 'tick', x1: PAD.left, y1: y, x2: W - PAD.right, y2: y }));
  }

  bars.forEach((bar, i) => {
    const h = (bar.value / max) * plotH;
    const x = PAD.left + i * band + GAP / 2;
    const y = PAD.top + plotH - h;
    const group = svg('g', { class: 'chart__group' });

    // Hit area spans the full band height and clears the 24px minimum.
    const hit = svg('rect', {
      class: 'hit', x: PAD.left + i * band, y: PAD.top, width: band, height: plotH,
      tabindex: 0, role: 'button', 'aria-label': `${bar.key}: ${bar.value}${valueSuffix}`,
    });
    const show = (event: { clientX: number; clientY: number }): void => {
      showTooltip(event.clientX, event.clientY, bar.key, [
        `${valueHeader}: ${bar.value}${valueSuffix}`, ...(bar.detail ?? []),
      ]);
    };
    hit.addEventListener('mousemove', show);
    hit.addEventListener('mouseleave', hideTooltip);
    hit.addEventListener('focus', () => {
      const box = hit.getBoundingClientRect();
      showTooltip(box.left + box.width / 2, box.top + 8, bar.key, [
        `${valueHeader}: ${bar.value}${valueSuffix}`, ...(bar.detail ?? []),
      ]);
    });
    hit.addEventListener('blur', hideTooltip);

    group.append(hit, svg('path', { class: 'bar', d: barPath(x, y, barW, h) }));

    // Direct value labels replace the y-axis entirely on a short discrete series.
    if (bar.value > 0) {
      group.append(svg('text', {
        class: 'label', x: x + barW / 2, y: y - 6, 'text-anchor': 'middle', text: `${bar.value}${valueSuffix}`,
      }));
    }
    group.append(svg('text', {
      x: x + barW / 2, y: H - PAD.bottom + 16, 'text-anchor': 'middle', text: bar.key,
    }));
    if (bar.sublabel) {
      group.append(svg('text', {
        x: x + barW / 2, y: H - PAD.bottom + 29, 'text-anchor': 'middle',
        fill: `var(--status-${bar.sublabel.role})`, 'font-size': 10,
        text: `${bar.sublabel.icon} ${bar.sublabel.text}`,
      }));
    }
    root.append(group);
  });

  root.append(svg('line', {
    class: 'axis', x1: PAD.left, y1: PAD.top + plotH, x2: W - PAD.right, y2: PAD.top + plotH,
  }));

  if (threshold) {
    const idx = bars.findIndex((b) => Number(b.key.split('–')[0]) >= threshold.value);
    const x = PAD.left + (idx < 0 ? bars.length : idx) * band;
    root.append(
      svg('line', { class: 'threshold', x1: x, y1: PAD.top - 6, x2: x, y2: PAD.top + plotH }),
      svg('text', { class: 'threshold-text', x: x + 4, y: PAD.top - 10, text: threshold.label }),
    );
  }

  // Table-view twin: the WCAG-clean equivalent of the same data.
  const table = el('div', { class: 'table-wrap' }, [
    el('table', {}, [
      el('thead', {}, [el('tr', {}, [
        el('th', { text: keyHeader }), el('th', { class: 'num', text: valueHeader }),
      ])]),
      el('tbody', {}, bars.map((b) => el('tr', {}, [
        el('td', { text: b.key }),
        el('td', { class: 'num', text: `${b.value}${valueSuffix}` }),
      ]))),
    ]),
  ]);

  return { chart: root, table };
}
