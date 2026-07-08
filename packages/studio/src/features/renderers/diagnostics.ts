export type RendererDiagnosticSeverity = "error" | "warn";
export type RendererDiagnosticStep = "discover" | "read" | "compile" | "manifest" | "contract" | "runtime";

export interface RendererDiagnostic {
  severity: RendererDiagnosticSeverity;
  code: string;
  rendererId: string;
  step: RendererDiagnosticStep;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  snippet?: string;
}

export class RendererDiagnosticError extends Error {
  readonly diagnostics: RendererDiagnostic[];

  constructor(diagnostics: RendererDiagnostic[]) {
    super(formatRendererDiagnostics(diagnostics));
    this.name = "RendererDiagnosticError";
    this.diagnostics = diagnostics;
  }
}

export function getRendererDiagnostics(error: unknown): RendererDiagnostic[] | null {
  if (error instanceof RendererDiagnosticError) return error.diagnostics;
  if (error && typeof error === "object" && "diagnostics" in error) {
    const diagnostics = (error as { diagnostics?: unknown }).diagnostics;
    if (Array.isArray(diagnostics)) return diagnostics as RendererDiagnostic[];
  }
  return null;
}

export function rendererFilePath(rendererId: string, file: string): string {
  return file.startsWith("renderers/") ? file : `renderers/${rendererId}/${file}`;
}

export function locationLabel(diagnostic: RendererDiagnostic): string {
  if (!diagnostic.file) return "";
  if (diagnostic.line != null && diagnostic.column != null) {
    return `${diagnostic.file}:${diagnostic.line}:${diagnostic.column}`;
  }
  if (diagnostic.line != null) return `${diagnostic.file}:${diagnostic.line}`;
  return diagnostic.file;
}

export function formatRendererDiagnostic(diagnostic: RendererDiagnostic): string {
  const location = locationLabel(diagnostic);
  const head = `[${diagnostic.severity}] ${diagnostic.code}`;
  const parts = [head, diagnostic.message];
  if (location) parts.push(location);
  if (diagnostic.snippet) parts.push(diagnostic.snippet);
  return parts.join("\n");
}

export function formatRendererDiagnostics(diagnostics: RendererDiagnostic[]): string {
  return diagnostics.map(formatRendererDiagnostic).join("\n\n");
}

export function sourceLocation(source: string, index: number): { line: number; column: number; snippet: string } {
  const before = source.slice(0, Math.max(0, index));
  const lines = before.split(/\r\n|\n|\r/);
  const line = lines.length;
  const column = lines.at(-1)!.length + 1;
  const snippet = source.split(/\r\n|\n|\r/)[line - 1] ?? "";
  return { line, column, snippet };
}

export function findPropertyLocation(source: string, propertyName: string): { line: number; column: number; snippet: string } {
  const match = new RegExp(`\\b${propertyName}\\s*:`).exec(source);
  return sourceLocation(source, match?.index ?? 0);
}
