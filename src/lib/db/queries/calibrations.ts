import { asc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { calibrationPoints, calibrations } from "@/lib/db/schema";
import type { CalibrationDraft } from "@/lib/pitch/types";

/**
 * Calibration rows.
 *
 * Two queries rather than one join: a calibration carries a handful of points
 * and the joined select would need every column aliased against the row-keyed
 * driver (AGENTS.md rule 8). Two focused selects are easier to read and cannot
 * collide.
 */

export type StoredCalibrationPoint = {
  feature: string;
  /** Normalised to the video frame. */
  imageU: number;
  imageV: number;
  /** Metres from the centre of the pitch. */
  xM: number;
  yM: number;
};

export type StoredCalibration = {
  id: number;
  videoId: number;
  fromMs: number;
  pitchLengthM: number;
  pitchWidthM: number;
  rmsErrorPx: number;
  points: StoredCalibrationPoint[];
};

export async function listCalibrations(videoId: number): Promise<StoredCalibration[]> {
  const rows = await db
    .select()
    .from(calibrations)
    .where(eq(calibrations.videoId, videoId))
    .orderBy(asc(calibrations.fromMs));

  if (rows.length === 0) return [];

  const points = await db
    .select()
    .from(calibrationPoints)
    .where(
      inArray(
        calibrationPoints.calibrationId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(calibrationPoints.calibrationId), asc(calibrationPoints.sortOrder));

  const byCalibration = new Map<number, StoredCalibrationPoint[]>();
  for (const point of points) {
    const list = byCalibration.get(point.calibrationId);
    const entry: StoredCalibrationPoint = {
      feature: point.feature,
      imageU: point.imageU,
      imageV: point.imageV,
      xM: point.xM,
      yM: point.yM,
    };
    if (list) list.push(entry);
    else byCalibration.set(point.calibrationId, [entry]);
  }

  return rows.map((row) => ({
    id: row.id,
    videoId: row.videoId,
    fromMs: row.fromMs,
    pitchLengthM: row.pitchLengthM,
    pitchWidthM: row.pitchWidthM,
    rmsErrorPx: row.rmsErrorPx,
    points: byCalibration.get(row.id) ?? [],
  }));
}

/**
 * Writes a calibration, replacing whatever sits at the same start time.
 *
 * The scalars are updated in place before the points are swapped, so an
 * interruption can leave a calibration with no reference points but never a
 * half-written one presented as good: the app treats a point-less calibration as
 * needing to be redone.
 */
export async function saveCalibration(
  input: CalibrationDraft & { rmsErrorPx: number },
): Promise<number> {
  const fromMs = Math.round(input.fromMs);
  const rows = await db
    .select({ id: calibrations.id, fromMs: calibrations.fromMs })
    .from(calibrations)
    .where(eq(calibrations.videoId, input.videoId));

  const match = rows.find((row) => row.fromMs === fromMs);
  let calibrationId: number;

  if (match) {
    await db
      .update(calibrations)
      .set({
        pitchLengthM: input.pitchLengthM,
        pitchWidthM: input.pitchWidthM,
        rmsErrorPx: input.rmsErrorPx,
      })
      .where(eq(calibrations.id, match.id));

    await db.delete(calibrationPoints).where(eq(calibrationPoints.calibrationId, match.id));
    calibrationId = match.id;
  } else {
    const [row] = await db
      .insert(calibrations)
      .values({
        videoId: input.videoId,
        fromMs,
        pitchLengthM: input.pitchLengthM,
        pitchWidthM: input.pitchWidthM,
        rmsErrorPx: input.rmsErrorPx,
      })
      .returning({ id: calibrations.id });
    calibrationId = row.id;
  }

  if (input.points.length > 0) {
    await db.insert(calibrationPoints).values(
      input.points.map((point, index) => ({
        calibrationId,
        feature: point.feature,
        sortOrder: index,
        imageU: point.imageU,
        imageV: point.imageV,
        xM: point.xM,
        yM: point.yM,
      })),
    );
  }

  return calibrationId;
}

export async function deleteCalibration(id: number): Promise<void> {
  await db.delete(calibrations).where(eq(calibrations.id, id));
}
