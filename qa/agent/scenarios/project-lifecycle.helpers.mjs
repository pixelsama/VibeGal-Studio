import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const LIFECYCLE_SENTINEL_RELATIVE_PATH = "user-sentinel.txt";

export const REQUIRED_INITIALIZED_PROJECT_FILES = Object.freeze([
  ".galstudio/schemas/fixture.json",
  ".galstudio/schemas/variables.json",
  ".galstudio/schemas/locale.json",
]);

export const REQUIRED_PROJECT_FILES = Object.freeze([
  "gal.project.json",
  "AGENTS.md",
  ".galstudio/README.md",
  ".galstudio/schemas/graph.json",
  ".galstudio/schemas/nodeFile.json",
  ".galstudio/schemas/manifest.json",
  ".galstudio/schemas/meta.json",
  "content/manifest.json",
  "content/meta.json",
  "content/graph.json",
  "content/variables.json",
  "renderers/default/index.tsx",
]);

export async function prepareLifecycleDirectory(projectPath) {
  await mkdir(projectPath, { recursive: true });
  const sentinelPath = path.join(projectPath, LIFECYCLE_SENTINEL_RELATIVE_PATH);
  const sentinelContent = "User-owned file; initialization must preserve this exact content.\n";
  try {
    await writeFile(sentinelPath, sentinelContent, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    assert.equal(
      await readFile(sentinelPath, "utf8"),
      sentinelContent,
      "existing lifecycle sentinel must match the expected user-owned content",
    );
  }
  return {
    path: sentinelPath,
    content: sentinelContent,
    sha256: sha256(sentinelContent),
  };
}

export async function readSentinelSnapshot(sentinel) {
  const content = await readFile(sentinel.path, "utf8");
  return { ...sentinel, content, sha256: sha256(content) };
}

export function assertSentinelUnchanged(before, after, label = "sentinel") {
  assert.equal(after.content, before.content, `${label} content was changed`);
  assert.equal(after.sha256, before.sha256, `${label} SHA-256 was changed`);
}

export async function assertRequiredProjectFiles(
  projectPath,
  { initialized = false, expectedProjectName, expectedTitle } = {},
) {
  const requiredFiles = initialized
    ? [...REQUIRED_PROJECT_FILES, ...REQUIRED_INITIALIZED_PROJECT_FILES, "content/nodes/start.json"]
    : REQUIRED_PROJECT_FILES;
  for (const relativePath of requiredFiles) {
    const absolutePath = path.join(projectPath, relativePath);
    await access(absolutePath).catch((error) => {
      throw new Error(`required project file is missing: ${relativePath} (${error.message})`);
    });
  }

  const project = await readJson(projectPath, "gal.project.json");
  if (expectedProjectName !== undefined) {
    assert.equal(project.name, expectedProjectName, "project name should match the fixture project metadata");
  }
  assert.equal(project.activeRendererId, "default", "initialized project should use the default renderer");

  const graph = await readJson(projectPath, "content/graph.json");
  assert.equal(typeof graph.entryNodeId, "string", "project graph should declare an entry node");
  assert.ok(
    Array.isArray(graph.nodes) && graph.nodes.some((node) => node.id === graph.entryNodeId),
    "project graph should contain its entry node",
  );

  const entryNode = graph.nodes.find((node) => node.id === graph.entryNodeId);
  const node = await readJson(projectPath, `content/${entryNode.file}`);
  assert.ok(Array.isArray(node), "entry node should contain an instruction array");

  const meta = await readJson(projectPath, "content/meta.json");
  if (expectedTitle !== undefined) {
    assert.equal(meta.title, expectedTitle, "work title should match the fixture project metadata");
  }

  return { project, graph, node, meta };
}

export async function readJson(projectPath, relativePath) {
  return JSON.parse(await readFile(path.join(projectPath, relativePath), "utf8"));
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
