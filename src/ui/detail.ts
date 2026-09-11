import type { Repo, Severity } from '../../shared/types.ts';
import { SLA_DAYS } from '../../shared/types.ts';
import { chip } from './chip.ts';
import { el } from './dom.ts';
import { BAND_STATUS, GATE_STATUS, SEVERITY_STATUS, SUPPORT_STATUS, days, num, pct } from './format.ts';
import { sparkline } from './sparkline.ts';

const SEVERITIES: Severity[] = ['critical', 'serious', 'moderate', 'low'];

function card(name: string, scanDaysAgo: number, rows: Array<[string, string | Node]>): HTMLElement {
  const list = el('dl');
  for (const [term, value] of rows) {
    list.append(el('dt', { text: term }));
    list.append(el('dd', {}, [typeof value === 'string' ? document.createTextNode(value) : value]));
  }
  return el('div', { class: 'tool' }, [
    el('h4', { class: 'tool__name', text: name }),
    list,
    el('p', {
      class: 'card__sub',
      style: 'margin:0.625rem 0 0',
      text: `Last scan ${days(scanDaysAgo)}${scanDaysAgo > 30 ? ' — stale' : ''}`,
    }),
  ]);
}

/** Severity rows carry an icon + label, so the status colour never stands alone. */
function severityRows(counts: Record<Severity, number>, ages: Record<Severity, number>): Array<[string, Node]> {
  return SEVERITIES.map((sev) => {
    const breached = counts[sev] > 0 && ages[sev] > SLA_DAYS[sev];
    return [
      SEVERITY_STATUS[sev].label,
      el('span', {}, [
        document.createTextNode(String(counts[sev])),
        ...(breached
          ? [el('span', { style: 'color:var(--status-critical)', text: ` · ${ages[sev]}d, past SLA` })]
          : []),
      ]),
    ] as [string, Node];
  });
}

export function detail(repo: Repo): HTMLElement {
  const { sonar, checkmarx, sonatype, analysis, risk } = repo;

  return el('section', { class: 'card detail', 'data-testid': 'detail' }, [
    el('div', { class: 'card__head' }, [
      el('h3', { class: 'card__title', text: repo.name }),
      chip(BAND_STATUS[risk.band], `risk ${risk.score}`),
      el('span', { class: 'card__spacer' }),
      el('span', { class: 'head__meta', text: `${repo.domain} · ${repo.team}` }),
    ]),
    el('p', { class: 'card__sub', text: `${num(repo.loc)} lines · ${analysis.buildTool} · Java ${analysis.java}${analysis.javaLts ? ' (LTS)' : ' (non-LTS)'} · last commit ${days(analysis.lastCommitDaysAgo)}` }),

    el('div', { class: 'detail__grid' }, [
      card('SonarQube', sonar.lastScanDaysAgo, [
        ['Quality gate', chip(GATE_STATUS[sonar.gate])],
        ['Coverage', pct(sonar.coverage)],
        ['Coverage on new code', pct(sonar.newCodeCoverage)],
        ['Duplication', `${sonar.duplication}%`],
        ['Bugs', num(sonar.bugs)],
        ['Vulnerabilities', num(sonar.vulnerabilities)],
        ['Code smells', num(sonar.codeSmells)],
        ['Technical debt', `${sonar.techDebtDays} d`],
        ['Ratings (M/R/S)', `${sonar.maintainability} / ${sonar.reliability} / ${sonar.security}`],
      ]),
      card('Checkmarx (SAST)', checkmarx.lastScanDaysAgo, [
        ...severityRows(checkmarx.findings, checkmarx.oldestDays),
        ['Top category', checkmarx.topCategories[0]?.name ?? '—'],
      ]),
      card('Sonatype Lifecycle (SCA)', sonatype.lastScanDaysAgo, [
        ...severityRows(sonatype.violations, sonatype.oldestDays),
        ['Components', num(sonatype.components)],
        ['Licence violations', String(sonatype.licenceViolations)],
        ['Waived', String(sonatype.waived)],
        ['Worst CVE', sonatype.worstCve ? `${sonatype.worstCve.id} (CVSS ${sonatype.worstCve.cvss})` : '—'],
        ['In component', sonatype.worstCve?.component ?? '—'],
      ]),
      card('Repository analysis', analysis.lastCommitDaysAgo, [
        ['Spring Boot', chip(SUPPORT_STATUS[analysis.springBootSupport], analysis.springBoot)],
        ['Minors behind', String(analysis.springBootBehind)],
        ['CODEOWNERS', analysis.hasCodeowners ? 'present' : 'missing'],
        ['README', analysis.hasReadme ? 'present' : 'missing'],
        ['Dockerfile', analysis.hasDockerfile ? 'present' : 'missing'],
        ['Test/source ratio', analysis.testRatio.toFixed(2)],
        ['TODO/FIXME', String(analysis.todoCount)],
      ]),
    ]),

    el('h4', { class: 'tool__name', style: 'margin:1.25rem 0 0.25rem', text: 'Why this score' }),
    el('ol', { class: 'drivers', 'data-testid': 'drivers' },
      risk.drivers.map((d) => el('li', { text: d }))),

    el('div', { class: 'legend', style: 'margin-top:1rem' }, [
      el('span', { class: 'legend__item' }, [
        document.createTextNode('Coverage, last 12 weeks'), sparkline(repo.history.map((h) => h.coverage), 120, 26),
      ]),
    ]),
  ]);
}
