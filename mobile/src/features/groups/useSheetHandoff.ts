import { useCallback, useEffect, useRef } from 'react';

/**
 * Long enough for a closing Sheet's Modal to finish sliding out (iOS slides
 * in about 300ms).
 */
export const SHEET_HANDOFF_MS = 400;

/**
 * Close one Sheet and open the next. iOS presents one Modal at a time: a
 * second Modal asked to show while the first is still dismissing can fail to
 * appear, so the next one opens only after the first has gone.
 */
export function useSheetHandoff() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  return useCallback((close: () => void, openNext: () => void) => {
    close();
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      openNext();
    }, SHEET_HANDOFF_MS);
  }, []);
}
