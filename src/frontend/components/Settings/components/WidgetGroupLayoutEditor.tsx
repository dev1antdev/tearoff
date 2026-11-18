import { useRef } from 'react';
import { useElementSize } from '@irdashies/context';
import {
  RESIZE_HANDLE_SIZE,
  ResizeHandles,
} from '@irdashies/domain/widgetPresentation/ResizeHandle';
import type { ResizeDirection } from '@irdashies/domain/widgetPresentation/resizeWidget';
import { previewFitScale } from '@irdashies/domain/widgetPreview/presentation';
import type { WidgetLayout } from '@irdashies/types';
import { useDragWidget } from '../../WidgetContainer/useDragWidget';
import { useResizeWidget } from '../../WidgetContainer/useResizeWidget';

/** Small enough for a badge, large enough to keep hold of. */
const MIN_TILE_SIZE = 20;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(value, max));

/** Moved inside the frame, where it can still be seen and picked up. */
const movedIntoFrame = (
  layout: WidgetLayout,
  frame: WidgetLayout
): WidgetLayout => ({
  ...layout,
  x: clamp(layout.x, 0, frame.width - layout.width),
  y: clamp(layout.y, 0, frame.height - layout.height),
});

/**
 * One axis of a tile being sized. An edge that moves stops where a piece of the
 * tile still shows in the frame, or where it already is if it is past that, so
 * it never jumps against the pointer. An edge that stays is left as it is.
 */
const sizedAxis = (
  start: number,
  size: number,
  currentStart: number,
  currentSize: number,
  frameSize: number
) => {
  const end = start + size;
  const currentEnd = currentStart + currentSize;
  const nextStart =
    start === currentStart
      ? start
      : clamp(
          start,
          Math.min(0, currentStart),
          Math.max(frameSize - MIN_TILE_SIZE, currentStart)
        );
  const nextEnd =
    end === currentEnd
      ? end
      : clamp(
          end,
          Math.min(MIN_TILE_SIZE, currentEnd),
          Math.max(frameSize, currentEnd)
        );
  return { start: nextStart, size: nextEnd - nextStart };
};

const sizedWithinFrame = (
  next: WidgetLayout,
  current: WidgetLayout,
  frame: WidgetLayout
): WidgetLayout => {
  const across = sizedAxis(
    next.x,
    next.width,
    current.x,
    current.width,
    frame.width
  );
  const down = sizedAxis(
    next.y,
    next.height,
    current.y,
    current.height,
    frame.height
  );
  return {
    ...next,
    x: across.start,
    width: across.size,
    y: down.start,
    height: down.size,
  };
};

export interface WidgetGroupEditorTile {
  id: string;
  name: string;
  layout: WidgetLayout;
}

interface TileProps {
  tile: WidgetGroupEditorTile;
  scale: number;
  bounds: WidgetLayout;
  siblings: WidgetLayout[];
  onChange: (id: string, layout: WidgetLayout) => void;
}

const Tile = ({ tile, scale, bounds, siblings, onChange }: TileProps) => {
  const { id, name, layout } = tile;
  const snapOptions = { bounds, siblingLayouts: siblings };
  const { isDragging, dragHandleProps } = useDragWidget({
    layout,
    onLayoutChange: (next) => onChange(id, movedIntoFrame(next, bounds)),
    enabled: true,
    snapOptions,
    pointerScale: scale,
  });
  const { isResizing, getResizeHandleProps } = useResizeWidget({
    layout,
    onLayoutChange: (next) =>
      onChange(id, sizedWithinFrame(next, layout, bounds)),
    enabled: true,
    minWidth: MIN_TILE_SIZE,
    minHeight: MIN_TILE_SIZE,
    snapOptions,
    pointerScale: scale,
  });

  return (
    <div
      {...dragHandleProps}
      data-member-tile={id}
      className={`absolute touch-none select-none rounded-md border bg-slate-800 text-slate-200 hover:border-accent-400 ${
        isDragging || isResizing
          ? 'border-accent-400'
          : 'border-settings-boundary'
      }`}
      style={{
        ...dragHandleProps.style,
        left: layout.x,
        top: layout.y,
        width: layout.width,
        height: layout.height,
      }}
    >
      <div className="h-full overflow-hidden p-1">
        <p className="truncate text-sm">{name}</p>
        <p className="truncate text-xs tabular-nums text-slate-400">
          {layout.width} × {layout.height}
        </p>
      </div>
      <ResizeHandles
        getResizeHandleProps={(direction: ResizeDirection) => ({
          ...getResizeHandleProps(direction),
          'data-resize-handle': direction,
        })}
        // As thick on screen as on the overlay, at any canvas scale, but
        // never so thick that a small tile has no middle left to drag it by.
        size={Math.min(
          RESIZE_HANDLE_SIZE / scale,
          Math.min(layout.width, layout.height) / 4
        )}
        visible
      />
    </div>
  );
};

interface WidgetGroupLayoutEditorProps {
  /** The group's frame, in the group's own pixels. */
  width: number;
  height: number;
  /** In drawing order: later tiles lie on top, as their widgets do. */
  tiles: WidgetGroupEditorTile[];
  onChange: (id: string, layout: WidgetLayout) => void;
}

/**
 * The group's frame with a tile per widget, to move and size with the pointer.
 * Drawn smaller where the page is narrower than the group, with the pointer's
 * movement converted back, and snapped as widgets on the overlay are.
 */
export const WidgetGroupLayoutEditor = ({
  width,
  height,
  tiles,
  onChange,
}: WidgetGroupLayoutEditorProps) => {
  const box = useRef<HTMLDivElement>(null);
  const { width: available } = useElementSize(box);
  const scale = previewFitScale(width, height, available, height);
  const bounds = { x: 0, y: 0, width, height };

  return (
    <div ref={box} className="w-full">
      <div
        className="relative overflow-hidden rounded-md border border-slate-700 bg-slate-900"
        style={{ width: width * scale, height: height * scale }}
      >
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{ width, height, transform: `scale(${scale})` }}
        >
          {tiles.map((tile) => (
            <Tile
              key={tile.id}
              tile={tile}
              scale={scale}
              bounds={bounds}
              siblings={tiles
                .filter((other) => other.id !== tile.id)
                .map((other) => other.layout)}
              onChange={onChange}
            />
          ))}
        </div>
      </div>
    </div>
  );
};
