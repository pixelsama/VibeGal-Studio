import { renderToStaticMarkup } from "react-dom/server";
import { Children, isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { AppearanceSection, CommandLineToolSection, Settings } from "./Settings";
import type { AppSettings } from "../../lib/theme";
import type { CliToolStatus } from "../../lib/tauri";

const noop = () => {};

describe("Settings", () => {
  it("显示主题选项，并标注当前选中项", () => {
    const html = renderToStaticMarkup(
      <Settings
        settings={{ theme: "dark" } as AppSettings}
        onUpdate={noop}
        onBack={noop}
        canGoBack
      />,
    );
    expect(html).toContain("外观");
    expect(html).toContain("跟随系统");
    expect(html).toContain("深色");
    expect(html).toContain("浅色");
    // 深色卡片应标记为当前选中
    expect(html).toContain("当前");
  });

  it("浅色主题下，浅色卡片被选中", () => {
    const html = renderToStaticMarkup(
      <Settings
        settings={{ theme: "light" } as AppSettings}
        onUpdate={noop}
        onBack={noop}
        canGoBack
      />,
    );
    // 两个卡片都渲染，浅色那个应带 aria-pressed
    expect(html).toContain("浅色");
    expect(html).toContain('aria-pressed="true"');
  });

  it("点击主题卡片调用 onUpdate", () => {
    const onUpdate = vi.fn();
    const tree = resolveFunctionComponents(
      <AppearanceSection
        settings={{ theme: "dark" } as AppSettings}
        onUpdate={onUpdate}
      />,
    );
    const lightButton = findButtonByText(tree, "浅色");

    expect(lightButton).not.toBeNull();
    lightButton?.props.onClick?.();
    expect(onUpdate).toHaveBeenCalledWith({ theme: "light" });
  });

  it("点击跟随系统卡片会保存原始 system 值", () => {
    const onUpdate = vi.fn();
    const tree = resolveFunctionComponents(
      <AppearanceSection
        settings={{ theme: "dark" } as AppSettings}
        onUpdate={onUpdate}
      />,
    );
    const systemButton = findButtonByText(tree, "跟随系统");

    expect(systemButton).not.toBeNull();
    systemButton?.props.onClick?.();
    expect(onUpdate).toHaveBeenCalledWith({ theme: "system" });
  });

  it("canGoBack 为 false 时返回按钮禁用", () => {
    const html = renderToStaticMarkup(
      <Settings
        settings={{ theme: "dark" } as AppSettings}
        onUpdate={noop}
        onBack={noop}
        canGoBack={false}
      />,
    );
    expect(html).toContain("disabled");
  });

  it("显示命令行工具安装状态与操作", () => {
    const status: CliToolStatus = {
      command: "vibegal-cli",
      cliPath: "/Applications/VibeGal-Studio.app/Contents/MacOS/vibegal-cli",
      linkPath: "/Users/me/.local/bin/vibegal-cli",
      installed: false,
      cliAvailable: true,
      linkOccupied: false,
      inPath: true,
      issue: null,
    };

    const html = renderToStaticMarkup(
      <CommandLineToolSection
        status={status}
        busy={false}
        error={null}
        message={null}
        onRefresh={noop}
        onInstall={noop}
        onUninstall={noop}
      />,
    );

    expect(html).toContain("命令行工具");
    expect(html).toContain("vibegal-cli");
    expect(html).toContain("未安装命令链接");
    expect(html).toContain("安装 vibegal-cli");
    expect(html).toContain("重新检查");
  });

  it("点击命令行工具按钮调用对应动作", () => {
    const onInstall = vi.fn();
    const onUninstall = vi.fn();
    const onRefresh = vi.fn();
    const status: CliToolStatus = {
      command: "vibegal-cli",
      cliPath: "/Applications/VibeGal-Studio.app/Contents/MacOS/vibegal-cli",
      linkPath: "/Users/me/.local/bin/vibegal-cli",
      installed: true,
      cliAvailable: true,
      linkOccupied: false,
      inPath: true,
      issue: null,
    };

    const tree = resolveFunctionComponents(
      <CommandLineToolSection
        status={status}
        busy={false}
        error={null}
        message={null}
        onRefresh={onRefresh}
        onInstall={onInstall}
        onUninstall={onUninstall}
      />,
    );

    findButtonByText(tree, "重新检查")?.props.onClick?.();
    findButtonByText(tree, "卸载")?.props.onClick?.();

    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(onUninstall).toHaveBeenCalledTimes(1);
    expect(findButtonByText(tree, "已安装")?.props.disabled).toBe(true);
    expect(onInstall).not.toHaveBeenCalled();
  });

  it("已安装但 App PATH 未包含命令目录时不显示错误，并让安装按钮视觉禁用", () => {
    const status: CliToolStatus = {
      command: "vibegal-cli",
      cliPath: "/Applications/VibeGal-Studio.app/Contents/MacOS/vibegal-cli",
      linkPath: "/Users/me/.local/bin/vibegal-cli",
      installed: true,
      cliAvailable: true,
      linkOccupied: false,
      inPath: false,
      issue: null,
    };

    const html = renderToStaticMarkup(
      <CommandLineToolSection
        status={status}
        busy={false}
        error={null}
        message={null}
        onRefresh={noop}
        onInstall={noop}
        onUninstall={noop}
      />,
    );
    expect(html).toContain("已安装到 /Users/me/.local/bin/vibegal-cli");
    expect(html).not.toContain("不在 PATH");

    const tree = resolveFunctionComponents(
      <CommandLineToolSection
        status={status}
        busy={false}
        error={null}
        message={null}
        onRefresh={noop}
        onInstall={noop}
        onUninstall={noop}
      />,
    );
    const installButton = findButtonByText(tree, "已安装");
    expect(installButton?.props.disabled).toBe(true);
    // 禁用态视觉由共享 Button 的 .gs-btn:disabled 规则承担（opacity/cursor 在 CSS 里）
    expect(installButton?.props.className).toContain("gs-btn");
  });
});

function resolveFunctionComponents(node: ReactNode): ReactNode {
  if (Array.isArray(node)) return node.map(resolveFunctionComponents);
  if (!isValidElement(node)) return node;

  if (typeof node.type === "function") {
    const Component = node.type as (props: unknown) => ReactNode;
    return resolveFunctionComponents(Component(node.props));
  }

  const props = node.props as { children?: ReactNode };
  return {
    ...node,
    props: {
      ...props,
      children: Children.toArray(props.children).map(resolveFunctionComponents),
    },
  };
}

function findButtonByText(node: ReactNode, text: string): { props: { onClick?: () => void; disabled?: boolean; style?: React.CSSProperties; className?: string } } | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findButtonByText(child, text);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement(node)) return null;

  const props = node.props as { children?: ReactNode; onClick?: () => void };
  if (node.type === "button" && textContent(props.children).includes(text)) {
    return { props };
  }

  return findButtonByText(props.children, text);
}

function textContent(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textContent).join("");
  if (!isValidElement(node)) return "";
  const props = node.props as { children?: ReactNode };
  return textContent(props.children);
}
