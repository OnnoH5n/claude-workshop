import { el } from './dom.ts';
import type { StatusRole } from './format.ts';

/**
 * Status chip. The status palette's red↔green pair measures ΔE 4.1 under
 * deuteranopia, so colour never carries the meaning: every chip ships a dot, an
 * icon AND the text label.
 */
export function chip(status: { role: StatusRole; icon: string; label: string }, suffix = ''): HTMLElement {
  return el('span', { class: 'chip', 'data-status': status.role }, [
    el('span', { class: 'chip__dot', 'aria-hidden': 'true' }),
    el('span', { class: 'chip__icon', 'aria-hidden': 'true', text: status.icon }),
    el('span', { text: suffix ? `${status.label} · ${suffix}` : status.label }),
  ]);
}
