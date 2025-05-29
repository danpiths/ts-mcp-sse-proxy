import { Request, Response, NextFunction } from "express";
import { Logger, RateLimiter } from "../types/index.js";

// Authentication middleware
export function createAuthMiddleware(authSecret: string, logger?: Logger) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Skip auth for health checks and OPTIONS requests
    if (req.url === "/health" || req.method === "OPTIONS") {
      next();
      return;
    }

    // Get the Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      logger?.warn("Missing authorization header", { ip: req.ip, path: req.path });
      res.status(401).json({ error: "Authorization header required" });
      return;
    }

    // Check if it's a Bearer token
    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0].toLowerCase() !== "bearer") {
      logger?.warn("Invalid authorization format", { ip: req.ip, authHeader });
      res.status(401).json({ error: "Invalid authorization format" });
      return;
    }

    // Validate the token
    if (parts[1] !== authSecret) {
      logger?.warn("Invalid token", { ip: req.ip });
      res.status(401).json({ error: "Invalid token" });
      return;
    }

    next();
  };
}

// Security headers middleware
export function createSecurityMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Health check endpoint
    if (req.url === "/health") {
      res.status(200).send("ok");
      return;
    }

    // HSTS header (only in production with HTTPS)
    if (req.secure || req.headers["x-forwarded-proto"] === "https") {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }

    // Security headers
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

    // Content Security Policy - Allow EventSource connections
    res.setHeader("Content-Security-Policy", "default-src 'self'; connect-src 'self' *");

    // CORS headers - More permissive for SSE but still secure
    const origin = req.headers.origin;
    if (origin) {
      // Allow the specific origin that made the request
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
    } else {
      // Fallback for non-browser clients
      res.setHeader("Access-Control-Allow-Origin", "*");
    }

    // Allow methods needed for SSE and message posting
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

    // Allow headers commonly used with SSE and required for the API
    res.setHeader(
      "Access-Control-Allow-Headers",
      ["Content-Type", "Authorization", "Cache-Control", "Last-Event-ID", "ENV_*", "X-Requested-With"].join(", ")
    );

    // Increase max age for better performance
    res.setHeader("Access-Control-Max-Age", "86400"); // 24 hours

    // Handle preflight requests
    if (req.method === "OPTIONS") {
      // Ensure the response includes the allowed headers
      res.setHeader("Access-Control-Expose-Headers", "Content-Type, Last-Event-ID");
      res.status(200).end();
      return;
    }

    next();
  };
}

// Rate limiting middleware
export function createRateLimitMiddleware(rateLimiter: RateLimiter, logger?: Logger) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Skip rate limiting for health checks and OPTIONS requests
    if (req.url === "/health" || req.method === "OPTIONS") {
      next();
      return;
    }

    // Get IP from X-Forwarded-For header, or fallback to RemoteAddr
    let ip = req.headers["x-forwarded-for"] as string;
    if (!ip) {
      ip = req.socket.remoteAddress || req.ip || "unknown";
    }

    // Clean IP address if it contains port (for IPv6)
    if (typeof ip === "string" && ip.includes(":")) {
      const parts = ip.split(":");
      if (parts.length === 2 && !ip.startsWith("[")) {
        // IPv4 with port
        ip = parts[0];
      }
      // For IPv6, we keep the full address
    }

    if (!rateLimiter.allow(ip)) {
      logger?.warn("Rate limit exceeded", { ip, path: req.path });
      res.status(429).json({ error: "Rate limit exceeded" });
      return;
    }

    next();
  };
}

// Error handling middleware
export function createErrorMiddleware(logger?: Logger) {
  return (error: Error, req: Request, res: Response, _next: NextFunction): void => {
    logger?.error("Unhandled error", {
      error: error.message,
      stack: error.stack,
      path: req.path,
      method: req.method,
      ip: req.ip,
    });

    // Don't send stack traces to clients in production
    const isDevelopment = process.env.NODE_ENV === "development";

    res.status(500).json({
      error: "Internal server error",
      ...(isDevelopment && { details: error.message, stack: error.stack }),
    });
  };
}

// Request logging middleware
export function createRequestLoggingMiddleware(logger?: Logger) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const start = Date.now();

    // Log request
    logger?.info("Incoming request", {
      method: req.method,
      path: req.path,
      ip: req.ip,
      userAgent: req.headers["user-agent"],
    });

    // Use the 'finish' event to log response
    res.on("finish", () => {
      const duration = Date.now() - start;
      logger?.info("Request completed", {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration,
        ip: req.ip,
      });
    });

    next();
  };
}
