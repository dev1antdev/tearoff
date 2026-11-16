import { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { SettingNumberListRow } from './SettingNumberListRow';

const meta: Meta<typeof SettingNumberListRow> = {
  component: SettingNumberListRow,
  title: 'components/SettingNumberListRow',
  decorators: [
    (Story) => (
      <div className="w-[760px] bg-slate-900 p-6 text-white">
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof meta>;

const nextValue = (values: readonly number[]) => (values.at(-1) ?? 20) + 10;

/** Four values with room for two more. */
export const Default: Story = {
  render: () => {
    const [values, setValues] = useState([30, 40, 50, 60]);
    return (
      <SettingNumberListRow
        title="Stop Lengths"
        description="Time lost in the pits, one column each."
        values={values}
        min={0}
        max={300}
        units="s"
        maxItems={6}
        nextValue={nextValue}
        onChange={setValues}
      />
    );
  },
};

/** A full list: nothing more can be added. */
export const Full: Story = {
  render: () => {
    const [values, setValues] = useState([20, 30, 40, 50, 60, 90]);
    return (
      <SettingNumberListRow
        title="Stop Lengths"
        description="Time lost in the pits, one column each."
        values={values}
        min={0}
        max={300}
        units="s"
        maxItems={6}
        nextValue={nextValue}
        onChange={setValues}
      />
    );
  },
};

/** An empty list. */
export const Empty: Story = {
  render: () => {
    const [values, setValues] = useState<number[]>([]);
    return (
      <SettingNumberListRow
        title="Stop Lengths"
        values={values}
        min={0}
        max={300}
        units="s"
        maxItems={6}
        nextValue={nextValue}
        onChange={setValues}
      />
    );
  },
};
