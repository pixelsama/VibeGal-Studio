const HEAP_REGRESSION_THRESHOLD_RATIO = 0.2;

export function compareScaleBenchmarkBaseline(current, baseline) {
  if (current.browser?.status !== "completed") {
    throw new Error("Current browser benchmark is not completed.");
  }
  if (baseline.browser?.status !== "completed") {
    throw new Error("Baseline browser benchmark is not completed.");
  }

  const currentPeak = current.browser.measurements?.peakJsHeapBytes;
  const baselinePeak = baseline.browser.measurements?.peakJsHeapBytes;
  if (!Number.isFinite(currentPeak) || currentPeak <= 0) {
    throw new Error("Current browser benchmark has no valid peak JS heap measurement.");
  }
  if (!Number.isFinite(baselinePeak) || baselinePeak <= 0) {
    throw new Error("Baseline browser benchmark has no valid peak JS heap measurement.");
  }

  const namedRunner = current.environment?.runnerClass && baseline.environment?.runnerClass;
  const comparedFields = [
    ...(namedRunner
      ? [["environment.runnerClass", current.environment.runnerClass, baseline.environment.runnerClass]]
      : [
          ["environment.platform", current.environment?.platform, baseline.environment?.platform],
          ["environment.architecture", current.environment?.architecture, baseline.environment?.architecture],
          ["environment.cpuModel", current.environment?.cpuModel, baseline.environment?.cpuModel],
          ["environment.cpuCount", current.environment?.cpuCount, baseline.environment?.cpuCount],
        ]),
    ["browser.name", current.browser.browser?.name, baseline.browser.browser?.name],
    ["browser.viewport.width", current.browser.browser?.viewport?.width, baseline.browser.browser?.viewport?.width],
    ["browser.viewport.height", current.browser.browser?.viewport?.height, baseline.browser.browser?.viewport?.height],
    ["browser.viewport.deviceScaleFactor", current.browser.browser?.viewport?.deviceScaleFactor, baseline.browser.browser?.viewport?.deviceScaleFactor],
  ];
  const mismatches = comparedFields
    .filter(([, currentValue, baselineValue]) => currentValue !== baselineValue)
    .map(([field, currentValue, baselineValue]) => ({ field, current: currentValue, baseline: baselineValue }));
  if (mismatches.length > 0) {
    throw new Error(`Scale benchmark baseline runner does not match: ${mismatches.map(({ field }) => field).join(", ")}`);
  }

  const deltaBytes = currentPeak - baselinePeak;
  const regressionRatio = deltaBytes / baselinePeak;
  return {
    status: "completed",
    thresholdRatio: HEAP_REGRESSION_THRESHOLD_RATIO,
    baselinePeakJsHeapBytes: baselinePeak,
    currentPeakJsHeapBytes: currentPeak,
    deltaBytes,
    regressionRatio: Number(regressionRatio.toFixed(6)),
    passed: regressionRatio <= HEAP_REGRESSION_THRESHOLD_RATIO,
    runnerFields: comparedFields.map(([field]) => field),
  };
}
