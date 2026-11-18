import { memo, CSSProperties } from 'react';
import type { ResizeDirection } from './resizeWidget';

export const RESIZE_HANDLE_SIZE = 8;

interface ResizeHandleProps {
  direction: ResizeDirection;
  getProps: (direction: ResizeDirection) => Record<string, unknown>;
  visible?: boolean;
  /** How thick the handle is, for a parent drawn scaled. */
  size?: number;
}

export const ResizeHandle = memo(
  ({
    direction,
    getProps,
    visible = false,
    size = RESIZE_HANDLE_SIZE,
  }: ResizeHandleProps) => {
    const props = getProps(direction);
    const style = getHandleStyle(direction, size);

    return (
      <div
        {...props}
        className={`absolute touch-none pointer-events-auto bg-sky-500 transition-opacity focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-white ${visible && direction.length === 2 ? 'opacity-100' : 'opacity-0 hover:opacity-100'}`}
        style={style}
      />
    );
  }
);

ResizeHandle.displayName = 'ResizeHandle';

export const ResizeHandles = ({
  getResizeHandleProps,
  visible = false,
  size,
}: {
  getResizeHandleProps: (direction: ResizeDirection) => Record<string, unknown>;
  visible?: boolean;
  size?: number;
}) => (
  <>
    <ResizeHandle
      direction="n"
      getProps={getResizeHandleProps}
      visible={visible}
      size={size}
    />
    <ResizeHandle
      direction="s"
      getProps={getResizeHandleProps}
      visible={visible}
      size={size}
    />
    <ResizeHandle
      direction="e"
      getProps={getResizeHandleProps}
      visible={visible}
      size={size}
    />
    <ResizeHandle
      direction="w"
      getProps={getResizeHandleProps}
      visible={visible}
      size={size}
    />
    <ResizeHandle
      direction="ne"
      getProps={getResizeHandleProps}
      visible={visible}
      size={size}
    />
    <ResizeHandle
      direction="nw"
      getProps={getResizeHandleProps}
      visible={visible}
      size={size}
    />
    <ResizeHandle
      direction="se"
      getProps={getResizeHandleProps}
      visible={visible}
      size={size}
    />
    <ResizeHandle
      direction="sw"
      getProps={getResizeHandleProps}
      visible={visible}
      size={size}
    />
  </>
);

function getHandleStyle(
  direction: ResizeDirection,
  size: number
): CSSProperties {
  const half = size / 2;
  const base: CSSProperties = {
    position: 'absolute',
  };

  switch (direction) {
    case 'n':
      return {
        ...base,
        top: -half,
        left: size,
        right: size,
        height: size,
        cursor: 'ns-resize',
      };
    case 's':
      return {
        ...base,
        bottom: -half,
        left: size,
        right: size,
        height: size,
        cursor: 'ns-resize',
      };
    case 'e':
      return {
        ...base,
        right: -half,
        top: size,
        bottom: size,
        width: size,
        cursor: 'ew-resize',
      };
    case 'w':
      return {
        ...base,
        left: -half,
        top: size,
        bottom: size,
        width: size,
        cursor: 'ew-resize',
      };
    case 'ne':
      return {
        ...base,
        top: -half,
        right: -half,
        width: size * 2,
        height: size * 2,
        cursor: 'nesw-resize',
        borderRadius: '0 4px 0 0',
      };
    case 'nw':
      return {
        ...base,
        top: -half,
        left: -half,
        width: size * 2,
        height: size * 2,
        cursor: 'nwse-resize',
        borderRadius: '4px 0 0 0',
      };
    case 'se':
      return {
        ...base,
        bottom: -half,
        right: -half,
        width: size * 2,
        height: size * 2,
        cursor: 'nwse-resize',
        borderRadius: '0 0 4px 0',
      };
    case 'sw':
      return {
        ...base,
        bottom: -half,
        left: -half,
        width: size * 2,
        height: size * 2,
        cursor: 'nesw-resize',
        borderRadius: '0 0 0 4px',
      };
  }
}
