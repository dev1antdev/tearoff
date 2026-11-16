import type { Meta, StoryObj } from '@storybook/react-vite';
import type { SectorMarkTone } from '@irdashies/domain/sectors/sectorMarks';
import { SectorMarksCell } from './SectorMarksCell';

const meta: Meta<typeof SectorMarksCell> = {
  component: SectorMarksCell,
  title: 'shared/SectorMarksCell',
  parameters: {
    layout: 'centered',
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

const ROWS: {
  label: string;
  tones: [SectorMarkTone, SectorMarkTone, SectorMarkTone];
}[] = [
  {
    label: 'A lap with the class’s best first sector',
    tones: ['classBest', 'ownBest', 'slower'],
  },
  {
    label: 'The car’s own best lap, somebody else quicker in each',
    tones: ['ownBest', 'ownBest', 'ownBest'],
  },
  {
    label: 'A slower lap',
    tones: ['slower', 'slower', 'slower'],
  },
  {
    label: 'The first lap, two sectors in',
    tones: ['classBest', 'ownBest', 'none'],
  },
  {
    label: 'No time yet',
    tones: ['none', 'none', 'none'],
  },
];

/** Every colour of the three squares, as a row of a timing table has them. */
export const States: Story = {
  render: () => (
    <table className="border-separate border-spacing-y-0.5 rounded bg-slate-800 p-2 text-sm text-white">
      <tbody>
        {ROWS.map((row) => (
          <tr
            key={row.label}
            className="odd:bg-slate-800/70 even:bg-slate-900/70"
          >
            <td className="px-2 text-slate-400">{row.label}</td>
            <SectorMarksCell
              s1={row.tones[0]}
              s2={row.tones[1]}
              s3={row.tones[2]}
            />
          </tr>
        ))}
      </tbody>
    </table>
  ),
};
