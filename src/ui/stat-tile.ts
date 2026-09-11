import { el } from './dom.ts';
import { sparkline } from './sparkline.ts';

export type Tile = {
  label: string;
  value: string;
  /** Change vs the start of the trend window, already worded (e.g. "+4 pts vs 12w ago"). */
  delta?: { text: string; dir: 'good' | 'bad' | 'flat' };
  trend?: number[];
};

/** A handful of headline numbers → a KPI row of stat tiles, not a grouped bar chart. */
export function statTile({ label, value, delta, trend }: Tile): HTMLElement {
  const foot = el('div', { class: 'tile__foot' });
  if (delta) foot.append(el('span', { class: 'tile__delta', 'data-dir': delta.dir, text: delta.text }));
  if (trend && trend.length > 1) foot.append(sparkline(trend));

  return el('div', { class: 'tile' }, [
    el('div', { class: 'tile__label', text: label }),
    el('div', { class: 'tile__value', text: value }),
    foot,
  ]);
}
