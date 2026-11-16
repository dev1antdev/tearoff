import type { Meta, StoryObj } from '@storybook/react-vite';
import { DriverStatusBadges } from './DriverStatusBadges';

const meta: Meta<typeof DriverStatusBadges> = {
  component: DriverStatusBadges,
  title: 'widgets/Standings/components/DriverStatusBadges',
  decorators: [
    (Story) => (
      <div className="bg-slate-800 p-2 text-white inline-block">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof DriverStatusBadges>;

export const DriveThrough: Story = {
  args: { penaltyKind: 'DT' },
};

export const StopGo: Story = {
  args: { penaltyKind: 'SG' },
};

/** LMU's mFinishStatus 1: the checkered flag, where the penalty badge goes. */
export const Finished: Story = {
  args: { finishState: 'FINISHED' },
};

/** LMU's mFinishStatus 2, written out like a penalty. */
export const DidNotFinish: Story = {
  args: { finishState: 'DNF' },
};

/** LMU's mFinishStatus 3, written out like a penalty. */
export const Disqualified: Story = {
  args: { finishState: 'DQ' },
};

/** The checkered flag beside a penalty the car still carries. */
export const FinishedWithPenalty: Story = {
  args: { finishState: 'FINISHED', penaltyKind: 'SG' },
};

/** In the pit lane, with the seconds spent there so far: the rivals box. */
export const InThePitLaneWithTime: Story = {
  args: { pit: true, pitTime: '12.3' },
};

/** Back out, with the seconds the visit took. */
export const OutWithTime: Story = {
  args: { out: true, pitTime: '41.2' },
};

/** Parked in the garage. */
export const InTheGarage: Story = {
  args: { garage: true },
};
