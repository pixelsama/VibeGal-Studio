import type { Instruction } from "./types";

export type RuntimeEffect =
  | { type: "unlock"; kind: "cg" | "music" | "replay" | "endings"; id: string }
  | { type: "showCg"; id: string }
  | { type: "playVideo"; id: string; skippable?: boolean }
  | { type: "completeEnding"; id: string; endingId: string; nodeId?: string; playthroughId?: string }
  | { type: "globalSet"; id: string; key: string; value: string | number | boolean | null; nodeId?: string; playthroughId?: string };

export type RuntimeEffectHandler = (effect: RuntimeEffect) => void | Promise<void>;

export function runtimeEffectFromInstruction(instruction: Instruction): RuntimeEffect | null {
  switch (instruction.t) {
    case "unlock":
      return { type: "unlock", kind: instruction.kind, id: instruction.id };
    case "showCg":
      return { type: "showCg", id: instruction.id };
    case "playVideo":
      return {
        type: "playVideo",
        id: instruction.id,
        ...(instruction.skippable == null ? {} : { skippable: instruction.skippable }),
      };
    case "completeEnding":
      return { type: "completeEnding", id: instruction.id, endingId: instruction.endingId };
    default:
      return null;
  }
}
