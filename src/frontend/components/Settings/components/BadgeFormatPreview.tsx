import {
  DriverRatingBadge,
  type DriverRatingBadgeProps,
} from '../../shared/DriverRatingBadge/DriverRatingBadge';

/** One iRacing licence badge format, drawn by the badge itself. */
export const BadgeFormatPreview = ({
  format,
  selected,
  onClick,
}: {
  format: string;
  /**
   * Omitted when this is only drawing the format, which is how FormatSelect
   * uses it: the button and the selected state belong to the dropdown, so the
   * preview renders bare rather than as a button inside a button.
   */
  selected?: boolean;
  onClick?: () => void;
}) => {
  // The real badge, as LmuBadgeFormatPreview draws the real LMU one: a
  // hand-built copy of each format drifted from what a row shows. The sample
  // is a B 3.8 licence with a 1412 iRating.
  const renderPreview = () => (
    <DriverRatingBadge
      license="B 3.80"
      rating={1412}
      format={format as DriverRatingBadgeProps['format']}
    />
  );

  if (!onClick) return <>{renderPreview()}</>;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1 rounded border cursor-pointer transition-colors inline-flex items-center justify-center ${
        selected
          ? 'border-accent-500 bg-accent-500/10'
          : 'border-transparent hover:bg-slate-800'
      }`}
    >
      {renderPreview()}
    </button>
  );
};
