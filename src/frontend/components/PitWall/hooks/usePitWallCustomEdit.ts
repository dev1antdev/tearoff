import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import {
  PIT_WALL_CUSTOM_START,
  getWidgetManifest,
  pitWallCustomFreeSpace,
  pitWallCustomVerdict,
  pitWallHostable,
  pitWallPanelMinCells,
  sortPitWallCustom,
  type PitWallCells,
  type PitWallCustomPanel,
  type PitWallCustomVerdict,
  type WidgetId,
} from '@irdashies/types';
import {
  cellPitch,
  cellsDragged,
  draggedCells,
  keyStep,
  refusalReason,
  withPanelOn,
  type PanelDragKind,
} from '../pitWallCustomEdit';

/** A panel held by the pointer, and where it would land. */
export interface PanelDrag {
  widget: WidgetId;
  kind: PanelDragKind;
  /** The cells the panel would take if it were let go of now. */
  cells: PitWallCells;
  /** Whether it may have them: let go of on anything but `fits`, it stays. */
  verdict: PitWallCustomVerdict;
}

interface PitWallCustomEditOptions {
  /**
   * The arrangement the page shows: what an edit starts from, and what
   * Cancel goes back to. Undefined on a page that is not the Custom layout.
   */
  saved: readonly PitWallCustomPanel[] | undefined;
  /** The page is the Custom layout where it may be arranged. */
  editable: boolean;
  /** Keeps an arrangement. Called once, by Done. */
  onSave: (panels: readonly PitWallCustomPanel[]) => void;
  /** The element the grid is drawn in, measured when a drag begins. */
  grid: RefObject<HTMLElement | null>;
}

interface Draft {
  panels: PitWallCustomPanel[];
  /** The saved arrangement the edit began from, as text. */
  from: string;
}

const titleOf = (widget: WidgetId): string =>
  getWidgetManifest(widget)?.name ?? widget;

const sameDrag = (a: PanelDrag | null, b: PanelDrag): boolean =>
  a !== null &&
  a.verdict === b.verdict &&
  a.cells.x === b.cells.x &&
  a.cells.y === b.cells.y &&
  a.cells.w === b.cells.w &&
  a.cells.h === b.cells.h;

/**
 * Arranging the Custom layout: a mode the page is put into, in which its
 * panels are moved, sized, added and removed on a copy of the arrangement,
 * and which Done ends by saving the copy and Cancel by dropping it. Nothing
 * is saved in between.
 *
 * A panel is dragged with any pointer, a mouse or a finger: the cells it
 * would take are worked out from how far the pointer has gone, snapped to
 * whole cells, and judged by the one rule (`pitWallCustomVerdict`). Let go
 * of where it fits, it is there; anywhere else, or on Escape, it is where
 * it was. The arrow keys do the same a cell at a time.
 */
