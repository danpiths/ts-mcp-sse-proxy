import { Logger } from "../types/index.js";

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

class ConsoleLogger implements Logger {
    private readonly level: LogLevel;
    private readonly prefix: string;

    constructor(level: LogLevel = "INFO", prefix = "🔄 SSE-Proxy") {
        this.level = level;
        this.prefix = prefix;
    }

    private shouldLog(messageLevel: LogLevel): boolean {
        const levels: Record<LogLevel, number> = {
            DEBUG: 0,
            INFO: 1,
            WARN: 2,
            ERROR: 3,
        };
        return levels[messageLevel] >= levels[this.level];
    }

    private formatMessage(
        level: LogLevel,
        message: string,
        ...args: unknown[]
    ): string {
        const timestamp = new Date().toISOString();
        const argsStr =
            args.length > 0
                ? ` ${args.map((arg) => (typeof arg === "object" ? JSON.stringify(arg) : String(arg))).join(" ")}`
                : "";

        return `${timestamp} ${this.prefix} ${level} ${message}${argsStr}`;
    }

    private getConsoleMethod(level: LogLevel): typeof console.log {
        switch (level) {
            case "DEBUG":
                return console.debug;
            case "INFO":
                return console.info;
            case "WARN":
                return console.warn;
            case "ERROR":
                return console.error;
            default:
                return console.log;
        }
    }

    debug(message: string, ...args: unknown[]): void {
        if (this.shouldLog("DEBUG")) {
            this.getConsoleMethod("DEBUG")(
                this.formatMessage("DEBUG", message, ...args),
            );
        }
    }

    info(message: string, ...args: unknown[]): void {
        if (this.shouldLog("INFO")) {
            this.getConsoleMethod("INFO")(
                this.formatMessage("INFO", message, ...args),
            );
        }
    }

    warn(message: string, ...args: unknown[]): void {
        if (this.shouldLog("WARN")) {
            this.getConsoleMethod("WARN")(
                this.formatMessage("WARN", message, ...args),
            );
        }
    }

    error(message: string, ...args: unknown[]): void {
        if (this.shouldLog("ERROR")) {
            this.getConsoleMethod("ERROR")(
                this.formatMessage("ERROR", message, ...args),
            );
        }
    }
}

export function createLogger(level: LogLevel = "INFO"): Logger {
    return new ConsoleLogger(level);
}
