/**
 * 资产页文件拖放监听（Tauri 原生拖放事件）。
 *
 * Tauri 窗口默认拦截系统文件拖放（tauri.conf.json 未关闭 dragDropEnabled），
 * HTML5 drop 事件不会触发；正确入口是 webview 的 onDragDropEvent，
 * 它能直接给出文件的绝对路径，正好对接 importAsset。
 *
 * 非 Tauri 环境（纯浏览器 dev / vitest）下订阅会失败，静默降级为不可用。
 */
import { useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";

/**
 * @param enabled 只读 / 角色编辑页等场景传 false，此时不订阅且不高亮。
 * @param onDropPaths drop 发生时收到拖入文件的绝对路径列表。
 * @returns dragging 是否有文件正悬停在窗口上（用于渲染高亮遮罩）。
 */
export function useAssetFileDrop(enabled: boolean, onDropPaths: (paths: string[]) => void): boolean {
  const [dragging, setDragging] = useState(false);
  // ref 存最新回调，避免回调引用变化导致反复退订/重订
  const onDropRef = useRef(onDropPaths);
  onDropRef.current = onDropPaths;

  useEffect(() => {
    if (!enabled) {
      setDragging(false);
      return;
    }
    let disposed = false;
    let unlisten: (() => void) | null = null;

    const setup = async () => {
      try {
        const stop = await getCurrentWebview().onDragDropEvent((event) => {
          const payload = event.payload;
          if (payload.type === "enter" || payload.type === "over") {
            setDragging(true);
          } else if (payload.type === "drop") {
            setDragging(false);
            if (payload.paths.length > 0) onDropRef.current(payload.paths);
          } else {
            // leave / cancel
            setDragging(false);
          }
        });
        if (disposed) {
          stop();
          return;
        }
        unlisten = stop;
      } catch (error) {
        console.warn("文件拖放监听初始化失败:", error);
      }
    };

    void setup();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [enabled]);

  return dragging;
}
