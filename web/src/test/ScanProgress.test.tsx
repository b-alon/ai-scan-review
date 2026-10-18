import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScanProgress } from '../components/ScanProgress';
import type { ScanView } from '../types';

const view = {
  id: '1',
  repoOwner: 'o',
  repoName: 'r',
  commitSha: 'abcdef1234567',
  status: 'running',
  stage: 'code',
  progressPct: 70,
  progressMessage: 'Scanned 120 files',
  attempts: 1,
  maxAttempts: 3,
  error: null,
  startedAt: '2026-10-18T12:00:00Z',
  createdAt: '2026-10-18T12:00:00Z',
  events: [
    { stage: 'fetching', message: 'Scan started', createdAt: '2026-10-18T12:00:00Z' },
    { stage: 'dependencies', message: 'Checked 50 packages', createdAt: '2026-10-18T12:00:03Z' },
    { stage: 'code', message: 'Scanned 120 files', createdAt: '2026-10-18T12:00:05Z' },
  ],
} as unknown as ScanView;

describe('ScanProgress', () => {
  it('shows the active step, the message and completed steps', () => {
    render(
      <MantineProvider>
        <ScanProgress view={view} />
      </MantineProvider>,
    );
    expect(screen.getAllByText('Scanned 120 files').length).toBeGreaterThan(0);
    expect(screen.getByText('Checked 50 packages')).toBeInTheDocument();
    expect(screen.getByText('Code')).toBeInTheDocument();
  });

  it('explains a retry', () => {
    render(
      <MantineProvider>
        <ScanProgress view={{ ...view, status: 'queued', error: 'OSV timed out', attempts: 1 }} />
      </MantineProvider>,
    );
    expect(screen.getByText(/Retrying/)).toBeInTheDocument();
    expect(screen.getByText(/OSV timed out/)).toBeInTheDocument();
  });
});
