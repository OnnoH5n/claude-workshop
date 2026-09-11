// The ONLY place fetch() appears. One choke point for logging, retries, or mocking
// if the demo needs to survive a flaky network.
import type { PortfolioResponse, RepoResponse } from '../shared/types.ts';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    throw new Error(`${init?.method ?? 'GET'} ${path} → ${response.status}: ${await response.text()}`);
  }
  return (await response.json()) as T;
}

export function getPortfolio(): Promise<PortfolioResponse> {
  return request<PortfolioResponse>('/api/portfolio');
}

export function getRepo(name: string): Promise<RepoResponse> {
  return request<RepoResponse>(`/api/repos/${encodeURIComponent(name)}`);
}
