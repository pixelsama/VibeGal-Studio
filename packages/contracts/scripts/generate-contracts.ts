import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildAllJsonSchemas } from "../src/schemaExport.ts";
import { contractDiagnostics, contractStructuralPolicies } from "../src/diagnostics.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const contractsRoot = resolve(here, "..");
const generated = resolve(root, "packages/studio/src-tauri/generated/contracts");
const docs = resolve(root, "docs/script-graph/schemas");
const sourceFiles = [
  "src/schema.ts",
  "src/diagnostics.ts",
  "src/fixtures.ts",
  "src/schemaExport.ts",
  "scripts/generate-contracts.ts",
  "package.json",
];
const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
// 源文件哈希按 LF 归一化：Windows（autocrlf）检出为 CRLF，直接哈希磁盘字节会与 LF 平台不一致。
const hashTextFile = (path: string) => sha256(readFileSync(path, "utf8").replace(/\r\n/g, "\n"));
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

rmSync(generated, { recursive: true, force: true });
mkdirSync(generated, { recursive: true });
mkdirSync(docs, { recursive: true });
const artifacts: Record<string, string> = {};
for (const [name, schema] of Object.entries(buildAllJsonSchemas())) {
  const filename = `${name}.schema.json`;
  const content = json(schema);
  writeFileSync(resolve(generated, filename), content);
  writeFileSync(resolve(docs, `${name}.json`), content);
  artifacts[filename] = sha256(content);
}
const diagnostics = json({
  formatVersion: 1,
  diagnostics: contractDiagnostics,
  structuralPolicies: contractStructuralPolicies,
});
writeFileSync(resolve(generated, "diagnostics.json"), diagnostics);
artifacts["diagnostics.json"] = sha256(diagnostics);
const sources = Object.fromEntries(sourceFiles.map((file) => [
  file,
  hashTextFile(resolve(contractsRoot, file)),
]));
const packageJson = JSON.parse(readFileSync(resolve(contractsRoot, "package.json"), "utf8")) as {
  dependencies: { zod: string };
};
const manifest = json({
  formatVersion: 1,
  generatorVersion: 1,
  zodVersion: packageJson.dependencies.zod,
  sourceSha256: sources,
  artifactSha256: artifacts,
});
writeFileSync(resolve(generated, "contract-manifest.json"), manifest);
