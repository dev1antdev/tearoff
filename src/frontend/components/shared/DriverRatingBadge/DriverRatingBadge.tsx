export interface DriverRatingBadgeProps {
  license?: string;
  rating?: number;
  isMinimal?: boolean;
  format?:
    | 'license-color-fullrating-combo'
    | 'fullrating-color-no-license'
    | 'license-color-fullrating-bw'
    | 'license-color-rating-bw'
    | 'license-color-rating-bw-no-license'
    | 'rating-color-no-license'
    | 'license-bw-rating-bw'
    | 'rating-only-bw-rating-bw'
    | 'license-bw-rating-bw-no-license'
    | 'rating-bw-no-license'
    | 'fullrating-bw-no-license'
    | 'rating-only-color-rating-bw';
}

export const DriverRatingBadge = ({
  license = 'R 0.0',
  rating = 0,
  isMinimal = false,
  format = 'license-color-rating-bw',
}: DriverRatingBadgeProps) => {
  const licenseLevel = license?.charAt(0) || 'R';
  // The licence colour as an outline and a light tint, the text in its light
  // shade; minimal keeps only a faint outline.
  const colorMap: Record<string, string> = {
    W: 'border-zinc-100/70 bg-zinc-100/12 text-zinc-100',
    P: 'border-purple-500/70 bg-purple-500/12 text-purple-300',
    A: 'border-blue-500/70 bg-blue-500/12 text-blue-300',
    B: 'border-green-500/70 bg-green-500/12 text-green-300',
    C: 'border-yellow-500/70 bg-yellow-500/12 text-yellow-300',
    D: 'border-orange-500/70 bg-orange-500/12 text-orange-300',
    R: 'border-red-500/70 bg-red-500/12 text-red-300',
  };
  const minimalColorMap: Record<string, string> = {
    W: 'border-zinc-500/40 text-zinc-300',
    P: 'border-purple-500/30 text-purple-300/80',
    A: 'border-blue-500/30 text-blue-300/80',
    B: 'border-green-500/30 text-green-300/80',
    C: 'border-yellow-500/30 text-yellow-300/80',
    D: 'border-orange-500/30 text-orange-300/80',
    R: 'border-red-500/30 text-red-300/80',
  };
  const color = (isMinimal ? minimalColorMap : colorMap)[licenseLevel] ?? '';

  const decimal = String(rating / 1000);
  const dotIndex = decimal.indexOf('.') > -1 ? decimal.indexOf('.') : 0;
  const simplifiedRating = Number(decimal.substring(0, dotIndex + 2)).toFixed(
    1
  );

  // Extract safety rating number from license string
  const safetyRatingMatch = license?.match(/([A-Z])\s*(\d+\.\d+)/);
  const safetyRating = safetyRatingMatch
    ? (Math.floor(parseFloat(safetyRatingMatch[2]) * 10) / 10).toFixed(1)
    : '';
  const formattedLicense =
    license?.replace(/([A-Z])\s*(\d+)\.(\d+)/, (_, level) => {
      return `${level}`;
    }) ||
    license ||
    'R 0.0';

  if (!license || !rating) {
    return (
      <div className="flex gap-1 items-center justify-center">
        <div
          className={`text-center text-nowrap border px-1 rounded-md text-xs leading-tight min-w-[1.8em] ${(isMinimal ? minimalColorMap : colorMap)['A']}`}
        >
          {'AI'}
        </div>
      </div>
    );
  } else {
    switch (format) {
      case 'license-color-fullrating-combo':
        // License = colored badge, full irating combined
        return (
          <div className="flex gap-1 items-center justify-center">
            <div
              className={`flex justify-between items-center text-nowrap border px-1 rounded-md text-xs leading-tight min-w-[6.4em] ${color}`}
            >
              <span>
                {formattedLicense} {safetyRating}{' '}
              </span>
              <span>{rating}</span>
            </div>
          </div>
        );

      case 'fullrating-color-no-license':
        // Full rating only in white
        return (
          <div className="flex gap-1 items-center justify-center">
            <div
              className={`text-center text-nowrap border px-1 rounded-md text-xs leading-tight min-w-[3.6em] ${color}`}
            >
              {rating}
            </div>
          </div>
        );

      case 'license-color-fullrating-bw':
        // License = colored badge, full irating (no 1.4k approx), rating in B&W
        return (
          <div className="flex gap-1 items-center">
            <div
              className={`text-center text-nowrap border px-1 rounded-md text-xs leading-tight min-w-[3.6em] ${color}`}
            >
              {formattedLicense} {safetyRating}
            </div>
            <div className="flex-1 flex justify-center">
              <div className="bg-white/8 text-slate-200 text-center border border-transparent px-1 rounded-md text-xs leading-tight">
                {rating}
              </div>
            </div>
          </div>
        );

      case 'license-color-rating-bw':
        // Default format: License + colored badge, rating in B&W
        return (
          <div className="flex gap-1 items-center">
            <div
              className={`text-center text-nowrap border px-1 rounded-md text-xs leading-tight min-w-[3.6em] ${color}`}
            >
              {formattedLicense} {safetyRating}
            </div>
            <div className="bg-white/8 text-slate-200 text-center border border-transparent px-1 rounded-md text-xs leading-tight">
              {simplifiedRating}k
            </div>
          </div>
        );

      case 'rating-only-color-rating-bw':
        // Rating only in colored badge, rating in B&W
        return (
          <div className="flex gap-1 items-center">
            <div
              className={`text-center text-nowrap border px-1 rounded-md text-xs leading-tight min-w-[2.4em] ${color}`}
            >
              {safetyRating}
            </div>
            <div className="bg-white/8 text-slate-200 text-center border border-transparent px-1 rounded-md text-xs leading-tight">
              {simplifiedRating}k
            </div>
          </div>
        );

      case 'license-color-rating-bw-no-license':
        // License without safety rating + colored badge, rating in B&W
        return (
          <div className="flex gap-1 items-center">
            <div
              className={`text-center text-nowrap border px-1 rounded-md text-xs leading-tight min-w-[1.8em] ${color}`}
            >
              {formattedLicense}
            </div>
            <div className="bg-white/8 text-slate-200 text-center border border-transparent px-1 rounded-md text-xs leading-tight">
              {simplifiedRating}k
            </div>
          </div>
        );

      case 'rating-color-no-license':
        // Rating only in colored badge, no license
        return (
          <div className="flex gap-1 items-center justify-center">
            <div
              className={`text-center text-nowrap border px-1 rounded-md text-xs leading-tight ${color}`}
            >
              {simplifiedRating}k
            </div>
          </div>
        );

      case 'license-bw-rating-bw':
        // All B&W badges - license without safety rating (like current but B&W)
        return (
          <div className="flex gap-1 items-center">
            <div className="bg-white/8 text-slate-200 text-center border border-transparent px-1 rounded-md text-xs leading-tight min-w-[3.6em]">
              {formattedLicense} {safetyRating}
            </div>
            <div className="bg-white/8 text-slate-200 text-center border border-transparent px-1 rounded-md text-xs leading-tight">
              {simplifiedRating}k
            </div>
          </div>
        );

      case 'rating-only-bw-rating-bw':
        // Rating only in colored badge, rating in B&W
        return (
          <div className="flex gap-1 items-center">
            <div className="bg-white/8 text-slate-200 text-center border border-transparent px-1 rounded-md text-xs leading-tight min-w-[2.4em]">
              {safetyRating}
            </div>
            <div className="bg-white/8 text-slate-200 text-center border border-transparent px-1 rounded-md text-xs leading-tight">
              {simplifiedRating}k
            </div>
          </div>
        );

      case 'license-bw-rating-bw-no-license':
        // All B&W badges - license without safety rating
        return (
          <div className="flex gap-1 items-center">
            <div className="bg-white/8 text-slate-200 text-center border border-transparent px-1 rounded-md text-xs leading-tight min-w-[1.8em]">
              {formattedLicense}
            </div>
            <div className="bg-white/8 text-slate-200 text-center border border-transparent px-1 rounded-md text-xs leading-tight">
              {simplifiedRating}k
            </div>
          </div>
        );

      case 'rating-bw-no-license':
        // Rating only in B&W
        return (
          <div className="flex gap-1 items-center justify-center">
            <div className="text-center text-nowrap border px-1 rounded-md text-xs leading-tight bg-white/10 border-transparent">
              {simplifiedRating}k
            </div>
          </div>
        );

      case 'fullrating-bw-no-license':
        // Full rating only in B&W
        return (
          <div className="flex gap-1 items-center justify-center">
            <div className="text-center text-nowrap border px-1 rounded-md text-xs leading-tight bg-white/10 border-transparent">
              {rating}
            </div>
          </div>
        );

      default:
        // Fallback to default format
        return (
          <div className="flex gap-1 items-center">
            <div
              className={`text-center text-nowrap border px-1 rounded-md text-xs leading-tight min-w-[3.6em] ${color}`}
            >
              {formattedLicense} {safetyRating}
            </div>
            <div className="bg-white/8 text-slate-200 text-center border border-transparent px-1 rounded-md text-xs leading-tight">
              {simplifiedRating}k
            </div>
          </div>
        );
    }
  }
};
