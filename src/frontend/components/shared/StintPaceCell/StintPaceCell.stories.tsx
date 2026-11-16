import type { Meta, StoryObj } from '@storybook/react-vite';
import { StintPaceCell } from './StintPaceCell';

const meta: Meta<typeof StintPaceCell> = {
  component: StintPaceCell,
  title: 'shared/StintPaceCell',
  parameters: {
    layout: 'centered',
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

const ROWS: { label: string; delta: number | null }[] = [
  { label: 'Quicker than the stint before', delta: -0.38 },
  { label: 'Slower', delta: 0.42 },
  { label: 'Much slower', delta: 12.07 },
  { label: 'Level to the hundredth', delta: 0.003 },
  { label: 'Fewer than three clean laps, or no earlier stint', delta: null },
];

/** Every state of the cell, as a row of a timing table prints it. */
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
            <StintPaceCell delta={row.delta} />
          </tr>
        ))}
      </tbody>
    </table>
  ),
};
