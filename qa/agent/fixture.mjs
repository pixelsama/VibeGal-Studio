import { cp, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const AGENT_QA_PROJECT_NAME = "VibeGal Agent QA";
export const AGENT_QA_INITIAL_TITLE = "Agent QA Original Title";

export async function prepareAgentQaFixture({ root, temporary }) {
  const source = path.join(root, "examples", "sample-novel");
  const projectPath = path.join(temporary, "Project With Spaces");
  await cp(source, projectPath, { recursive: true, errorOnExist: true });

  const projectFile = path.join(projectPath, "gal.project.json");
  const project = JSON.parse(await readFile(projectFile, "utf8"));
  project.name = AGENT_QA_PROJECT_NAME;
  await writeFile(projectFile, `${JSON.stringify(project, null, 2)}\n`, "utf8");

  const metaFile = path.join(projectPath, "content", "meta.json");
  const meta = JSON.parse(await readFile(metaFile, "utf8"));
  meta.title = AGENT_QA_INITIAL_TITLE;
  await writeFile(metaFile, `${JSON.stringify(meta, null, 2)}\n`, "utf8");

  return {
    projectPath,
    projectName: AGENT_QA_PROJECT_NAME,
    initialTitle: AGENT_QA_INITIAL_TITLE,
  };
}
