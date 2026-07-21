/** Stable, product-owned diagnostics and semantic rules exported alongside schemas. */
export type DiagnosticSeverity = "error" | "warn";
export type DiagnosticSource = "node" | "graph" | "manifest" | "meta" | "variables" | "contract";

export interface ContractDiagnostic {
  severity: DiagnosticSeverity;
  source: DiagnosticSource;
}

/**
 * The canonical issue registry. Keep every code emitted by contract validation
 * here so TypeScript, generated artifacts and Rust can share severity/source.
 */
export const contractDiagnostics = {
  node_not_array: { severity: "error", source: "node" },
  instruction_unknown_type: { severity: "error", source: "node" },
  instruction_invalid_field: { severity: "error", source: "node" },
  instruction_id_missing: { severity: "warn", source: "node" },
  instruction_id_duplicate: { severity: "error", source: "node" },
  choice_instruction_not_supported: { severity: "error", source: "node" },
  missing_background_ref: { severity: "error", source: "node" },
  missing_bgm_ref: { severity: "error", source: "node" },
  missing_sfx_ref: { severity: "error", source: "node" },
  missing_voice_ref: { severity: "error", source: "node" },
  missing_character_ref: { severity: "error", source: "node" },
  missing_character_expr: { severity: "error", source: "node" },
  missing_unlock_ref: { severity: "error", source: "node" },
  missing_cg_ref: { severity: "error", source: "node" },
  missing_video_ref: { severity: "error", source: "node" },
  missing_ending_ref: { severity: "error", source: "node" },
  duplicate_persistent_effect_id: { severity: "error", source: "node" },
  invalid_assignment_expression: { severity: "error", source: "node" },
  global_effect_missing_id: { severity: "error", source: "node" },
  graph_invalid_structure: { severity: "error", source: "graph" },
  invalid_edge_condition: { severity: "error", source: "graph" },
  auto_default_edge_not_last: { severity: "error", source: "graph" },
  missing_replay_node_ref: { severity: "error", source: "manifest" },
  missing_ending_node_ref: { severity: "error", source: "manifest" },
  ending_node_has_outgoing: { severity: "warn", source: "manifest" },
  missing_ending_completion: { severity: "warn", source: "manifest" },
  variables_invalid: { severity: "error", source: "variables" },
  reserved_variable_name: { severity: "error", source: "variables" },
  variable_default_type_mismatch: { severity: "error", source: "variables" },
  undeclared_variable: { severity: "warn", source: "variables" },
  variable_write_type_mismatch: { severity: "error", source: "variables" },
  manifest_not_object: { severity: "error", source: "manifest" },
  manifest_invalid_audio: { severity: "error", source: "manifest" },
  manifest_invalid_structure: { severity: "error", source: "manifest" },
  meta_not_object: { severity: "error", source: "meta" },
  meta_invalid_title: { severity: "error", source: "meta" },
  meta_invalid_timing: { severity: "error", source: "meta" },
  meta_invalid_stage: { severity: "error", source: "meta" },
  meta_invalid_structure: { severity: "error", source: "meta" },
  contract_invalid_value: { severity: "error", source: "contract" },
  contract_error_truncated: { severity: "error", source: "contract" },
} as const satisfies Record<string, ContractDiagnostic>;

export type DiagnosticCode = keyof typeof contractDiagnostics;

export type ContractDocumentName = "nodeFile" | "graph" | "manifest" | "meta" | "variables";

export type StructuralPathOverride = {
  code: DiagnosticCode;
  exact?: string[];
  prefixes?: string[];
};

export interface ContractStructuralPolicy {
  defaultCode: DiagnosticCode;
  rootTypeCode?: DiagnosticCode;
  pathOverrides?: StructuralPathOverride[];
}

