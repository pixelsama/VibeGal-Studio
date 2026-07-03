import { useEffect, useState } from "react";
import { readAssetPreviewDataUrl } from "../../lib/tauri";

interface AssetImagePreviewProps {
  projectPath: string;
  relPath: string;
  alt: string;
  style: React.CSSProperties;
  placeholderStyle: React.CSSProperties;
}

type PreviewState =
  | { status: "loading" }
  | { status: "loaded"; dataUrl: string }
  | { status: "failed"; message: string };

export function AssetImagePreview({
  projectPath,
  relPath,
  alt,
  style,
  placeholderStyle,
}: AssetImagePreviewProps) {
  const [preview, setPreview] = useState<PreviewState>({ status: "loading" });

  useEffect(() => {
    let alive = true;
    setPreview({ status: "loading" });
    readAssetPreviewDataUrl(projectPath, relPath)
      .then((dataUrl) => {
        if (alive) setPreview({ status: "loaded", dataUrl });
      })
      .catch((error) => {
        if (!alive) return;
        setPreview({
          status: "failed",
          message: error instanceof Error ? error.message : String(error),
        });
      });
    return () => {
      alive = false;
    };
  }, [projectPath, relPath]);

  if (preview.status === "loaded") {
    return <img src={preview.dataUrl} alt={alt} style={style} draggable={false} />;
  }

  const text = preview.status === "failed" ? "预览不可用" : "加载中";
  const title = preview.status === "failed" ? preview.message : relPath;
  return <span style={placeholderStyle} title={title}>{text}</span>;
}
