import { CalibrationPanel } from "./CalibrationPanel";

/**
 * The Pitch tab.
 *
 * M8 fills it with calibration. M9 adds the top-down view of the positions
 * marked on an event, which is the reason the calibration exists.
 */
export function PitchPanel() {
  return <CalibrationPanel />;
}
