import { el } from './dom.ts';

// One shared tooltip node. Tooltips ENHANCE — every value is also directly labelled
// or reachable in the table view, never tooltip-gated.
const node = el('div', { class: 'tooltip', role: 'tooltip', hidden: '' });
document.body.append(node);

export function showTooltip(x: number, y: number, title: string, rows: string[]): void {
  node.replaceChildren(
    el('div', { class: 'tooltip__title', text: title }),
    ...rows.map((row) => el('div', { class: 'tooltip__row', text: row })),
  );
  node.hidden = false;
  const box = node.getBoundingClientRect();
  const left = Math.min(Math.max(8, x - box.width / 2), window.innerWidth - box.width - 8);
  const top = y - box.height - 12 < 8 ? y + 16 : y - box.height - 12;
  node.style.left = `${left}px`;
  node.style.top = `${top}px`;
}

export function hideTooltip(): void {
  node.hidden = true;
}
