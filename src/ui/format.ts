import type { RiskBand, Severity, SonarGate, SupportState } from '../../shared/types.ts';

/** Status role a value maps onto. Drives chip colour AND its icon + label. */
export type StatusRole = 'good' | 'warning' | 'serious' | 'critical';

export const GATE_STATUS: Record<SonarGate, { role: StatusRole; icon: string; label: string }> = {
  passed: { role: 'good', icon: '✓', label: 'Gate passed' },
  warn: { role: 'warning', icon: '!', label: 'Gate warning' },
  failed: { role: 'critical', icon: '✕', label: 'Gate failed' },
};

export const SUPPORT_STATUS: Record<SupportState, { role: StatusRole; icon: string; label: string }> = {
  supported: { role: 'good', icon: '✓', label: 'Supported' },
  'oss-ended': { role: 'warning', icon: '!', label: 'OSS support ended' },
  eol: { role: 'critical', icon: '✕', label: 'End of life' },
};

export const BAND_STATUS: Record<RiskBand, { role: StatusRole; icon: string; label: string }> = {
  low: { role: 'good', icon: '✓', label: 'Low' },
  elevated: { role: 'warning', icon: '!', label: 'Elevated' },
  high: { role: 'serious', icon: '▲', label: 'High' },
  critical: { role: 'critical', icon: '✕', label: 'Critical' },
};

export const SEVERITY_STATUS: Record<Severity, { role: StatusRole; icon: string; label: string }> = {
  critical: { role: 'critical', icon: '✕', label: 'Critical' },
  serious: { role: 'serious', icon: '▲', label: 'Serious' },
  moderate: { role: 'warning', icon: '!', label: 'Moderate' },
  low: { role: 'good', icon: '·', label: 'Low' },
};

export const num = (n: number): string => n.toLocaleString('en-GB');
export const pct = (n: number): string => `${Math.round(n)}%`;
export const kloc = (n: number): string => `${Math.round(n / 1000)}k`;
export const days = (n: number): string => (n === 0 ? 'today' : n === 1 ? '1 day ago' : `${n} days ago`);
