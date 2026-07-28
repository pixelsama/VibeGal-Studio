import { useEffect, useState } from "react";
import type { FileRevision } from "../../lib/types";
import { readAssetThumbnailDataUrl } from "../../lib/tauri";
import { useStudioI18n } from "../../lib/i18n";

interface AssetImagePreviewProps {
  projectPath: string;
  relPath: string;
  revision?: FileRevision;
  generation?: number;
  alt: string;
  style: React.CSSProperties;
  placeholderStyle: React.CSSProperties;
}

const MAX_THUMBNAIL_CACHE_ENTRIES = 200;
const thumbnailCache = new Map<string, Promise<string>>();

export function clearAssetThumbnailCache(projectPath?: string) {
  if (!projectPath) {
    thumbnailCache.clear();
    return;
  }
  const prefix = `${projectPath}\x00`;
  for (const key of thumbnailCache.keys()) {
    if (key.startsWith(prefix)) thumbnailCache.delete(key);
  }
}

export function assetThumbnailCacheKey(
  projectPath: string,
  relPath: string,
  revision: FileRevision | undefined,
  maxSize: number,
  generation = 0,
): string {
  return [
    projectPath,
    relPath,
    revision?.sha256 ?? `${revision?.mtimeMs ?? "missing"}:${revision?.size ?? 0}`,
    maxSize,
    generation,
  ].join("\x00");
}

function loadThumbnail(key: string, projectPath: string, relPath: string, maxSize: number) {
  const cached = thumbnailCache.get(key);
  if (cached) return cached;
  const request = readAssetThumbnailDataUrl(projectPath, relPath, maxSize).catch((error) => {
    thumbnailCache.delete(key);
    throw error;
  });
  thumbnailCache.set(key, request);
  if (thumbnailCache.size > MAX_THUMBNAIL_CACHE_ENTRIES) {
    thumbnailCache.delete(thumbnailCache.keys().next().value as string);
  }
  return request;
}

type PreviewState =
  | { status: "loading" }
  | { status: "loaded"; dataUrl: string }
  | { status: "failed"; message: string };

export function AssetImagePreview({
  projectPath,
  relPath,
  revision,
  generation = 0,
  alt,
  style,
  placeholderStyle,
}: AssetImagePreviewProps) {
  const { t } = useStudioI18n();
  const [preview, setPreview] = useState<PreviewState>({ status: "loading" });
  const maxSize = 384;
  const cacheKey = assetThumbnailCacheKey(projectPath, relPath, revision, maxSize, generation);

  useEffect(() => {
    let alive = true;
    setPreview({ status: "loading" });
    loadThumbnail(cacheKey, projectPath, relPath, maxSize)
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
  }, [cacheKey, projectPath, relPath]);

  if (preview.status === "loaded") {
    return <img src={preview.dataUrl} alt={alt} style={style} draggable={false} />;
  }

  const text = preview.status === "failed"
    ? t("assets.preview.unavailable")
    : t("assets.preview.loading");
  const title = preview.status === "failed" ? preview.message : relPath;
  return <span style={placeholderStyle} title={title}>{text}</span>;
}
