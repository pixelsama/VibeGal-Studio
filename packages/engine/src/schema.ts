/**
 * Backwards-compatible schema entry point.
 *
 * The canonical runtime contracts live in @vibegal/contracts. Keep this thin
 * re-export so existing @vibegal/engine consumers continue to work unchanged.
 */
export * from "@vibegal/contracts/schema";
