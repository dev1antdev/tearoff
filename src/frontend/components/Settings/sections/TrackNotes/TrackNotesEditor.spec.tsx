import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TrackNote, TrackProfileDetails } from '@irdashies/types';
import type { TrackCorner } from '@irdashies/domain/corners/trackCorners';
import {
  TrackNotesEditor,
  type TrackNotesEditorProps,
} from './TrackNotesEditor';
import {
  createMockTrackProfileBridge,
  lagunaSecaProfile,
  spaProfile,
  type MockTrackProfileBridge,
} from './mockTrackProfileBridge';

vi.mock('@irdashies/utils/logger', () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const LAGUNA = lagunaSecaProfile.trackKey;
const SPA = spaProfile.trackKey;

const note = (
  id: string,
  distanceM: number,
  text: string,
  extra: Partial<TrackNote> = {}
): TrackNote => ({
  id,
  distanceM,
  kind: 'track',
  text,
  comment: '',
  pit: false,
  ...extra,
});

/** Laguna Seca with three notes: enough to see an order in. */
const laguna = (notes: TrackNote[]): TrackProfileDetails => ({
  ...lagunaSecaProfile,
  notes,
});

const THREE = [
  note('a', 100, 'Turn 1'),
  note('b', 900, 'Turn 2', { comment: 'Late apex' }),
  note('c', 3000, 'Turn 3'),
];

const corner = (label: string, startPct: number): TrackCorner =>
  ({
    section_id: label.toLowerCase(),
    name: label,
    label,
    type: 'corner',
    start_pct: startPct,
    end_pct: startPct + 0.02,
  }) as unknown as TrackCorner;

const renderEditor = (
  bridge: MockTrackProfileBridge = createMockTrackProfileBridge([
    laguna(THREE),
    spaProfile,
  ]),
  props: Partial<TrackNotesEditorProps> = {}
) => {
  render(
    <TrackNotesEditor
      bridge={bridge}
      sessionTrackKey={LAGUNA}
      sessionTrackName="Laguna Seca"
      getSessionPositionM={() => 1795.18}
      corners={[]}
      {...props}
    />
  );
  return bridge;
};

/** The rows of the table once it is on show, without its heading. */
const rows = async (): Promise<HTMLElement[]> =>
  (await screen.findAllByRole('row')).slice(1);

/** What the table shows: each note's distance, kind, text, comment and pit. */
const table = async () =>
  (await rows()).map((row) => {
    const [distance, text, comment] = within(row).getAllByRole(
      'textbox'
    ) as HTMLInputElement[];
    return [
      distance.value,
      (within(row).getByRole('combobox') as HTMLSelectElement).value,
      text.value,
      comment.value,
      (within(row).getByRole('checkbox') as HTMLInputElement).checked,
    ];
  });

const storedNotes = (bridge: MockTrackProfileBridge, trackKey = LAGUNA) =>
  bridge.peek(trackKey)?.notes ?? [];

const type = (field: HTMLElement, value: string) => {
  fireEvent.change(field, { target: { value } });
  fireEvent.blur(field);
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TrackNotesEditor', () => {
  describe('the table', () => {
    it('lists the notes of the track of the running session, by distance', async () => {
      renderEditor();

      expect(await table()).toEqual([
        ['100.0', 'track', 'Turn 1', '', false],
        ['900.0', 'track', 'Turn 2', 'Late apex', false],
        ['3000.0', 'track', 'Turn 3', '', false],
      ]);
      expect(screen.getByText(/3,590 m · 3 notes/)).toBeInTheDocument();
    });

    it("names the session's track first among the tracks to choose from", async () => {
      renderEditor();
      await rows();

      const options = within(screen.getByRole('combobox', { name: 'Track' }))
        .getAllByRole('option')
        .map((option) => option.textContent);
      expect(options).toEqual([
        'Laguna Seca (this session)',
        'Circuit de Spa-Francorchamps (iRacing)',
      ]);
    });

    it('shows a comment with its line breaks as they are typed', async () => {
      renderEditor(
        createMockTrackProfileBridge([
          laguna([
            note('a', 100, 'Turn 1', { comment: 'Brake late\nTrail in' }),
          ]),
        ])
      );

      expect((await table())[0][3]).toBe('Brake late\\nTrail in');
    });

    it('says so on a track with no notes yet', async () => {
      renderEditor(createMockTrackProfileBridge([laguna([])]));

      expect(
        await screen.findByText(/No notes for this track yet/)
      ).toBeInTheDocument();
      expect(screen.queryByRole('table')).toBeNull();
      expect(screen.getByRole('button', { name: 'Export' })).toBeDisabled();
    });

    it('offers the track of the session before anything is stored for it', async () => {
      const bridge = createMockTrackProfileBridge([spaProfile]);
      // What the app answers for a track that is being driven and has no file.
      bridge.getProfile = async (trackKey) =>
        trackKey === LAGUNA ? laguna([]) : (bridge.peek(trackKey) ?? null);
      renderEditor(bridge);

      expect(
        await screen.findByText(/No notes for this track yet/)
      ).toBeInTheDocument();
      expect(screen.getByRole('combobox', { name: 'Track' })).toHaveValue(
        LAGUNA
      );
    });
  });

  describe('with no session running', () => {
    it('opens on the track changed last', async () => {
      renderEditor(undefined, { sessionTrackKey: null });

      expect(await table()).toHaveLength(3);
      expect(screen.getByRole('combobox', { name: 'Track' })).toHaveValue(
        LAGUNA
      );
    });

    it('cannot add a note where the car is, or from the corners', async () => {
      renderEditor(undefined, {
        sessionTrackKey: null,
        corners: [corner('Turn 4', 0.3)],
      });
      await rows();

      expect(
        screen.getByRole('button', { name: 'Add at current position' })
      ).toBeDisabled();
      expect(
        screen.getByRole('button', { name: 'Create from corners' })
      ).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Add note' })).toBeEnabled();
    });

    it('says there is nothing to write notes for with no track stored', async () => {
      renderEditor(createMockTrackProfileBridge([]), {
        sessionTrackKey: null,
      });

      expect(
        await screen.findByText(/No track to write notes for yet/)
      ).toBeInTheDocument();
    });
  });

  it('says so where the app has no track profiles', () => {
    render(
      <TrackNotesEditor
        bridge={undefined}
        sessionTrackKey={null}
        getSessionPositionM={() => null}
        corners={[]}
      />
    );

    expect(
      screen.getByText('Track notes are not available in this window.')
    ).toBeInTheDocument();
  });

  describe('another track', () => {
    it('shows its notes when it is chosen', async () => {
      const bridge = renderEditor();
      await rows();

      fireEvent.change(screen.getByRole('combobox', { name: 'Track' }), {
        target: { value: SPA },
      });

      expect(
        await screen.findByText(/No notes for this track yet/)
      ).toBeInTheDocument();
      expect(screen.getByText(/6,996 m · 0 notes/)).toBeInTheDocument();
      // Not the track being driven: the car is not on it.
      expect(
        screen.getByRole('button', { name: 'Add at current position' })
      ).toBeDisabled();

      fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
      await waitFor(() => expect(storedNotes(bridge, SPA)).toHaveLength(1));
      expect(storedNotes(bridge)).toHaveLength(3);
    });
  });

  describe('changing a note', () => {
    it('saves the text when the field is left', async () => {
      const bridge = renderEditor();
      const [first] = await rows();

      type(
        within(first).getByLabelText('Text of Turn 1'),
        'Turn 1: brake late'
      );

      await waitFor(() =>
        expect(storedNotes(bridge)[0]).toEqual(
          note('a', 100, 'Turn 1: brake late')
        )
      );
    });

    it('saves the text on Enter', async () => {
      const bridge = renderEditor();
      const [first] = await rows();
      const field = within(first).getByLabelText('Text of Turn 1');

      fireEvent.change(field, { target: { value: 'Hairpin' } });
      fireEvent.keyDown(field, { key: 'Enter' });

      await waitFor(() => expect(storedNotes(bridge)[0].text).toBe('Hairpin'));
    });

    it('saves nothing for a field left as it was', async () => {
      const bridge = renderEditor();
      const save = vi.spyOn(bridge, 'saveNotes');
      const [first] = await rows();

      fireEvent.blur(within(first).getByLabelText('Text of Turn 1'));
      fireEvent.blur(within(first).getByLabelText(/^Distance of Turn 1/));
      fireEvent.blur(within(first).getByLabelText('Comment of Turn 1'));

      expect(save).not.toHaveBeenCalled();
    });

    it('saves a comment with the line breaks typed as \\n', async () => {
      const bridge = renderEditor();
      const [first] = await rows();

      type(
        within(first).getByLabelText('Comment of Turn 1'),
        'Brake late\\nTrail in'
      );

      await waitFor(() =>
        expect(storedNotes(bridge)[0].comment).toBe('Brake late\nTrail in')
      );
    });

    it('moves a note and puts it where it now belongs', async () => {
      const bridge = renderEditor();
      const [first] = await rows();

      type(within(first).getByLabelText(/^Distance of Turn 1/), '1500,25');

      await waitFor(async () =>
        expect((await table()).map((row) => row[2])).toEqual([
          'Turn 2',
          'Turn 1',
          'Turn 3',
        ])
      );
      expect(storedNotes(bridge)[1]).toEqual(note('a', 1500.3, 'Turn 1'));
    });

    it('holds a distance to the lap', async () => {
      const bridge = renderEditor();
      const [first] = await rows();

      type(within(first).getByLabelText(/^Distance of Turn 1/), '99999');

      await waitFor(() =>
        expect(storedNotes(bridge).at(-1)).toEqual(note('a', 3590.3, 'Turn 1'))
      );
    });

    it('puts back a distance that is not a number', async () => {
      const bridge = renderEditor();
      const save = vi.spyOn(bridge, 'saveNotes');
      const [first] = await rows();
      const field = within(first).getByLabelText(
        /^Distance of Turn 1/
      ) as HTMLInputElement;

      type(field, 'Turn one');

      expect(field.value).toBe('100.0');
      expect(save).not.toHaveBeenCalled();
    });

    it('saves the kind and the pit mark as they are changed', async () => {
      const bridge = renderEditor();
      const [first] = await rows();

      fireEvent.change(within(first).getByLabelText('Kind of Turn 1'), {
        target: { value: 'pace' },
      });
      await waitFor(() => expect(storedNotes(bridge)[0].kind).toBe('pace'));

      fireEvent.click(
        within((await rows())[0]).getByLabelText('Show Turn 1 on pit road only')
      );
      await waitFor(() => expect(storedNotes(bridge)[0].pit).toBe(true));
      expect(storedNotes(bridge)[0]).toEqual(
        note('a', 100, 'Turn 1', { kind: 'pace', pit: true })
      );
    });

    it('keeps two changes made one after the other', async () => {
      const bridge = renderEditor();
      const [first, second] = await rows();

      // Before the first has come back.
      type(within(first).getByLabelText('Text of Turn 1'), 'One');
      type(within(second).getByLabelText('Text of Turn 2'), 'Two');

      await waitFor(() =>
        expect(storedNotes(bridge).map((each) => each.text)).toEqual([
          'One',
          'Two',
          'Turn 3',
        ])
      );
    });
  });

  describe('adding and deleting', () => {
    it('adds an empty track note at the line, ready to be written', async () => {
      const bridge = renderEditor();
      await rows();

      fireEvent.click(screen.getByRole('button', { name: 'Add note' }));

      await waitFor(() => expect(storedNotes(bridge)).toHaveLength(4));
      expect(storedNotes(bridge)[0]).toMatchObject({
        distanceM: 0,
        kind: 'track',
        text: '',
        comment: '',
        pit: false,
      });
      // The store gave it its id.
      expect(storedNotes(bridge)[0].id).not.toBe('');
      await waitFor(async () =>
        expect(
          within((await rows())[0]).getAllByRole('textbox')[1]
        ).toHaveFocus()
      );
    });

    it('adds a note where the car is', async () => {
      const bridge = renderEditor();
      await rows();

      fireEvent.click(
        screen.getByRole('button', { name: 'Add at current position' })
      );

      await waitFor(() => expect(storedNotes(bridge)).toHaveLength(4));
      // Between the notes at 900 m and 3,000 m, to the tenth of a metre.
      expect(storedNotes(bridge)[2].distanceM).toBe(1795.2);
    });

    it('says so when where the car is has not been heard yet', async () => {
      const bridge = renderEditor(undefined, {
        getSessionPositionM: () => null,
      });
      await rows();

      fireEvent.click(
        screen.getByRole('button', { name: 'Add at current position' })
      );

      expect(
        await screen.findByText('Where the car is on the lap is not known yet.')
      ).toBeInTheDocument();
      expect(storedNotes(bridge)).toHaveLength(3);
    });

    it('deletes a note', async () => {
      const bridge = renderEditor();
      await rows();

      fireEvent.click(screen.getByRole('button', { name: 'Delete Turn 2' }));

      await waitFor(() =>
        expect(storedNotes(bridge).map((each) => each.text)).toEqual([
          'Turn 1',
          'Turn 3',
        ])
      );
      expect(await table()).toHaveLength(2);
    });

    it('refuses a note past the most a track holds', async () => {
      const full = Array.from({ length: 500 }, (_, index) =>
        note(`n${index}`, index * 7, `Note ${index}`)
      );
      const bridge = renderEditor(createMockTrackProfileBridge([laguna(full)]));
      const save = vi.spyOn(bridge, 'saveNotes');
      await rows();

      fireEvent.click(screen.getByRole('button', { name: 'Add note' }));

      expect(
        await screen.findByText('A track holds at most 500 notes.')
      ).toBeInTheDocument();
      expect(save).not.toHaveBeenCalled();
    });
  });

  describe('shifting every note', () => {
    it('moves them all along the lap, round the line', async () => {
      const bridge = renderEditor();
      await rows();

      fireEvent.change(screen.getByLabelText(/Shift all by/), {
        target: { value: '600' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Shift' }));

      await waitFor(() =>
        expect(
          storedNotes(bridge).map((each) => [each.text, each.distanceM])
        ).toEqual([
          // 3,000 m and 600 m is 9.7 m past the 3,590.35 m of the lap.
          ['Turn 3', 9.7],
          ['Turn 1', 700],
          ['Turn 2', 1500],
        ])
      );
      expect(
        await screen.findByText('Moved 3 notes by 600 m.')
      ).toBeInTheDocument();
      expect(screen.getByLabelText(/Shift all by/)).toHaveValue('');
    });

    it('asks for a number', async () => {
      const bridge = renderEditor();
      const save = vi.spyOn(bridge, 'saveNotes');
      await rows();

      fireEvent.click(screen.getByRole('button', { name: 'Shift' }));

      expect(
        await screen.findByText('Enter how many metres to move the notes by.')
      ).toBeInTheDocument();
      expect(save).not.toHaveBeenCalled();
    });
  });

  describe('starting from the corners', () => {
    const corners = [
      corner('Turn 2', 0.25),
      corner('Turn 4', 0.3),
      corner('The Corkscrew', 0.666),
    ];

    it('adds a track note for each corner that has none', async () => {
      const bridge = renderEditor(undefined, { corners });
      await rows();

      fireEvent.click(
        screen.getByRole('button', { name: 'Create from corners' })
      );

      await waitFor(() =>
        expect(
          storedNotes(bridge).map((each) => [each.text, each.distanceM])
        ).toEqual([
          ['Turn 1', 100],
          ['Turn 2', 900],
          ['Turn 4', 1077.1],
          ['The Corkscrew', 2391.2],
          ['Turn 3', 3000],
        ])
      );
      expect(
        await screen.findByText('Added 2 notes from the corners of the track.')
      ).toBeInTheDocument();
    });

    it('adds nothing a second time', async () => {
      const bridge = renderEditor(undefined, { corners });
      await rows();
      const button = screen.getByRole('button', {
        name: 'Create from corners',
      });

      fireEvent.click(button);
      await waitFor(() => expect(storedNotes(bridge)).toHaveLength(5));
      fireEvent.click(button);

      expect(
        await screen.findByText(
          'Every corner of this track already has a note.'
        )
      ).toBeInTheDocument();
      expect(storedNotes(bridge)).toHaveLength(5);
    });

    it('is not offered for a track without corner data', async () => {
      renderEditor();
      await rows();

      expect(
        screen.getByRole('button', { name: 'Create from corners' })
      ).toBeDisabled();
    });
  });

  describe('a TinyPedal notes file', () => {
    const file = (name: string, text: string) =>
      new File([text], name, { type: 'text/plain' });

    const choose = (chosen: File) =>
      fireEvent.change(screen.getByLabelText('TinyPedal notes file'), {
        target: { files: [chosen] },
      });

    it('is read by the page and sent as text, with the kind its name says', async () => {
      const bridge = renderEditor();
      const importNotes = vi.spyOn(bridge, 'importNotes');
      await rows();
      const text = 'distance,pace note,comment,tags\n180.5,"Brake",,\n';

      choose(file('Laguna Seca.tppn', text));

      await waitFor(() =>
        expect(importNotes).toHaveBeenCalledWith(LAGUNA, 'pace', text)
      );
      expect(await screen.findByText('Imported 1 note.')).toBeInTheDocument();
      expect((await table()).map((row) => row[2])).toEqual([
        'Turn 1',
        'Brake',
        'Turn 2',
        'Turn 3',
      ]);
    });

    it('adds to the notes the track has', async () => {
      const bridge = renderEditor();
      await rows();

      choose(
        file(
          'notes.csv',
          'distance,track note,comment,tags\n50,"Line",,\n1200,"Kink",,\n'
        )
      );

      await waitFor(() => expect(storedNotes(bridge)).toHaveLength(5));
      expect(await screen.findByText('Imported 2 notes.')).toBeInTheDocument();
    });

    it('says so when the file is not a notes file', async () => {
      const bridge = renderEditor();
      await rows();

      choose(file('holiday.csv', 'day,place\n1,Monza\n'));

      expect(
        await screen.findByText(/That file is not a TinyPedal notes file/)
      ).toBeInTheDocument();
      expect(storedNotes(bridge)).toHaveLength(3);
    });

    it('does not send a file too large to be one', async () => {
      const bridge = renderEditor();
      const importNotes = vi.spyOn(bridge, 'importNotes');
      await rows();

      choose(
        file('huge.tptn', `distance,track note\n${'x'.repeat(1_024_001)}`)
      );

      expect(
        await screen.findByText('That file is too large to be a notes file.')
      ).toBeInTheDocument();
      expect(importNotes).not.toHaveBeenCalled();
    });
  });

  describe('exporting', () => {
    it('saves one file for each kind of note the track has', async () => {
      const bridge = renderEditor(
        createMockTrackProfileBridge([
          laguna([
            note('a', 100, 'Turn 1'),
            note('b', 700, 'Brake', { kind: 'pace' }),
          ]),
        ])
      );
      const exportNotes = vi.spyOn(bridge, 'exportNotes');
      const saved: { name: string; href: string }[] = [];
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
        function (this: HTMLAnchorElement) {
          saved.push({ name: this.download, href: this.href });
        }
      );
      URL.createObjectURL = vi.fn(() => 'blob:notes');
      URL.revokeObjectURL = vi.fn();
      await rows();

      fireEvent.click(screen.getByRole('button', { name: 'Export' }));

      expect(
        await screen.findByText('Exported 2 files, one for each kind of note.')
      ).toBeInTheDocument();
      expect(exportNotes).toHaveBeenCalledWith(LAGUNA, 'track');
      expect(exportNotes).toHaveBeenCalledWith(LAGUNA, 'pace');
      expect(saved.map((each) => each.name).sort()).toEqual([
        'WeatherTech Raceway Laguna Seca.tppn',
        'WeatherTech Raceway Laguna Seca.tptn',
      ]);
      expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
    });

    it('saves one file for a track with one kind', async () => {
      const bridge = renderEditor();
      const exportNotes = vi.spyOn(bridge, 'exportNotes');
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(
        () => undefined
      );
      URL.createObjectURL = vi.fn(() => 'blob:notes');
      URL.revokeObjectURL = vi.fn();
      await rows();

      fireEvent.click(screen.getByRole('button', { name: 'Export' }));

      expect(await screen.findByText('Exported one file.')).toBeInTheDocument();
      expect(exportNotes).toHaveBeenCalledTimes(1);
      expect(exportNotes).toHaveBeenCalledWith(LAGUNA, 'track');
    });
  });

  describe('a change made elsewhere', () => {
    it('is shown without the page being opened again', async () => {
      const bridge = renderEditor();
      await rows();

      // A lap recorded, another window, a file dropped in.
      await bridge.saveNotes(LAGUNA, [...THREE, note('d', 2000, 'Turn 2b')]);

      await waitFor(async () =>
        expect((await table()).map((row) => row[2])).toEqual([
          'Turn 1',
          'Turn 2',
          'Turn 2b',
          'Turn 3',
        ])
      );
    });
  });
});
