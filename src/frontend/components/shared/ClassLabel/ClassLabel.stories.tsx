import type { Meta, StoryObj } from '@storybook/react-vite';
import { LMU_CLASS_COLOURS } from '@irdashies/types';
import { ClassLabel } from './ClassLabel';

const meta: Meta<typeof ClassLabel> = {
  component: ClassLabel,
  title: 'shared/ClassLabel',
  parameters: {
    layout: 'centered',
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

const HIGHLIGHT = 960745;

/** The classes of a Le Mans Ultimate grid and an iRacing one, as labelled. */
export const Classes: Story = {
  render: () => (
    <div className="flex flex-col gap-3 rounded bg-slate-800 p-4 text-sm text-white">
      <div className="flex items-center gap-2">
        {Object.entries(LMU_CLASS_COLOURS).map(([name, color]) => (
          <ClassLabel
            key={name}
            name={name}
            color={color}
            highlightColor={HIGHLIGHT}
            isMultiClass
            className="px-2 py-1"
          />
        ))}
      </div>
      <div className="flex items-center gap-2">
        <ClassLabel
          name="GTP"
          color={0xffda59}
          isMultiClass
          className="px-2 py-1"
        />
        <ClassLabel
          name="LMP2"
          color={0x33ceff}
          isMultiClass
          className="px-2 py-1"
        />
        <ClassLabel
          name="GT3"
          color={0xff5888}
          isMultiClass
          className="px-2 py-1"
        />
      </div>
    </div>
  ),
};

/** A single-class session takes the highlight colour instead. */
export const SingleClass: Story = {
  args: {
    name: 'GT3 2025',
    color: 0xff5888,
    highlightColor: HIGHLIGHT,
    isMultiClass: false,
    className: 'px-2 py-1 text-sm text-white',
  },
};

/** Not filled: only the bottom border carries the class colour. */
export const BorderOnly: Story = {
  args: {
    name: 'Hypercar',
    color: LMU_CLASS_COLOURS.Hypercar,
    isMultiClass: true,
    filled: false,
    className: 'border-b-2 px-2 py-1 text-sm text-white',
  },
};

/** At the small size the flag panel uses for the car a blue is for. */
export const Small: Story = {
  args: {
    name: 'LMGT3',
    color: LMU_CLASS_COLOURS.LMGT3,
    isMultiClass: true,
    className: 'rounded-sm px-1.5 py-0.5 text-xs text-white',
  },
};
