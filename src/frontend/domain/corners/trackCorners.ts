import type { LovelyTrackSection } from '@irdashies/types';

/**
 * The corners of a track, as the widgets that report on them list them.
 *
 * The bundled track data is a list of sections: corners and named straights,
 * some overlapping, some sharing a name. This turns it into the corners a
 * driver would count, in lap order, each with the label it is shown under.
 */

/**
 * How a corner is named: by its name ('Acque Minerali A') or by its turn
 * number ('T5A').
 */
export type CornerLabelStyle = 'name' | 'number';

/** A corner with its display label resolved. */
export interface TrackCorner extends LovelyTrackSection {
  label: string;
}

/** The base a corner is known by before any A/B suffix. */
const baseLabelOf = (section: LovelyTrackSection): string =>
  section.corner_number ?? section.name;

/** A, B, C … then plain numbers past Z, which no real complex reaches. */
const suffixAt = (index: number): string =>
  index < 26 ? String.fromCharCode(65 + index) : String(index + 1);

/**
 * Split the kept sections into corners.
 *
 * A corner is a run of **consecutive** sections sharing a base label. The
 * track data models some complexes as two abutting halves under one name —
 * Imola's Acque Minerali is 0.540-0.575 and 0.575-0.598 — and they are two
 * corners to drive, so they stay two rows and are told apart by an A/B suffix
 * rather than being merged. Consecutive rather than "every section with this
 * name" so two corners that merely share a name on a long circuit (the
 * Nordschleife has several) are not lettered as though they were one complex.
 */
const groupSections = (
  kept: readonly LovelyTrackSection[]
): LovelyTrackSection[][] => {
  const groups: LovelyTrackSection[][] = [];
  for (const section of kept) {
    const current = groups[groups.length - 1];
    if (current && baseLabelOf(current[0]) === baseLabelOf(section)) {
      current.push(section);
    } else {
      groups.push([section]);
    }
  }
  return groups;
};

/**
 * Label every kept section, and give the halves of a split complex distinct
 * `section_id`s — the id is a row's identity, and it deliberately does not
 * depend on `labelStyle` so history survives that setting being toggled.
 *
 * Turn numbers come from the track data where it has them, and are otherwise
 * counted off the corners themselves. All-or-nothing rather than per corner:
 * mixing a supplied 'T5' with a counted 5 on one circuit would print the same
 * number twice. Note the counted numbers are not iRacing's — the track-data
 * mapper drops marker-only turns (Imola loses T1, T4, T8, T10, T13, T16, T17
 * and T20 that way), so they count *named* corners.
 */
const labelCorners = (
  kept: readonly LovelyTrackSection[],
  labelStyle: CornerLabelStyle
): TrackCorner[] => {
  const groups = groupSections(kept);
  const numbered = labelStyle === 'number';
  const useTrackNumbers = groups.every((group) => !!group[0].corner_number);

  return groups.flatMap((group, groupIdx) => {
    const base = numbered
      ? useTrackNumbers
        ? (group[0].corner_number as string)
        : `T${groupIdx + 1}`
      : baseLabelOf(group[0]);

    return group.map((section, idx) => {
      const suffix = group.length > 1 ? suffixAt(idx) : '';
      return {
        ...section,
        section_id: suffix
          ? `${section.section_id}_${suffix.toLowerCase()}`
          : section.section_id,
        label: numbered
          ? `${base}${suffix}`
          : suffix
            ? `${base} ${suffix}`
            : base,
      };
    });
  });
};

/**
 * Every corner in the track's sections, in lap order, labelled.
 *
 * Straights are left out, and so is any section that starts before the one
 * kept ahead of it has ended.
 */
export const trackCornersFrom = (
  sections: readonly LovelyTrackSection[],
  labelStyle: CornerLabelStyle
): TrackCorner[] => {
  const sorted = sections
    .filter((s) => s.type !== 'straight')
    .sort((a, b) => a.start_pct - b.start_pct);

  // Sections in the bundled track data very occasionally overlap — 7 of 131
  // tracks, always a metre-scale start offset between two halves of one
  // corner (Virginia's T19a/T19b, Barcelona's Seat/T6). Two overlapping
  // ranges would report one stretch of road twice, so keep the first and
  // drop whatever starts before it ends. Comparing against the last section
  // *kept* rather than the last one seen matters if a chain ever overlaps:
  // the one before may itself have been dropped.
  const kept: LovelyTrackSection[] = [];
  for (const section of sorted) {
    const last = kept[kept.length - 1];
    // A kept section that wraps the start/finish line has end < start;
    // nothing later in a start_pct-sorted list can overlap it.
    if (
      !last ||
      last.end_pct < last.start_pct ||
      section.start_pct >= last.end_pct
    ) {
      kept.push(section);
    }
  }
  return labelCorners(kept, labelStyle);
};
