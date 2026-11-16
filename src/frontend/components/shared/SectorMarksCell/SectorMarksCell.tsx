import { memo } from 'react';
import type { SectorMarkTone } from '@irdashies/domain/sectors/sectorMarks';

interface SectorMarksCellProps {
  /** The car's most recent first, second and third sector. */
  s1: SectorMarkTone;
  s2: SectorMarkTone;
  s3: SectorMarkTone;
  compactMode?: string;
}

const TONE_CLASS: Record<SectorMarkTone, string> = {
  classBest: 'bg-purple-400',
  ownBest: 'bg-green-400',
  slower: 'bg-amber-400',
  none: 'bg-slate-600',
};

const TONE_TEXT: Record<SectorMarkTone, string> = {
  classBest: 'best of the class',
  ownBest: 'own best',
  slower: 'slower than own best',
  none: 'no time yet',
};

/**
 * A car's three sectors as three small squares, for a timing table with no
 * room for the times: purple for the best of the class, green for the car's
 * own best, amber for slower than that, grey where there is no time yet.
 *
 * The colours are decided by `carSectorMarks`; this only draws them.
 */
export const SectorMarksCell = memo(
  ({ s1, s2, s3, compactMode }: SectorMarksCellProps) => {
    const pxClass = compactMode === 'ultra' ? '' : 'px-1';
    const tones = [s1, s2, s3];
    return (
      <td
        data-column="sectors"
        className={`w-auto ${pxClass} text-center align-middle whitespace-nowrap`}
      >
        <span
          role="img"
          aria-label={tones
            .map((tone, index) => `S${index + 1} ${TONE_TEXT[tone]}`)
            .join(', ')}
          className="inline-flex items-center gap-[3px] align-middle"
        >
          {tones.map((tone, index) => (
            <span
              // The three sectors never change places.
              key={index}
              data-sector={index + 1}
              data-tone={tone}
              className={`size-3 rounded-[2px] ${TONE_CLASS[tone]}`}
            />
          ))}
        </span>
      </td>
    );
  }
);

SectorMarksCell.displayName = 'SectorMarksCell';
