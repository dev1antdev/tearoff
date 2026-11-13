import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { LapLibraryBridge } from '@irdashies/types';
import { LapLibrarySettings } from './LapLibrarySettings';
import { createMockLapLibrary } from './mockLapLibrary';

vi.mock('@irdashies/utils/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const LAGUNA = 'WeatherTech Raceway Laguna Seca';

const renderPage = (
  bridge: LapLibraryBridge = createMockLapLibrary(),
  initiallyExpanded?: number[]
) => {
  render(
    <LapLibrarySettings bridge={bridge} initiallyExpanded={initiallyExpanded} />
  );
  return bridge;
};

/** The card of the session whose heading button carries this text. */
const sessionCard = (text: RegExp): HTMLElement => {
  const toggle = screen
    .getAllByRole('button', { expanded: false })
    .concat(screen.queryAllByRole('button', { expanded: true }))
    .find((button) => text.test(button.textContent ?? ''));
  if (!toggle) throw new Error(`No session matching ${text}`);
  return toggle.closest('section') as HTMLElement;
};

/** The card of a session the page was told to show open, once loaded. */
const loadedCard = async (text: RegExp) => {
  await screen.findByText('Road America - Full Course');
  const card = sessionCard(text);
  await within(card).findByRole('table');
  return card;
};

const openSession = async (text: RegExp) => {
  const card = sessionCard(text);
  fireEvent.click(within(card).getAllByRole('button')[0]);
  await within(card).findByRole('table');
  return card;
};

const lapTimes = (card: HTMLElement): string[] =>
  within(card)
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[1].textContent ?? '');

