import { useEffect } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { DashboardProvider } from '@irdashies/context';
import { mockDashboardBridge } from '@irdashies/storybook';
import { WearSettings } from './WearSettings';

const meta = {
  title: 'components/Settings/WearSettings',
  component: WearSettings,
  decorators: [
    (Story) => (
      <DashboardProvider bridge={mockDashboardBridge}>
        <div className="w-[880px] bg-slate-900 p-6 text-white">
          <Story />
        </div>
      </DashboardProvider>
    ),
  ],
  parameters: { layout: 'centered' },
} satisfies Meta<typeof WearSettings>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Scrolls the page to a section once its dashboard has loaded. */
const useScrollTo = (title: string) =>
  useEffect(() => {
    // The page waits for its dashboard, so the section is not there at mount.
    const timer = window.setInterval(() => {
      const heading = [...document.querySelectorAll('h3')].find(
        (element) => element.textContent === title
      );
      if (!heading) return;
      heading.scrollIntoView();
      window.clearInterval(timer);
    }, 50);
    return () => window.clearInterval(timer);
  }, [title]);

/** The top of the page, as a new dashboard has it. */
export const Options: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('wearTab', 'options');
      return <Story />;
    },
  ],
};

/** The tyre section: what is shown, the end of life and the warnings. */
export const Tyres: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('wearTab', 'options');
      useScrollTo('Tyres');
      return <Story />;
    },
  ],
};

/**
 * The brake section: the note on where the thickness comes from, the large
 * figure, and the two failure thicknesses the sim does not state.
 */
export const Brakes: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('wearTab', 'options');
      useScrollTo('Brakes');
      return <Story />;
    },
  ],
};

/** The sessions the widget shows in, and whether it hides off track. */
export const Visibility: Story = {
  decorators: [
    (Story) => {
      localStorage.setItem('wearTab', 'visibility');
      return <Story />;
    },
  ],
};
