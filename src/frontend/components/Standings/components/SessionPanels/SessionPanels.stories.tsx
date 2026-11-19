import type { Meta, StoryObj } from '@storybook/react-vite';
import { getWidgetDefaultConfig } from '@irdashies/types';
import SessionBarStories from '../SessionBar/SessionBar.stories';
import { SessionPanels } from './SessionPanels';

const standings = getWidgetDefaultConfig('standings');

const meta: Meta<typeof SessionPanels> = {
  component: SessionPanels,
  title: 'widgets/Standings/components/SessionPanels',
  // The session bars read the same snapshots as the SessionBar stories.
  decorators: SessionBarStories.decorators,
  args: {
    header: standings.headerBar,
    footer: standings.footerBar,
    barOpacity: 70,
    compact: false,
    children: (
      <div
        className="overlay-panel p-2 text-sm text-white"
        style={{ ['--bg-opacity' as string]: '80%' }}
      >
        The widget&apos;s own panel
      </div>
    ),
  },
};
export default meta;

type Story = StoryObj<typeof SessionPanels>;

export const HeaderAndFooter: Story = {};

export const Compact: Story = { args: { compact: true } };

export const FooterOnly: Story = { args: { header: undefined } };
