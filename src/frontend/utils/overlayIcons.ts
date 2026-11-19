import type { IconProps } from '@phosphor-icons/react';

/**
 * Icon defaults for a redesigned overlay (docs/DESIGN_BOOK.md §3.6): thin.
 * A provided context replaces Phosphor's defaults rather than adding to them,
 * so they are all restated here, the weight changed. One object, so the
 * IconContext value never changes between renders. An icon that sets its own
 * weight or size keeps it.
 */
export const OVERLAY_ICONS: IconProps = {
  color: 'currentColor',
  size: '1em',
  weight: 'light',
  mirrored: false,
};
