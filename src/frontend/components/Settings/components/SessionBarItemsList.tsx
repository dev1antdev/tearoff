import { useCallback } from 'react';
import { DotsSixVerticalIcon } from '@phosphor-icons/react';
import { ToggleSwitch } from './ToggleSwitch';
import { ReorderControls } from './ReorderControls';
import { useSortableList } from '../../SortableList';
import { SESSION_BAR_ITEM_LABELS } from '../sessionBarConstants';
import type {
  TrackClockFormat,
  TrackClockTimeScaleDisplay,
} from '@irdashies/types';

const getItemId = (item: { id: string }) => item.id;

export interface SessionBarItemConfig {
  enabled: boolean;
  unit?: 'Metric' | 'Imperial';
  mode?: 'Remaining' | 'Elapsed';
  totalFormat?: 'hh:mm' | 'minimal';
  labelStyle?: 'none' | 'short' | 'minimal';
  speedPosition?: 'left' | 'right';
  hideIfSingleMake?: boolean;
  hideIfSingleDriver?: boolean;
  /**
   * How the item is written. The in-game clock: locale, 24 h or 12 h.
   * Session laps: the lap number, or laps done against the projection.
   */
  format?: TrackClockFormat | 'lap' | 'progress';
  /** The in-game clock: when the day's speed is shown beside it. */
  timeScale?: TrackClockTimeScaleDisplay;
  /** Session laps, progress format: the "+1" / "-1" at the flag. */
  showExtraLaps?: boolean;
  /** Position change: which grid it is measured on. */
  scope?: 'class' | 'overall';
}

interface SessionBarItemsListProps {
  items: string[];
  onReorder: (newOrder: string[]) => void;
  getItemConfig: (id: string) => SessionBarItemConfig | undefined;
  updateItemConfig: (id: string, config: Partial<SessionBarItemConfig>) => void;
}

