import { ProcessConfig, RateLimitConfig, EnabledCommands, BlacklistedEnvVars } from "../types/index.js";

// Default process configuration - only what we actually use
export const defaultProcessConfig: ProcessConfig = {
  sessionTimeout: 60 * 60 * 1000, // 1 hour
  cleanupInterval: 5 * 60 * 1000, // 5 minutes
  gracefulTimeout: 10 * 1000, // 10 seconds
} as const;

// Default rate limit configuration - more restrictive for security
export const defaultRateLimitConfig: RateLimitConfig = {
  requestsPerMinute: 500, // Reduced from 1000 for better security
  burstLimit: 25, // Reduced from 50 for better security
} as const;

// Enabled commands - static configuration
export const enabledCommands: EnabledCommands = {
  "npx -y @upstash/context7-mcp@latest": true,
  "npx -y @maximai/mcp-server@latest": true,
  "npx -y @notionhq/notion-mcp-server": true,
  "npx -y exa-mcp-server": true,
  "docker run -i --rm -e GITHUB_PERSONAL_ACCESS_TOKEN ghcr.io/github/github-mcp-server": true,
} as const;

// Blacklisted environment variables - exact same as Go implementation + additional security
export const blacklistedEnvVars: BlacklistedEnvVars = new Set([
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "PWD",
  "TMPDIR",
  "TEMP",
  "TMP",
  "HOSTNAME",
  "LANG",
  "LC_ALL",
  "SUDO_USER",
  "SUDO_COMMAND",
  "SSH_AUTH_SOCK",
  "SSH_AGENT_PID",
  "AWS_ACCESS_KEY",
  "AWS_SECRET_KEY",
  "AWS_SESSION_TOKEN",
  "API_KEY",
  "SECRET_KEY",
  "PRIVATE_KEY",
  "PASSWORD",
  "TOKEN",
  "MAXIM_SECRET",
  // Additional security - prevent Node.js specific attacks
  "NODE_OPTIONS",
  "NODE_PATH",
  "NPM_TOKEN",
  "YARN_RC_FILENAME",
  "NODE_TLS_REJECT_UNAUTHORIZED",
] as const);

// Environment configuration
export interface EnvConfig {
  readonly port: number;
  readonly host: string;
  readonly logLevel: "DEBUG" | "INFO" | "WARN" | "ERROR";
  readonly authSecret: string;
  readonly nodeEnv: string;
  readonly trustedProxies: readonly string[];
}

export function getEnvConfig(): EnvConfig {
  const port = parseInt(process.env.PORT || "8000", 10);
  const host = process.env.HOST || "0.0.0.0";
  const logLevel = (process.env.LOG_LEVEL?.toUpperCase() as EnvConfig["logLevel"]) || "INFO";
  const authSecret = process.env.MAXIM_SECRET;
  const nodeEnv = process.env.NODE_ENV || "development";

  // Configure trusted proxies for production (Fly.io specific)
  const trustedProxies =
    nodeEnv === "production" ? (["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7"] as const) : ([] as const);

  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid port: ${process.env.PORT || "8000"}`);
  }

  if (!authSecret) {
    throw new Error("MAXIM_SECRET environment variable is required");
  }

  if (authSecret.length < 32) {
    throw new Error("MAXIM_SECRET must be at least 32 characters long");
  }

  return {
    port,
    host,
    logLevel,
    authSecret,
    nodeEnv,
    trustedProxies,
  };
}

// Validation functions
export function validateCommand(command: string): string {
  const isEnabled = enabledCommands[command];
  if (!isEnabled) {
    throw new Error(`Command not allowed: ${command}`);
  }
  return command;
}

export function isEnvVarBlacklisted(envVar: string): boolean {
  return blacklistedEnvVars.has(envVar);
}

// Configuration factory
export function createServerConfig(): {
  readonly process: ProcessConfig;
  readonly rateLimit: RateLimitConfig;
  readonly enabledCommands: EnabledCommands;
  readonly blacklistedEnvVars: BlacklistedEnvVars;
  readonly env: EnvConfig;
} {
  return {
    process: defaultProcessConfig,
    rateLimit: defaultRateLimitConfig,
    enabledCommands,
    blacklistedEnvVars,
    env: getEnvConfig(),
  } as const;
}
