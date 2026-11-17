/**
 * Axis maths for a chart drawn over laps, kept pure so it can be tested
 * without a DOM. Shared by the Gantry's lap graph, which draws on a canvas,
 * and the Race Charts, which draw in SVG.
 */

/** Hard ceiling on gridline count, whatever the data does. */
export const MAX_GRIDLINES = 8;

/**
 * Lap numbers to label, at most `maxLabels` of them, always including the
 * first and never overlapping.
 */
export const lapAxisLabels = (
  minLap: number,
  maxLap: number,
  maxLabels: number
): number[] => {
  const total = maxLap - minLap + 1;
  if (total <= 1) return [minLap];
  const limit = Math.max(2, maxLabels);
  const step = Math.max(1, Math.ceil(total / limit));
  const labels: number[] = [];
  for (let lap = minLap; lap <= maxLap; lap += step) labels.push(lap);
  if (labels[labels.length - 1] !== maxLap) labels.push(maxLap);
  return labels;
};

/**
 * How many lap labels fit across a plot of this width, given roughly how wide
 * one label renders. Never returns fewer than 2.
 */
export const lapLabelCapacity = (
  plotWidth: number,
  approxLabelWidth: number
): number => Math.max(2, Math.floor(plotWidth / Math.max(1, approxLabelWidth)));

const LAP_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];

/**
 * Lap numbers to mark along the bottom of a chart: the round ones, at most
 * `maxTicks` of them, evenly apart. Where `lapAxisLabels` always names the
 * first and the last lap, this names laps that are easy to count from, and
 * its marks never crowd each other at an end.
 */
export const roundLapTicks = (
  minLap: number,
  maxLap: number,
  maxTicks: number
): number[] => {
  const from = Math.ceil(Math.min(minLap, maxLap));
  const to = Math.floor(Math.max(minLap, maxLap));
  const limit = Math.max(2, Math.floor(maxTicks));
  const step =
    LAP_STEPS.find(
      (candidate) =>
        Math.floor(to / candidate) - Math.ceil(from / candidate) + 1 <= limit
    ) ?? Math.max(1, Math.ceil((to - from + 1) / limit));
  const ticks: number[] = [];
  for (let lap = Math.ceil(from / step) * step; lap <= to; lap += step) {
    ticks.push(lap);
  }
  // A span with no round lap in it still says where it is.
  return ticks.length > 0 ? ticks : [from];
};

/** A y axis that can span negative values. */
export interface LinearAxis {
  min: number;
  max: number;
  step: number;
  values: number[];
}

const LADDER = [1, 2, 2.5, 5];

/**
 * Smallest 1/2/2.5/5 x 10^n step that keeps the gridline count within
 * MAX_GRIDLINES. Returned steps are always positive.
 */
export const niceStep = (range: number, maxLines = MAX_GRIDLINES): number => {
  const span = Number.isFinite(range) ? Math.abs(range) : 0;
  const lines = Math.max(1, maxLines);
  if (span <= 0) return 1;
  const rough = span / lines;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  for (const factor of LADDER) {
    const step = factor * magnitude;
    if (span / step <= lines) return step;
  }
  return 10 * magnitude;
};

/**
 * Builds a y axis over an arbitrary range, snapped outwards to whole steps.
 * A flat series still gets a usable axis rather than a zero-height one.
 */
export const buildLinearAxis = (
  rawMin: number,
  rawMax: number,
  maxLines = MAX_GRIDLINES
): LinearAxis => {
  let low = Number.isFinite(rawMin) ? rawMin : 0;
  let high = Number.isFinite(rawMax) ? rawMax : 0;
  if (high < low) [low, high] = [high, low];
  if (high - low < 1e-9) {
    const pad = Math.max(1, Math.abs(high) * 0.05);
    low -= pad;
    high += pad;
  }

  const step = niceStep(high - low, maxLines);
  const min = Math.floor(low / step) * step;
  const max = Math.ceil(high / step) * step;
  const values: number[] = [];
  for (
    let value = min;
    value <= max + step / 2 && values.length <= MAX_GRIDLINES;
    value += step
  ) {
    // Re-snap so repeated addition of a fractional step does not drift.
    values.push(Math.round(value / step) * step);
  }
  return { min, max, step, values };
};

/**
 * A y axis over exactly the range given, with gridlines at the round values
 * inside it. Where `buildLinearAxis` widens a range to whole steps, this
 * keeps it, for a plot that is to be filled by what it was fitted to: its
 * first and last gridline are then not at its edges.
 */
export const buildFittedAxis = (
  rawMin: number,
  rawMax: number,
  maxLines = MAX_GRIDLINES
): LinearAxis => {
  let min = Number.isFinite(rawMin) ? rawMin : 0;
  let max = Number.isFinite(rawMax) ? rawMax : 0;
  if (max < min) [min, max] = [max, min];
  if (max - min < 1e-9) {
    const pad = Math.max(1, Math.abs(max) * 0.05);
    min -= pad;
    max += pad;
  }

  const step = niceStep(max - min, maxLines);
  const values: number[] = [];
  // A hair of slack, so that a range ending on a round value keeps it.
  const slack = step * 1e-6;
  for (
    let index = Math.ceil((min - slack) / step);
    index * step <= max + slack && values.length <= MAX_GRIDLINES;
    index += 1
  ) {
    values.push(index * step);
  }
  return { min, max, step, values };
};

/**
 * Vertical pixel for a value, clamped to the plot. `inverted` counts
 * downwards from the top, for an axis whose smallest value belongs there.
 */
export const valueToY = (
  value: number,
  axis: LinearAxis,
  plotHeight: number,
  inverted: boolean
): number => {
  const span = axis.max - axis.min;
  if (span <= 0) return plotHeight / 2;
  const ratio = Math.min(1, Math.max(0, (value - axis.min) / span));
  return inverted ? ratio * plotHeight : (1 - ratio) * plotHeight;
};
