import path from "node:path";

export const DEFAULT_DESKTOP_SCENARIO = "desktop-authoring-loop";

// These ids are the stable handoff between the desktop runner and the
// scenario agents. The corresponding business specs are intentionally not
// implemented here.
export const DESKTOP_SCENARIO_IDS = Object.freeze([
  DEFAULT_DESKTOP_SCENARIO,
  "project-lifecycle",
  "core-authoring",
  "external-collaboration",
  "asset-workflow",
  "renderer-appearance",
  "validation-export",
]);

const DEFAULT_PHASES = Object.freeze([
  { id: "authoring", restart: false },
]);

const SCENARIO_DEFINITIONS = Object.freeze({
  [DEFAULT_DESKTOP_SCENARIO]: {
    id: DEFAULT_DESKTOP_SCENARIO,
    spec: "qa/agent/specs/studio-core.e2e.mjs",
    fixtureProfile: "sample-novel",
    phases: DEFAULT_PHASES,
  },
  "project-lifecycle": scenarioDefinition("project-lifecycle", [
    ["create", false],
    ["reopen", true],
  ]),
  "core-authoring": scenarioDefinition("core-authoring", [
    ["authoring", false],
    ["reopen", true],
  ]),
  "external-collaboration": scenarioDefinition("external-collaboration", [
    ["open", false],
    ["external-edit", true],
    ["conflict", true],
  ]),
  "asset-workflow": scenarioDefinition("asset-workflow", [
    ["import-and-reference", false],
    ["repair-reference", true],
  ]),
  "renderer-appearance": scenarioDefinition("renderer-appearance", [
    ["edit", false],
    ["reopen", true],
  ]),
  "validation-export": scenarioDefinition("validation-export", [
    ["edit-and-validate", false],
    ["export", true],
  ]),
});

export function parseDesktopArgs(argv) {
  const parsed = {
    scenario: DEFAULT_DESKTOP_SCENARIO,
    phase: null,
    fixtureProfile: "sample-novel",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--scenario") {
      parsed.scenario = requiredValue(argv, ++index, "--scenario");
    } else if (argument === "--phase") {
      parsed.phase = requiredValue(argv, ++index, "--phase");
    } else if (argument === "--fixture") {
      parsed.fixtureProfile = requiredValue(argv, ++index, "--fixture");
    } else if (argument === "--" || argument === "--help" || argument === "-h") {
      continue;
    } else {
      throw new Error(`Unknown desktop Agent QA argument: ${argument}`);
    }
  }

  assertSafeId(parsed.scenario, "desktop scenario");
  if (!DESKTOP_SCENARIO_IDS.includes(parsed.scenario)) {
    throw new Error(`Unknown desktop scenario: ${parsed.scenario}`);
  }
  if (parsed.phase !== null) assertSafeId(parsed.phase, "desktop phase");
  assertSafeId(parsed.fixtureProfile, "desktop fixture profile");
  return parsed;
}

export function getDesktopScenarioDefinition(id = DEFAULT_DESKTOP_SCENARIO) {
  const definition = SCENARIO_DEFINITIONS[id];
  if (!definition) throw new Error(`Unknown desktop scenario: ${id}`);
  return {
    ...definition,
    phases: definition.phases.map((phase) => ({ ...phase })),
  };
}

export function buildDesktopPhasePlan(definition, { phase = null } = {}) {
  const phases = definition.phases ?? DEFAULT_PHASES;
  const selected = phases
    .map((item, index) => ({ ...item, originalIndex: index }))
    .filter((item) => phase === null || item.id === phase);
  if (selected.length === 0) {
    throw new Error(`Unknown phase ${JSON.stringify(phase)} for desktop scenario ${definition.id}`);
  }
  return selected.map(({ originalIndex, ...item }) => ({
    ...item,
    index: originalIndex,
    scenarioId: definition.id,
    spec: definition.spec,
  }));
}

export function desktopArtifactDirectory(artifactsRoot, scenarioId, { legacyCompatible = false } = {}) {
  const root = path.resolve(artifactsRoot);
  if (legacyCompatible && scenarioId === DEFAULT_DESKTOP_SCENARIO) return path.join(root, "desktop");
  return path.join(root, "desktop", "scenarios", scenarioId);
}

export function resolveDesktopSpec(root, definition) {
  return path.resolve(root, definition.spec);
}

function scenarioDefinition(id, phaseEntries) {
  return {
    id,
    spec: `qa/agent/specs/${id}.e2e.mjs`,
    fixtureProfile: "sample-novel",
    phases: Object.freeze(phaseEntries.map(([phaseId, restart]) => ({ id: phaseId, restart }))),
  };
}

function requiredValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function assertSafeId(value, label) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}