describe('LapLibrarySettings', () => {
  it('lists the sessions, most recent first, with their lap count and best', async () => {
    renderPage();

    await screen.findByText('Road America - Full Course');
    const headings = screen
      .getAllByRole('button', { expanded: false })
      .map((button) => button.textContent ?? '');
    expect(headings).toHaveLength(3);
    expect(headings[0]).toContain(LAGUNA);
    expect(headings[0]).toContain('Race');
    expect(headings[0]).toContain('Le Mans Ultimate');
    expect(headings[0]).toContain('6 laps');
    expect(headings[0]).toContain('best 1:26.216');
    expect(headings[2]).toContain('BMW M4 GT3');
    expect(headings[2]).toContain('iRacing');
    expect(screen.getByText(/3 sessions · 12 laps/)).toBeInTheDocument();
  });

  it('shows no laps until a session is opened', async () => {
    renderPage();
    await screen.findByText('Road America - Full Course');

    expect(screen.queryByRole('table')).toBeNull();
  });

  it('opens a session to its laps in the order driven', async () => {
    renderPage();
    await screen.findByText('Road America - Full Course');

    const card = await openSession(/Road America/);

    expect(lapTimes(card)).toEqual(['2:19.735', '2:11.301', '2:09.284']);
    const rows = within(card).getAllByRole('row').slice(1);
    // Lap numbers as the sim counted them, and fuel burned.
    expect(within(rows[0]).getAllByRole('cell')[0].textContent).toBe('2');
    expect(within(rows[1]).getAllByRole('cell')[4].textContent).toBe('3.36 L');
  });

  it('measures each lap against the best of the session', async () => {
    renderPage(undefined, [1]);
    const card = await loadedCard(/Road America/);

    const gaps = within(card)
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('cell')[2].textContent);
    expect(gaps).toEqual(['+10.451', '+2.017', '-']);
  });

  it('stars the all-time reference and says why other laps are not it', async () => {
    renderPage(undefined, [3]);
    const card = await loadedCard(/Laguna Seca.*Race/);
    const rows = within(card).getAllByRole('row').slice(1);

    // The quickest clean lap, not the quickest lap: that one was voided.
    expect(
      within(rows[2]).getByLabelText('The all-time reference')
    ).toBeInTheDocument();
    expect(within(rows[3]).queryByLabelText(/all-time reference/)).toBeNull();
    expect(within(rows[3]).getByText('Voided')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Pit')).toBeInTheDocument();
    expect(within(rows[5]).getByText('No trace')).toBeInTheDocument();
    // Virtual energy for a car that runs on it.
    expect(within(rows[1]).getAllByRole('cell')[4].textContent).toBe('2.3% VE');
  });

  it('closes a session again', async () => {
    renderPage();
    await screen.findByText('Road America - Full Course');
    const card = await openSession(/Road America/);

    fireEvent.click(within(card).getAllByRole('button')[0]);

    expect(within(card).queryByRole('table')).toBeNull();
  });

  it('deletes a lap only after it is confirmed', async () => {
    const bridge = renderPage(undefined, [1]);
    const deleteLap = vi.spyOn(bridge, 'deleteLap');
    const card = await loadedCard(/Road America/);

    fireEvent.click(within(card).getByLabelText('Delete lap 2'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('2:19.735');
    expect(deleteLap).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(lapTimes(sessionCard(/Road America/))).toEqual([
        '2:11.301',
        '2:09.284',
      ])
    );
    expect(deleteLap).toHaveBeenCalledExactlyOnceWith(11);
    expect(screen.getByText(/3 sessions · 11 laps/)).toBeInTheDocument();
  });

  it('keeps the lap when the delete is cancelled', async () => {
    const bridge = renderPage(undefined, [1]);
    const deleteLap = vi.spyOn(bridge, 'deleteLap');
    const card = await loadedCard(/Road America/);

    fireEvent.click(within(card).getByLabelText('Delete lap 2'));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Keep' }));

    expect(deleteLap).not.toHaveBeenCalled();
    expect(lapTimes(card)).toHaveLength(3);
  });

  it('warns that deleting the reference lap hands it to the next one', async () => {
    renderPage(undefined, [1]);
    const card = await loadedCard(/Road America/);

    fireEvent.click(within(card).getByLabelText('Delete lap 3'));

    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('all-time reference');
  });

  it('deletes a whole session after it is confirmed', async () => {
    const bridge = renderPage();
    const deleteSession = vi.spyOn(bridge, 'deleteSession');
    await screen.findByText('Road America - Full Course');

    fireEvent.click(
      screen.getByLabelText('Delete the session at Road America - Full Course')
    );
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('3 laps');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(screen.queryByText('Road America - Full Course')).toBeNull()
    );
    expect(deleteSession).toHaveBeenCalledExactlyOnceWith(1);
    expect(screen.getByText(/2 sessions · 9 laps/)).toBeInTheDocument();
  });

  it('pins a lap as the reference, and unpins it', async () => {
    renderPage(undefined, [1]);
    await loadedCard(/Road America/);
    const row = (index: number) =>
      within(sessionCard(/Road America/)).getAllByRole('row')[index + 1];

    // The quickest lap has incident points, so it is not the reference
    // until it is chosen by hand.
    expect(within(row(2)).queryByLabelText(/all-time reference/)).toBeNull();
    fireEvent.click(
      within(row(2)).getByLabelText('Pin lap 4 as the reference')
    );

    await waitFor(() =>
      expect(
        within(row(2)).getByLabelText('Pinned as the all-time reference')
      ).toBeInTheDocument()
    );
    expect(within(row(1)).queryByLabelText(/all-time reference/)).toBeNull();

    fireEvent.click(within(row(2)).getByLabelText('Unpin lap 4'));

    await waitFor(() =>
      expect(
        within(row(1)).getByLabelText('The all-time reference')
      ).toBeInTheDocument()
    );
    expect(within(row(2)).queryByLabelText(/all-time reference/)).toBeNull();
  });

  it('offers no pin on a lap with no trace to measure against', async () => {
    renderPage(undefined, [3]);
    const card = await loadedCard(/Laguna Seca.*Race/);
    const last = within(card).getAllByRole('row')[6];

    expect(within(last).queryByLabelText(/Pin lap/)).toBeNull();
    expect(within(last).getByLabelText('Delete lap 6')).toBeInTheDocument();
  });

  it('shows a lap recorded while the page is open', async () => {
    const bridge = createMockLapLibrary();
    let sessions = await bridge.listSessions();
    const listSessions = vi.fn(() => Promise.resolve(sessions));
    let announce: () => void = () => undefined;
    renderPage({
      ...bridge,
      listSessions,
      onChanged: (callback) => {
        announce = callback;
        return () => undefined;
      },
    });
    await screen.findByText('Road America - Full Course');
    expect(screen.getAllByText(/6 laps/)).toHaveLength(1);

    sessions = sessions.map((entry) =>
      entry.id === 3 ? { ...entry, lapCount: 7 } : entry
    );
    await act(async () => announce());

    expect(await screen.findByText(/7 laps/)).toBeInTheDocument();
  });

  it('says so when there are no laps yet', async () => {
    renderPage(createMockLapLibrary([], []));

    expect(await screen.findByText(/No laps recorded yet/)).toBeInTheDocument();
    expect(screen.queryByText(/sessions ·/)).toBeNull();
  });

  it('says so where the app has no lap library', () => {
    render(<LapLibrarySettings />);

    expect(
      screen.getByText('The lap library is not available in this window.')
    ).toBeInTheDocument();
  });

  it('stops listening when it goes away', async () => {
    const bridge = createMockLapLibrary();
    const stop = vi.fn();
    const { unmount } = render(
      <LapLibrarySettings bridge={{ ...bridge, onChanged: () => stop }} />
    );
    await screen.findByText('Road America - Full Course');

    unmount();

    expect(stop).toHaveBeenCalledOnce();
  });
});
