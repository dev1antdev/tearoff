import { memo, useEffect, useRef, useState } from 'react';
import {
  ArrowCounterClockwiseIcon,
  CheckIcon,
  PencilSimpleIcon,
  PlusIcon,
} from '@phosphor-icons/react';
import type { PitWallCellSize, WidgetId } from '@irdashies/types';
import { cellSizeLabel } from '../../pitWallCustomEdit';

/** A widget the page can host and does not, as the Add panel list offers it. */
export interface PitWallAddable {
  widget: WidgetId;
  /** The widget's name, as the settings menu has it. */
  title: string;
  /** See `PitWallHostable.kind`: the list is in two parts. */
  kind: 'panel' | 'overlay';
  /** The size its panel is added at. */
  size: PitWallCellSize;
  /** The page has a free place of that size. */
  hasRoom: boolean;
  /** Said beside it: that the running sim cannot show it, for one. */
  note?: string;
}

interface PitWallEditBarProps {
  /** What can be added, in the order to list it. */
  addable: readonly PitWallAddable[];
  /** What the last thing asked for could not be given; empty for nothing. */
  message: string;
  /** The id to give the words on arranging by keyboard, for the panels to point at. */
  hintId: string;
  /** Adds a panel of the widget. False where the page had no room for it. */
  onAdd: (widget: WidgetId) => boolean;
  /** Brings back the panels the layout starts with. Asked about first, here. */
  onReset: () => void;
  onCancel: () => void;
  onDone: () => void;
}

const GROUPS = [
  { kind: 'panel', label: 'Pit Wall panels' },
  { kind: 'overlay', label: 'Overlay widgets' },
] as const;

/**
 * The bar under the header while the Custom layout is being arranged: how
 * it is done, what the last attempt came to, and the four things to do
 * besides dragging. Add panel opens the list of what the page can host and
 * does not; Reset asks before it brings back the copy of Race; Cancel and
 * Done end the edit.
 */
