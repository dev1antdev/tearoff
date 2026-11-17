import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { PIT_WALL_LAYOUTS, type PitWallTabId } from '@irdashies/types';
import { PitWallTabs } from './PitWallTabs';

const TABS = PIT_WALL_LAYOUTS.compact.tabs;

/** The bar with a tab in front that a press changes, as on the page. */
const Bar = ({ first, width }: { first: PitWallTabId; width: number }) => {
  const [tab, setTab] = useState(first);
  return (
    <div className="bg-settings-page" style={{ width }}>
      <PitWallTabs tabs={TABS} tab={tab} onTabChange={setTab} />
    </div>
  );
};

const meta: Meta<typeof Bar> = {
  component: Bar,
  title: 'widgets/PitWall/PitWallTabs',
  parameters: { layout: 'fullscreen' },
  args: { first: 'overview', width: 1180 },
};
export default meta;
type Story = StoryObj<typeof Bar>;

/** The tabs of the Compact layout across a tablet. */
export const Tablet: Story = {};

/** Another tab in front. */
export const StrategyInFront: Story = { args: { first: 'strategy' } };

/**
 * On a phone the seven tabs are wider than the page: the bar scrolls
 * sideways and the page does not.
 */
export const Phone: Story = { args: { width: 390 } };
