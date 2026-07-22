# 23. Script Graph Chapters

## Goal

Introduce chapters as an authoring-only organization layer inside `content/graph.json` so large
story graphs can be edited one chapter at a time without creating a second script source of truth.

This feature does not restore legacy `content/meta.json` `chapters` or `content/chapters/` files.
Runtime traversal continues to use the complete graph and node files exactly as before.

## Data Contract

```json
{
  "chapters": [
    { "id": "chapter_1", "title": "第一章" }
  ],
  "nodes": [
    { "id": "start", "chapterId": "chapter_1" }
  ]
}
```

- `chapters` is an ordered, optional graph-level list and defaults to an empty list.
- `nodes[].chapterId` is optional. A missing value means the node is unassigned.
- Chapter ids must be unique. A node chapter id must reference a declared chapter.
- Old graphs without chapter metadata remain valid and open in the all-nodes view.

## Authoring Behavior

- The story-structure sidebar lists all chapters in graph order, plus all-nodes and unassigned views.
- Selecting a chapter limits the canvas to its nodes and edges whose two endpoints are visible.
- The complete graph remains available for validation, analysis, persistence, and runtime playback.
- Authors can create, rename, reorder, and delete chapters.
- Deleting a chapter keeps its nodes and removes only their `chapterId` assignment.
- Authors can move a selected node between chapters from the node inspector.
- Nodes created in a chapter are assigned to it. Duplicates and successors inherit their source chapter.

## Requirement-to-Test Matrix

| Requirement | Executable verification |
| --- | --- |
| Old graph compatibility and schema defaults | `packages/contracts/src/validation.test.ts` default-projection corpus |
| Chapter metadata survives backend loading | `packages/studio/src-tauri/src/backend/tests/project_loading.rs` |
| Invalid chapter ids/references surface as graph issues | `packages/studio/src-tauri/src/backend/tests/graph_validation.rs` |
| Chapter CRUD does not delete nodes | `packages/studio/src/features/script/chapterEditing.test.ts` |
| New, duplicate, and successor nodes inherit chapter context | `packages/studio/src/features/script/graphEditing.test.ts` |
| Chapter canvas filtering hides cross-scope edges only in the view | `packages/studio/src/features/script/chapterEditing.test.ts` |
| Story-structure sidebar exposes chapter and unassigned navigation | `packages/studio/src/features/script/StoryOutline.test.tsx` |
| Node inspector supports chapter assignment | `packages/studio/src/features/script/NodeInspector.test.tsx` |
