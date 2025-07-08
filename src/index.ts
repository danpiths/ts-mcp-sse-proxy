import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import { ChildProcessWithoutNullStreams, spawn } from "child_process";
import cors from "cors";
import "dotenv/config";
import express from "express";
import { createServerConfig, validateCommand } from "./config/index.js";
import {
    createAuthMiddleware,
    createErrorMiddleware,
    createRateLimitMiddleware,
    createRequestLoggingMiddleware,
    createSecurityMiddleware,
} from "./middleware/index.js";
import { createLogger } from "./utils/logger.js";
import { DefaultRateLimiter } from "./utils/rate-limiter.js";

interface Session {
    transport: SSEServerTransport;
    response: express.Response;
    childProcess: ChildProcessWithoutNullStreams;
    command: string;
    envVars: Record<string, string>;
    lastActivity: number;
}

class MCPSSEProxy {
    private readonly config = createServerConfig();
    private readonly logger = createLogger(this.config.env.logLevel);
    private readonly sessions: Record<string, Session> = {};
    private readonly app = express();
    private cleanupInterval?: NodeJS.Timeout;

    constructor() {
        this.setupAppSecurity();
        this.setupMiddleware();
        this.setupRoutes();
        this.setupCleanup();
        this.setupSignalHandlers();
    }

    private setupAppSecurity(): void {
        // Configure proxy trust for production environments (Fly.io)
        if (this.config.env.nodeEnv === "production") {
            this.app.set("trust proxy", this.config.env.trustedProxies);
        }

        // Disable X-Powered-By header for security
        this.app.disable("x-powered-by");
    }

    private setupMiddleware(): void {
        // CORS with security-conscious defaults
        this.app.use(
            cors({
                origin: (origin, callback) => {
                    // Allow requests with no origin (like mobile apps or curl requests)
                    if (!origin) return callback(null, true);

                    // In production, you might want to be more restrictive
                    // For now, allow all origins for maximum compatibility
                    callback(null, true);
                },
                credentials: true,
                optionsSuccessStatus: 200, // For legacy browser support
            }),
        );

        // Logging
        this.app.use(createRequestLoggingMiddleware(this.logger));

        // Security
        this.app.use(createSecurityMiddleware());

        // Auth
        this.app.use(createAuthMiddleware(this.config.env.authSecret, this.logger));

        // Rate limiting
        const rateLimiter = new DefaultRateLimiter(this.config.rateLimit);
        this.app.use(createRateLimitMiddleware(rateLimiter, this.logger));

        // JSON parsing for non-SSE routes with size limit for security
        this.app.use((req, res, next) => {
            if (req.path.endsWith("/sse") || req.path.endsWith("/message")) {
                return next();
            }
            return express.json({ limit: "1mb" })(req, res, next);
        });
    }

    private setupRoutes(): void {
        // Health check with more detailed information
        this.app.get("/health", this.handleHealthCheck.bind(this));

        // SSE endpoint pattern: /<command>/sse
        this.app.get("/:command/sse", this.handleSSEConnection.bind(this));

        // Message endpoint pattern: /<command>/message
        this.app.post("/:command/message", this.handleMessagePost.bind(this));

        // Error handling
        this.app.use(createErrorMiddleware(this.logger));
    }

    private setupCleanup(): void {
        // Cleanup sessions periodically
        this.cleanupInterval = setInterval(() => {
            this.cleanupExpiredSessions();
        }, this.config.process.cleanupInterval);
    }

    private setupSignalHandlers(): void {
        const signals = ["SIGTERM", "SIGINT", "SIGQUIT"];
        signals.forEach((signal) => {
            process.on(signal, async () => {
                this.logger.info(`Received ${signal}, shutting down gracefully...`);
                await this.shutdown();
                process.exit(0);
            });
        });

        process.on("unhandledRejection", (reason, promise) => {
            this.logger.error("Unhandled Rejection at:", promise, "reason:", reason);
        });

        process.on("uncaughtException", (error) => {
            this.logger.error("Uncaught Exception:", error);
            process.exit(1);
        });
    }

    private parseRequestPath(req: express.Request): {
        command: string;
        rest: string;
    } {
        // With Express route parameters, we can get the command directly
        const command = req.params.command;
        if (!command) {
            throw new Error("Invalid request path");
        }

        // The rest is the remaining part of the path after the command
        const path = req.url.split("?")[0]; // Remove query string
        const commandIndex = path.indexOf(`/${command}/`);
        const rest = path.substring(commandIndex + command.length + 1); // +1 for the slash after command

        return { command: decodeURIComponent(command), rest: `/${rest}` };
    }

