import type { Meta, StoryObj } from '@storybook/react-vite';
import { LastTimeCell } from './LastTimeCell';

const meta: Meta<typeof LastTimeCell> = {
  component: LastTimeCell,
  title: 'shared/LastTimeCell',
  parameters: {
    layout: 'centered',
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

const ROWS: {
  label: string;
  time: string;
  state?: 'session-fastest' | 'personal-best';
  invalid?: boolean;
}[] = [
  { label: 'A lap', time: '1:33.218' },
  { label: 'Session fastest', time: '1:31.004', state: 'session-fastest' },
  { label: 'Personal best', time: '1:31.870', state: 'personal-best' },
  { label: 'Did not count', time: '1:37.412', invalid: true },
  {
    label: 'Did not count, at the best time',
    time: '1:31.004',
    state: 'session-fastest',
    invalid: true,
  },
  { label: 'No lap yet', time: '' },
];

/** Every state of the last-lap cell, as a standings row prints it. */
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
            <LastTimeCell
              lastTimeString={row.time}
              lastTimeState={row.state}
              invalid={row.invalid}
            />
          </tr>
        ))}
      </tbody>
    </table>
  ),
};
