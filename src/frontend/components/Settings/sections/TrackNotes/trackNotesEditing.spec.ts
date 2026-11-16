import { describe, expect, it } from 'vitest';
import type { TrackNote, TrackProfileSummary } from '@irdashies/types';
import type { TrackCorner } from '@irdashies/domain/corners/trackCorners';
import {
  exportFileName,
  formatTrackLength,
  kindOfFileName,
  lastDistanceOf,
  noteCountLabel,
  notesFromCorners,
  parseDistance,
  roundDistance,
  shiftNotes,
  trackChoices,
  trackOptionLabel,
} from './trackNotesEditing';

const note = (
  distanceM: number,
  text: string,
  extra: Partial<TrackNote> = {}
): TrackNote => ({
  id: `n${distanceM}`,
  distanceM,
  kind: 'track',
  text,
  comment: '',
  pit: false,
  ...extra,
});

const corner = (label: string, startPct: number): TrackCorner =>
  ({
    section_id: label.toLowerCase(),
    name: label,
    label,
    type: 'corner',
    start_pct: startPct,
    end_pct: startPct + 0.02,
  }) as unknown as TrackCorner;

describe('parseDistance', () => {
  it('reads metres to the tenth', () => {
    expect(parseDistance('285', 3590.35)).toBe(285);
    expect(parseDistance(' 180.54 ', 3590.35)).toBe(180.5);
    expect(parseDistance('0', 3590.35)).toBe(0);
  });

  it('takes a comma for the decimal point', () => {
    expect(parseDistance('180,5', 3590.35)).toBe(180.5);
  });

  it('holds a distance to the lap', () => {
    expect(parseDistance('-20', 3590.35)).toBe(0);
    // Short of the end, which is the start of the next lap.
    expect(parseDistance('9999', 3590.35)).toBe(3590.3);
    expect(parseDistance('3590.35', 3590.35)).toBe(3590.3);
    expect(parseDistance('3590.3', 3590.35)).toBe(3590.3);
    expect(parseDistance('3590', 3590)).toBe(3589.9);
    expect(parseDistance('3590.3', 3590.3)).toBe(3590.2);
  });

  it('refuses what is not a number', () => {
    expect(parseDistance('', 3590.35)).toBeNull();
    expect(parseDistance('  ', 3590.35)).toBeNull();
    expect(parseDistance('T1', 3590.35)).toBeNull();
    expect(parseDistance('1e999', 3590.35)).toBeNull();
  });
});

describe('lastDistanceOf', () => {
  it('is the last tenth of a metre short of the end of the lap', () => {
    expect(lastDistanceOf(3590.35)).toBe(3590.3);
    expect(lastDistanceOf(3590)).toBe(3589.9);
    expect(lastDistanceOf(13626.04)).toBe(13626);
  });

  it('is the line itself on a track of no stated length', () => {
    expect(lastDistanceOf(0)).toBe(0);
  });
});

describe('roundDistance', () => {
  it('keeps a tenth of a metre', () => {
    expect(roundDistance(1795.175)).toBe(1795.2);
    expect(roundDistance(12)).toBe(12);
  });
});

describe('shiftNotes', () => {
  const notes = [
    note(100, 'Turn 1'),
    note(900, 'Turn 2'),
    note(3500, 'Turn 3'),
  ];

  it('moves every note along the lap', () => {
    expect(shiftNotes(notes, 25.5, 3590).map((each) => each.distanceM)).toEqual(
      [125.5, 925.5, 3525.5]
    );
  });

  it('takes a note past the line round to the start, and keeps them sorted', () => {
    const shifted = shiftNotes(notes, 100, 3590);

    expect(shifted.map((each) => [each.text, each.distanceM])).toEqual([
      ['Turn 3', 10],
      ['Turn 1', 200],
      ['Turn 2', 1000],
    ]);
  });

  it('moves notes back as well as on', () => {
    expect(
      shiftNotes(notes, -150, 3590).map((each) => [each.text, each.distanceM])
    ).toEqual([
      ['Turn 2', 750],
      ['Turn 3', 3350],
      ['Turn 1', 3540],
    ]);
  });

  it('changes nothing else of a note', () => {
    const [shifted] = shiftNotes(
      [note(100, 'Box', { kind: 'pace', pit: true, comment: 'Now' })],
      10,
      3590
    );

    expect(shifted).toEqual({
      id: 'n100',
      distanceM: 110,
      kind: 'pace',
      text: 'Box',
      comment: 'Now',
      pit: true,
    });
  });

  it('never leaves a note on the far side of the line', () => {
    const [shifted] = shiftNotes([note(100, 'Turn 1')], 3489.99, 3590);

    expect(shifted.distanceM).toBe(0);
  });
});