export const PitWallEditBar = memo(
  ({
    addable,
    message,
    hintId,
    onAdd,
    onReset,
    onCancel,
    onDone,
  }: PitWallEditBarProps) => {
    const [adding, setAdding] = useState(false);
    const [asking, setAsking] = useState(false);
    const add = useRef<HTMLDivElement>(null);
    const first = useRef<HTMLButtonElement>(null);

    // The button that began the edit is gone from the header: the keyboard
    // goes on from the first thing here.
    useEffect(() => first.current?.focus(), []);

    // The list closes on a press anywhere else and on Escape, as a menu does.
    useEffect(() => {
      if (!adding) return;
      const onDown = (event: PointerEvent) => {
        if (!add.current?.contains(event.target as Node)) setAdding(false);
      };
      const onKey = (event: KeyboardEvent) => {
        if (event.key === 'Escape') setAdding(false);
      };
      window.addEventListener('pointerdown', onDown);
      window.addEventListener('keydown', onKey);
      return () => {
        window.removeEventListener('pointerdown', onDown);
        window.removeEventListener('keydown', onKey);
      };
    }, [adding]);

    return (
      <div
        role="group"
        aria-label="Edit layout"
        className="settings-shell flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-700 bg-slate-950 px-4 py-2 text-slate-200"
      >
        <p className="flex shrink-0 items-center gap-2 text-sm font-semibold text-white">
          <PencilSimpleIcon size={16} className="text-accent-400" />
          Editing the Custom layout
        </p>
        {/* What the last attempt came to takes the place of how it is done,
            and not a line of its own: a line that came and went would move
            the page under the pointer that is about to drag. How it is done
            stays for a reader, whom the panels point at it. */}
        <p
          id={hintId}
          className={
            message
              ? 'sr-only'
              : 'min-w-0 flex-1 basis-72 text-xs text-slate-400'
          }
        >
          Drag a panel by its title bar to move it, and by its lower right
          corner to size it. With a panel in focus the arrow keys move it and
          Shift with an arrow key sizes it. Nothing is saved until Done.
        </p>
        {message && (
          <p
            aria-hidden="true"
            data-item="edit-message"
            className="min-w-0 flex-1 basis-72 text-sm text-amber-200"
          >
            {message}
          </p>
        )}

        {/* Said to a reader from a region that is always there, so that the
            words are heard when they appear. */}
        <span role="status" className="sr-only">
          {message}
        </span>

        {asking ? (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <p className="text-sm text-slate-300">
              Bring back the panels this layout starts with, a copy of Race?
            </p>
            <button
              type="button"
              className="settings-button-danger"
              onClick={() => {
                setAsking(false);
                onReset();
              }}
            >
              Reset layout
            </button>
            <button
              type="button"
              className="settings-button"
              onClick={() => setAsking(false)}
            >
              Keep editing
            </button>
          </div>
        ) : (
          <div className="ml-auto flex items-center gap-2">
            <div ref={add} className="relative">
              <button
                ref={first}
                type="button"
                className="settings-button"
                aria-expanded={adding}
                onClick={() => setAdding((open) => !open)}
              >
                <PlusIcon size={16} />
                Add panel
              </button>
              {adding && (
                <div
                  data-item="add-list"
                  // Hung from the button, over the page, like a menu.
                  className="absolute top-full right-0 z-30 mt-1.5 max-h-[78vh] w-80 overflow-y-auto rounded-md border border-slate-700 bg-slate-900 py-1 shadow-lg shadow-black/50"
                >
                  {addable.length === 0 && (
                    <p className="px-3 py-2 text-sm text-slate-400">
                      Every panel the page can host is on it already.
                    </p>
                  )}
                  {GROUPS.map(({ kind, label }) => {
                    const items = addable.filter((item) => item.kind === kind);
                    if (items.length === 0) return null;
                    return (
                      <div key={kind} role="group" aria-label={label}>
                        <p className="px-3 pt-2 pb-1 text-[11px] font-semibold tracking-[0.08em] text-slate-400 uppercase">
                          {label}
                        </p>
                        {items.map((item) => (
                          <button
                            key={item.widget}
                            type="button"
                            aria-label={
                              item.hasRoom
                                ? `Add ${item.title}`
                                : `Add ${item.title}: no room`
                            }
                            className={`flex w-full items-center gap-3 px-3 py-1.5 text-left text-sm transition-colors hover:bg-slate-800 focus-visible:-outline-offset-2! ${
                              item.hasRoom ? 'text-slate-200' : 'text-slate-400'
                            }`}
                            onClick={() => {
                              // Left open on a refusal, with the reason in
                              // the bar: another may be tried.
                              if (onAdd(item.widget)) setAdding(false);
                            }}
                          >
                            <span className="min-w-0 flex-1 truncate">
                              {item.title}
                            </span>
                            {item.note && (
                              <span className="shrink-0 text-xs text-slate-400">
                                {item.note}
                              </span>
                            )}
                            <span
                              className={`shrink-0 text-xs tabular-nums ${
                                item.hasRoom
                                  ? 'text-slate-400'
                                  : 'text-amber-300'
                              }`}
                            >
                              {item.hasRoom
                                ? cellSizeLabel(item.size)
                                : `no room for ${cellSizeLabel(item.size)}`}
                            </span>
                          </button>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
            <button
              type="button"
              className="settings-button"
              onClick={() => {
                setAdding(false);
                setAsking(true);
              }}
            >
              <ArrowCounterClockwiseIcon size={16} />
              Reset
            </button>
            <button
              type="button"
              className="settings-button"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              className="settings-button-primary"
              onClick={onDone}
            >
              <CheckIcon size={16} weight="bold" />
              Done
            </button>
          </div>
        )}
      </div>
    );
  }
);
PitWallEditBar.displayName = 'PitWallEditBar';