    private extractEnvVarsFromHeaders(req: express.Request): Record<string, string> {
        const envVars: Record<string, string> = {};

        for (const [name, value] of Object.entries(req.headers)) {
            const upperName = name.toUpperCase();
            if (upperName.startsWith("ENV_")) {
                const envKey = upperName.substring(4);

                // Skip blacklisted environment variables
                if (this.config.blacklistedEnvVars.has(envKey)) {
                    this.logger.warn(
                        `Blocked attempt to set blacklisted env var: ${envKey}`,
                        {
                            ip: req.ip,
                            userAgent: req.headers["user-agent"],
                        },
                    );
                    continue;
                }

                const envValue = Array.isArray(value) ? value[0] : value;
                if (typeof envValue === "string") {
                    envVars[envKey] = envValue;
                }
            }
        }

        return envVars;
    }

    private handleHealthCheck(_req: express.Request, res: express.Response): void {
        const uptime = process.uptime();
        const memoryUsage = process.memoryUsage();

        res.status(200).json({
            status: "ok",
            timestamp: new Date().toISOString(),
            uptime: Math.floor(uptime),
            sessions: Object.keys(this.sessions).length,
            memory: {
                rss: Math.round(memoryUsage.rss / 1024 / 1024),
                heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024),
                heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024),
            },
            nodeEnv: this.config.env.nodeEnv,
        });
    }

    private async handleSSEConnection(
        req: express.Request,
        res: express.Response,
    ): Promise<void> {
        try {
            const { command } = this.parseRequestPath(req);

            // Validate command
            const cmdStr = validateCommand(command);

            // Extract environment variables
            const envVars = this.extractEnvVarsFromHeaders(req);

            this.logger.info(`New SSE connection for command: ${command}`, {
                remoteAddr: req.ip,
                userAgent: req.headers["user-agent"],
                envVarCount: Object.keys(envVars).length,
            });

            // Create MCP server
            const server = new Server(
                { name: "ts-mcp-sse-proxy", version: "1.0.0" },
                { capabilities: {} },
            );

            // Create SSE transport
            const baseUrl = `${req.protocol}://${req.get("host")}`;
            const messagePath = req.path.replace("/sse", "/message");
            const sseTransport = new SSEServerTransport(
                `${baseUrl}${messagePath}`,
                res,
            );

            // Connect server to transport
            await server.connect(sseTransport);

            const sessionId = sseTransport.sessionId;
            if (!sessionId) {
                throw new Error("Failed to create session ID");
            }

            // Spawn child process with security considerations
            const childProcess = spawn(cmdStr, {
                shell: true,
                env: {
                    ...process.env,
                    ...envVars,
                    // Security: ensure Node.js specific variables are not overridden
                    NODE_ENV: this.config.env.nodeEnv,
                },
                stdio: ["pipe", "pipe", "pipe"],
            });

            // Store session
            const session: Session = {
                transport: sseTransport,
                response: res,
                childProcess,
                command,
                envVars,
                lastActivity: Date.now(),
            };
            this.sessions[sessionId] = session;

            // Handle child process events
            childProcess.on("exit", (code, signal) => {
                this.logger.info(
                    `Child process exited: code=${code}, signal=${signal}`,
                    { sessionId },
                );
                delete this.sessions[sessionId];
            });

            childProcess.on("error", (error) => {
                this.logger.error(`Child process error:`, error, { sessionId });
                this.cleanupSession(sessionId);
            });

            // Handle SSE events
            sseTransport.onmessage = (msg: JSONRPCMessage) => {
                this.logger.debug(`SSE → Child (session ${sessionId}):`, msg);
                session.lastActivity = Date.now();

                try {
                    childProcess.stdin.write(JSON.stringify(msg) + "\n");
                } catch (error) {
                    this.logger.error(
                        `Failed to write to child process stdin:`,
                        error,
                        { sessionId },
                    );
                    this.cleanupSession(sessionId);
                }
            };

            sseTransport.onclose = () => {
                this.logger.info(`SSE connection closed (session ${sessionId})`);
                this.cleanupSession(sessionId);
            };

            sseTransport.onerror = (err) => {
                this.logger.error(`SSE error (session ${sessionId}):`, err);
                this.cleanupSession(sessionId);
            };

            // Handle child stdout
            let buffer = "";
            childProcess.stdout.on("data", (chunk: Buffer) => {
                buffer += chunk.toString("utf8");
                const lines = buffer.split(/\r?\n/);
                buffer = lines.pop() ?? "";

                lines.forEach((line) => {
                    if (!line.trim()) return;

                    try {
                        const jsonMsg = JSON.parse(line);
                        this.logger.debug(
                            `Child → SSE (session ${sessionId}):`,
                            jsonMsg,
                        );
                        session.transport.send(jsonMsg);
                        session.lastActivity = Date.now();
                    } catch {
                        this.logger.debug(
                            `Child non-JSON output (session ${sessionId}): ${line}`,
                        );
                    }
                });
            });

            // Handle child stderr
            childProcess.stderr.on("data", (chunk: Buffer) => {
                this.logger.error(
                    `Child stderr (session ${sessionId}): ${chunk.toString("utf8")}`,
                );
            });

            // Handle client disconnect
            req.on("close", () => {
                this.logger.info(`Client disconnected (session ${sessionId})`);
                this.cleanupSession(sessionId);
            });
        } catch (error) {
            this.logger.error("Failed to handle SSE connection:", error);
            if (!res.headersSent) {
                res.status(500).json({ error: "Internal server error" });
            }
        }
    }

    private async handleMessagePost(
        req: express.Request,
        res: express.Response,
    ): Promise<void> {
        try {
            const sessionId = req.query.sessionId as string;

            if (!sessionId) {
                res.status(400).json({ error: "Missing sessionId parameter" });
                return;
            }

            const session = this.sessions[sessionId];
            if (!session?.transport?.handlePostMessage) {
                res.status(503).json({
                    error: `No active SSE connection for session ${sessionId}`,
                });
                return;
            }

            this.logger.debug(`POST to SSE transport (session ${sessionId})`);
            session.lastActivity = Date.now();
            await session.transport.handlePostMessage(req, res);
        } catch (error) {
            this.logger.error("Failed to handle message POST:", error);
            if (!res.headersSent) {
                res.status(500).json({ error: "Internal server error" });
            }
        }
    }

    private cleanupSession(sessionId: string): void {
        const session = this.sessions[sessionId];
        if (session) {
            try {
                // Kill child process
                if (!session.childProcess.killed) {
                    session.childProcess.kill("SIGTERM");

                    // Force kill after timeout
                    setTimeout(() => {
                        if (!session.childProcess.killed) {
                            session.childProcess.kill("SIGKILL");
                        }
                    }, this.config.process.gracefulTimeout);
                }
            } catch (error) {
                this.logger.error(
                    `Error killing child process for session ${sessionId}:`,
                    error,
                );
            }

            delete this.sessions[sessionId];
        }
    }

    private cleanupExpiredSessions(): void {
        const now = Date.now();
        const expiredSessions = Object.entries(this.sessions).filter(
            ([, session]) =>
                now - session.lastActivity > this.config.process.sessionTimeout,
        );

        if (expiredSessions.length > 0) {
            this.logger.info(
                `Cleaning up ${expiredSessions.length} expired sessions`,
            );
            expiredSessions.forEach(([sessionId]) => {
                this.cleanupSession(sessionId);
            });
        }
    }

    private async shutdown(): Promise<void> {
        // Clear cleanup interval
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }

        // Cleanup all sessions
        const sessionIds = Object.keys(this.sessions);
        this.logger.info(`Cleaning up ${sessionIds.length} active sessions`);

        for (const sessionId of sessionIds) {
            this.cleanupSession(sessionId);
        }

        // Wait a bit for cleanup
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    public start(): void {
        this.app.listen(this.config.env.port, this.config.env.host, () => {
            this.logger.info(
                `🚀 Server running at http://${this.config.env.host}:${this.config.env.port}`,
            );
            this.logger.info(
                `📊 Health check: http://localhost:${this.config.env.port}/health`,
            );
            this.logger.info(
                `🔗 SSE format: http://localhost:${this.config.env.port}/<command>/sse`,
            );
            this.logger.info(
                `📨 Message format: http://localhost:${this.config.env.port}/<command>/message`,
            );
            this.logger.info(
                `🛡️ Security: Rate limit ${this.config.rateLimit.requestsPerMinute}/min, Burst ${this.config.rateLimit.burstLimit}`,
            );
            this.logger.info(`🔒 Environment: ${this.config.env.nodeEnv}`);
        });
    }
}

// Start the server
async function main(): Promise<void> {
    try {
        const proxy = new MCPSSEProxy();
        proxy.start();
    } catch (error) {
        console.error("Failed to start server:", error);
        process.exit(1);
    }
}

main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
