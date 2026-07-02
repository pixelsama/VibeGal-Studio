import { useState } from "react";
import { ProjectList } from "./features/projects/ProjectList";
import { Workspace } from "./Workspace";
import type { ProjectData } from "./lib/types";

export default function App() {
  const [project, setProject] = useState<ProjectData | null>(null);

  if (!project) {
    return <ProjectList onOpen={setProject} />;
  }

  return (
    <Workspace
      project={project}
      onBack={() => setProject(null)}
      onProjectChanged={setProject}
    />
  );
}
