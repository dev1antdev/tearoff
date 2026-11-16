import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { CarChoice } from '@irdashies/domain/raceHistory/carChoice';
import { CarChoiceSelect } from './CarChoiceSelect';

const meta: Meta<typeof CarChoiceSelect> = {
  component: CarChoiceSelect,
  title: 'shared/CarChoiceSelect',
  parameters: { layout: 'centered' },
};

export default meta;
type Story = StoryObj<typeof meta>;

const CHOICES: CarChoice[] = [
  {
    carIdx: 11,
    number: '77',
    name: 'Tearoff Endurance',
    className: 'LMGT3',
    group: 'own',
  },
  {
    carIdx: 8,
    number: '33',
    name: 'Nordwind Racing',
    className: 'LMGT3',
    group: 'class',
  },
  {
    carIdx: 9,
    number: '46',
    name: 'Blue Harbor Motorsport',
    className: 'LMGT3',
    group: 'class',
  },
  {
    carIdx: 0,
    number: '7',
    name: 'Aurora Hypersport',
    className: 'Hypercar',
    group: 'rest',
  },
  {
    carIdx: 4,
    number: '22',
    name: 'Union Row Racing',
    className: 'LMP2',
    group: 'rest',
  },
];

const Chooser = ({ choices }: { choices: CarChoice[] }) => {
  const [carIdx, setCarIdx] = useState(choices[0].carIdx);
  return (
    <div className="rounded bg-slate-800 p-3">
      <CarChoiceSelect choices={choices} value={carIdx} onChange={setCarIdx} />
    </div>
  );
};

/** Our car chosen, in amber: the cars of our class next, then the rest. */
export const OurCar: Story = {
  render: () => <Chooser choices={CHOICES} />,
};

/** With no car of our own in the session the field is one list. */
export const NoCarOfOurOwn: Story = {
  render: () => (
    <Chooser
      choices={CHOICES.map((choice) => ({ ...choice, group: 'rest' }))}
    />
  ),
};
