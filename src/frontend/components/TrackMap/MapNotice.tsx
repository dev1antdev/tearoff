import type { ReactNode } from 'react';

/**
 * One sentence in place of a map that cannot be drawn yet, so the widget's
 * box is not left empty with nothing to say why.
 */
export const MapNotice = ({ children }: { children: ReactNode }) => (
  <div className="flex h-full w-full items-center justify-center p-2">
    <p className="rounded-sm bg-slate-800/80 px-3 py-2 text-center text-sm text-slate-200">
      {children}
    </p>
  </div>
);
