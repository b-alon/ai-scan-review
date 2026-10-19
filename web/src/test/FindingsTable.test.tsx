import { MantineProvider } from '@mantine/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FindingsTable } from '../components/FindingsTable';
import { doneView } from './fixtures';

describe('FindingsTable', () => {
  it('filters by severity and expands a row', () => {
    render(
      <MantineProvider>
        <FindingsTable findings={doneView.findings!} />
      </MantineProvider>,
    );
    expect(screen.getAllByRole('row')).toHaveLength(4);
    fireEvent.click(screen.getByRole('radio', { name: 'critical' }));
    expect(screen.getAllByRole('row')).toHaveLength(2);
    fireEvent.click(screen.getByText('AWS key'));
    expect(screen.getByText('key = "AKIA****"')).toBeInTheDocument();
  });
});
