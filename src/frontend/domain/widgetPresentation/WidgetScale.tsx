import { createContext, useContext, type ReactNode } from 'react';
import { normalizeWidgetScale } from '@irdashies/types';

const WidgetScaleContext = createContext(1);

/** Absolute content scale; canvases use it to keep their backing buffers sharp. */
export const useWidgetScale = () => useContext(WidgetScaleContext);

interface WidgetScaleProps {
  scale?: number;
  /**
   * Take `scale` as it is, for a scale worked out from two others: held to
   * the range of one setting, their product would lose one of them.
   */
  exact?: boolean;
  children: ReactNode;
}

/**
 * Keeps the host's frame in screen coordinates and lays out content in logical
 * pixels. Nested widgets (Gantry panels) use their own absolute scale, rather
 * than multiplying it by their host widget's scale.
 */
export const WidgetScale = ({ scale, exact, children }: WidgetScaleProps) => {
  const parentScale = useWidgetScale();
  const percent =
    exact && scale !== undefined && scale > 0
      ? scale
      : normalizeWidgetScale(scale);
  const contentScale = percent / 100;
  const relativeScale = contentScale / parentScale;

  return (
    <div className="w-full h-full overflow-hidden" data-widget-scale={percent}>
      <div
        className="origin-top-left"
        style={{
          width: `${100 / relativeScale}%`,
          height: `${100 / relativeScale}%`,
          transform:
            relativeScale === 1 ? undefined : `scale(${relativeScale})`,
        }}
      >
        <WidgetScaleContext.Provider value={contentScale}>
          {children}
        </WidgetScaleContext.Provider>
      </div>
    </div>
  );
};
