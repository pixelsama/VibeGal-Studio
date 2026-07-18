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
import { InstructionSchema } from "./schema";
import { SCHEMAS } from "./schemaExport";

export interface ContractInputIssue {
  code: DiagnosticCode;
  severity: DiagnosticSeverity;
  source: DiagnosticSource;
  jsonPath: string;
  message: string;
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
    if (instructionType === "choice") {
      issues.push(issue("choice_instruction_not_supported", `${basePath}.t`, "choice 指令已废弃且不受支持"));
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
