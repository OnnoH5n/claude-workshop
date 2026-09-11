import type { RepoSummary } from '../../shared/types.ts';
import { el } from './dom.ts';

export type FilterState = {
  team: string;
  tier: string;
  gate: string;
  support: string;
  query: string;
};

export const EMPTY_FILTERS: FilterState = { team: 'all', tier: 'all', gate: 'all', support: 'all', query: '' };

export function applyFilters(repos: RepoSummary[], f: FilterState): RepoSummary[] {
  const query = f.query.trim().toLowerCase();
  return repos.filter((r) =>
    (f.team === 'all' || r.team === f.team) &&
    (f.tier === 'all' || r.tier === f.tier) &&
    (f.gate === 'all' || r.sonar.gate === f.gate) &&
    (f.support === 'all' || r.analysis.springBootSupport === f.support) &&
    (query === '' || r.name.includes(query) || r.team.toLowerCase().includes(query)));
}

function select(
  label: string, name: string, value: string,
  options: Array<[string, string]>, onChange: (v: string) => void,
): HTMLElement {
  const field = el('select', { name, 'data-testid': `filter-${name}` }, options.map(([v, text]) => {
    const option = el('option', { value: v, text });
    if (v === value) option.selected = true;
    return option;
  }));
  field.addEventListener('change', () => onChange(field.value));
  return el('label', {}, [el('span', { text: label }), field]);
}

/** ONE filter row above everything it scopes — never per-chart filters. */
export function filters(
  repos: RepoSummary[], state: FilterState, shown: number,
  onChange: (next: FilterState) => void,
): HTMLElement {
  const teams = [...new Set(repos.map((r) => r.team))].sort();
  const set = (patch: Partial<FilterState>): void => onChange({ ...state, ...patch });

  const search = el('input', {
    type: 'search', name: 'query', placeholder: 'Filter by name or team',
    value: state.query, 'aria-label': 'Filter by name or team', 'data-testid': 'filter-query',
  });
  search.addEventListener('input', () => set({ query: search.value }));

  return el('div', { class: 'filters', role: 'search' }, [
    select('Team', 'team', state.team, [['all', 'All teams'], ...teams.map((t) => [t, t] as [string, string])], (team) => set({ team })),
    select('Criticality', 'tier', state.tier, [
      ['all', 'All tiers'], ['tier-1', 'Tier 1'], ['tier-2', 'Tier 2'], ['tier-3', 'Tier 3'],
    ], (tier) => set({ tier })),
    select('Quality gate', 'gate', state.gate, [
      ['all', 'Any gate'], ['passed', 'Passed'], ['warn', 'Warning'], ['failed', 'Failed'],
    ], (gate) => set({ gate })),
    select('Spring Boot', 'support', state.support, [
      ['all', 'Any version'], ['supported', 'Supported'], ['oss-ended', 'OSS support ended'], ['eol', 'End of life'],
    ], (support) => set({ support })),
    el('label', {}, [el('span', { text: 'Search' }), search]),
    el('span', { class: 'filters__count', 'data-testid': 'shown-count', text: `${shown} of ${repos.length} repositories` }),
  ]);
}
