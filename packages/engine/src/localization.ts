import type { Instruction, LocaleTable } from "./types";

export type LocalizableInstruction = Extract<Instruction, { t: "say" | "narrate" }>;
export type LocaleTables = Readonly<Record<string, LocaleTable>>;

export interface ResolveLocalizedTextInput {
  text: string;
  textKey?: string;
  currentLocale?: string;
  defaultLocale?: string;
  tables?: LocaleTables;
}

/**
 * Resolve display text without changing the source instruction. Read-state and
 * story-point identity must continue to use the inline source text.
 */
export function resolveLocalizedText(input: ResolveLocalizedTextInput): string {
  if (!input.textKey || !input.tables) return input.text;
  const current = tableValue(input.tables[input.currentLocale ?? ""], input.textKey);
  if (current !== undefined) return current;
  const fallback = tableValue(input.tables[input.defaultLocale ?? ""], input.textKey);
  return fallback ?? input.text;
}

export function localizeInstruction(
  instruction: LocalizableInstruction,
  options: Omit<ResolveLocalizedTextInput, "text" | "textKey">,
): LocalizableInstruction {
  const text = resolveLocalizedText({
    ...options,
    text: instruction.text,
    textKey: instruction.textKey,
  });
  return text === instruction.text ? instruction : { ...instruction, text };
}

function tableValue(table: LocaleTable | undefined, key: string): string | undefined {
  return table && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}
