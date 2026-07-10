/**
 * 运行时校验：在剧本/资源加载时跑一次。
 * TS 不会校验 JSON，所以外部工具生成或手工改过的数据必须在这里兜底，
 * 报错要指明是哪个文件、第几条指令、什么 id 出了问题。
 */
import {
  ChapterSchema,
  ManifestSchema,
  MetaSchema,
} from "./schema";
import {
  contractDiagnostics,
  instructionPolicies,
  validateContractInput,
  type DiagnosticCode,
  type DiagnosticSource,
  type InstructionPolicy,
  type InstructionRule,
} from "@vibegal/contracts";
import type { Manifest, Meta, Chapter } from "./types";

export interface ValidationIssue {
  level: "error" | "warn";
  code?: DiagnosticCode;
  source?: DiagnosticSource;
  file: string;
  index?: number; // 指令序号（chapter 校验时）
  jsonPath?: string;
  message: string;
}

export class ContentValidationError extends Error {
  issues: ValidationIssue[];
  constructor(issues: ValidationIssue[]) {
    super(`内容校验失败，共 ${issues.length} 个问题:\n` +
      issues.map((i) => `  [${i.level}] ${i.file}${i.index != null ? `#${i.index}` : ""}: ${i.message}`).join("\n"));
    this.issues = issues;
  }
}

/** 校验单个 chapter 的指令结构（不检查 id 引用，那一步在 validateReferences 里做） */
export function validateChapter(raw: unknown, file: string): ValidationIssue[] {
  const structuralIssues = contractIssues("nodeFile", raw, file);
  if (structuralIssues.length > 0) return structuralIssues;

  const result = ChapterSchema.safeParse(raw);
  if (!result.success) throw new Error("contracts normalizer accepted a chapter rejected by ChapterSchema");
  return validateInstructionIdentity(result.data, file);
}

function instructionPolicy(instruction: { t: string }): InstructionPolicy | undefined {
  return instructionPolicies[instruction.t as keyof typeof instructionPolicies];
}

function validateInstructionIdentity(chapter: Chapter, file: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const firstIndexById = new Map<string, number>();

  chapter.forEach((instr, index) => {
    if (!instructionPolicy(instr)?.storyPoint) return;
    const instructionId = (instr as Record<string, unknown>).id;
    if (typeof instructionId !== "string" || !instructionId) {
      issues.push(productIssue(
        "instruction_id_missing",
        file,
        `${instr.t} 指令缺少稳定 id；存档、已读和回滚将无法稳定定位该停点。`,
        index,
        `$[${index}].id`,
      ));
      return;
    }

    const firstIndex = firstIndexById.get(instructionId);
    if (firstIndex != null) {
      issues.push(productIssue(
        "instruction_id_duplicate",
        file,
        `同一节点内重复的停点 instruction id: "${instructionId}"（首次出现于 #${firstIndex}）。`,
        index,
        `$[${index}].id`,
      ));
      return;
    }
    firstIndexById.set(instructionId, index);
  });

  return issues;
}

/** 校验 manifest 结构 */
export function validateManifest(raw: unknown, file = "manifest.json"): ValidationIssue[] {
  return contractIssues("manifest", raw, file);
}

/** 校验 meta 结构 */
export function validateMeta(raw: unknown, file = "meta.json"): ValidationIssue[] {
  return contractIssues("meta", raw, file);
}

/**
 * 校验剧本里引用的所有 id 是否在 manifest 中存在。
 * 这是外部生成剧本最容易踩的坑：拼错角色 id、用了不存在的表情。
 */
export function validateReferences(
  chapter: unknown,
  manifest: Manifest,
  file: string,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const parsed = ChapterSchema.safeParse(chapter);
  if (!parsed.success) return contractIssues("nodeFile", chapter, file);

  parsed.data.forEach((instruction, index) => {
    const fields = instruction as Record<string, unknown>;
    for (const rule of instructionPolicy(instruction)?.references ?? []) {
      validateReferenceRule(rule, fields, manifest, file, index, issues);
    }
  });
  return issues;
}

function validateReferenceRule(
  rule: InstructionRule,
  fields: Record<string, unknown>,
  manifest: Manifest,
  file: string,
  index: number,
  issues: ValidationIssue[],
) {
  if (rule.kind === "registry") {
    const id = fields[rule.idField];
    const registry = recordAtPath(manifest, rule.registryPath);
    if (typeof id === "string" && !(id in registry)) {
      issues.push(productIssue(rule.missingCode, file, `引用了不存在的资源 id: "${id}"`, index, `$[${index}].${rule.idField}`));
    }
    return;
  }

  if (rule.kind === "characterExpression") {
    const characterId = fields[rule.characterIdField];
    const expression = fields[rule.expressionField] ?? rule.defaultExpression;
    if (typeof characterId !== "string") return;
    const character = manifest.characters[characterId];
    if (!character) {
      issues.push(productIssue("missing_character_ref", file, `引用了不存在的 character id: "${characterId}"`, index, `$[${index}].${rule.characterIdField}`));
      return;
    }
    if (typeof expression === "string" && !(expression in character.sprites)) {
      issues.push(productIssue("missing_character_expr", file, `角色 "${characterId}" 没有表情 "${expression}"（可用: ${Object.keys(character.sprites).join(", ")}）`, index, `$[${index}].${rule.expressionField}`));
    }
    return;
  }

  if (rule.kind === "registryByDiscriminator") {
    const discriminator = fields[rule.discriminatorField];
    const id = fields[rule.idField];
    const branch = typeof discriminator === "string" ? rule.registryByValue[discriminator] : undefined;
    if (!branch || typeof id !== "string") return;
    const registry = recordAtPath(manifest, [...rule.registryPath, ...branch]);
    if (!(id in registry)) {
      issues.push(productIssue(rule.missingCode, file, `引用了不存在的资源 id: "${id}"`, index, `$[${index}].${rule.idField}`));
    }
    return;
  }

  // Story-point is consumed by validateInstructionIdentity. Keep this branch
  // explicit so new metadata rule kinds cannot be silently mistaken for refs.
  if (rule.kind !== "storyPoint") {
    const exhaustive: never = rule;
    throw new Error(`未知 contracts 引用规则: ${String(exhaustive)}`);
  }
}

function recordAtPath(value: unknown, path: readonly string[]): Record<string, unknown> {
  let current: unknown = value;
  for (const segment of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return {};
    current = (current as Record<string, unknown>)[segment];
  }
  return current && typeof current === "object" && !Array.isArray(current)
    ? current as Record<string, unknown>
    : {};
}

function contractIssues(
  schema: "nodeFile" | "manifest" | "meta",
  raw: unknown,
  file: string,
): ValidationIssue[] {
  return validateContractInput(schema, raw).map((issue) => ({
    level: issue.severity,
    code: issue.code,
    source: issue.source,
    file,
    index: instructionIndex(issue.jsonPath),
    jsonPath: issue.jsonPath,
    message: issue.message,
  }));
}

function productIssue(
  code: DiagnosticCode,
  file: string,
  message: string,
  index?: number,
  jsonPath?: string,
): ValidationIssue {
  const definition = contractDiagnostics[code];
  return {
    level: definition.severity,
    code,
    source: definition.source,
    file,
    index,
    jsonPath,
    message,
  };
}

function instructionIndex(jsonPath: string): number | undefined {
  const match = /^\$\[(\d+)]/.exec(jsonPath);
  return match ? Number(match[1]) : undefined;
}

/** 一站式：跑完结构校验，再对每个 chapter 跑引用校验。返回值含解析后的 chapters（已应用默认值）。 */
export function validateContent(opts: {
  meta: unknown;
  manifest: unknown;
  chapters: { file: string; data: unknown }[];
}): { meta: Meta; manifest: Manifest; chapters: Chapter[] } {
  const issues: ValidationIssue[] = [];
  issues.push(...validateMeta(opts.meta));
  issues.push(...validateManifest(opts.manifest));

  const metaRes = MetaSchema.safeParse(opts.meta);
  const manifestRes = ManifestSchema.safeParse(opts.manifest);
  if (!metaRes.success || !manifestRes.success) {
    throw new ContentValidationError(issues);
  }

  // 每个 chapter 都 parse 一次，拿到「带默认值」的解析结果；
  // 这些解析后的指令才是 player 应该消费的数据（裸 JSON 没有默认值）。
  const parsedChapters: Chapter[] = [];
  for (const ch of opts.chapters) {
    issues.push(...validateChapter(ch.data, ch.file));
    const res = ChapterSchema.safeParse(ch.data);
    if (res.success) {
      parsedChapters.push(res.data);
      issues.push(...validateReferences(res.data, manifestRes.data, ch.file));
    }
  }

  const errors = issues.filter((i) => i.level === "error");
  if (errors.length > 0) throw new ContentValidationError(errors);

  // 警告打印但不阻断
  issues.filter((i) => i.level === "warn").forEach((i) => console.warn(`[content] ${i.file}: ${i.message}`));

  return { meta: metaRes.data, manifest: manifestRes.data, chapters: parsedChapters };
}
