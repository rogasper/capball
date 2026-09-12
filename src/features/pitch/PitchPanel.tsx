import { CalibrationPanel } from "./CalibrationPanel";
import { MarkingPanel } from "./MarkingPanel";

/**
 * The Pitch tab: where the pitch is in this video, and where the players were on
 * the moment currently selected.
 *
 * M8 filled the first half with calibration; M9 adds the positions and the
 * top-down view they feed, which is the reason the calibration exists.
 */
export function PitchPanel() {
  return (
    <div className="space-y-4">
      <CalibrationPanel />
      <MarkingPanel />
    </div>
  );
}
