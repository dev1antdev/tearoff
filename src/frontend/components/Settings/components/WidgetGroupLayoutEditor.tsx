import { memo, useCallback, useMemo, useRef } from 'react';
import { useElementSize } from '@irdashies/context';
import { ResizeHandles } from '@irdashies/domain/widgetPresentation/ResizeHandle';
import type { ResizeDirection } from '@irdashies/domain/widgetPresentation/resizeWidget';
import type { WidgetLayout } from '@irdashies/types';
import { useDragWidget } from '../../WidgetContainer/useDragWidget';
import { useResizeWidget } from '../../WidgetContainer/useResizeWidget';

/** Small enough for a badge, large enough to keep hold of. */
const MIN_TILE_SIZE = 20;

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

const Tile = memo(({ tile, scale, bounds, siblings, onChange }: TileProps) => {
  const { id, name, layout } = tile;
  const onLayoutChange = useCallback(
    (next: WidgetLayout) => onChange(id, next),
    [id, onChange]
  );
  const snapOptions = useMemo(
    () => ({ bounds, siblingLayouts: siblings }),
    [bounds, siblings]
  );
  const { dragHandleProps } = useDragWidget({
    layout,
    onLayoutChange,
    enabled: true,
    snapOptions,
    pointerScale: scale,
  });
  const { getResizeHandleProps } = useResizeWidget({
    layout,
    onLayoutChange,
    enabled: true,
    minWidth: MIN_TILE_SIZE,
    minHeight: MIN_TILE_SIZE,
    snapOptions,
    pointerScale: scale,
  });
  const handleProps = useCallback(
    (direction: ResizeDirection) => ({
      ...getResizeHandleProps(direction),
      'data-resize-handle': direction,
    }),
    [getResizeHandleProps]
  );

  return (
    <div
      {...dragHandleProps}
      data-member-tile={id}
      className="absolute touch-none select-none overflow-hidden rounded-sm border border-accent-400 bg-slate-800 p-1 text-slate-200"
      style={{
        ...dragHandleProps.style,
        left: layout.x,
        top: layout.y,
        width: layout.width,
        height: layout.height,
      }}
    >
      <p className="truncate text-sm">{name}</p>
      <p className="truncate text-xs tabular-nums text-slate-400">
        {layout.width} × {layout.height}
      </p>
      <ResizeHandles getResizeHandleProps={handleProps} visible />
    </div>
  );
});
Tile.displayName = 'Tile';

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
  const scale = available > 0 ? Math.min(1, available / width) : 1;
  const bounds = useMemo(
    () => ({ x: 0, y: 0, width, height }),
    [width, height]
  );
  const siblingsOf = useMemo(
    () =>
      new Map(
        tiles.map(({ id }) => [
          id,
          tiles.filter((tile) => tile.id !== id).map((tile) => tile.layout),
        ])
      ),
    [tiles]
  );

  return (
    <div ref={box} className="w-full">
      <div
        className="relative overflow-hidden rounded-sm border border-slate-700 bg-slate-900"
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
              siblings={siblingsOf.get(tile.id) ?? []}
              onChange={onChange}
            />
          ))}
        </div>
      </div>
    </div>
  );
};
