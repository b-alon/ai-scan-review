import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../App';

describe('App shell', () => {
  it('renders the header and the home page', () => {
    render(<App />);
    expect(screen.getByText('AI Scan Review')).toBeInTheDocument();
    expect(screen.getByText('Scan a GitHub repository')).toBeInTheDocument();
  });
});
