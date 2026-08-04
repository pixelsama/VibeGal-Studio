import assert from "node:assert/strict";
import path from "node:path";

import {
  CORE_AUTHORING_NEW_NODE_ID,
  CORE_AUTHORING_NODE_TITLE,
  CORE_AUTHORING_TEXT,
  assertCoreAuthoringGraph,
  assertCoreAuthoringNode,
  authorNodeInstructions,
  createSuccessorFromGraphNode,
  disableMotion,
  openNodeEditor,
  openPreviewWorkspace,
  openProjectFromRecent,
  openScriptWorkspace,
  projectPaths,
  readCoreAuthoringNode,
  readProjectGraph,
  renameSelectedNode,
  requiredEnv,
  verifyPreviewBranch,
  waitForProjectFiles,
  waitForBodyText,
} from "../scenarios/core-authoring.helpers.mjs";

const projectPath = requiredEnv("VIBEGAL_AGENT_QA_PROJECT");
const projectName = requiredEnv("VIBEGAL_AGENT_QA_PROJECT_NAME");
const initialTitle = requiredEnv("VIBEGAL_AGENT_QA_INITIAL_TITLE");
const phase = requiredEnv("VIBEGAL_AGENT_QA_PHASE");
const artifacts = requiredEnv("VIBEGAL_AGENT_QA_ARTIFACTS");
const screenshots = path.join(artifacts, "desktop/screenshots");

assert.ok(["authoring", "reopen"].includes(phase), `unsupported core-authoring phase: ${phase}`);

describe(`Core authoring desktop chain (${phase})`, () => {
  it(phase === "authoring"
    ? "creates a graph successor, authors Instruction[], persists it, and takes its branch"
    : "reopens the persisted graph and node, then takes the persisted branch", async () => {
    await openProjectFromRecent({ projectPath, projectName, initialTitle });
    await disableMotion();

    if (phase === "authoring") {
      await openScriptWorkspace();
      await createSuccessorFromGraphNode();
      await renameSelectedNode();
      // The graph UI reflects the optimistic state before the create-node
      // mutation and its watcher refresh have both settled. Wait for the
      // actual node file and graph edge before mounting the editor; otherwise
      // the create event can arrive while the editor is being authored and be
      // mistaken for a conflicting external update.
      await waitForProjectFiles(projectPath, ({ graph, node }) => {
        assertCoreAuthoringGraph(graph);
        return Array.isArray(node);
      });

      const textarea = await openNodeEditor(CORE_AUTHORING_NODE_TITLE);
      await authorNodeInstructions(textarea, projectPath);

      await waitForProjectFiles(projectPath, ({ graph, node }) => {
        const { edge } = assertCoreAuthoringGraph(graph);
        assert.equal(edge.to, CORE_AUTHORING_NEW_NODE_ID);
        assertCoreAuthoringNode(node);
        return graph.nodes.some((candidate) => candidate.title === CORE_AUTHORING_NODE_TITLE)
          && node.some((instruction) => instruction.text === CORE_AUTHORING_TEXT);
      });
      assertCoreAuthoringGraph(await readProjectGraph(projectPath));
      assertCoreAuthoringNode(await readCoreAuthoringNode(projectPath));

      await browser.saveScreenshot(path.join(screenshots, "01-core-authoring-authored.png"));
      await openPreviewWorkspace();
      await verifyPreviewBranch();
      await browser.saveScreenshot(path.join(screenshots, "02-core-authoring-branch.png"));
      return;
    }

    const graph = await readProjectGraph(projectPath);
    assertCoreAuthoringGraph(graph);
    assertCoreAuthoringNode(await readCoreAuthoringNode(projectPath));

    await openScriptWorkspace();
    const textarea = await openNodeEditor(CORE_AUTHORING_NODE_TITLE);
    await browser.waitUntil(async () => (await textarea.getValue()).includes(CORE_AUTHORING_TEXT), {
      timeout: 15_000,
      timeoutMsg: `reopened node editor did not contain ${JSON.stringify(CORE_AUTHORING_TEXT)}`,
    });
    await waitForBodyText(CORE_AUTHORING_NODE_TITLE);
    await browser.saveScreenshot(path.join(screenshots, "03-core-authoring-reopened.png"));

    await openPreviewWorkspace();
    await verifyPreviewBranch();
    await browser.saveScreenshot(path.join(screenshots, "04-core-authoring-reopened-branch.png"));

    const finalGraph = await readProjectGraph(projectPath);
    const finalNode = await readCoreAuthoringNode(projectPath);
    assertCoreAuthoringGraph(finalGraph);
    assertCoreAuthoringNode(finalNode);
    assert.equal(finalGraph.nodes.find((node) => node.id === CORE_AUTHORING_NEW_NODE_ID)?.title, CORE_AUTHORING_NODE_TITLE);
    assert.equal(finalNode.find((instruction) => instruction.text === CORE_AUTHORING_TEXT)?.text, CORE_AUTHORING_TEXT);
    assert.equal(path.basename(projectPaths(projectPath).node), `${CORE_AUTHORING_NEW_NODE_ID}.json`);
  });
});