/** Stable mapping from structural failures to product diagnostics. */
export const contractStructuralPolicies = {
  nodeFile: {
    defaultCode: "instruction_invalid_field",
    rootTypeCode: "node_not_array",
  },
  graph: {
    defaultCode: "graph_invalid_structure",
  },
  manifest: {
    defaultCode: "manifest_invalid_structure",
    rootTypeCode: "manifest_not_object",
    pathOverrides: [
      { code: "manifest_invalid_audio", exact: ["$.audio"], prefixes: ["$.audio."] },
    ],
  },
  meta: {
    defaultCode: "meta_invalid_structure",
    rootTypeCode: "meta_not_object",
    pathOverrides: [
      { code: "meta_invalid_title", exact: ["$.title"] },
      { code: "meta_invalid_stage", exact: ["$.stage"], prefixes: ["$.stage."] },
      {
        code: "meta_invalid_timing",
        exact: ["$.typingSpeedCps", "$.autoAdvanceMs", "$.chapterGapMs"],
      },
    ],
  },
  variables: {
    defaultCode: "variables_invalid",
    pathOverrides: [
      { code: "reserved_variable_name", prefixes: ["$.variables.system"] },
      { code: "variable_default_type_mismatch", prefixes: ["$.variables"], exact: [] },
    ],
  },
} as const satisfies Record<ContractDocumentName, ContractStructuralPolicy>;

export type RegistryRule = {
  kind: "registry";
  registryPath: string[];
  idField: string;
  missingCode: DiagnosticCode;
};

export type CharacterExpressionRule = {
  kind: "characterExpression";
  characterIdField: string;
  expressionField: string;
  defaultExpression: string;
};

export type RegistryByDiscriminatorRule = {
  kind: "registryByDiscriminator";
  discriminatorField: string;
  idField: string;
  registryPath: string[];
  registryByValue: Record<string, string[]>;
  missingCode: DiagnosticCode;
};

export type StoryPointRule = { kind: "storyPoint" };
export type InstructionRule =
  | RegistryRule
  | CharacterExpressionRule
  | RegistryByDiscriminatorRule
  | StoryPointRule;

export interface InstructionPolicy {
  storyPoint?: boolean;
  references?: InstructionRule[];
}

export const instructionPolicies = {
  bg: { references: [{ kind: "registry", registryPath: ["backgrounds"], idField: "id", missingCode: "missing_background_ref" }] },
  bgm: { references: [{ kind: "registry", registryPath: ["audio", "bgm"], idField: "id", missingCode: "missing_bgm_ref" }] },
  sfx: { references: [{ kind: "registry", registryPath: ["audio", "sfx"], idField: "id", missingCode: "missing_sfx_ref" }] },
  voice: { references: [{ kind: "registry", registryPath: ["audio", "voice"], idField: "id", missingCode: "missing_voice_ref" }] },
  char: { references: [{ kind: "characterExpression", characterIdField: "id", expressionField: "expr", defaultExpression: "default" }] },
  say: { storyPoint: true, references: [{ kind: "characterExpression", characterIdField: "who", expressionField: "expr", defaultExpression: "default" }] },
  narrate: { storyPoint: true },
  set: {},
  wait: { storyPoint: true },
  effect: {},
  transition: {},
  pause: { storyPoint: true },
  unlock: { references: [{ kind: "registryByDiscriminator", discriminatorField: "kind", idField: "id", registryPath: ["unlocks"], registryByValue: { cg: ["cg"], music: ["music"], replay: ["replay"], endings: ["endings"] }, missingCode: "missing_unlock_ref" }] },
  showCg: { references: [{ kind: "registry", registryPath: ["cg"], idField: "id", missingCode: "missing_cg_ref" }] },
  playVideo: { references: [{ kind: "registry", registryPath: ["videos"], idField: "id", missingCode: "missing_video_ref" }] },
  completeEnding: { storyPoint: true, references: [{ kind: "registry", registryPath: ["unlocks", "endings"], idField: "endingId", missingCode: "missing_ending_ref" }] },
} as const satisfies Record<string, InstructionPolicy>;

export function diagnosticDefinition(code: DiagnosticCode): ContractDiagnostic {
  return contractDiagnostics[code];
}
