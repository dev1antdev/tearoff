import { describe, expect, it } from 'vitest';
import { TRACK_NOTE_FILE_LENGTH } from '@irdashies/types';
import {
  parseTrackNotesFile,
  serializeTrackNotesFile,
  type TrackNoteRow,
} from './trackNotesFile';

const row = (overrides: Partial<TrackNoteRow> = {}): TrackNoteRow => ({
  distanceM: 100,
  text: 'Turn 1',
  comment: '',
  pit: false,
  ...overrides,
});

describe('parseTrackNotesFile', () => {
  it('reads a file with its version line and its metadata', () => {
    const file = parseTrackNotesFile(
      [
        'TINYPEDAL TRACK NOTES FILE VERSION,2',
        'TITLE,"Laguna Seca"',
        'AUTHOR,"Somebody"',
        'DATE,"2026-11-01"',
        'DESCRIPTION,"Braking points, and a distance, in the description"',
        'distance,track note,comment,tags',
        '100,"Turn 1","Brake at the 100 board, late",',
        '2400.5,"Corkscrew","Blind\\nTurn in at the tree","#wet"',
        '3000,"Pit entry","","#pit"',
        'nowhere,"No distance","",',
        ',"Nor here","",',
      ].join('\r\n')
    );

    expect(file).toEqual({
      kind: 'track',
      rows: [
        row({ comment: 'Brake at the 100 board, late' }),
        // A tag that means nothing here is dropped and the note kept.
        row({
          distanceM: 2400.5,
          text: 'Corkscrew',
          comment: 'Blind\nTurn in at the tree',
        }),
        row({ distanceM: 3000, text: 'Pit entry', pit: true }),
      ],
    });
  });

  it('takes a pace-note header for pace notes', () => {
    expect(
      parseTrackNotesFile('distance,pace note,comment,tags\n820,Left 4,,\n')
    ).toEqual({
      kind: 'pace',
      rows: [row({ distanceM: 820, text: 'Left 4' })],
    });
  });

  it('names no kind when the header does not', () => {
    expect(parseTrackNotesFile('Distance,Note\n5,x')).toEqual({
      kind: null,
      rows: [row({ distanceM: 5, text: 'x' })],
    });
  });

  it('reads quotes inside a quoted field', () => {
    const file = parseTrackNotesFile(
      'distance,track note,comment,tags\n10,"The ""Andretti"" hairpin","a,b",\n'
    );

    expect(file?.rows).toEqual([
      row({ distanceM: 10, text: 'The "Andretti" hairpin', comment: 'a,b' }),
    ]);
  });

  it('reads a file that starts with a byte order mark', () => {
    expect(
      parseTrackNotesFile(
        `${String.fromCharCode(0xfeff)}distance,track note\n1,"a"`
      )?.rows
    ).toHaveLength(1);
  });

  it('gives an empty list for a header and nothing else', () => {
    expect(parseTrackNotesFile('distance,track note,comment,tags')).toEqual({
      kind: 'track',
      rows: [],
    });
  });

  it('refuses a file with no header', () => {
    expect(
      parseTrackNotesFile('100,"Turn 1","",\n200,"Turn 2","",')
    ).toBeNull();
    expect(parseTrackNotesFile('')).toBeNull();
  });

  it('refuses what is not text, and text longer than a notes file may be', () => {
    expect(parseTrackNotesFile(undefined)).toBeNull();
    expect(parseTrackNotesFile({ text: 'distance' })).toBeNull();
    const header = 'distance,track note\n';
    const fits = header.padEnd(TRACK_NOTE_FILE_LENGTH, ' ');
    expect(parseTrackNotesFile(fits)).not.toBeNull();
    expect(parseTrackNotesFile(`${fits} `)).toBeNull();
  });
});

describe('serializeTrackNotesFile', () => {
  it('writes a file the parser reads back as the same notes', () => {
    const rows = [
      row({ comment: 'Brake at the 100 board, late' }),
      row({
        distanceM: 2400.5,
        text: 'The "Corkscrew"',
        comment: 'Blind\nTurn in at the tree',
      }),
      row({ distanceM: 3000.123456, text: 'Pit entry', pit: true }),
    ];

    const text = serializeTrackNotesFile('track', rows);
    expect(text.split('\n')).toEqual([
      'TINYPEDAL TRACK NOTES FILE VERSION,2',
      'distance,track note,comment,tags',
      '100,"Turn 1","Brake at the 100 board, late",',
      '2400.5,"The ""Corkscrew""","Blind\\nTurn in at the tree",',
      '3000.1235,"Pit entry","","#pit"',
      '',
    ]);
    expect(parseTrackNotesFile(text)).toEqual({
      kind: 'track',
      rows: [rows[0], rows[1], { ...rows[2], distanceM: 3000.1235 }],
    });
  });

  it('says in the header which kind the notes are', () => {
    const text = serializeTrackNotesFile('pace', [row()]);

    expect(text.startsWith('TINYPEDAL PACE NOTES FILE VERSION,2\n')).toBe(true);
    expect(parseTrackNotesFile(text)?.kind).toBe('pace');
  });

  it('keeps a note on one line whatever its text holds', () => {
    const text = serializeTrackNotesFile('track', [
      row({ text: 'Two\nlines', comment: 'a\r\nb' }),
    ]);

    expect(text.split('\n')).toHaveLength(4);
    expect(parseTrackNotesFile(text)?.rows).toEqual([
      row({ text: 'Two lines', comment: 'a\nb' }),
    ]);
  });
});
