import { RateLimiter, RateLimitConfig } from "../types/index.js";
import { RateLimiter as TokenBucketLimiter } from "limiter";

interface VisitorLimiter {
  readonly limiter: TokenBucketLimiter;
  lastUsed: number;
}

export class DefaultRateLimiter implements RateLimiter {
  private readonly visitors = new Map<string, VisitorLimiter>();
  private readonly requestsPerMinute: number;
  private readonly cleanupInterval: number;
  private readonly visitorTimeout: number;
  private lastCleanup = Date.now();

  constructor(
    config: RateLimitConfig,
    cleanupInterval = 5 * 60 * 1000, // 5 minutes
    visitorTimeout = 30 * 60 * 1000 // 30 minutes
  ) {
    this.requestsPerMinute = config.requestsPerMinute;
    // Note: burstLimit is available in config but not used in this simple implementation
    // TODO: Implement proper burst limiting if needed
    this.cleanupInterval = cleanupInterval;
    this.visitorTimeout = visitorTimeout;
  }

  private cleanupStaleVisitors(): void {
    const now = Date.now();
    if (now - this.lastCleanup < this.cleanupInterval) {
      return;
    }
    this.lastCleanup = now;

    // Remove visitors that haven't been used recently
    for (const [ip, visitor] of this.visitors.entries()) {
      if (now - visitor.lastUsed > this.visitorTimeout) {
        this.visitors.delete(ip);
      }
    }
  }

  getVisitor(ip: string): { readonly allow: () => boolean } {
    this.cleanupStaleVisitors();

    let visitor = this.visitors.get(ip);
    if (!visitor) {
      // Create rate limiter with high initial allowance and refill at sustained rate
      visitor = {
        limiter: new TokenBucketLimiter({
          tokensPerInterval: this.requestsPerMinute,
          interval: "minute",
          fireImmediately: true,
        }),
        lastUsed: Date.now(),
      };
      this.visitors.set(ip, visitor);
    }

    visitor.lastUsed = Date.now();

    return {
      allow: (): boolean => {
        return visitor!.limiter.tryRemoveTokens(1);
      },
    };
  }

  allow(ip: string): boolean {
    return this.getVisitor(ip).allow();
  }

  // Additional methods for management
  getVisitorCount(): number {
    this.cleanupStaleVisitors();
    return this.visitors.size;
  }

  clearVisitor(ip: string): void {
    this.visitors.delete(ip);
  }

  clearAllVisitors(): void {
    this.visitors.clear();
  }
}