export const usePitWallCustomEdit = ({
  saved,
  editable,
  onSave,
  grid,
}: PitWallCustomEditOptions) => {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [drag, setDrag] = useState<PanelDrag | null>(null);
  const [message, setMessage] = useState('');
  /** Ends the drag under way, if one is, without moving anything. */
  const stopDrag = useRef<(() => void) | null>(null);

  const savedKey = useMemo(() => JSON.stringify(saved ?? null), [saved]);
  const editing = draft !== null && editable && draft.from === savedKey;
  // The page stopped being the Custom layout, or the arrangement under the
  // edit was changed from somewhere else, as by choosing another profile:
  // the edit is dropped, never saved over what it did not start from.
  if (draft !== null && !editing) {
    setDraft(null);
    setMessage('');
  }
  useEffect(() => {
    if (!editing) stopDrag.current?.();
  }, [editing]);
  useEffect(() => () => stopDrag.current?.(), []);

  const panels = editing ? draft.panels : undefined;

  const change = useCallback((next: PitWallCustomPanel[]) => {
    setDraft((current) => current && { ...current, panels: next });
    setMessage('');
  }, []);

  const begin = useCallback(() => {
    if (!editable) return;
    setDraft({ panels: [...(saved ?? [])], from: savedKey });
    setMessage('');
  }, [editable, saved, savedKey]);

  const cancel = useCallback(() => {
    stopDrag.current?.();
    setDraft(null);
    setMessage('');
  }, []);

  const done = useCallback(() => {
    stopDrag.current?.();
    if (panels) onSave(sortPitWallCustom(panels));
    setDraft(null);
    setMessage('');
  }, [panels, onSave]);

  /** Brings back the arrangement the layout starts with. */
  const reset = useCallback(() => {
    if (!panels || stopDrag.current) return;
    change([...PIT_WALL_CUSTOM_START]);
  }, [panels, change]);

  /**
   * Puts a panel of the widget in the first free place it fits, at the
   * least size it may have. False, with a word of why, where there is no
   * such place.
   */
  const add = useCallback(
    (widget: WidgetId): boolean => {
      if (
        !panels ||
        stopDrag.current ||
        !pitWallHostable(widget) ||
        panels.some((panel) => panel.widget === widget)
      ) {
        return false;
      }
      const size = pitWallPanelMinCells(widget);
      const place = pitWallCustomFreeSpace(panels, size);
      if (!place) {
        setMessage(
          `No room for ${titleOf(widget)}: it needs ${size.w} by ${size.h} free cells. Move, size or remove a panel to make room.`
        );
        return false;
      }
      change([...panels, { widget, ...place, ...size }]);
      return true;
    },
    [panels, change]
  );

  const remove = useCallback(
    (widget: WidgetId) => {
      if (!panels || stopDrag.current) return;
      change(panels.filter((panel) => panel.widget !== widget));
    },
    [panels, change]
  );

  /** Begins a drag of a panel from the press of a pointer on a handle. */
  const beginDrag = useCallback(
    (
      widget: WidgetId,
      kind: PanelDragKind,
      event: ReactPointerEvent<HTMLElement>
    ) => {
      // Only the first pointer down, and of a mouse only its main button: a
      // press that ends in a context menu never sends its release.
      if (event.button !== 0 || !event.isPrimary || stopDrag.current) return;
      const origin = panels?.find((panel) => panel.widget === widget);
      const element = grid.current;
      if (!panels || !origin || !element) return;
      const box = element.getBoundingClientRect();
      // The page may be drawn larger or smaller than it is laid out (its
      // own scale); the pointer is reported in pixels as drawn.
      const pitch = cellPitch(
        box,
        element.offsetWidth > 0 ? box.width / element.offsetWidth : 1
      );
      if (!pitch) return;

      const handle = event.currentTarget;
      const { pointerId, clientX: startX, clientY: startY } = event;
      const min = pitWallPanelMinCells(widget);
      const at = (pointer: PointerEvent): PanelDrag => {
        const cells = draggedCells(
          origin,
          kind,
          cellsDragged(pointer.clientX - startX, pitch.x),
          cellsDragged(pointer.clientY - startY, pitch.y)
        );
        return {
          widget,
          kind,
          cells,
          verdict: pitWallCustomVerdict(panels, { widget, ...cells }, min),
        };
      };

      // Followed on the window, not on the handle: the pointer is off the
      // handle at once, and one that could not be captured below still has
      // to be followed.
      const listening = new AbortController();
      const stop = () => {
        listening.abort();
        stopDrag.current = null;
        try {
          handle.releasePointerCapture(pointerId);
        } catch {
          // It was never captured, or the browser has let go of it already.
        }
        setDrag(null);
      };
      const onMove = (pointer: PointerEvent) => {
        if (pointer.pointerId !== pointerId) return;
        // The release happened where the page could not see it.
        if (pointer.buttons === 0) {
          stop();
          return;
        }
        const next = at(pointer);
        setDrag((current) => (sameDrag(current, next) ? current : next));
      };
      const onUp = (pointer: PointerEvent) => {
        if (pointer.pointerId !== pointerId) return;
        const end = at(pointer);
        stop();
        if (end.verdict === 'fits') {
          change(withPanelOn(panels, widget, end.cells));
        } else {
          setMessage(
            `${titleOf(widget)} was put back: it ${refusalReason(end.verdict, min)}.`
          );
        }
      };
      const onCancel = (pointer: PointerEvent) => {
        if (pointer.pointerId === pointerId) stop();
      };
      const onKey = (key: KeyboardEvent) => {
        if (key.key !== 'Escape') return;
        key.preventDefault();
        key.stopPropagation();
        stop();
      };

      try {
        // So the drag goes on while the pointer is outside the window.
        handle.setPointerCapture(pointerId);
      } catch {
        // A pointer the browser does not hold cannot be captured. The drag
        // is followed on the window all the same.
      }
      const { signal } = listening;
      window.addEventListener('pointermove', onMove, { signal });
      window.addEventListener('pointerup', onUp, { signal });
      window.addEventListener('pointercancel', onCancel, { signal });
      window.addEventListener('keydown', onKey, { capture: true, signal });
      stopDrag.current = stop;
      setMessage('');
      setDrag({
        widget,
        kind,
        cells: { x: origin.x, y: origin.y, w: origin.w, h: origin.h },
        verdict: 'fits',
      });
    },
    [panels, grid, change]
  );

  /** Moves or sizes the panel in focus by a cell for an arrow key. */
  const stepByKey = useCallback(
    (widget: WidgetId, event: ReactKeyboardEvent<HTMLElement>) => {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const step = keyStep(event.key, event.shiftKey);
      const origin = panels?.find((panel) => panel.widget === widget);
      if (!step || !panels || !origin) return;
      // The arrows are the panel's here, not the page's to scroll by.
      event.preventDefault();
      if (stopDrag.current) return;
      const cells = draggedCells(origin, step.kind, step.dx, step.dy);
      const min = pitWallPanelMinCells(widget);
      const verdict = pitWallCustomVerdict(panels, { widget, ...cells }, min);
      if (verdict === 'fits') {
        change(withPanelOn(panels, widget, cells));
      } else {
        setMessage(`${titleOf(widget)} ${refusalReason(verdict, min)}.`);
      }
    },
    [panels, change]
  );

  return {
    /** The page is being arranged. */
    editing,
    /** The arrangement as it stands in the edit; undefined outside one. */
    panels,
    drag: editing ? drag : null,
    /** What the last thing asked for could not be given, in a sentence. */
    message: editing ? message : '',
    begin,
    cancel,
    done,
    reset,
    add,
    remove,
    beginDrag,
    stepByKey,
  };
};

export type PitWallCustomEdit = ReturnType<typeof usePitWallCustomEdit>;
