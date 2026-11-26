import type { Meta, StoryObj } from '@storybook/react-vite';
import { ThermometerIcon } from '@phosphor-icons/react';
import { WeatherRow } from './WeatherRow';

export default {
  component: WeatherRow,
  title: 'widgets/Weather/components/WeatherRow',
} as Meta;

type Story = StoryObj<typeof WeatherRow>;

export const Primary: Story = {
  args: {
    title: 'Air Temp',
    value: '19°C',
    icon: ThermometerIcon,
  },
};
