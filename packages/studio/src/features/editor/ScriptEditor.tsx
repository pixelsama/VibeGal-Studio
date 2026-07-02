/**
 * 剧情编辑器（地基版）—— 章节列表 + JSON 文本框 + 保存。
 *
 * 不做 Monaco/CodeMirror 和指令级可视化，只做带保存的 JSON 编辑。
 * 保存时调 Tauri 写盘，并通过 onChange 通知预览刷新。
 */
import { useEffect, useState } from "react";
import { saveFile } from "../../lib/tauri";
import type { ProjectData } from "../../lib/types";

interface Props {
  project: ProjectData;
  /** 保存后通知上层刷新预览 */
  onSaved: () => void;
}

export function ScriptEditor({ project, onSaved }: Props) {
  const chapters = project.content.chapters;
  const [selectedRel, setSelectedRel] = useState<string | null>(chapters[0]?.relPath ?? null);
  const [text, setText] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string>("");

  // 选中的章节数据
  const selected = chapters.find((c) => c.relPath === selectedRel) ?? null;

  useEffect(() => {
    if (selected) {
      setText(JSON.stringify(selected.data, null, 2));
      setDirty(false);
      setStatus("");
    }
  }, [selectedRel, project]);

  const handleSave = async () => {
    if (!selectedRel) return;
    setSaving(true);
    setStatus("");
    try {
      // 先校验 JSON 合法性
      const parsed = JSON.parse(text);
      await saveFile(project.path, selectedRel, JSON.stringify(parsed, null, 2));
      setDirty(false);
      setStatus("已保存 ✓");
      onSaved();
    } catch (e) {
      setStatus(`保存失败: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: "flex", width: "100%", height: "100%", background: "#0e1116" }}>
      {/* 章节列表 */}
      <div style={{ width: 220, borderRight: "1px solid #232a38", overflowY: "auto" }}>
        <div style={{ padding: "12px 16px", fontSize: 12, color: "#6a7280", borderBottom: "1px solid #232a38" }}>
          章节（{chapters.length}）
        </div>
        {chapters.length === 0 && (
          <div style={{ padding: 16, fontSize: 13, color: "#6a7280" }}>暂无章节</div>
        )}
        {chapters.map((c) => (
          <div
            key={c.relPath}
            onClick={() => setSelectedRel(c.relPath)}
            style={{
              padding: "10px 16px",
              fontSize: 13,
              cursor: "pointer",
              background: c.relPath === selectedRel ? "#1e2632" : "transparent",
              color: c.relPath === selectedRel ? "#9fc8e3" : "#a0a8b4",
              borderBottom: "1px solid #161b24",
            }}
          >
            {c.relPath.split("/").pop()}
          </div>
        ))}
      </div>

      {/* 编辑区 */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 16px", borderBottom: "1px solid #232a38" }}>
          <span style={{ fontSize: 13, color: "#a0a8b4" }}>{selectedRel ?? "未选择"}</span>
          <div style={{ flex: 1 }} />
          {dirty && <span style={{ fontSize: 12, color: "#c9a96a" }}>未保存</span>}
          {status && <span style={{ fontSize: 12, color: status.includes("失败") ? "#e0a0a0" : "#7ab38a" }}>{status}</span>}
          <button onClick={handleSave} disabled={!selectedRel || saving} style={saveBtnStyle}>
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
        <textarea
          value={text}
          onChange={(e) => { setText(e.target.value); setDirty(true); setStatus(""); }}
          spellCheck={false}
          style={{
            flex: 1, width: "100%", resize: "none", border: "none", outline: "none",
            padding: 16, background: "#0e1116", color: "#d4dae2",
            fontFamily: "ui-monospace, 'SF Mono', monospace", fontSize: 13, lineHeight: 1.6,
          }}
        />
      </div>
    </div>
  );
}

const saveBtnStyle: React.CSSProperties = {
  padding: "6px 16px", background: "#3a6ea5", border: "1px solid #3a6ea5",
  borderRadius: 6, color: "#fff", cursor: "pointer", fontSize: 13,
};
