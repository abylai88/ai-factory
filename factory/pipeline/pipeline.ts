export type PipelineType = "game" | "engineering";

export interface PipelineStep {
  id: string;
  title: string;
  role: string;
  agent: string;
  description: string;
}

export interface Pipeline {
  id: string;
  name: string;
  goal: string;
  type: PipelineType;
  steps: PipelineStep[];
}

/**
 * Full game production pipeline — runs all specialized game agents
 * from market research through release.
 *
 * Agents: market → competitor → idea → director → gameplay → designer →
 *         architect → programmer → content → monetization → tester →
 *         bugfix → retest → reviewer → build → release
 */
export function createFullGamePipeline(goal: string): Pipeline {
  return {
    id: `game-prod-${Date.now()}`,
    name: "Game Production Pipeline",
    goal,
    type: "game",

    steps: [
      {
        id: "market",
        title: "Market analysis",
        role: "research",
        agent: "market",
        description:
          "Проанализируй целевую аудиторию, размер рынка, тренды и бенчмарки монетизации для жанра这个游戏. Определи платформу и её ограничения."
      },
      {
        id: "competitor",
        title: "Competitor analysis",
        role: "research",
        agent: "competitor",
        description:
          "Исследуй прямых и косвенных конкурентов. Определи их сильные и слабые стороны, возможности для дифференциации и приоритеты фич."
      },
      {
        id: "idea",
        title: "Game concept",
        role: "game",
        agent: "idea",
        description:
          "На основе анализа рынка и конкурентов сгенерируй конкретную игровую концепцию: USP, базовый игровой цикл, целевой опыт игрока и ключевые фичи."
      },
      {
        id: "director",
        title: "Game design document",
        role: "game",
        agent: "director",
        description:
          "Разработай подробный GDD: видение, механики, системы, прогрессия, UX-поток, структура контента и приоритеты продакшена. Определи архитектуру сцен Phaser."
      },
      {
        id: "gameplay",
        title: "Gameplay mechanics design",
        role: "game",
        agent: "gameplay",
        description:
          "Детально проработай геймплейные механики: физику, тюнинг, feedback-системы, juice-эффекты, обработку ввода и кривую сложности."
      },
      {
        id: "design",
        title: "Technical design",
        role: "designer",
        agent: "designer",
        description:
          "На основе GDD и gameplay-дизайна разработай технический план: конкретные изменения в файлах, инкременты, критерии приёмки. Код не изменяй."
      },
      {
        id: "architect",
        title: "Technical architecture",
        role: "engineering",
        agent: "architect",
        description:
          "Спроектируй техническую архитектуру: модульную структуру, управление состоянием, потоки данных, конфигурацию сборки. Определи риски."
      },
      {
        id: "implementation",
        title: "Implement game",
        role: "engineering",
        agent: "programmer",
        description:
          "Реализуй игровой код на TypeScript/Phaser 3 по архитектурному плану. Следуй конвенциям проекта. Проверяй сборку и typecheck после изменений."
      },
      {
        id: "content",
        title: "Create game content",
        role: "game",
        agent: "content",
        description:
          "Создай данные уровней, конфигурации, строки интерфейса, структуры данных. Обеспечь data-driven подход и интеграцию с игровой логикой."
      },
      {
        id: "monetization",
        title: "Monetization design",
        role: "game",
        agent: "monetization",
        description:
          "Разработай стратегию монетизации: размещение рекламы, вознаграждения, IAP, интеграция с Yandex Games SDK. Определи KPI-цели."
      },
      {
        id: "test",
        title: "Test implementation",
        role: "qa",
        agent: "tester",
        description:
          "Проверь результат: запусти сборку, typecheck, протестируй игровой flow. Ищи regressions, runtime-проблемы и ошибки. Не исправляй код."
      },
      {
        id: "review",
        title: "Review final result",
        role: "reviewer",
        agent: "reviewer",
        description:
          "Независимо оцени итог: соответствие цели, качество, тесты, регрессии. Дай вердикт: release / release-with-fixes / block."
      },
      {
        id: "build",
        title: "Build production artifact",
        role: "engineering",
        agent: "builder",
        description:
          "Запусти production build, убедись что проект собирается без ошибок. Исправь только проблемы сборки."
      },
      {
        id: "release",
        title: "Prepare release",
        role: "reviewer",
        agent: "reviewer",
        description:
          "Проверь финальное состояние: сборка, тесты, отсутствие регрессий. Оформи итоговый отчёт по релизу."
      }
    ]
  };
}

/**
 * Game improvement pipeline — for bugfixes and improvements to existing games.
 * Skips research/design stages, focuses on targeted changes.
 */
