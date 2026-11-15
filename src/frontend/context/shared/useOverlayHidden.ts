import { createContext, useContext } from 'react';

/**
 * Whether the overlay is hidden: switched off, or the sim is paused.
 *
 * The widgets stay mounted while it is, so that what they have built up is
 * still there when the overlay comes back. Anything that reaches the driver
 * some other way than by being painted inside the overlay has to ask: a
 * sound, or an element that sets its own visibility.
 */
export const OverlayHiddenContext = createContext(false);

export const useOverlayHidden = (): boolean => useContext(OverlayHiddenContext);
