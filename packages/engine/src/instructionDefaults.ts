/**
 * 指令可选字段的缺省值 —— 与 contracts 里 zod `.default()` 的取值一一对应。
 *
 * 项目文件省略这些字段是合法的（JSON Schema 承诺了缺省语义），但指令进入
 * interpreter 时并没有被 zod 解析过，`instr.trans` 之类可能是 undefined；
 * 剧本文本也需要知道「哪些值等于缺省」才能决定要不要写出来。两处共用这一份表。
 */
export const INSTRUCTION_DEFAULTS = {
  bg: { trans: "fade", ms: 1000 },
  bgm: { fade: 1500, loop: true },
  char: {
    expr: "default",
    pos: "center",
    trans: "fade",
    ms: 600,
    clear: false,
    remove: false,
    scale: 1,
    flip: false,
    exprMs: 0,
  },
  say: { expr: "default" },
  inputName: { maxLength: 20 },
  effect: { intensity: 6, ms: 400 },
  transition: { ms: 1000 },
} as const satisfies Record<string, Record<string, string | number | boolean>>;

type DefaultedInstructionType = keyof typeof INSTRUCTION_DEFAULTS;

function hasDefaults(t: string): t is DefaultedInstructionType {
  return Object.prototype.hasOwnProperty.call(INSTRUCTION_DEFAULTS, t);
}

/**
 * 把缺省字段补齐后再比较两条指令 —— 「省略 trans」与「显式写 trans: fade」是
 * 同一条指令，剧本文本不应该因为项目文件写得更啰嗦就退化成 JSON。
 */
export function withInstructionDefaults<T extends { t: string }>(instruction: T): Record<string, unknown> {
  if (!hasDefaults(instruction.t)) return { ...instruction };
  const explicit = Object.fromEntries(
    Object.entries(instruction).filter(([, value]) => value !== undefined),
  );
  return { ...INSTRUCTION_DEFAULTS[instruction.t], ...explicit };
}
