import { useNativeWindowVisibility } from './useNativeWindowVisibility';
import { useOverlayHidden } from './useOverlayHidden';

/**
 * Whether nothing this widget paints can reach the screen.
 *
 * True while the overlay is hidden (switched off, or the sim is paused), and
 * while the window itself is hidden or minimised: the Gantry closed to the
 * background, the settings window in the tray.
 *
 * The overlay is hidden with CSS and its widgets stay mounted, so their
 * canvases and frame loops would go on drawing into pixels nobody sees. A
 * widget that draws outside React reads this, stops drawing while it is true,
 * and draws once from its current data when it turns false. It must not drop
 * anything else: the data keeps arriving and whatever the widget has built up
 * stays as it is.
 */
export const usePaintingPaused = (): boolean => {
  const overlayHidden = useOverlayHidden();
  const windowVisible = useNativeWindowVisibility();
  return overlayHidden || !windowVisible;
};
