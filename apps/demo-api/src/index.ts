import { Container } from "@cloudflare/containers";
import type { DurableObject } from "cloudflare:workers";

const CONTAINER_NAME = "public-demo";
const API_PORT = 3001;
const ENTRYPOINT = ["/bin/sh", "-lc", "pnpm --filter @bidwright/api exec tsx src/index.ts"];

export class BidwrightDemoApiContainer extends Container<Env> {
  private readonly runtimeEnv: Env;

  defaultPort = API_PORT;
  requiredPorts = [API_PORT];
  sleepAfter = "20m";
  enableInternet = true;
  pingEndpoint = "localhost/health";

  constructor(ctx: DurableObject["ctx"], env: Env) {
    super(ctx, env, {
      defaultPort: API_PORT,
      sleepAfter: "20m",
      envVars: containerEnvVars(env),
      entrypoint: ENTRYPOINT,
      enableInternet: true,
    });
    this.runtimeEnv = env;
  }

  async fetch(request: Request) {
    await this.startAndWaitForPorts({
      ports: [API_PORT],
      startOptions: {
        envVars: containerEnvVars(this.runtimeEnv),
        entrypoint: ENTRYPOINT,
        enableInternet: true,
      },
      cancellationOptions: {
        instanceGetTimeoutMS: 120_000,
        portReadyTimeoutMS: 180_000,
        waitInterval: 1_000,
      },
    });
    return this.containerFetch(request, API_PORT);
  }
}

function containerEnvVars(env: Env) {
  return {
    NODE_ENV: "production",
    API_PORT: String(API_PORT),
    DATA_DIR: "/data",
    DATABASE_URL: String(env.DATABASE_URL ?? ""),
    INTEGRATIONS_ENCRYPTION_KEY: String(env.INTEGRATIONS_ENCRYPTION_KEY ?? ""),
    BIDWRIGHT_DEMO_MODE: "1",
    BIDWRIGHT_PUBLIC_DEMO: "1",
    BIDWRIGHT_DEMO_ORG_SLUG: "demo",
    BIDWRIGHT_DEMO_ORG_NAME: "Bidwright Demo",
    BIDWRIGHT_DEMO_USER_EMAIL: "demo@bidwright.app",
    BIDWRIGHT_DEMO_USER_NAME: "Bidwright Demo User",
    BIDWRIGHT_MODE: "server",
    BIDWRIGHT_MULTITENANT: "false",
    BIDWRIGHT_SKIP_BOOTSTRAP_MIGRATIONS: "1",
    AGENT_HOME_ROOT: "/data/agent-home",
    WORKSPACE_STORAGE_PROVIDER: "",
    LLM_PROVIDER: "none",
    LLM_MODEL: "",
    EMBEDDING_PROVIDER: "",
    OPENAI_API_KEY: "",
    ANTHROPIC_API_KEY: "",
    OPENROUTER_API_KEY: "",
    GEMINI_API_KEY: "",
    GOOGLE_API_KEY: "",
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    try {
      const container = env.BIDWRIGHT_API.getByName(CONTAINER_NAME);
      const response = await container.fetch(request);
      return withCors(response, cors);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Bidwright demo API container failed";
      return json({ error: message }, 502, cors);
    }
  },
};

function corsHeaders(request: Request, env: Env) {
  const origin = request.headers.get("origin") ?? "";
  const configured = (env.DEMO_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const allowOrigin = getAllowedCorsOrigin(origin, configured);
  return {
    "access-control-allow-origin": allowOrigin || "*",
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,authorization,x-bidwright-actor",
    "access-control-max-age": "86400",
    "vary": "Origin",
  };
}

function getAllowedCorsOrigin(origin: string, configuredOrigins: string[]) {
  if (!origin) return "";
  if (configuredOrigins.includes(origin)) return origin;

  try {
    const url = new URL(origin);
    const hostname = url.hostname.toLowerCase();

    if (url.protocol === "https:" && hostname === "demo.bidwright.app") return origin;
    if (url.protocol === "https:" && hostname.endsWith(".vercel.app") && hostname.startsWith("bidwright-demo")) return origin;
    if (url.protocol === "http:" && (hostname === "localhost" || hostname === "127.0.0.1")) return origin;
  } catch {
    return configuredOrigins[0] ?? "";
  }

  return configuredOrigins[0] ?? "";
}

function withCors(response: Response, cors: Record<string, string>) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(cors)) headers.set(key, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}
