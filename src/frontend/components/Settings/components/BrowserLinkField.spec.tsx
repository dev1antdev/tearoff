import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import logger from '@irdashies/utils/logger';
import { BrowserLinkField } from './BrowserLinkField';

vi.mock('@irdashies/utils/logger', () => ({
  default: { warn: vi.fn() },
}));

const KEY = 'k'.repeat(32);
const LOCAL = 'http://localhost:3000/pitwall';
const KEYED = `http://192.168.1.50:3000/pitwall?key=${KEY}`;
const MASKED = 'http://192.168.1.50:3000/pitwall?key=••••••••';
const writeText = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  writeText.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const field = () => screen.getByRole('textbox') as HTMLInputElement;

describe('BrowserLinkField', () => {
  it('shows a link that has no key in it whole, with nothing to reveal', () => {
    render(<BrowserLinkField label="Pit Wall link for this PC" url={LOCAL} />);

    expect(
      screen.getByRole('textbox', { name: 'Pit Wall link for this PC' })
    ).toHaveValue(LOCAL);
    expect(field()).toHaveAttribute('readonly');
    expect(screen.queryByRole('button', { name: /key/ })).toBeNull();
  });

  it('keeps the key off the screen until it is asked for', () => {
    render(<BrowserLinkField label="Link" url={KEYED} secret={KEY} />);

    expect(field()).toHaveValue(MASKED);
    expect(document.body.innerHTML).not.toContain(KEY);

    const show = screen.getByRole('button', { name: 'Show key' });
    expect(show).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(show);
    expect(field()).toHaveValue(KEYED);

    const hide = screen.getByRole('button', { name: 'Hide key' });
    expect(hide).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(hide);
    expect(field()).toHaveValue(MASKED);
  });

  it('copies the whole link, key and all, whatever is on the screen', async () => {
    render(<BrowserLinkField label="Link" url={KEYED} secret={KEY} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    });

    expect(writeText).toHaveBeenCalledExactlyOnceWith(KEYED);
    expect(field()).toHaveValue(MASKED);
  });

  it('says it copied, for a moment, and keeps the button’s name', async () => {
    render(
      <BrowserLinkField label="Link" url={LOCAL} copyLabel="Copy for OBS" />
    );
    expect(screen.getByRole('status')).toBeEmptyDOMElement();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy for OBS' }));
    });
    expect(screen.getByRole('status')).toHaveTextContent('Copied');
    expect(screen.getByRole('button', { name: 'Copy for OBS' })).toBeVisible();

    act(() => vi.advanceTimersByTime(2000));
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('does not say it copied when it could not, and logs no link', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    render(<BrowserLinkField label="Link" url={KEYED} secret={KEY} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    });

    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(vi.mocked(logger.warn).mock.calls)).not.toContain(
      KEY
    );
  });

  it('does not say it copied where there is no clipboard to copy to', async () => {
    vi.stubGlobal('navigator', {});
    render(<BrowserLinkField label="Link" url={LOCAL} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    });

    expect(screen.getByRole('status')).toBeEmptyDOMElement();
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it('follows the link it is given, as when the key is replaced', () => {
    const next = 'n'.repeat(32);
    const { rerender } = render(
      <BrowserLinkField label="Link" url={KEYED} secret={KEY} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show key' }));

    rerender(
      <BrowserLinkField
        label="Link"
        url={KEYED.replace(KEY, next)}
        secret={next}
      />
    );

    expect(field()).toHaveValue(KEYED.replace(KEY, next));
  });
});
