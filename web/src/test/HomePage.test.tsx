import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { HomePage } from '../pages/HomePage';

vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ scans: [] }), { status: 200 })));

describe('HomePage', () => {
  it('has a single URL field that explains branch, tag, commit and pull request URLs', () => {
    render(
      <MantineProvider>
        <MemoryRouter>
          <HomePage />
        </MemoryRouter>
      </MantineProvider>,
    );
    expect(screen.getAllByRole('textbox')).toHaveLength(1);
    expect(screen.getByLabelText(/Repository URL/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Branch, tag or commit/)).toBeNull();
    expect(screen.getByText(/branch, tag, commit or pull request/i)).toBeInTheDocument();
  });
});
