/** The box a readout is kept inside, in the pixels its position is given in. */
export interface ReadoutBounds {
  width: number;
  height: number;
}

export interface EdgeAnchor {
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
}

/**
 * Anchors a floating box to whichever edges keep it inside `bounds`, without
 * needing to know how big the box is. Used for a chart's readout, where
 * measuring would cost a second render on every pointer move.
 */
export const anchorInsideBounds = (
  point: { x: number; y: number },
  bounds: ReadoutBounds,
  offset: number
): EdgeAnchor => {
  const anchor: EdgeAnchor = {};
  if (point.x > bounds.width / 2)
    anchor.right = bounds.width - point.x + offset;
  else anchor.left = point.x + offset;
  if (point.y > bounds.height / 2)
    anchor.bottom = bounds.height - point.y + offset;
  else anchor.top = point.y + offset;
  return anchor;
};
