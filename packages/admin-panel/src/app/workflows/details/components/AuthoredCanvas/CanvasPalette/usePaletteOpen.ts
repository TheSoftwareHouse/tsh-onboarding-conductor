import { useState } from 'react';
import { PALETTE_STORAGE_KEY } from '../canvas-constants';

function readPaletteOpen(): boolean {
  try {
    return window.localStorage.getItem(PALETTE_STORAGE_KEY) !== 'false';
  } catch {
    // Storage blocked (private mode, previews): the palette just opens.
    return true;
  }
}

function writePaletteOpen(open: boolean): void {
  try {
    window.localStorage.setItem(PALETTE_STORAGE_KEY, String(open));
  } catch {
    // Not remembered; the palette still toggles.
  }
}

/** The palette's open state, remembered per browser as a viewing convenience. */
export function usePaletteOpen(): [open: boolean, toggle: () => void] {
  const [open, setOpen] = useState(readPaletteOpen);
  function toggle(): void {
    writePaletteOpen(!open);
    setOpen(!open);
  }
  return [open, toggle];
}
