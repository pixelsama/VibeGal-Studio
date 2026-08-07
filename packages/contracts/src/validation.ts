import type { z } from "zod";
import {
  contractDiagnostics,
  contractStructuralPolicies,
  instructionPolicies,
  type DiagnosticCode,
  type DiagnosticSeverity,
  type DiagnosticSource,
  type ContractDocumentName,
  type ContractStructuralPolicy,
} from "./diagnostics";
import { InstructionSchema, ManifestSchema, ProjectGraphSchema } from "./schema";
import type { Chapter, Manifest, ProjectGraphData } from "./types";
import { SCHEMAS } from "./schemaExport";

export interface ContractInputIssue {
  code: DiagnosticCode;
  severity: DiagnosticSeverity;
  source: DiagnosticSource;
  jsonPath: string;
  message: string;
}

export interface ContractProjectSemanticInput {
  graph: unknown;
  manifest: unknown;
  nodes: Array<{ nodeId: string; data: unknown }>;
  /** Optional atlas image dimensions keyed by content-relative image path. */
  imageDimensions?: Record<string, { width: number; height: number }>;
}

/**
 * Cross-document semantics shared by engine tooling and the Rust project report.
 * Structural validation remains in validateContractInput; invalid documents do
 * not produce speculative reference diagnostics here.
 */
export function validateProjectSemantics(
  input: ContractProjectSemanticInput,
): ContractInputIssue[] {
  const graphResult = ProjectGraphSchema.safeParse(input.graph);
  const manifestResult = ManifestSchema.safeParse(input.manifest);
  if (!graphResult.success || !manifestResult.success) return [];

  const nodes = new Map<string, Chapter>();
  for (const entry of input.nodes) {
    const result = Array.isArray(entry.data)
      ? SCHEMAS.nodeFile.safeParse(entry.data)
      : null;
    if (result?.success) nodes.set(entry.nodeId, result.data as Chapter);
  }

  return stableIssues([
    ...validateChapterCheckpoints(graphResult.data, manifestResult.data, nodes),
    ...validateAnimationAtlases(manifestResult.data, input.imageDimensions ?? {}),
  ]);
}

function validateChapterCheckpoints(
  graph: ProjectGraphData,
  manifest: Manifest,
  nodes: ReadonlyMap<string, Chapter>,
): ContractInputIssue[] {
  const issues: ContractInputIssue[] = [];
  const graphNodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const entryChapterId = graphNodes.get(graph.entryNodeId)?.chapterId;

  graph.chapters.forEach((chapter, chapterIndex) => {
    const chapterPath = `$.chapters[${chapterIndex}]`;
    const checkpoint = chapter.checkpoint;
    if (!checkpoint) {
      if (entryChapterId && chapter.id !== entryChapterId) {
        issues.push(issue(
          "chapter_checkpoint_missing",
          `${chapterPath}.checkpoint`,
          `章节 "${chapter.id}" 没有安全跳读 checkpoint；它只能作为编辑分组。`,
        ));
      }
      return;
    }

    const target = graphNodes.get(checkpoint.nodeId);
    if (!target) {
      issues.push(issue(
        "checkpoint_node_missing",
        `${chapterPath}.checkpoint.nodeId`,
        `章节 checkpoint 引用了不存在的节点 "${checkpoint.nodeId}"。`,
      ));
    } else if (target.chapterId !== chapter.id) {
      issues.push(issue(
        "checkpoint_node_wrong_chapter",
        `${chapterPath}.checkpoint.nodeId`,
        `章节 "${chapter.id}" 的 checkpoint 节点属于章节 "${target.chapterId}"。`,
      ));
    }

    if (checkpoint.instructionId) {
      const instructions = nodes.get(checkpoint.nodeId);
      const found = instructions ? storyPointExistsInTree(instructions, checkpoint.instructionId) : false;
      if (!found) {
        issues.push(issue(
          "checkpoint_story_point_missing",
          `${chapterPath}.checkpoint.instructionId`,
          `checkpoint 停点 "${checkpoint.instructionId}" 不存在于节点 "${checkpoint.nodeId}"。`,
        ));
      }
    }

    if (checkpoint.background && !(checkpoint.background in manifest.backgrounds)) {
      issues.push(issue(
        "checkpoint_background_missing",
        `${chapterPath}.checkpoint.background`,
        `checkpoint 引用了不存在的背景 "${checkpoint.background}"。`,
      ));
    }
    checkpoint.sprites.forEach((sprite, spriteIndex) => {
      const character = manifest.characters[sprite.id];
      if (!character) {
        issues.push(issue(
          "checkpoint_character_missing",
          `${chapterPath}.checkpoint.sprites[${spriteIndex}].id`,
          `checkpoint 引用了不存在的角色 "${sprite.id}"。`,
        ));
      } else if (!(sprite.expr in character.sprites)) {
        issues.push(issue(
          "checkpoint_character_expr_missing",
          `${chapterPath}.checkpoint.sprites[${spriteIndex}].expr`,
          `角色 "${sprite.id}" 没有 checkpoint 表情 "${sprite.expr}"。`,
        ));
      }
    });
    if (checkpoint.bgm && !(checkpoint.bgm.id in manifest.audio.bgm)) {
      issues.push(issue(
        "checkpoint_bgm_missing",
        `${chapterPath}.checkpoint.bgm.id`,
        `checkpoint 引用了不存在的 BGM "${checkpoint.bgm.id}"。`,
      ));
    }
  });
  return issues;
}

