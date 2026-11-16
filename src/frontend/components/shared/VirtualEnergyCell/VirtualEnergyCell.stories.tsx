import type { Meta, StoryObj } from '@storybook/react-vite';
import { VirtualEnergyCell } from './VirtualEnergyCell';

const meta = {
  component: VirtualEnergyCell,
  title: 'widgets/Standings/components/DriverInfoRow/VirtualEnergyCell',
} satisfies Meta<typeof VirtualEnergyCell>;

export default meta;
type Story = StoryObj<typeof meta>;

const ROWS: {
  label: string;
  remaining?: number;
  isVirtual?: boolean;
}[] = [
  { label: 'Hypercar, energy', remaining: 0.82, isVirtual: true },
  { label: 'LMGT3, energy low', remaining: 0.24, isVirtual: true },
  { label: 'LMGT3, energy critical', remaining: 0.07, isVirtual: true },
  { label: 'Hypercar, out of energy', remaining: 0, isVirtual: true },
  { label: 'LMP2, fuel', remaining: 0.64, isVirtual: false },
  { label: 'LMP2, fuel low', remaining: 0.22, isVirtual: false },
  { label: 'LMP3, fuel critical', remaining: 0.08, isVirtual: false },
  { label: 'No reading', remaining: undefined, isVirtual: false },
];

/**
 * A mixed grid under the one VE heading. Energy figures stand bare; a fuel
 * figure carries a pump, so an LMP2 is not read as having virtual energy.
 */
export const MixedGrid: Story = {
  render: () => (
    <table className="text-sm text-white border-separate border-spacing-y-0.5">
      <thead>
        <tr className="text-xs text-slate-400">
          <th className="px-2 text-left font-normal">Car</th>
          <th className="px-1 text-right font-normal">VE</th>
        </tr>
      </thead>
      <tbody>
        {ROWS.map((row) => (
          <tr
            key={row.label}
            className="odd:bg-slate-800/70 even:bg-slate-900/70"
          >
            <td className="px-2 whitespace-nowrap">{row.label}</td>
            <VirtualEnergyCell
              remaining={row.remaining}
              isVirtual={row.isVirtual}
            />
          </tr>
        ))}
      </tbody>
    </table>
  ),
};

export const Energy: Story = {
  args: { remaining: 0.42, isVirtual: true },
  decorators: [
    (Story) => (
      <table className="text-sm text-white">
        <tbody>
          <tr>
            <Story />
          </tr>
        </tbody>
      </table>
    ),
  ],
};

export const Fuel: Story = {
  ...Energy,
  args: { remaining: 0.42, isVirtual: false },
};
