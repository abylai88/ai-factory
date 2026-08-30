import { Navigate, Route, Routes } from "react-router-dom";
import {
  AgentsPage,
  Dashboard,
  DiagnosticsPage,
  EventsPage,
  PipelinePage,
  PipelinesPage,
  ProjectPage,
  ProjectsPage,
  TaskPage,
  VisualQaPage
} from "./pages.js";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/dashboard" element={<Dashboard />} />
      <Route path="/projects" element={<ProjectsPage />} />
      <Route path="/projects/:id" element={<ProjectPage />} />
      <Route path="/projects/:id/tasks/:taskId" element={<TaskPage />} />
      <Route path="/pipelines" element={<PipelinesPage />} />
      <Route path="/pipelines/:id" element={<PipelinePage />} />
      <Route path="/agents" element={<AgentsPage />} />
      <Route path="/events" element={<EventsPage />} />
      <Route path="/diagnostics" element={<DiagnosticsPage />} />
      <Route path="/visual-qa" element={<VisualQaPage />} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
