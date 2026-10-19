import { MantineProvider } from '@mantine/core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { NextActions } from '../components/NextActions';
import { doneView } from './fixtures';

describe('NextActions', () => {
  it('keeps the effort chip and the step number at full width so long actions wrap instead', () => {
    const longAction = { action: 'Upgrade path-to-regexp from 0.1.7 to 0.1.13 or later, staying on the 0.1.x line that Express 4 routing depends on. '.repeat(3), effort: 'hours' as const, resolves: ['eval'] };
    render(
      <MantineProvider>
        <NextActions actions={[longAction]} findings={doneView.findings!} />
      </MantineProvider>,
    );
    const chip = screen.getByText('hours');
    const chipHost = chip.closest('[class*="Badge-root"]') as HTMLElement;
    expect(chipHost.style.flex).toBe('0 0 auto');
    const number = screen.getByText('1');
    const numberHost = number.closest('[class*="Badge-root"]') as HTMLElement;
    expect(numberHost.style.flex).toBe('0 0 auto');
  });
});
