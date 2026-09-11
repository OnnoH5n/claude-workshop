import type { RepoSummary } from '../../shared/types.ts';
import { COVERAGE_POLICY } from '../../shared/types.ts';
import { chip } from './chip.ts';
import { el } from './dom.ts';
import { BAND_STATUS, GATE_STATUS, SUPPORT_STATUS, kloc, pct } from './format.ts';

export type SortKey = 'risk' | 'coverage' | 'criticals' | 'sla' | 'name';

const COLUMNS: Array<{ key: SortKey | null; label: string; num?: boolean }> = [
  { key: 'name', label: 'Repository' },
  { key: 'risk', label: 'Risk', num: true },
  { key: null, label: 'Quality gate' },
  { key: 'coverage', label: 'Coverage', num: true },
  { key: null, label: 'Spring Boot' },
  { key: 'criticals', label: 'Criticals', num: true },
  { key: 'sla', label: 'Past SLA', num: true },
];

/** A ranked list with many meaningful classes is a table, not more colours. */
export function leaderboard(
  repos: RepoSummary[],
  state: { sort: SortKey; dir: 'asc' | 'desc'; selected: string | null },
  handlers: { onSort: (key: SortKey) => void; onSelect: (name: string) => void },
): HTMLElement {
  const head = el('tr', {}, COLUMNS.map((col) => {
    const cell = el('th', { class: col.num ? 'num' : '', text: col.label });
    if (col.key) {
      cell.setAttribute('aria-sort', state.sort === col.key
        ? (state.dir === 'desc' ? 'descending' : 'ascending') : 'none');
      cell.tabIndex = 0;
      const sort = (): void => handlers.onSort(col.key as SortKey);
      cell.addEventListener('click', sort);
      cell.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sort(); } });
    }
    return cell;
  }));

  const rows = repos.map((repo) => {
    const criticals = repo.sonatype.violations.critical + repo.checkmarx.findings.critical;
    const row = el('tr', { 'data-repo': repo.name, tabindex: '0' }, [
      el('td', {}, [
        el('div', { class: 'repo-name', text: repo.name }),
        el('div', { class: 'repo-sub', text: `${repo.team} · ${repo.tier.replace('tier-', 'Tier ')} · ${kloc(repo.loc)} LOC` }),
      ]),
      el('td', { class: 'num' }, [
        el('div', { class: 'meter' }, [
          el('span', { class: 'meter__value', text: String(repo.risk.score) }),
          el('span', { class: 'meter__track' }, [
            el('span', {
              class: 'meter__fill',
              style: `width:${repo.risk.score}%;background:var(--status-${BAND_STATUS[repo.risk.band].role})`,
            }),
          ]),
        ]),
      ]),
      el('td', {}, [chip(GATE_STATUS[repo.sonar.gate])]),
      el('td', { class: 'num' }, [
        el('span', {
          text: pct(repo.sonar.coverage),
          style: repo.sonar.coverage < COVERAGE_POLICY ? 'color:var(--status-critical)' : '',
        }),
      ]),
      el('td', {}, [chip(SUPPORT_STATUS[repo.analysis.springBootSupport], repo.analysis.springBoot)]),
      el('td', { class: 'num', text: String(criticals) }),
      el('td', { class: 'num', text: String(repo.risk.slaBreaches) }),
    ]);
    if (state.selected === repo.name) row.setAttribute('aria-selected', 'true');
    const select = (): void => handlers.onSelect(repo.name);
    row.addEventListener('click', select);
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); select(); } });
    return row;
  });

  return el('div', { class: 'table-wrap' }, [
    el('table', {}, [el('thead', {}, [head]), el('tbody', { 'data-testid': 'leaderboard-body' }, rows)]),
  ]);
}
