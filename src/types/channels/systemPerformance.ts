/**
 * What the machine, Tearoff and the sim are costing right now.
 *
 * Built by SystemPerformanceProcessor from two sources: the operating
 * system's counters, read once a second by the system load sampler, and the
 * sim's own meters in the telemetry frame. Every figure is rounded to what
 * the widget shows, so the snapshot is republished only when a digit moves.
 */
export interface SystemPerformanceSnapshot {
  /**
   * Whole machine, 0..100, averaged over all logical cores and smoothed, one
   * decimal. Null until two readings exist.
   */
  systemCpuPercent: number | null;
  /** Physical memory in use, gigabytes (2^30 bytes), one decimal. */
  systemMemoryUsedGb: number | null;
  systemMemoryTotalGb: number | null;
  /**
   * All of Tearoff's processes together, 0..100 of the whole machine,
   * smoothed, one decimal. Null until two readings exist.
   */
  appCpuPercent: number | null;
  /** All of Tearoff's processes together, megabytes (2^20 bytes), whole. */
  appMemoryMb: number | null;
  /**
   * The sim's own meters, null where the sim publishes none (Le Mans
   * Ultimate). Frames per second, whole.
   */
  simFps: number | null;
  /**
   * Share of the frame the sim's foreground thread uses, 0..100, one
   * decimal. The sim's own meter, not whole-machine utilisation.
   */
  simCpuPercent: number | null;
  /** The same kind of share for the sim's GPU thread. */
  simGpuPercent: number | null;
  /**
   * Whole-machine GPU load, 0..100. Always null today: neither Node nor
   * Electron reports it. Carried so a later sampler needs no channel change.
   */
  gpuPercent: number | null;
  version: number;
}