export function createGameImprovementPipeline(
  goal: string
): Pipeline {
  return {
    id: `game-${Date.now()}`,
    name: "Game Improvement Pipeline",
    goal,
    type: "game" as const,

    steps: [
      {
        id: "research",
        title: "Research and diagnose",
        role: "research",
        agent: "researcher",
        description:
          "Изучи проект, архитектуру и игровой flow. Найди подтверждённые проблемы и возможности улучшения. Ничего не изменяй."
      },

      {
        id: "design",
        title: "Design solution",
        role: "designer",
        agent: "designer",
        description:
          "На основе цели и результатов Researcher разработай практическое решение. Код не изменяй. Определи конкретные изменения, приоритеты и критерии успеха."
      },

      {
        id: "implementation",
        title: "Implement solution",
        role: "engineering",
        agent: "builder",
        description:
          "На основе результатов Researcher и Designer реализуй согласованное решение в проекте. Не делай unrelated changes. После реализации проверь изменения."
      },

      {
        id: "test",
        title: "Test implementation",
        role: "qa",
        agent: "tester",
        description:
          "Проверь результат предыдущего этапа. Ищи regressions, runtime problems и ошибки сборки. Не исправляй код без необходимости."
      },

      {
        id: "review",
        title: "Review final result",
        role: "reviewer",
        agent: "reviewer",
        description:
          "Независимо оцени итог. Проверь соответствие цели, качество изменений, тесты и возможные регрессии. Не изменяй код."
      },

      {
        id: "build",
        title: "Build production artifact",
        role: "engineering",
        agent: "builder",
        description:
          "Запусти production build и убедись, что проект собирается без ошибок. Исправь только проблемы сборки."
      },

      {
        id: "release",
        title: "Prepare release",
        role: "reviewer",
        agent: "reviewer",
        description:
          "Проверь финальное состояние: сборка, тесты, отсутствие регрессий. Оформи итоговый отчёт по релизу."
      }
    ]
  };
}

/**
 * Engineering pipeline — for technical tasks, bugfixes, refactoring.
 */
export function createEngineeringPipeline(goal: string): Pipeline {
  return {
    id: `eng-${Date.now()}`,
    name: "Engineering Pipeline",
    goal,
    type: "engineering",

    steps: [
      {
        id: "research",
        title: "Research and diagnose",
        role: "research",
        agent: "researcher",
        description:
          "Изучи проект, архитектуру и flow. Найди подтверждённые проблемы и возможности улучшения. Ничего не изменяй."
      },
      {
        id: "design",
        title: "Design solution",
        role: "designer",
        agent: "designer",
        description:
          "На основе цели и результатов Researcher разработай конкретное техническое решение. Код не изменяй."
      },
      {
        id: "implementation",
        title: "Implement solution",
        role: "engineering",
        agent: "builder",
        description:
          "Реализуй согласованное решение в проекте. Не делай unrelated changes. Проверь сборку после изменений."
      },
      {
        id: "test",
        title: "Test implementation",
        role: "qa",
        agent: "tester",
        description:
          "Проверь результат: typecheck, build, тесты. Ищи regressions. Не исправляй код без необходимости."
      },
      {
        id: "review",
        title: "Review result",
        role: "reviewer",
        agent: "reviewer",
        description:
          "Независимо оцени итог. Проверь соответствие цели, качество, тесты. Не изменяй код."
      },
      {
        id: "build",
        title: "Build production artifact",
        role: "engineering",
        agent: "builder",
        description:
          "Запусти production build. Убедись, что проект собирается без ошибок."
      },
      {
        id: "release",
        title: "Prepare release",
        role: "reviewer",
        agent: "reviewer",
        description:
          "Проверь финальное состояние и оформи отчёт по релизу."
      }
    ]
  };
}

/**
 * Select the appropriate pipeline based on the goal text and context.
 */
export function selectPipeline(
  goal: string,
  pipelineType?: PipelineType
): Pipeline {
  if (pipelineType === "engineering") {
    return createEngineeringPipeline(goal);
  }

  if (pipelineType === "game") {
    return createFullGamePipeline(goal);
  }

  const lower = goal.toLowerCase();

  const isNewGame =
    /\b(new|create|make|build|develop|начать|создать|разработать)\b/i.test(
      lower
    ) &&
    /\b(game|игра|arcade|puzzle|clicker|idle|match|casual)\b/i.test(lower);

  const isBugfix =
    /\b(fix|bug|error|исправить|ошибка|баг|repair|patch)\b/i.test(lower);

  const isEngineering =
    /\b(refactor|typescript|build|deploy|config|setup|test|lint)\b/i.test(
      lower
    ) && !/\b(game|игра)\b/i.test(lower);

  if (isNewGame) {
    return createFullGamePipeline(goal);
  }

  if (isBugfix || isEngineering) {
    return createEngineeringPipeline(goal);
  }

  return createGameImprovementPipeline(goal);
}
