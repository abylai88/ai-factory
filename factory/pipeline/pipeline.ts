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

import { isRobloxGoal } from "../roblox/platform.js";

/**
 * Full game production pipeline — runs all specialized game agents
 * from market research through release.
 *
 * Agents: market → competitor → idea → director → gameplay → designer →
 *         architect → programmer → content → monetization → tester →
 *         bugfix → retest → reviewer → build → release
 */

export function createFullGamePipeline(goal: string): Pipeline {
  const roblox = isRobloxGoal(goal);

  return {
    id: `game-prod-${Date.now()}`,
    name: roblox ? "Roblox Game Production Pipeline" : "Game Production Pipeline",
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
          "Read the project's GDD and existing docs in docs/. Based ONLY on project-local files (no web research), write docs/competitor-analysis.md with direct competitors, differentiation opportunities, and feature priorities. Stop after writing the artifact."
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
          roblox
            ? "Разработай подробный GDD для Roblox: видение, механики, системы, прогрессия, UX-поток, структура контента и приоритеты продакшена. Определи Roblox gameplay/service architecture и разделение server/client."
            : "Разработай подробный GDD: видение, механики, системы, прогрессия, UX-поток, структура контента и приоритеты продакшена. Определи архитектуру сцен Phaser."
      },
      {
        id: "gameplay",
        title: "Gameplay mechanics design",
        role: "game",
        agent: "gameplay",
        description:
          roblox
            ? "Детально проработай геймплейные механики для Roblox: server-authoritative логику, RemoteEvents/RemoteFunctions, feedback-системы, обработку ввода и кривую сложности. Доверенное состояние — только на сервере."
            : "Детально проработай геймплейные механики: физику, тюнинг, feedback-системы, juice-эффекты, обработку ввода и кривую сложности."
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
          roblox
            ? "Спроектируй техническую архитектуру Roblox-игры: ModuleScripts в ReplicatedStorage, серверные скрипты в ServerScriptService, клиентские LocalScripts в StarterPlayer/StarterGui, RemoteEvents/RemoteFunctions, DataStore-персистентность, server-authoritative границы. Определи риски."
            : "Спроектируй техническую архитектуру: модульную структуру, управление состоянием, потоки данных, конфигурацию сборки. Определи риски."
      },
      {
        id: "implementation",
        title: "Implement game",
        role: "engineering",
        agent: "programmer",
        description:
          roblox
            ? "Read the GDD and design docs in docs/. Read existing Luau source in src/. Implement the Roblox game in Luau by editing source files. Follow Roblox server/client conventions and the existing Rojo structure. Keep server-authoritative gameplay logic on the server and shared/client code in the appropriate services. Validate the Rojo project structure and report files changed."
            : "Read the GDD and design docs in docs/. Read existing source in src/. Implement the game code in TypeScript/Phaser 3 by editing source files. Follow project conventions. After editing, run npm run build or npx tsc --noEmit to verify. Fix build errors yourself. Report files changed and build result."
      },
      {
        id: "content",
        title: "Create game content",
        role: "game",
        agent: "content",
        description:
          roblox
            ? "Создай игровой контент как Luau ModuleScripts и конфигурации (баланс, уровни, строки интерфейса). Обеспечь data-driven подход и интеграцию с серверной игровой логикой."
            : "Создай данные уровней, конфигурации, строки интерфейса, структуры данных. Обеспечь data-driven подход и интеграцию с игровой логикой."
      },
      {
        id: "monetization",
        title: "Monetization design",
        role: "game",
        agent: "monetization",
        description:
          roblox
            ? "Разработай стратегию монетизации для Roblox: game passes, developer products, retention loops и другие подходящие Roblox-механики. Не внедряй платёжный код на этом этапе; опиши точки интеграции и ограничения."
            : "Разработай стратегию монетизации: размещение рекламы, вознаграждения, IAP, интеграция с Yandex Games SDK. Определи KPI-цели."
      },
      {
        id: "test",
        title: "Test implementation",
        role: "qa",
        agent: "tester",
        description:
          roblox
            ? "Проверь Roblox-проект: валидируй default.project.json, структуру src/, Luau scripts и server/client boundaries. Запусти доступную Rojo-проверку/build, если инструмент доступен. Ищи runtime- и структурные ошибки. Не исправляй код."
            : "Проверь результат: запусти сборку (npm run build), typecheck, протестируй игровой flow. Ищи regressions, runtime-проблемы и ошибки. Не исправляй код."
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
          roblox
            ? "Проведи production validation Roblox-проекта. Используй доступный Rojo build/validation и убедись, что default.project.json и Luau source собираются в валидный place artifact. Исправляй только проблемы сборки/структуры."
            : "Запусти production build (npm run build), убедись что проект собирается без ошибок. Исправь только проблемы сборки."
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
  const roblox = isRobloxGoal(goal);

  return {
    id: `game-${Date.now()}`,
    name: roblox ? "Roblox Game Improvement Pipeline" : "Game Improvement Pipeline",
    goal,
    type: "game" as const,

    steps: [
      {
        id: "research",
        title: "Research and diagnose",
        role: "research",
        agent: "researcher",
        description:
          roblox
            ? "Изучи Roblox-проект: структуру Rojo (default.project.json, src/), Luau-исходники и server/client boundaries. Найди подтверждённые проблемы и возможности улучшения. Ничего не изменяй."
            : "Изучи проект, архитектуру и игровой flow. Найди подтверждённые проблемы и возможности улучшения. Ничего не изменяй."
      },

      {
        id: "design",
        title: "Design solution",
        role: "designer",
        agent: "designer",
        description:
          roblox
            ? "На основе цели и результатов Researcher разработай практическое решение для Roblox: конкретные Luau-изменения, server/client размещение, приоритеты и критерии успеха. Код не изменяй."
            : "На основе цели и результатов Researcher разработай практическое решение. Код не изменяй. Определи конкретные изменения, приоритеты и критерии успеха."
      },

      {
        id: "implementation",
        title: "Implement solution",
        role: "engineering",
        agent: "builder",
        description:
          roblox
            ? "На основе результатов Researcher и Designer реализуй согласованное решение в Luau, соблюдая server/client boundaries Rojo-проекта (server-authoritative логика — на сервере). Не делай unrelated changes. После реализации проверь структуру Rojo-проекта."
            : "На основе результатов Researcher и Designer реализуй согласованное решение в проекте. Не делай unrelated changes. После реализации проверь изменения."
      },

      {
        id: "test",
        title: "Test implementation",
        role: "qa",
        agent: "tester",
        description:
          roblox
            ? "Проверь Roblox-проект: валидируй default.project.json, структуру src/, Luau scripts и server/client boundaries. Запусти доступную Rojo-проверку/build, если инструмент доступен. Ищи regressions и структурные ошибки. Не исправляй код без необходимости."
            : "Проверь результат предыдущего этапа. Ищи regressions, runtime problems и ошибки сборки. Не исправляй код без необходимости."
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
          roblox
            ? "Проведи production validation Roblox-проекта. Используй доступный Rojo build/validation и убедись, что default.project.json и Luau source собираются в валидный place artifact. Исправляй только проблемы сборки/структуры. Не запускай npm/webpack."
            : "Запусти production build и убедись, что проект собирается без ошибок. Исправь только проблемы сборки."
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
  const roblox = isRobloxGoal(goal);

  return {
    id: `eng-${Date.now()}`,
    name: roblox ? "Roblox Engineering Pipeline" : "Engineering Pipeline",
    goal,
    type: "engineering",

    steps: [
      {
        id: "research",
        title: "Research and diagnose",
        role: "research",
        agent: "researcher",
        description:
          roblox
            ? "Изучи Roblox-проект: структуру Rojo (default.project.json, src/), Luau-исходники и server/client boundaries. Найди подтверждённые проблемы. Ничего не изменяй."
            : "Изучи проект, архитектуру и flow. Найди подтверждённые проблемы и возможности улучшения. Ничего не изменяй."
      },
      {
        id: "design",
        title: "Design solution",
        role: "designer",
        agent: "designer",
        description:
          roblox
            ? "На основе цели и результатов Researcher разработай конкретное техническое решение для Roblox (Luau, server/client размещение). Код не изменяй."
            : "На основе цели и результатов Researcher разработай конкретное техническое решение. Код не изменяй."
      },
      {
        id: "implementation",
        title: "Implement solution",
        role: "engineering",
        agent: "builder",
        description:
          roblox
            ? "Реализуй согласованное решение в Luau, соблюдая server/client boundaries Rojo-проекта. Не делай unrelated changes. Проверь структуру проекта после изменений. Не запускай npm/webpack."
            : "Реализуй согласованное решение в проекте. Не делай unrelated changes. Проверь сборку после изменений."
      },
      {
        id: "test",
        title: "Test implementation",
        role: "qa",
        agent: "tester",
        description:
          roblox
            ? "Проверь Roblox-проект: валидируй default.project.json, структуру src/ и Luau scripts. Запусти доступную Rojo-проверку/build, если инструмент доступен. Ищи regressions. Не исправляй код без необходимости."
            : "Проверь результат: typecheck, build, тесты. Ищи regressions. Не исправляй код без необходимости."
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
          roblox
            ? "Проведи production validation Roblox-проекта через доступный Rojo build/validation. Убедись, что проект собирается без ошибок. Не запускай npm/webpack."
            : "Запусти production build. Убедись, что проект собирается без ошибок."
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
    /\b(game|игра|arcade|puzzle|clicker|idle|match|casual|platformer|simulator|roblox|tycoon|obby)\b/i.test(lower);

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