function validateAnimationAtlases(
  manifest: Manifest,
  dimensions: Readonly<Record<string, { width: number; height: number }>>,
): ContractInputIssue[] {
  const issues: ContractInputIssue[] = [];
  Object.entries(manifest.characters).forEach(([characterId, character]) => {
    Object.entries(character.sprites).forEach(([expression, reference]) => {
      if (typeof reference === "string") return;
      const path = `$.characters[${JSON.stringify(characterId)}].sprites[${JSON.stringify(expression)}]`;
      const atlas = manifest.animationAtlases[reference.atlas];
      if (!atlas) {
        issues.push(issue(
          "animation_atlas_missing",
          `${path}.atlas`,
          `角色表情引用了不存在的 animation atlas "${reference.atlas}"。`,
        ));
        return;
      }
      if (!atlas.clips?.[reference.clip]) {
        issues.push(issue(
          "animation_clip_missing",
          `${path}.clip`,
          `animation atlas "${reference.atlas}" 没有 clip "${reference.clip}"。`,
        ));
      }
    });
  });

  Object.entries(manifest.animationAtlases).forEach(([atlasId, atlas]) => {
    const dimension = dimensions[atlas.image];
    if (!dimension || !atlas.frameWidth || !atlas.frameHeight) return;
    const columns = Math.floor(dimension.width / atlas.frameWidth);
    const rows = Math.floor(dimension.height / atlas.frameHeight);
    const frameCount = columns * rows;
    Object.entries(atlas.clips ?? {}).forEach(([clipId, clip]) => {
      clip.frames.forEach((frame, frameIndex) => {
        if (columns > 0 && rows > 0 && frame < frameCount) return;
        issues.push(issue(
          "animation_frame_out_of_bounds",
          `$.animationAtlases[${JSON.stringify(atlasId)}].clips[${JSON.stringify(clipId)}].frames[${frameIndex}]`,
          `图集帧 ${frame} 超过 ${columns}×${rows} 网格范围。`,
        ));
      });
    });
  });
  return issues;
}

function isStoryPointInstruction(
  instruction: Chapter[number],
): instruction is Chapter[number] & { id?: string } {
  return instruction.t === "say"
    || instruction.t === "narrate"
    || instruction.t === "wait"
    || instruction.t === "pause"
    || instruction.t === "inputName"
    || instruction.t === "completeEnding"
    || instruction.t === "choice";
}

/**
 * Spec 35 Phase 4：在节点指令树（含 if.then/else、choice.options[].body）里
 * 检查 checkpoint 停点是否存在。
 *
 * 根帧：匹配 `instr.id` 或 `index:<N>`。
 * 嵌套帧：**仅匹配显式 `instr.id`**（index:N 在不同帧间有歧义，不支持）。
 */
function storyPointExistsInTree(instructions: Chapter, instructionId: string): boolean {
  const isRootFallback = instructionId.startsWith("index:");
  for (let i = 0; i < instructions.length; i += 1) {
    const instr = instructions[i];
    if (isStoryPointInstruction(instr) && (instr.id ?? `index:${i}`) === instructionId) {
      return true;
    }
    if (isRootFallback) continue;
    if (instr.t === "if") {
      if (scanBranchForStoryPoint(instr.then, instructionId)) return true;
      if (instr.else && scanBranchForStoryPoint(instr.else, instructionId)) return true;
    } else if (instr.t === "choice") {
      for (const option of instr.options) {
        if (option.body && scanBranchForStoryPoint(option.body, instructionId)) return true;
      }
    }
  }
  return false;
}

function scanBranchForStoryPoint(branch: Chapter, instructionId: string): boolean {
  for (const instr of branch) {
    if (isStoryPointInstruction(instr) && instr.id === instructionId) {
      return true;
    }
    if (instr.t === "if") {
      if (scanBranchForStoryPoint(instr.then, instructionId)) return true;
      if (instr.else && scanBranchForStoryPoint(instr.else, instructionId)) return true;
    } else if (instr.t === "choice") {
      for (const option of instr.options) {
        if (option.body && scanBranchForStoryPoint(option.body, instructionId)) return true;
      }
    }
  }
  return false;
}

const MAX_CONTRACT_ISSUES = 64;

