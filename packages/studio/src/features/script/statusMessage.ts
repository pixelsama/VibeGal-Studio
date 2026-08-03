/**
 * 带严重度的状态文案。
 *
 * 以前状态色是靠正则从本地化字符串里反推（含"失败/failed"→error，其余→ok），
 * 这会把"请先把节点移到其他章节"这类警告误染成成功绿。改为由调用方按语义
 * 显式传入 severity，渲染侧直接据 severity 取色。
 */
export type StatusSeverity = "ok" | "warn" | "error";

export interface StatusMessage {
  message: string;
  severity: StatusSeverity;
}

export function statusOk(message: string): StatusMessage {
  return { message, severity: "ok" };
}

export function statusWarn(message: string): StatusMessage {
  return { message, severity: "warn" };
}

export function statusError(message: string): StatusMessage {
  return { message, severity: "error" };
}

/** 严重度对应的文字色 token。 */
export function statusSeverityColor(severity: StatusSeverity): string {
  if (severity === "error") return "var(--status-error-text)";
  if (severity === "warn") return "var(--status-warn-text)";
  return "var(--status-ok-text)";
}
