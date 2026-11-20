import type { SectorColor } from '@irdashies/context';

/**
 * A sector's colour as a light tint of its reading, not a bar or a frame
 * (docs/DESIGN_BOOK.md §3.1): session best purple, personal best green,
 * slower yellow, red. A sector with nothing to say has no tint.
 */
export const SECTOR_TINT: Record<SectorColor, string> = {
  purple: 'bg-purple-500/20',
  green: 'bg-green-500/20',
  yellow: 'bg-yellow-500/20',
  red: 'bg-red-500/20',
  default: '',
};
