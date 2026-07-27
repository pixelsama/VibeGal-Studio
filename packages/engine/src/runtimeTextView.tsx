import { Fragment, type CSSProperties, type ReactNode } from "react";
import type { RuntimeTextState, RuntimeTextToken } from "./state";

export interface RuntimeTextViewProps {
  text: Pick<RuntimeTextState, "text" | "typedLen" | "tokens">;
  reveal?: number;
}

/** Render the safe runtime-text token stream without HTML or innerHTML. */
export function RuntimeTextView({ text, reveal = text.typedLen }: RuntimeTextViewProps): ReactNode {
  return renderRuntimeTextTokens(text.tokens, text.text, reveal);
}

export function renderRuntimeTextTokens(
  tokens: readonly RuntimeTextToken[] | undefined,
  plainText: string,
  reveal = plainText.length,
): ReactNode {
  if (!tokens) return plainText.slice(0, reveal);
  let remaining = Math.max(0, reveal);
  const nodes: ReactNode[] = [];

  tokens.forEach((token, index) => {
    if (token.type === "pause" || remaining <= 0) return;
    const visible = token.text.slice(0, remaining);
    remaining -= visible.length;
    if (!visible) return;

    let node: ReactNode = visible;
    if (token.ruby) node = <ruby>{node}<rt>{token.ruby}</rt></ruby>;
    if (token.bold) node = <strong>{node}</strong>;
    if (token.color) node = <span style={{ color: token.color } as CSSProperties}>{node}</span>;
    nodes.push(<Fragment key={`${index}:${visible}`}>{node}</Fragment>);
  });

  return nodes;
}
