import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

export interface LaunchedProject {
  baseUrl: string;
  stop: () => Promise<void>;
}

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav"
};

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const started = Date.now();
  let lastError = "Server not reachable";
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok || response.status < 500) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Unknown connection error";
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Project server did not become reachable at ${url}: ${lastError}`);
}

function createStaticServer(rootDir: string, port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const root = path.resolve(rootDir);
    const server = createServer(async (req, res) => {
      try {
        const requestPath = decodeURIComponent((req.url ?? "/").split("?")[0] || "/");
        const safePath = path.normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
        let filePath = path.join(root, safePath === "/" ? "index.html" : safePath);
        if (safePath.endsWith("/")) filePath = path.join(filePath, "index.html");
        const resolved = path.resolve(filePath);
        if (!resolved.startsWith(root + path.sep) && resolved !== root) {
          res.writeHead(403); res.end("Forbidden"); return;
        }
        const data = await readFile(resolved);
        const ext = path.extname(resolved).toLowerCase();
        res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
        res.end(data);
      } catch {
        res.writeHead(404); res.end("Not found");
      }
    });
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

async function stopProcessGroup(child: ChildProcess) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  await new Promise<void>(resolve => {
    const timer = setTimeout(() => {
      try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
      resolve();
    }, 3_000);
    child.once("exit", () => { clearTimeout(timer); resolve(); });
  });
}

export async function launchProject(options: {
  projectPath: string;
  type: "static" | "npm-dev";
  directory?: string;
  port: number;
  healthCheckPath: string;
  command?: string;
  args?: string[];
  timeoutMs?: number;
}): Promise<LaunchedProject> {
  const timeoutMs = options.timeoutMs ?? 45_000;
  const baseUrl = `http://127.0.0.1:${options.port}`;
  const healthUrl = `${baseUrl}${options.healthCheckPath.startsWith("/") ? options.healthCheckPath : `/${options.healthCheckPath}`}`;

  if (options.type === "static") {
    const staticRoot = path.resolve(options.projectPath, options.directory ?? "build");
    const server = await createStaticServer(staticRoot, options.port);
    try {
      await waitForHttp(healthUrl, timeoutMs);
    } catch (error) {
      server.close();
      throw error;
    }
    return {
      baseUrl,
      stop: async () => { await new Promise<void>(resolve => server.close(() => resolve())); }
    };
  }

  const command = options.command ?? "npm";
  const args = options.args ?? ["run", "dev"];
  if (command !== "npm" || args[0] !== "run" || !args[1]) {
    throw new Error("Unsupported launch configuration");
  }

  const child = spawn(command, args, {
    cwd: options.projectPath,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, PORT: String(options.port) }
  });

  try {
    await waitForHttp(healthUrl, timeoutMs);
  } catch (error) {
    await stopProcessGroup(child);
    throw error;
  }

  return {
    baseUrl,
    stop: async () => { await stopProcessGroup(child); }
  };
}