describe('notesFromCorners', () => {
  const corners = [
    corner('Andretti Hairpin', 0.08),
    corner('Turn 3', 0.2),
    corner('The Corkscrew', 0.666),
  ];

  it('writes one track note where each corner starts, named as it is', () => {
    expect(notesFromCorners(corners, [], 3590.35)).toEqual([
      {
        distanceM: 287.2,
        kind: 'track',
        text: 'Andretti Hairpin',
        comment: '',
        pit: false,
      },
      {
        distanceM: 718.1,
        kind: 'track',
        text: 'Turn 3',
        comment: '',
        pit: false,
      },
      {
        distanceM: 2391.2,
        kind: 'track',
        text: 'The Corkscrew',
        comment: '',
        pit: false,
      },
    ]);
  });

  it('leaves out a corner the track already has a note for', () => {
    const existing = [note(300, 'andretti hairpin'), note(700, 'Brake')];

    expect(
      notesFromCorners(corners, existing, 3590.35).map((each) => each.text)
    ).toEqual(['Turn 3', 'The Corkscrew']);
  });

  it('does not take a pace note or a pit note of the same name for one', () => {
    const existing = [
      note(700, 'Turn 3', { kind: 'pace' }),
      note(60, 'The Corkscrew', { pit: true }),
    ];

    expect(notesFromCorners(corners, existing, 3590.35)).toHaveLength(3);
  });

  it('writes a name that two corners share once', () => {
    expect(
      notesFromCorners([corner('Esses', 0.3), corner('Esses', 0.34)], [], 5000)
    ).toHaveLength(1);
  });

  it('has nothing to offer a track without corner data', () => {
    expect(notesFromCorners([], [], 3590.35)).toEqual([]);
  });
});

describe('kindOfFileName', () => {
  it('takes a pace notes file by its extension', () => {
    expect(kindOfFileName('Laguna Seca.tppn')).toBe('pace');
    expect(kindOfFileName('LAGUNA.TPPN')).toBe('pace');
  });

  it('takes anything else for track notes', () => {
    expect(kindOfFileName('Laguna Seca.tptn')).toBe('track');
    expect(kindOfFileName('notes.csv')).toBe('track');
    expect(kindOfFileName('notes')).toBe('track');
  });
});

describe('exportFileName', () => {
  it('names the file after the track, with the extension of its kind', () => {
    expect(exportFileName('WeatherTech Raceway Laguna Seca', 'track')).toBe(
      'WeatherTech Raceway Laguna Seca.tptn'
    );
    expect(exportFileName('WeatherTech Raceway Laguna Seca', 'pace')).toBe(
      'WeatherTech Raceway Laguna Seca.tppn'
    );
  });

  it('leaves out what no file name may hold', () => {
    expect(exportFileName('Spa: 24h / "Endurance" <2026>?', 'track')).toBe(
      'Spa 24h Endurance 2026.tptn'
    );
    expect(exportFileName('..\\..\\evil', 'track')).toBe('.. .. evil.tptn');
    expect(exportFileName('Le Mans\u0000\n.', 'pace')).toBe('Le Mans.tppn');
  });

  it('falls back when nothing is left of the name', () => {
    expect(exportFileName('', 'track')).toBe('track.tptn');
    expect(exportFileName(' ... ', 'pace')).toBe('track.tppn');
  });
});

describe('the track list', () => {
  const summary = (
    extra: Partial<TrackProfileSummary> = {}
  ): TrackProfileSummary => ({
    simulator: 'lmu',
    trackId: 694510461,
    trackName: 'WeatherTech Raceway Laguna Seca',
    trackLengthM: 3590.35,
    elevationSource: 'recorded',
    notes: 12,
    updatedAt: 2,
    ...extra,
  });

  it('names a track with the simulator it was driven in', () => {
    expect(trackOptionLabel(summary())).toBe(
      'WeatherTech Raceway Laguna Seca (Le Mans Ultimate)'
    );
    expect(
      trackOptionLabel(
        summary({ simulator: 'iracing', trackName: 'Spa', trackId: 163 })
      )
    ).toBe('Spa (iRacing)');
  });

  it('names a track with no name by its id', () => {
    expect(trackOptionLabel(summary({ trackName: '' }))).toBe(
      'Track 694510461 (Le Mans Ultimate)'
    );
  });

  it("puts the session's track first, and lists it once", () => {
    const choices = trackChoices(
      [
        summary({ simulator: 'iracing', trackName: 'Spa', trackId: 163 }),
        summary(),
      ],
      { trackKey: 'lmu:694510461', label: 'Laguna Seca (this session)' }
    );

    expect(choices).toEqual([
      { trackKey: 'lmu:694510461', label: 'Laguna Seca (this session)' },
      { trackKey: 'iracing:163', label: 'Spa (iRacing)' },
    ]);
  });

  it('lists the stored tracks alone with no session', () => {
    expect(trackChoices([summary()], null)).toEqual([
      {
        trackKey: 'lmu:694510461',
        label: 'WeatherTech Raceway Laguna Seca (Le Mans Ultimate)',
      },
    ]);
  });
});

describe('the figures under the track name', () => {
  it('prints the length in whole metres', () => {
    expect(formatTrackLength(3590.35)).toBe('3,590 m');
    expect(formatTrackLength(13626)).toBe('13,626 m');
  });

  it('counts notes', () => {
    expect(noteCountLabel(0)).toBe('0 notes');
    expect(noteCountLabel(1)).toBe('1 note');
    expect(noteCountLabel(12)).toBe('12 notes');
  });
});
