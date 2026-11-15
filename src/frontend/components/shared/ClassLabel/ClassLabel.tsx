import { memo } from 'react';
import { getTailwindStyle } from '@irdashies/utils/colors';

export interface ClassLabelProps {
  /** The session's class name, printed as it stands. */
  name: string;
  /** The session's class colour. */
  color: number | undefined;
  /** Used instead of the class colour in a single-class session. */
  highlightColor?: number;
  isMultiClass: boolean;
  /**
   * Fill the label with the class colour. Off, only its bottom border carries
   * the colour, as the standings draw it with their coloured class header
   * switched off.
   */
  filled?: boolean;
  /** Padding and text size; the standings and each widget set their own. */
  className?: string;
}

/**
 * The class label the standings draw: the class name in bold on the solid
 * class colour, with a left border in the same colour.
 *
 * One component so that every widget that names a class draws it the same
 * way. The colours come from `getTailwindStyle`, so a single-class session
 * takes the highlight colour here exactly as it does in the standings.
 */
export const ClassLabel = memo(
  ({
    name,
    color,
    highlightColor,
    isMultiClass,
    filled = true,
    className = '',
  }: ClassLabelProps) => {
    const styles = getTailwindStyle(color, highlightColor, isMultiClass);
    const classes = [
      filled ? styles.classHeader : styles.borderColor,
      'font-bold whitespace-nowrap',
      filled ? 'border-l-4' : '',
      className,
    ];
    return (
      <span
        data-testid="class-label"
        className={classes.filter(Boolean).join(' ')}
      >
        {name}
      </span>
    );
  }
);
ClassLabel.displayName = 'ClassLabel';
