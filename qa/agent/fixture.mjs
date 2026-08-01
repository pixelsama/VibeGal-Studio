import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const AGENT_QA_PROJECT_NAME = "VibeGal Agent QA";
export const AGENT_QA_INITIAL_TITLE = "Agent QA Original Title";

export const AGENT_QA_FIXTURE_PROFILES = Object.freeze({
  "sample-novel": Object.freeze({
    sourceRelativePath: path.join("examples", "sample-novel"),
    projectExists: true,
  }),
  "empty-parent": Object.freeze({
    sourceRelativePath: null,
    projectExists: false,
  }),
});

export async function prepareAgentQaFixture({
  root,
  temporary,
  scenarioId = "desktop-authoring-loop",
  fixtureProfile = "sample-novel",
}) {
  const profile = AGENT_QA_FIXTURE_PROFILES[fixtureProfile];
  if (!profile) throw new Error(`Unknown Agent QA fixture profile: ${fixtureProfile}`);

  const projectPath = path.join(temporary, "Project With Spaces");
  if (profile.projectExists) {
    const source = path.join(root, profile.sourceRelativePath);
    await cp(source, projectPath, { recursive: true, errorOnExist: true });
  } else {
    await mkdir(temporary, { recursive: true });
    await writeFile(path.join(temporary, "existing-user-file.txt"), "must remain unchanged\n", "utf8");
  }

  if (profile.projectExists) {
    const projectFile = path.join(projectPath, "gal.project.json");
    const project = JSON.parse(await readFile(projectFile, "utf8"));
    project.name = AGENT_QA_PROJECT_NAME;
    await writeFile(projectFile, `${JSON.stringify(project, null, 2)}\n`, "utf8");

    const metaFile = path.join(projectPath, "content", "meta.json");
    const meta = JSON.parse(await readFile(metaFile, "utf8"));
    meta.title = AGENT_QA_INITIAL_TITLE;
    await writeFile(metaFile, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  }

  return {
    scenarioId,
    fixtureProfile,
    temporaryPath: temporary,
    projectParentPath: temporary,
    projectPath,
    phaseProjectPath: projectPath,
    projectExists: profile.projectExists,
    artifactsKey: path.basename(temporary),
    projectName: AGENT_QA_PROJECT_NAME,
    initialTitle: AGENT_QA_INITIAL_TITLE,
  };
}
