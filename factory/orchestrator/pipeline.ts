export interface PipelineStep {
  id: string;
  title: string;
  role: string;
  description: string;
  dependsOn?: string[];
}

export interface Pipeline {
  name: string;
  goal: string;
  steps: PipelineStep[];
}

export function createEngineeringPipeline(goal: string): Pipeline {
  return {
    name: "Engineering Pipeline",
    goal,
    steps: [
      {
        id: "research",
        title: "Analyze project",
        role: "engineering",
        description:
          "Изучи проект, архитектуру, зависимости и найди наиболее важные технические проблемы.",
      },
      {
        id: "architecture",
        title: "Architecture plan",
        role: "architect",
        description:
          "На основе анализа подготовь технический план улучшений. Код пока не изменяй.",
        dependsOn: ["research"],
      },
      {
        id: "implementation",
        title: "Implement improvements",
        role: "programmer",
        description:
          "Реализуй утверждённые технические улучшения и не меняй части проекта, не относящиеся к задаче.",
        dependsOn: ["architecture"],
      },
      {
        id: "test",
        title: "Test project",
        role: "tester",
        description:
          "Проверь изменения, запусти доступные проверки и production build.",
        dependsOn: ["implementation"],
      },
      {
        id: "review",
        title: "Review changes",
        role: "reviewer",
        description:
          "Проверь качество реализации, регрессии и соответствие исходной задаче.",
        dependsOn: ["test"],
      },
    ],
  };
}
