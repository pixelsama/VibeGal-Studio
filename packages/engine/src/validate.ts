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
import type { Manifest, Meta, Chapter } from "./types";

export interface ValidationIssue {
  level: "error" | "warn";
  code?: string;
  file: string;
  index?: number; // 指令序号（chapter 校验时）
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
  const issues: ValidationIssue[] = [];
  const result = ChapterSchema.safeParse(raw);
  if (!result.success) {
    for (const err of result.error.issues) {
      // zod 的 path 形如 [3, "id"]，取首段作为指令序号
      const idx = typeof err.path[0] === "number" ? err.path[0] : undefined;
      issues.push({ level: "error", file, index: idx, message: err.message });
    }
    return issues;
  }
  issues.push(...validateInstructionIdentity(result.data, file));
  return issues;
}

const STORY_POINT_INSTRUCTION_TYPES = new Set(["say", "narrate", "wait", "pause"]);

function validateInstructionIdentity(chapter: Chapter, file: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const firstIndexById = new Map<string, number>();

  chapter.forEach((instr, index) => {
    if (!STORY_POINT_INSTRUCTION_TYPES.has(instr.t)) return;
    const instructionId = "id" in instr ? instr.id : undefined;
    if (!instructionId) {
      issues.push({
        level: "warn",
        code: "instruction_id_missing",
        file,
        index,
        message: `${instr.t} 指令缺少稳定 id；存档、已读和回滚将无法稳定定位该停点。`,
      });
      return;
    }

    const firstIndex = firstIndexById.get(instructionId);
    if (firstIndex != null) {
      issues.push({
        level: "error",
        code: "instruction_id_duplicate",
        file,
        index,
        message: `同一节点内重复的停点 instruction id: "${instructionId}"（首次出现于 #${firstIndex}）。`,
      });
      return;
    }
    firstIndexById.set(instructionId, index);
  });

  return issues;
}

/** 校验 manifest 结构 */
export function validateManifest(raw: unknown, file = "manifest.json"): ValidationIssue[] {
  const result = ManifestSchema.safeParse(raw);
  if (!result.success) {
    return result.error.issues.map((err) => ({ level: "error" as const, file, message: err.message }));
  }
  return [];
}

/** 校验 meta 结构 */
export function validateMeta(raw: unknown, file = "meta.json"): ValidationIssue[] {
  const result = MetaSchema.safeParse(raw);
  if (!result.success) {
    return result.error.issues.map((err) => ({ level: "error" as const, file, message: err.message }));
  }
  return [];
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
  if (!parsed.success) return [{ level: "error", file, message: "剧本结构非法，无法做引用检查" }];

  parsed.data.forEach((instr, index) => {
    switch (instr.t) {
      case "bg":
        if (!(instr.id in manifest.backgrounds))
          issues.push({ level: "error", code: "missing_background_ref", file, index, message: `引用了不存在的 background id: "${instr.id}"` });
        break;
      case "bgm":
        if (!(instr.id in manifest.audio.bgm))
          issues.push({ level: "error", code: "missing_bgm_ref", file, index, message: `引用了不存在的 bgm id: "${instr.id}"` });
        break;
      case "sfx":
        if (!(instr.id in manifest.audio.sfx))
          issues.push({ level: "error", code: "missing_sfx_ref", file, index, message: `引用了不存在的 sfx id: "${instr.id}"` });
        break;
      case "voice":
        if (!(instr.id in manifest.audio.voice))
          issues.push({ level: "error", code: "missing_voice_ref", file, index, message: `引用了不存在的 voice id: "${instr.id}"` });
        break;
      case "char":
      case "say": {
        const charId = instr.t === "char" ? instr.id : instr.who;
        const char = manifest.characters[charId];
        if (!char) {
          issues.push({ level: "error", code: "missing_character_ref", file, index, message: `引用了不存在的 character id: "${charId}"` });
          break;
        }
        if (!(instr.expr in char.sprites))
          issues.push({ level: "error", code: "missing_character_expr", file, index, message: `角色 "${charId}" 没有表情 "${instr.expr}"（可用: ${Object.keys(char.sprites).join(", ")}）` });
        break;
      }
      case "unlock": {
        const table = manifest.unlocks[instr.kind];
        if (!(instr.id in table)) {
          issues.push({ level: "error", code: "missing_unlock_ref", file, index, message: `引用了不存在的 unlock id: "${instr.id}"` });
        }
        break;
      }
      case "showCg":
        if (!(instr.id in manifest.cg))
          issues.push({ level: "error", code: "missing_cg_ref", file, index, message: `引用了不存在的 cg id: "${instr.id}"` });
        break;
      case "playVideo":
        if (!(instr.id in manifest.videos))
          issues.push({ level: "error", code: "missing_video_ref", file, index, message: `引用了不存在的 video id: "${instr.id}"` });
        break;
    }
  });
  return issues;
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
