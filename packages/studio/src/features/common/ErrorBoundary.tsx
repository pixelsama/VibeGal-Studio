import { Component, type CSSProperties, type ErrorInfo, type ReactNode } from "react";

export interface ErrorBoundaryProps {
  children?: ReactNode;
  /** 降级面板标题，便于定位是哪个区域出错 */
  title?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * 渲染期异常兜底：子树渲染抛错时，不再让 React 卸载整棵组件树（白屏），
 * 而是降级为错误面板并保留「重新加载」出口。
 * 注意：事件处理器里的异常不由 ErrorBoundary 捕获，也不会导致卸载。
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("界面渲染异常:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" style={containerStyle}>
        <div style={titleStyle}>{this.props.title ?? "界面渲染出错"}</div>
        <p style={messageStyle}>{error.message || String(error)}</p>
        <button type="button" style={buttonStyle} onClick={() => window.location.reload()}>
          重新加载
        </button>
      </div>
    );
  }
}

const containerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: "var(--space-4)",
  width: "100%",
  height: "100%",
  padding: "var(--space-6)",
  background: "var(--bg-app)",
  color: "var(--text-primary)",
};

const titleStyle: CSSProperties = {
  fontSize: "var(--text-lg)",
  fontWeight: 600,
  color: "var(--text-bright)",
};

const messageStyle: CSSProperties = {
  maxWidth: 480,
  fontSize: "var(--text-sm)",
  color: "var(--text-muted)",
  wordBreak: "break-word",
  textAlign: "center",
};

const buttonStyle: CSSProperties = {
  padding: "var(--space-2) var(--space-4)",
  borderRadius: "var(--radius-md)",
  border: "1px solid var(--border)",
  background: "var(--bg-panel)",
  color: "var(--text-primary)",
  cursor: "pointer",
};
