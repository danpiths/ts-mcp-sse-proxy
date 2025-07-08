// Core configuration types
export interface ProcessConfig {
    readonly sessionTimeout: number; // milliseconds
    readonly cleanupInterval: number; // milliseconds
    readonly gracefulTimeout: number; // milliseconds
}

export interface RateLimitConfig {
    readonly requestsPerMinute: number;
    readonly burstLimit: number;
}

// Command and security types
export type EnabledCommands = Record<string, boolean>;

export type BlacklistedEnvVars = ReadonlySet<string>;

// Rate limiter types
export interface RateLimiter {
    readonly allow: (ip: string) => boolean;
    readonly getVisitor: (ip: string) => { readonly allow: () => boolean };
}

// Logger interface
export interface Logger {
    readonly info: (message: string, ...args: unknown[]) => void;
    readonly error: (message: string, ...args: unknown[]) => void;
    readonly warn: (message: string, ...args: unknown[]) => void;
    readonly debug: (message: string, ...args: unknown[]) => void;
}

// Error types
export class ProxyError extends Error {
    constructor(
        message: string,
        public readonly statusCode: number = 500,
        public readonly code?: string,
    ) {
        super(message);
        this.name = "ProxyError";
    }
}

export class AuthenticationError extends ProxyError {
    constructor(message = "Authentication required") {
        super(message, 401, "AUTH_REQUIRED");
    }
}

export class RateLimitError extends ProxyError {
    constructor(message = "Rate limit exceeded") {
        super(message, 429, "RATE_LIMIT");
    }
}

export class CommandNotAllowedError extends ProxyError {
    constructor(command: string) {
        super(`Command not allowed: ${command}`, 403, "COMMAND_NOT_ALLOWED");
    }
}
