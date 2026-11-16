import { memo } from 'react';
import { RankingIcon } from '@phosphor-icons/react';
import { useFieldSize, useFocusCarPlace } from '@irdashies/domain';
import { sessionBarItemWrapperClass } from '../../sessionBarItemWrapperClass';
import type { SessionBarItemProps } from '../../sessionBarItemTypes';

/**
 * The focus car's place against the whole field: "P26/38".
 *
 * The car being driven, and while watching, the car the camera is on. Not
 * rendered while the car has no place or is not one of the cars racing: a
 * place of nothing would be a claim nobody made.
 */
export const PositionItem = memo(({ standalone }: SessionBarItemProps) => {
  const focus = useFocusCarPlace();
  const fieldSize = useFieldSize(focus?.carIdx);
  if (!focus || focus.position <= 0 || fieldSize <= 0) return null;

  return (
    <div className={sessionBarItemWrapperClass(standalone)}>
      <div
        data-item="position"
        className="flex justify-center gap-1 items-center text-nowrap tabular-nums"
      >
        <RankingIcon size={14} />
        <span>
          <span className="font-semibold">P{focus.position}</span>
          <span className="text-white/60">/{fieldSize}</span>
        </span>
      </div>
    </div>
  );
});
PositionItem.displayName = 'PositionItem';
