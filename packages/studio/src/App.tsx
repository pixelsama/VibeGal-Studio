import { useCallback, useMemo, useState } from "react";
import { ProjectList } from "./features/projects/ProjectList";
import { Workspace } from "./Workspace";
import type { ProjectData } from "./lib/types";
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
  const location = currentLocation(navigation);
  const backEnabled = canGoBack(navigation);
  const forwardEnabled = canGoForward(navigation);

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

  const showProjectList = !project || location.type === "project-list";

  const projectListForwardEnabled = useMemo(
    () => Boolean(project) && forwardEnabled,
    [forwardEnabled, project],
  );

  if (showProjectList) {
    return (
      <ProjectList
        onOpen={handleOpenProject}
        canGoForward={projectListForwardEnabled}
        onForward={projectListForwardEnabled ? handleForward : undefined}
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
    />
  );
}
