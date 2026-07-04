import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import App from "./App";

vi.mock("./lib/theme", () => ({
  useAppSettings: () => ({
    settings: { theme: "dark" },
    loading: true,
    updateSettings: vi.fn(),
  }),
}));

vi.mock("./features/projects/ProjectList", () => ({
  ProjectList: () => <main>Project List</main>,
}));

vi.mock("./features/settings/Settings", () => ({
  Settings: () => <main>Settings</main>,
}));

vi.mock("./Workspace", () => ({
  Workspace: () => <main>Workspace</main>,
}));

describe("App settings bootstrap", () => {
  it("does not render main screens until app settings are loaded", () => {
    const html = renderToStaticMarkup(<App />);

    expect(html).toContain("正在加载设置");
    expect(html).not.toContain("Project List");
    expect(html).not.toContain("Settings");
    expect(html).not.toContain("Workspace");
  });
});
