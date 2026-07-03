# Script Graph Feature Plan

## Goal

GalStudio should evolve into a data-driven galgame editor with three primary workspaces:

- Render
- Script
- Assets

The Script workspace should use a graph-first workflow. The top level is a story flow graph; each graph node is a narrative unit. Double-clicking a node opens a local instruction-stream editor for that unit.

This preserves a clean mental model:

```text
Project
  Render: how the game is presented
  Script: how the story is structured and written
  Assets: what media/data the story can reference
```

## Product Shape

### Top-Level Navigation

Add a top workspace switcher:

```text
Render | Script | Assets
```

Initial behavior:

- `Render` shows renderer selection/status and later renderer editing tools.
- `Script` opens the graph-first script workspace.
- `Assets` manages images, audio, characters, backgrounds, and asset metadata.

The current `Preview` and `Editor` tabs should not remain the main top-level model. Preview should become a persistent panel or mode inside relevant workspaces, especially Script and Render.

### Script Workspace

Default view:

```text
Script
  Flow Graph
    Node: Prologue
    Node: First Meeting
    Node: Choice A
    Node: Ending
```

Node interaction:

- Single-click selects a node and shows node properties.
- Double-click enters the node.
- Entered node view shows an instruction-stream editor similar to the referenced gal editor screenshot.
- A breadcrumb or back button returns to the graph.

Suggested layout:

```text
Left: node/chapter outline
Center: graph canvas OR node instruction stream
Right: live preview / inspector
```

## Data Model

Introduce a graph layer above existing chapter instruction data.

Recommended structure:

```text
content/
  graph.json
  nodes/
    prologue.json
    first_meeting.json
    choice_a.json
  manifest.json
  meta.json
```

### `graph.json`

Owns narrative structure:

```json
{
  "version": 1,
  "entryNodeId": "prologue",
  "nodes": [
    {
      "id": "prologue",
      "title": "Prologue",
      "file": "nodes/prologue.json",
      "position": { "x": 120, "y": 180 }
    }
  ],
  "edges": [
    {
      "id": "prologue_to_first_meeting",
      "from": "prologue",
      "to": "first_meeting",
      "condition": null
    }
  ]
}
```

### Node Files

Each node file stores local story instructions:

```json
[
  { "t": "bg", "id": "school_gate", "trans": "fade", "ms": 800 },
  { "t": "say", "who": "hero", "text": "..." }
]
```

Node files reuse the existing engine `Instruction[]` schema (`t` discriminator, e.g. `say` uses `who`). They do not introduce a new `{ type, speaker }` format.

This makes each node a natural external editing boundary. An external Agent can safely modify one node file without rewriting the entire story.

## Compatibility

Current projects use `content/meta.json` with `chapters`.

Migration should be non-destructive:

1. If `content/graph.json` exists, use graph mode.
2. If `graph.json` is missing but `meta.chapters` exists, synthesize a linear graph in memory.
3. Offer an explicit "Convert to graph project" action later.

Do not immediately rewrite existing projects just because they were opened.

## Hot Reload

The existing watcher/debounce behavior should include the graph files:

- `content/graph.json`
- `content/nodes/*.json`
- existing `content/chapters/*.json`
- `renderers/`
- `gal.project.json`

External file updates should refresh the graph, selected node, preview, and renderer list without requiring the user to reopen the project.

## Implementation Phases

### Phase 1: Workspace Navigation

Requirement:

The app exposes three primary workspaces: Render, Script, Assets.

Tasks:

- Replace the current preview/editor tab model with top workspace state.
- Keep the existing preview and script JSON editor available inside Script as a transitional view.
- Ensure current project open/new flows still land in a useful default workspace.

Verification:

- Open a project and switch between Render, Script, and Assets.
- Existing project preview still works.

### Phase 2: Graph Data Contract

Requirement:

The backend can load graph data when present and can synthesize a linear graph from existing chapters when absent.

Tasks:

- Add TypeScript and Rust data types for graph nodes/edges.
- Extend `openProject()` response with optional graph data.
- Add tests for graph loading, missing graph fallback, and invalid node paths.
- Reuse existing path traversal protections for node files.

Verification:

- Rust tests cover valid graph, fallback graph, and path escape rejection.

### Phase 3: Script Graph View

Requirement:

Script workspace opens to a graph overview.

Tasks:

- Build a basic graph canvas.
- Render nodes with title and status.
- Support select, pan/zoom, and double-click to enter node.
- Show node properties in the inspector.

Verification:

- Existing graph files render as nodes.
- Double-clicking a node opens its instruction editor.

### Phase 4: Node Instruction Editor

Requirement:

Each narrative node can be edited as a local instruction stream.

Tasks:

- Adapt current `ScriptEditor` from chapter files to node files.
- Preserve JSON editing first; visual instruction blocks can come later.
- Saving a node updates the node file and refreshes preview.

Verification:

- Editing a node file saves to `content/nodes/<id>.json`.
- External changes to the same file refresh the editor and preview.

### Phase 5: Graph Editing

Requirement:

Users can create, move, connect, and rename story nodes.

Tasks:

- Create node.
- Rename node title.
- Move node and persist position.
- Connect nodes with edges.
- Delete node with confirmation.

Verification:

- `graph.json` persists edits.
- Reloading the project restores node positions and edges.

### Phase 6: External Data Operations

Requirement:

The graph/node structure is easy for external tools and Agents to modify safely, while GalStudio remains a data editor rather than an AI client.

Tasks:

- Document graph and node schemas.
- Add validation errors that identify exact broken node/edge references.
- Add a visible refresh/status indicator for external file changes.
- Improve external AI coding ergonomics through stable schemas, predictable persistence, and copyable issue context.
- Explicitly avoid in-app AI buttons, prompt generation, provider settings, token storage, or Agent session management.

Verification:

- Invalid graph data produces actionable errors.
- External generation of a new node file plus graph edge appears without reopening the project.
- A user can hand an external Agent the schema and issue details without first creating an in-app AI task.

## Open Design Questions

- Should a graph node map to a whole chapter, a scene, or any arbitrary narrative unit?
- Should choices live inside node instruction files, graph edges, or both?
- Should the live preview play only the selected node or the full graph from entry?
- Should Render be a full workspace or stay as a right-side panel until renderer editing becomes richer?

## Recommended Next Step

Start with Phase 1 and Phase 2 together. The UI can expose the new product shape while the backend gains the graph data contract. After that, the graph canvas can be built incrementally without blocking the rest of the editor.
