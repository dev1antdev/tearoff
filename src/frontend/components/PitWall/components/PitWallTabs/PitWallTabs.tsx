import { memo, useEffect, useRef } from 'react';
import type { PitWallTab, PitWallTabId } from '@irdashies/types';

interface PitWallTabsProps {
  tabs: readonly PitWallTab[];
  /** The tab in front. */
  tab: PitWallTabId;
  onTabChange: (tab: PitWallTabId) => void;
}

/**
 * The bar under the header of a layout made of tabs: one button a tab, as
 * tall as a finger needs. On a page too narrow for all of them the bar
 * scrolls sideways by itself, so the page never does.
 */
export const PitWallTabs = memo(
  ({ tabs, tab, onTabChange }: PitWallTabsProps) => {
    const front = useRef<HTMLButtonElement>(null);
    // On a phone the tab in front may be one the bar has scrolled away: the
    // page opens on the tab it was left on, which can be the last of seven.
    useEffect(() => {
      front.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }, [tab]);

    return (
      <nav
        aria-label="Tabs"
        className="settings-shell flex shrink-0 gap-1.5 overflow-x-auto border-b border-slate-700 bg-slate-950 px-3.5 py-2"
      >
        {tabs.map((option) => (
          <button
            key={option.id}
            ref={option.id === tab ? front : undefined}
            type="button"
            aria-pressed={option.id === tab}
            onClick={() => onTabChange(option.id)}
            className={[
              'min-h-11 shrink-0 rounded-md border px-4 text-sm transition-colors',
              option.id === tab
                ? 'border-accent-500 bg-accent-500 font-bold text-white'
                : 'border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white',
            ].join(' ')}
          >
            {option.label}
          </button>
        ))}
      </nav>
    );
  }
);
PitWallTabs.displayName = 'PitWallTabs';
