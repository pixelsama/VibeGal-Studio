import { useCallback, useState } from "react";
import { ProjectList } from "./features/projects/ProjectList";
import { Settings } from "./features/settings/Settings";
import { Workspace } from "./Workspace";
import type { ProjectData } from "./lib/types";
import { useAppSettings } from "./lib/theme";
import { t } from "./lib/i18n";
import {
  canGoBack,
  canGoForward,
  createNavigationState,
  currentLocation,
  goBack,
  goForward,
  pushLocation,
  replaceLocation,
  type NavigationLocation,
} from "./lib/navigation";

export default function App() {
  const [project, setProject] = useState<ProjectData | null>(null);
  const [navigation, setNavigation] = useState(createNavigationState);
  const { settings, loading, updateSettings } = useAppSettings();
  const location = currentLocation(navigation);
  const backEnabled = canGoBack(navigation);
  const forwardEnabled = canGoForward(navigation);
  const projectListForwardEnabled = Boolean(project) && forwardEnabled;

  const navigate = useCallback((next: NavigationLocation) => {
    setNavigation((state) => pushLocation(state, next));
  }, []);

  const replaceNavigation = useCallback((next: NavigationLocation) => {
    setNavigation((state) => replaceLocation(state, next));
  }, []);

  const handleOpenProject = useCallback((nextProject: ProjectData) => {
    setProject(nextProject);
    setNavigation((state) => pushLocation(state, { type: "workspace", workspace: "render" }));
  }, []);

  const handleProjectChanged = useCallback((nextProject: ProjectData) => {
    setProject(nextProject);
  }, []);

  const handleBack = useCallback(() => {
    setNavigation((state) => goBack(state));
  }, []);

  const handleForward = useCallback(() => {
    setNavigation((state) => goForward(state));
  }, []);

  const openSettings = useCallback(() => {
    navigate(project ? { type: "workspace", workspace: "settings" } : { type: "settings" });
  }, [navigate, project]);

  if (loading) {
    return <div role="status" aria-label={t("app.loadingSettings")} style={bootstrapStyle} />;
  }

  // 设置页：独立全屏，可从项目列表或工作台进入
  if (location.type === "settings") {
    return (
      <Settings
        settings={settings}
        onUpdate={updateSettings}
        onBack={handleBack}
        canGoBack={backEnabled}
        presentation="standalone"
      />
    );
  }

  const showProjectList = !project || location.type === "project-list";

  if (showProjectList) {
    return (
      <ProjectList
        onOpen={handleOpenProject}
        canGoForward={projectListForwardEnabled}
        onForward={projectListForwardEnabled ? handleForward : undefined}
        onOpenSettings={openSettings}
      />
    );
  }

  return (
    <Workspace
      project={project}
      location={location}
      canGoBack={backEnabled}
      canGoForward={forwardEnabled}
      onBack={handleBack}
      onForward={handleForward}
      onNavigate={navigate}
      onReplaceLocation={replaceNavigation}
      onProjectChanged={handleProjectChanged}
      settings={settings}
      onUpdateSettings={updateSettings}
    />
  );
}

const bootstrapStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  background: "var(--bg-app)",
};
