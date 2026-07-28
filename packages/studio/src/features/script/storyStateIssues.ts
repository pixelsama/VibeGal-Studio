/**
 * 把故事状态的静态诊断汇成 ProjectIssue，交给右下角的全局问题面板。
 *
 * 此前这些诊断只出现在「分析」tab 里，于是问题散在两个地方：全局面板一份、
 * 分析面板一份，作者不知道哪个才权威。现在全局面板是唯一收件箱。
 */
import type { Manifest, VariableRegistry } from "@vibegal/engine";
import type { NodeEntry, ProjectGraph, ProjectIssue } from "../../lib/types";
import { analyzeGraphVariables } from "./variableAnalysis";
import { describeVariableIssue } from "./storyState";
import { translateZhCN, type StudioTranslator } from "../../lib/i18n";

export function collectStoryStateIssues(input: {
  graph?: ProjectGraph | null;
  nodes?: NodeEntry[];
  registry?: VariableRegistry;
  manifest?: Manifest;
  t?: StudioTranslator;
}): ProjectIssue[] {
  if (!input.graph) return [];
  const t = input.t ?? translateZhCN;
  const analysis = analyzeGraphVariables(input.graph, input.nodes, input.registry);
  const issues: ProjectIssue[] = [];

  for (const entry of analysis.variables) {
    for (const issue of entry.issues) {
      const described = describeVariableIssue(issue, entry.name, input.registry, input.manifest, t);
      // 点击后跳到能改它的位置：优先条件所在的边，否则第一处写入。
      const read = entry.reads[0];
      const write = entry.writes[0];
      issues.push({
        severity: described.severity,
        source: "variables",
        code: described.code,
        message: described.fix ? `${described.message} ${described.fix}` : described.message,
        ...(read?.edgeId ? { edgeId: read.edgeId, nodeId: read.nodeId } : {}),
        ...(!read?.edgeId && write?.nodeId ? { nodeId: write.nodeId, file: write.file, jsonPath: write.jsonPath } : {}),
      });
    }
  }

  for (const issue of analysis.parseIssues) {
    issues.push({
      severity: "error",
      source: "variables",
      code: "invalid_condition",
      message: t("script.stateIssue.invalidCondition", { detail: issue.message }),
      nodeId: issue.nodeId,
      edgeId: issue.edgeId,
      file: issue.file,
      jsonPath: issue.jsonPath,
    });
  }

  return issues;
}

/**
 * 条件里引用了已经不存在的选择支或节点。
 *
 * `chose.<edgeId>` / `seen.<nodeId>` 是本轮新引入的引用形态：边或节点被删掉后，
 * 引用它的条件会静默失效（求值恒为 false，玩家永远走不到那条分支），静态分析
 * 原本看不出来。这里补上这个缺口。
 */
export function collectDanglingExperienceIssues(
  graph?: ProjectGraph | null,
  nodes?: NodeEntry[],
  t: StudioTranslator = translateZhCN,
): ProjectIssue[] {
  if (!graph) return [];
  const analysis = analyzeGraphVariables(graph, nodes);
  const edgeIds = new Set(graph.edges.map((edge) => edge.id));
  const nodeIds = new Set(graph.nodes.map((node) => node.id));
  const issues: ProjectIssue[] = [];

  for (const entry of analysis.variables) {
    const dangling = danglingExperienceTarget(entry.name, edgeIds, nodeIds);
    if (!dangling) continue;
    const read = entry.reads[0];
    issues.push({
      severity: "error",
      source: "variables",
      code: "dangling_story_experience",
      message: dangling.kind === "chose"
        ? t("script.stateIssue.danglingChoice")
        : t("script.stateIssue.danglingNode"),
      ...(read?.edgeId ? { edgeId: read.edgeId, nodeId: read.nodeId, file: read.file, jsonPath: read.jsonPath } : {}),
    });
  }

  return issues;
}

function danglingExperienceTarget(
  name: string,
  edgeIds: Set<string>,
  nodeIds: Set<string>,
): { kind: "chose" | "seen" } | null {
  if (name.startsWith("chose.")) {
    return edgeIds.has(name.slice("chose.".length)) ? null : { kind: "chose" };
  }
  if (name.startsWith("seen.")) {
    return nodeIds.has(name.slice("seen.".length)) ? null : { kind: "seen" };
  }
  return null;
}
