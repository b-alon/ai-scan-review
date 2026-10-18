import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { ScanResult } from '../components/ScanResult';
import { doneView } from './fixtures';

function renderResult(view = doneView) {
  return render(
    <MantineProvider>
      <MemoryRouter>
        <ScanResult view={view} />
      </MemoryRouter>
    </MantineProvider>,
  );
}

describe('ScanResult', () => {
  it('renders the three product sections in order plus comparison and findings', () => {
    renderResult();
    const headings = screen.getAllByRole('heading').map((h) => h.textContent);
    const order = ['What matters', 'What is risky', 'What to do next', 'Since previous scan', 'All findings'].map((t) => headings.findIndex((h) => h?.startsWith(t)));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(screen.getByText(doneView.summary!.headline)).toBeInTheDocument();
    expect(screen.getByText('Anyone can use your AWS account.')).toBeInTheDocument();
    expect(screen.getByText(/1 fixed/)).toBeInTheDocument();
    expect(screen.getByText(/1 new/)).toBeInTheDocument();
    expect(screen.getByText(/2 still open/)).toBeInTheDocument();
    expect(screen.getByText('The dependency vulnerability check did not run.')).toBeInTheDocument();
  });

  it('labels same-commit rescans', () => {
    renderResult({ ...doneView, comparison: { ...doneView.comparison!, sameCommit: true } });
    expect(screen.getByText(/Same commit as your previous scan/)).toBeInTheDocument();
    expect(screen.getByText(/updated advisory data/)).toBeInTheDocument();
  });
});