export const SessionBarItemsList = ({
  items,
  onReorder,
  getItemConfig,
  updateItemConfig,
}: SessionBarItemsListProps) => {
  // Move targets and announcements describe the rows users can actually see.
  const wrappedItems = items
    .filter((id) => Boolean(getItemConfig(id)))
    .map((id) => ({ id }));
  const handleReorder = useCallback(
    (newItems: { id: string }[]) => {
      const renderedIds = new Set(newItems.map((item) => item.id));
      let renderedIndex = 0;
      // Unknown/unconfigured saved IDs retain their slots for future recovery.
      onReorder(
        items.map((id) =>
          renderedIds.has(id) ? newItems[renderedIndex++].id : id
        )
      );
    },
    [items, onReorder]
  );

  const { getItemProps, displayItems } = useSortableList({
    items: wrappedItems,
    onReorder: handleReorder,
    getItemId,
  });

  return (
    <div className="space-y-3">
      {displayItems.map((item) => {
        const {
          dragHandleProps,
          itemProps,
          onMoveUp,
          onMoveDown,
          position,
          total,
        } = getItemProps(item);
        const itemConfig = getItemConfig(item.id);

        if (!itemConfig) {
          return null;
        }

        return (
          <div
            key={item.id}
            {...itemProps}
            className="border-b border-slate-700 pb-3"
          >
            <div className="group flex min-h-9 items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2 flex-1">
                <div
                  {...dragHandleProps}
                  className="cursor-grab opacity-60 hover:opacity-100 transition-opacity p-1 hover:bg-settings-hover rounded"
                >
                  <DotsSixVerticalIcon size={16} className="text-slate-400" />
                </div>
                <span className="text-md text-slate-300">
                  {SESSION_BAR_ITEM_LABELS[item.id]}
                </span>
              </div>
              <ReorderControls
                label={SESSION_BAR_ITEM_LABELS[item.id]}
                position={position}
                total={total}
                onMoveUp={onMoveUp}
                onMoveDown={onMoveDown}
              />
              <ToggleSwitch
                ariaLabel={SESSION_BAR_ITEM_LABELS[item.id]}
                enabled={itemConfig.enabled}
                onToggle={(enabled) => updateItemConfig(item.id, { enabled })}
              />
            </div>

            {(item.id === 'airTemperature' || item.id === 'trackTemperature') &&
              itemConfig.enabled && (
                <div className="mt-2 grid max-w-xl grid-cols-2 gap-3 pl-8 sm:grid-cols-3">
                  <label className="flex min-w-0 flex-col gap-1 text-xs text-slate-400">
                    <span>Units</span>
                    <select
                      aria-label={`${SESSION_BAR_ITEM_LABELS[item.id]} units`}
                      value={itemConfig.unit ?? 'Metric'}
                      onChange={(e) =>
                        updateItemConfig(item.id, {
                          unit: e.target.value as 'Metric' | 'Imperial',
                        })
                      }
                      className="settings-field w-full"
                    >
                      <option value="Metric">°C</option>
                      <option value="Imperial">°F</option>
                    </select>
                  </label>
                </div>
              )}

            {item.id === 'wind' && itemConfig.enabled && (
              <div className="mt-2 flex flex-wrap items-center gap-2 pl-8">
                <span className="text-xs text-slate-400">Speed position</span>
                {(['left', 'right'] as const).map((pos) => {
                  const currentPos = itemConfig.speedPosition ?? 'right';
                  const arrow = (
                    <svg
                      viewBox="50 80 650 720"
                      className="w-3 h-3.5 fill-current shrink-0"
                      style={{ rotate: '-14deg' }}
                    >
                      <path
                        fillRule="nonzero"
                        d="m373.75 91.496c-0.95-1.132-74.87 153.23-164.19 343.02-160.8 341.68-162.27 345.16-156.49 350.27 3.203 2.83 6.954 4.79 8.319 4.34 1.365-0.46 71.171-73.88 155.14-163.1 83.97-89.22 153.66-162.83 154.87-163.56 1.2-0.72 71.42 72.34 156.04 162.29s155.21 163.82 156.95 164.19 5.57-1.19 8.5-3.44c5.04-3.86-3.75-23.46-156.04-348-88.77-189.18-162.15-344.88-163.1-346.01z"
                      />
                    </svg>
                  );
                  return (
                    <button
                      key={pos}
                      type="button"
                      onClick={() =>
                        updateItemConfig(item.id, { speedPosition: pos })
                      }
                      aria-pressed={currentPos === pos}
                      aria-label={`Wind speed on ${pos}`}
                      className="settings-button aria-pressed:border-accent-400 aria-pressed:bg-accent-400/10 aria-pressed:text-accent-200"
                    >
                      {pos === 'left' ? (
                        <>
                          <span>7</span>
                          {arrow}
                        </>
                      ) : (
                        <>
                          {arrow}
                          <span>7</span>
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {item.id === 'sessionLaps' && itemConfig.enabled && (
              <div className="mt-2 grid max-w-xl grid-cols-2 gap-3 pl-8 sm:grid-cols-3">
                <label className="flex min-w-0 flex-col gap-1 text-xs text-slate-400">
                  <span>Mode</span>
                  <select
                    aria-label={`${SESSION_BAR_ITEM_LABELS[item.id]} mode`}
                    value={itemConfig.mode ?? 'Elapsed'}
                    onChange={(e) =>
                      updateItemConfig(item.id, {
                        mode: e.target.value as 'Elapsed' | 'Remaining',
                      })
                    }
                    className="settings-field w-full"
                  >
                    <option value="Elapsed">Elapsed</option>
                    <option value="Remaining">Remaining</option>
                  </select>
                </label>
                <label className="flex min-w-0 flex-col gap-1 text-xs text-slate-400">
                  <span>Format</span>
                  <select
                    aria-label={`${SESSION_BAR_ITEM_LABELS[item.id]} format`}
                    value={itemConfig.format ?? 'lap'}
                    onChange={(e) =>
                      updateItemConfig(item.id, {
                        format: e.target.value as 'lap' | 'progress',
                      })
                    }
                    className="settings-field w-full"
                  >
                    <option value="lap">Lap (L3 / 11.6)</option>
                    <option value="progress">Progress (2.72 / ~10.3)</option>
                  </select>
                </label>
                {itemConfig.format === 'progress' && (
                  <div className="col-span-full flex items-center justify-between gap-3">
                    <span className="text-sm text-slate-300">
                      Show laps added or taken at the flag (+1 / -1)
                    </span>
                    <ToggleSwitch
                      ariaLabel={`${SESSION_BAR_ITEM_LABELS[item.id]} extra laps`}
                      enabled={itemConfig.showExtraLaps ?? true}
                      onToggle={(v) =>
                        updateItemConfig(item.id, { showExtraLaps: v })
                      }
                    />
                  </div>
                )}
              </div>
            )}

            {item.id === 'positionChange' && itemConfig.enabled && (
              <div className="mt-2 grid max-w-xl grid-cols-2 gap-3 pl-8 sm:grid-cols-3">
                <label className="flex min-w-0 flex-col gap-1 text-xs text-slate-400">
                  <span>Measured on</span>
                  <select
                    aria-label={`${SESSION_BAR_ITEM_LABELS[item.id]} scope`}
                    value={itemConfig.scope ?? 'class'}
                    onChange={(e) =>
                      updateItemConfig(item.id, {
                        scope: e.target.value as 'class' | 'overall',
                      })
                    }
                    className="settings-field w-full"
                  >
                    <option value="class">Class grid</option>
                    <option value="overall">Overall grid</option>
                  </select>
                </label>
              </div>
            )}

            {item.id === 'sessionClockTime' && itemConfig.enabled && (
              <div className="mt-2 grid max-w-xl grid-cols-2 gap-3 pl-8 sm:grid-cols-3">
                <label className="flex min-w-0 flex-col gap-1 text-xs text-slate-400">
                  <span>Format</span>
                  <select
                    aria-label={`${SESSION_BAR_ITEM_LABELS[item.id]} format`}
                    value={itemConfig.format ?? 'locale'}
                    onChange={(e) =>
                      updateItemConfig(item.id, {
                        format: e.target.value as TrackClockFormat,
                      })
                    }
                    className="settings-field w-full"
                  >
                    <option value="locale">System</option>
                    <option value="24h">15:12</option>
                    <option value="12h">3:12 PM</option>
                  </select>
                </label>
                <label className="flex min-w-0 flex-col gap-1 text-xs text-slate-400">
                  <span>Time scale</span>
                  <select
                    aria-label={`${SESSION_BAR_ITEM_LABELS[item.id]} time scale`}
                    value={itemConfig.timeScale ?? 'whenScaled'}
                    onChange={(e) =>
                      updateItemConfig(item.id, {
                        timeScale: e.target.value as TrackClockTimeScaleDisplay,
                      })
                    }
                    className="settings-field w-full"
                  >
                    <option value="whenScaled">When not real time</option>
                    <option value="always">Always</option>
                    <option value="never">Never</option>
                  </select>
                </label>
                <p className="col-span-full text-xs text-slate-500">
                  The time scale is how fast the in-game day runs: x2 is twice
                  real time, x0 a time of day that stands still. It is measured
                  from the sim&apos;s two clocks, so it appears a few seconds
                  into a session.
                </p>
              </div>
            )}

            {item.id === 'manufacturerPosition' && itemConfig.enabled && (
              <div className="flex flex-col gap-2 pl-4 mt-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-300">
                    Hide if single make in session
                  </span>
                  <ToggleSwitch
                    enabled={itemConfig.hideIfSingleMake ?? false}
                    onToggle={(v) =>
                      updateItemConfig(item.id, { hideIfSingleMake: v })
                    }
                  />
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-slate-300">
                    Hide if only driver of that make
                  </span>
                  <ToggleSwitch
                    enabled={itemConfig.hideIfSingleDriver ?? false}
                    onToggle={(v) =>
                      updateItemConfig(item.id, { hideIfSingleDriver: v })
                    }
                  />
                </div>
              </div>
            )}

            {item.id === 'sessionTime' && itemConfig.enabled && (
              <div className="mt-2 grid max-w-xl grid-cols-2 gap-3 pl-8 sm:grid-cols-3">
                <label className="flex min-w-0 flex-col gap-1 text-xs text-slate-400">
                  <span>Mode</span>
                  <select
                    aria-label={`${SESSION_BAR_ITEM_LABELS[item.id]} mode`}
                    value={itemConfig.mode ?? 'Remaining'}
                    onChange={(e) =>
                      updateItemConfig(item.id, {
                        mode: e.target.value as 'Remaining' | 'Elapsed',
                      })
                    }
                    className="settings-field w-full"
                  >
                    <option value="Remaining">Remaining</option>
                    <option value="Elapsed">Elapsed</option>
                  </select>
                </label>
                <label className="flex min-w-0 flex-col gap-1 text-xs text-slate-400">
                  <span>Format</span>
                  <select
                    aria-label={`${SESSION_BAR_ITEM_LABELS[item.id]} total format`}
                    value={itemConfig.totalFormat ?? 'minimal'}
                    onChange={(e) =>
                      updateItemConfig(item.id, {
                        totalFormat: e.target.value as 'hh:mm' | 'minimal',
                      })
                    }
                    className="settings-field w-full"
                  >
                    <option value="minimal">2:34</option>
                    <option value="hh:mm">00:12:34</option>
                  </select>
                </label>
                <label className="flex min-w-0 flex-col gap-1 text-xs text-slate-400">
                  <span>Labels</span>
                  <select
                    aria-label={`${SESSION_BAR_ITEM_LABELS[item.id]} label style`}
                    value={itemConfig.labelStyle ?? 'minimal'}
                    onChange={(e) =>
                      updateItemConfig(item.id, {
                        labelStyle: e.target.value as
                          'none' | 'short' | 'minimal',
                      })
                    }
                    className="settings-field w-full"
                  >
                    <option value="minimal">Minimal Labels</option>
                    <option value="short">Short Labels</option>
                    <option value="none">Hide Labels</option>
                  </select>
                </label>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};
