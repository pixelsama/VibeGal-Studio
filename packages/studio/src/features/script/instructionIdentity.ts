import {
  isStoryPointInstruction,
  withoutStoryPointId,
  type Instruction,
} from "@vibegal/engine";

export interface AssignedInstructionIdentity {
  id: string;
}

export function projectInstructionsWithoutStoryPointIds(
  instructions: Instruction[],
): Instruction[] {
  return instructions.map((instruction) => ({ ...withoutStoryPointId(instruction) }));
}

export function reconcileScenarioInstructionIdentities(
  previousInstructions: Instruction[],
  parsedInstructions: Instruction[],
): Instruction[] {
  const previousProjected = projectInstructionsWithoutStoryPointIds(previousInstructions);
  const nextProjected = projectInstructionsWithoutStoryPointIds(parsedInstructions);
  const next = parsedInstructions.map((instruction) => ({ ...instruction }));
  const exactPairs = findUniqueExactMatches(previousProjected, nextProjected);

  for (const [previousIndex, nextIndex] of exactPairs) {
    next[nextIndex] = inheritStoryPointId(previousInstructions[previousIndex], next[nextIndex]);
  }

  const anchors = longestIncreasingPairs(exactPairs);
  const boundaries = [[-1, -1], ...anchors, [previousInstructions.length, next.length]] as const;
  for (let boundaryIndex = 0; boundaryIndex < boundaries.length - 1; boundaryIndex += 1) {
    const [previousStart, nextStart] = boundaries[boundaryIndex];
    const [previousEnd, nextEnd] = boundaries[boundaryIndex + 1];
    const previousCount = previousEnd - previousStart - 1;
    const nextCount = nextEnd - nextStart - 1;
    if (previousCount !== nextCount) continue;

    const regionTypesMatch = Array.from({ length: previousCount }, (_, offset) => (
      previousInstructions[previousStart + offset + 1].t === next[nextStart + offset + 1].t
    )).every(Boolean);
    if (!regionTypesMatch) continue;

    for (let offset = 0; offset < previousCount; offset += 1) {
      const previousIndex = previousStart + offset + 1;
      const nextIndex = nextStart + offset + 1;
      next[nextIndex] = inheritStoryPointId(previousInstructions[previousIndex], next[nextIndex]);
    }
  }

  return next;
}

export function mergeAssignedInstructionIdentities(
  savedInstructions: Instruction[],
  assigned: AssignedInstructionIdentity[],
  draftInstructions: Instruction[],
): Instruction[] {
  const assignedIds = new Set(assigned.map((item) => item.id));
  if (assignedIds.size === 0) return draftInstructions.map((instruction) => ({ ...instruction }));

  const assignedIdentitySource = savedInstructions.map((instruction) => {
    if (!isStoryPointInstruction(instruction)) return { ...instruction };
    const id = storyPointId(instruction);
    return id != null && assignedIds.has(id)
      ? { ...instruction }
      : ({ ...withoutStoryPointId(instruction) } as Instruction);
  });
  return reconcileScenarioInstructionIdentities(assignedIdentitySource, draftInstructions);
}

function findUniqueExactMatches(
  previous: Instruction[],
  next: Instruction[],
): Array<[number, number]> {
  const previousByProjection = groupIndicesByProjection(previous);
  const nextByProjection = groupIndicesByProjection(next);
  const matches: Array<[number, number]> = [];

  for (const [projection, previousIndices] of previousByProjection) {
    const nextIndices = nextByProjection.get(projection);
    if (previousIndices.length === 1 && nextIndices?.length === 1) {
      matches.push([previousIndices[0], nextIndices[0]]);
    }
  }

  return matches.sort((left, right) => left[0] - right[0]);
}

function groupIndicesByProjection(instructions: Instruction[]): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  instructions.forEach((instruction, index) => {
    const projection = stableJson(instruction);
    const indices = groups.get(projection) ?? [];
    indices.push(index);
    groups.set(projection, indices);
  });
  return groups;
}

function longestIncreasingPairs(pairs: Array<[number, number]>): Array<[number, number]> {
  if (pairs.length < 2) return pairs.slice();
  const lengths = pairs.map(() => 1);
  const predecessors = pairs.map(() => -1);
  let bestEnd = 0;

  for (let index = 0; index < pairs.length; index += 1) {
    for (let candidate = 0; candidate < index; candidate += 1) {
      if (pairs[candidate][1] < pairs[index][1] && lengths[candidate] + 1 > lengths[index]) {
        lengths[index] = lengths[candidate] + 1;
        predecessors[index] = candidate;
      }
    }
    if (lengths[index] > lengths[bestEnd]) bestEnd = index;
  }

  const result: Array<[number, number]> = [];
  for (let index = bestEnd; index >= 0; index = predecessors[index]) {
    result.push(pairs[index]);
    if (predecessors[index] === -1) break;
  }
  return result.reverse();
}

function inheritStoryPointId(previous: Instruction, next: Instruction): Instruction {
  if (!isStoryPointInstruction(previous) || !isStoryPointInstruction(next)) return next;
  if (storyPointId(next) != null) return next;
  const id = storyPointId(previous);
  return id == null ? next : ({ ...next, id } as Instruction);
}

function storyPointId(instruction: Instruction): string | undefined {
  if (!("id" in instruction) || typeof instruction.id !== "string" || instruction.id.length === 0) {
    return undefined;
  }
  return instruction.id;
}

function stableJson(value: unknown): string {
  if (typeof value === "number" && Object.is(value, -0)) return "-0";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isJsonObject(value)) {
    return `{${Object.keys(value)
      .filter((key) => value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  return serialized ?? String(value);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