export function validateContractInput(
  schemaName: ContractDocumentName,
  input: unknown,
): ContractInputIssue[] {
  if (schemaName === "nodeFile") return validateNodeFile(input);

  const result = SCHEMAS[schemaName].safeParse(input);
  if (result.success) return [];

  return stableIssues(flattenZodIssues(result.error.issues).map((zodIssue) => {
    const jsonPath = zodPathToJsonPath(zodIssue.path);
    return issue(structuralCode(schemaName, input, jsonPath), jsonPath, zodIssue.message);
  }));
}

function validateNodeFile(input: unknown): ContractInputIssue[] {
  const policy: ContractStructuralPolicy = contractStructuralPolicies.nodeFile;
  if (!Array.isArray(input)) {
    return [issue(
      policy.rootTypeCode ?? policy.defaultCode,
      "$",
      "节点内容必须是 Instruction[] 数组",
    )];
  }

  const issues: ContractInputIssue[] = [];
  input.forEach((instruction, index) => {
    const basePath = `$[${index}]`;
    if (!isRecord(instruction)) {
      issues.push(issue(policy.defaultCode, basePath, "指令必须是 JSON 对象"));
      return;
    }

    const instructionType = instruction.t;
    if (typeof instructionType !== "string") {
      issues.push(issue("instruction_unknown_type", `${basePath}.t`, "指令缺少有效的 t 类型"));
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(instructionPolicies, instructionType)) {
      issues.push(issue("instruction_unknown_type", `${basePath}.t`, `不受支持的指令类型：${instructionType}`));
      return;
    }

    const result = InstructionSchema.safeParse(instruction);
    if (result.success) return;
    for (const zodIssue of flattenZodIssues(result.error.issues)) {
      const suffix = zodPathToJsonPath(zodIssue.path);
      issues.push(issue(
        policy.defaultCode,
        suffix === "$" ? basePath : `${basePath}${suffix.slice(1)}`,
        zodIssue.message,
      ));
    }
  });

  return stableIssues(issues);
}

function structuralCode(
  schemaName: Exclude<ContractDocumentName, "nodeFile">,
  input: unknown,
  jsonPath: string,
): DiagnosticCode {
  const policy: ContractStructuralPolicy = contractStructuralPolicies[schemaName];
  if (!isRecord(input) && policy.rootTypeCode) return policy.rootTypeCode;
  for (const override of policy.pathOverrides ?? []) {
    if (override.exact?.some((path) => path === jsonPath)
      || override.prefixes?.some((prefix) => jsonPath.startsWith(prefix))) {
      return override.code;
    }
  }
  return policy.defaultCode;
}

function issue(code: DiagnosticCode, jsonPath: string, message: string): ContractInputIssue {
  const definition = contractDiagnostics[code];
  return {
    code,
    severity: definition.severity,
    source: definition.source,
    jsonPath,
    message,
  };
}

function stableIssues(issues: ContractInputIssue[]): ContractInputIssue[] {
  const unique = new Map<string, ContractInputIssue>();
  for (const current of issues) {
    unique.set(`${current.jsonPath}\0${current.code}`, current);
  }
  const sorted = [...unique.values()].sort(compareIssues);
  if (sorted.length <= MAX_CONTRACT_ISSUES) return sorted;

  const truncated = sorted.slice(0, MAX_CONTRACT_ISSUES);
  truncated.push(issue(
    "contract_error_truncated",
    "$",
    `结构错误超过 ${MAX_CONTRACT_ISSUES} 条，剩余错误已截断`,
  ));
  return truncated.sort(compareIssues);
}

function compareIssues(left: ContractInputIssue, right: ContractInputIssue): number {
    const leftKey = `${left.jsonPath}\0${left.code}`;
    const rightKey = `${right.jsonPath}\0${right.code}`;
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

type FlatZodIssue = {
  path: PropertyKey[];
  message: string;
};

function flattenZodIssues(
  issues: z.core.$ZodIssue[],
  prefix: PropertyKey[] = [],
): FlatZodIssue[] {
  return issues.flatMap((current) => {
    const path = [...prefix, ...current.path];
    if (current.code !== "invalid_union" || current.errors.length === 0) {
      return [{ path, message: current.message }];
    }

    const branches = current.errors.map((branch) => flattenZodIssues(branch, path));
    branches.sort((left, right) => unionBranchScore(left) - unionBranchScore(right));
    return branches[0] ?? [{ path, message: current.message }];
  });
}

function unionBranchScore(issues: FlatZodIssue[]): number {
  const pathSpecificity = issues.reduce((total, issue) => total + issue.path.length, 0);
  return issues.length * 1_000 - pathSpecificity;
}

function zodPathToJsonPath(path: readonly PropertyKey[]): string {
  let jsonPath = "$";
  for (const segment of path) {
    if (typeof segment === "number") {
      jsonPath += `[${segment}]`;
    } else if (typeof segment === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(segment)) {
      jsonPath += `.${segment}`;
    } else if (typeof segment === "string") {
      jsonPath += `[${JSON.stringify(segment)}]`;
    }
  }
  return jsonPath;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
