import type { A11yNode, Bounds } from "../types.js";
import { querySelector } from "../selectors.js";

/**
 * Window control button bounds extracted from frame.
 */
export interface WindowControlBounds {
  closeButtonBounds?: Bounds;
  minimizeButtonBounds?: Bounds;
  maximizeButtonBounds?: Bounds;
}

/**
 * Extract window control button bounds from a frame.
 * Returns bounds for close, minimize, and maximize buttons if found.
 */
export function extractWindowControlBounds(frame: A11yNode | undefined): WindowControlBounds {
  if (!frame) return {};

  const closeBtn = querySelector(frame, 'tool-bar push-button[name="Disable"]');
  const minimizeBtn = querySelector(frame, 'tool-bar push-button[name="Minimize"]');
  const maximizeBtn = querySelector(frame, 'tool-bar push-button[name="Maximize"]');

  return {
    closeButtonBounds: closeBtn?.bounds,
    minimizeButtonBounds: minimizeBtn?.bounds,
    maximizeButtonBounds: maximizeBtn?.bounds,
  };
}
