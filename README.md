# TypeScript MCP SSE Proxy

A high-performance Server-Sent Events (SSE) proxy server designed for the Model Context Protocol (MCP), built in TypeScript. This proxy enables efficient real-time communication between MCP clients and servers while providing rate limiting, security features, and robust process management.

## Features

- 🚀 High-performance SSE proxy for MCP communication
- 🔒 Built-in security headers and authentication middleware
- ⚡ Rate limiting with configurable thresholds
- 🔄 Process management for handling MCP server instances
- 🛡️ Graceful shutdown handling
- 🌐 CORS support optimized for SSE connections

## Prerequisites

- Node.js 18.x or higher
- npm or yarn package manager

## Installation

### Local Development

1. Clone the repository:

```bash
git clone <repository-url>
cd ts-mcp-sse-proxy
```

2. Install dependencies:

```bash
npm install
```

3. Set up environment variables:

```bash
cp .env.example .env
# Edit .env with your configuration
```

4. Build the project:

```bash
npm run build
```

## Deployment

### Fly.io Deployment with Docker-in-Docker (DinD) Sidecar

This project includes a complete Fly.io deployment setup with a Docker-in-Docker sidecar.

#### Deployment Process

1. **Run the deployment script:**

```bash
./deploy.sh
```

The deployment script will:

- 🛑 Stop and destroy any existing DinD containers
- 🐳 Deploy a new Docker-in-Docker sidecar
- 🏗️ Build and validate the application locally
- 🚀 Deploy the TypeScript proxy with proper configuration
- 🔍 Verify the deployment with health checks

#### Security Features in Deployment

- 🔒 **Non-root container**: Application runs as non-privileged user
- ⚡ **Rate limiting**: Default 500 requests/minute with 25 burst limit
- 🔐 **Proxy trust**: Properly configured for Fly.io's network architecture
- 📊 **Health monitoring**: Built-in health checks and resource monitoring

#### Monitoring and Logs

```bash
# View application logs
fly logs

# Check machine status
fly machine list

# View health status
curl https://ts-mcp-sse-proxy.fly.dev/health

# Monitor resource usage
fly machine status <machine-id>
```

#### Troubleshooting

1. **DinD container issues:**

   ```bash
   fly machine list
   fly machine destroy <docker-daemon-machine-id> --force
   ./deploy.sh  # Re-run deployment
   ```

2. **Application not responding:**

   ```bash
   fly logs --app ts-mcp-sse-proxy
   fly machine restart <app-machine-id>
   ```

3. **Secret configuration:**
   ```bash
   fly secrets list
   fly secrets set MAXIM_SECRET="new-secret-value"
   ```

## Configuration

### Environment Variables

Configure the server using the following environment variables:

- `PORT`: Server port (default: 8000)
- `HOST`: Server host/interface to bind to (default: 0.0.0.0)
- `LOG_LEVEL`: Set logging level (DEBUG, INFO, WARN, ERROR) (default: INFO)
- `MAXIM_SECRET`: **Required** authentication secret for Bearer token auth (minimum 32 characters)

### Rate Limiting

The default rate limit configuration:

- 500 requests per minute
- Burst limit of 25 requests

You can modify these values by editing the `defaultRateLimitConfig` in `src/config/index.ts`:

```typescript
export const defaultRateLimitConfig: RateLimitConfig = {
  requestsPerMinute: 500,
  burstLimit: 25,
} as const;
```

### Process Management

The process manager handles MCP server instances with configurable settings:

- Session timeout: 1 hour
- Cleanup interval: 5 minutes
- Graceful shutdown timeout: 10 seconds

### Command Execution Security

To prevent remote code execution, the proxy implements strict command whitelisting:

- Only pre-approved commands in `src/config/index.ts` can be executed
- Environment variables are protected with a blacklist to prevent overwriting sensitive data
- Each command must be explicitly allowed in the `enabledCommands` map

### Adding New Commands

To add support for new commands:

1. Open `src/config/index.ts`
2. Add your command to the `enabledCommands` object:

```typescript
export const enabledCommands: EnabledCommands = {
  "your-command-string": true,
  "another-command": false, // disabled
  // ... existing commands ...
} as const;
```

Note: Only commands with a value of `true` will be allowed to execute.

## API Endpoints

This proxy implements the standard MCP SSE protocol with an additional authorization header check for security. The `/health` endpoint is available for monitoring service status.

### Health Check

```
GET /health
```

Returns server status and active session count.

### SSE Connection

```
GET /<command>/sse
```

Establishes a Server-Sent Events connection for the specified command.

### Message Posting

```
POST /<command>/message?sessionId=<session_id>
```

Posts a message to an active SSE session.

## Environment Variable Headers

You can pass environment variables to spawned processes via HTTP headers:

```
ENV_API_KEY: your-api-key
ENV_DATABASE_URL: your-database-url
```

The `ENV_` prefix is stripped and the variable is passed to the child process.

### Blacklisted Variables

The following environment variables are blacklisted for security:

- System variables: PATH, HOME, USER, SHELL, PWD
- Temporary directories: TMPDIR, TEMP, TMP
- System info: HOSTNAME, LANG, LC_ALL
- Security: SUDO_USER, SUDO_COMMAND, SSH_AUTH_SOCK, SSH_AGENT_PID
- Credentials: AWS\_\*, API_KEY, SECRET_KEY, PRIVATE_KEY, PASSWORD, TOKEN, MAXIM_SECRET
- Node.js specific: NODE_OPTIONS, NODE_PATH, NPM_TOKEN, YARN_RC_FILENAME, NODE_TLS_REJECT_UNAUTHORIZED

## Connecting to MCP Servers

Here's how to connect to the proxy server once it is deployed:

1. Set up environment variables (if required):

   - Add any required environment variables with the `ENV_` prefix in your request headers
   - Example: For GitHub MCP server, set `ENV_GITHUB_PERSONAL_ACCESS_TOKEN` header

2. Make SSE connection:
   - URL format: `https://<your-domain>/<encoded-command>/sse`
   - Required headers:
     ```
     Authorization: Bearer <your-MAXIM_SECRET>
     ```

### Example: Context7 MCP Server

Using the official MCP TypeScript SDK:

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";

const client = new Client({
  name: "example-client",
  version: "1.0.0",
});

const transport = new SSEClientTransport(new URL("https://<your-domain>/npx%20-y%20%40upstash%2Fcontext7-mcp%40latest/sse"), {
  requestInit: {
    headers: {
      Authorization: `Bearer ${process.env.MAXIM_SECRET}`,
    },
  },
  eventSourceInit: {
    fetch: (url, init) => {
      return fetch(url, {
        ...init,
        headers: init?.headers
          ? {
              ...(init?.headers ?? {}),
              ...{
                Authorization: `Bearer ${process.env.MAXIM_SECRET}`,
              },
            }
          : {
              Authorization: `Bearer ${process.env.MAXIM_SECRET}`,
            },
      });
    },
  },
});

await client.connect(transport);
```

Note: The Context7 MCP server doesn't require any additional environment variables.

## Development

### Available Scripts

```bash
# Start in development mode with hot reload
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Type check only
npm run type-check

# Clean build artifacts
npm run clean
```

### Project Structure

```
.
├── src/
│   ├── config/         # Configuration management and validation
│   ├── middleware/     # Express middleware (auth, security, rate limiting)
│   ├── types/          # TypeScript type definitions and error classes
│   ├── utils/          # Utilities (logger, rate limiter)
│   └── index.ts        # Main application entry point
├── .env.example        # Environment configuration template
├── package.json        # Dependencies and scripts
├── tsconfig.json       # TypeScript configuration
├── Dockerfile          # Multi-stage production container
├── fly.toml            # Fly.io deployment configuration
├── deploy.sh           # Automated deployment script
└── README.md           # This file
```

### Architecture

#### Core Components

1. **Types** (`src/types/`) - TypeScript interfaces and error classes for type safety
2. **Config** (`src/config/`) - Configuration management with environment validation
3. **Utils** (`src/utils/`) - Logger and rate limiter implementations
4. **Middleware** (`src/middleware/`) - Express middleware for auth, security, and rate limiting
5. **Main Server** (`src/index.ts`) - Core server logic and request handling

#### Key Features

##### Process Management

- Automatic cleanup of expired sessions and child processes
- Session-based process tracking with configurable timeouts
- Graceful process termination with fallback handling

##### Security

- Mandatory Bearer token authentication via `MAXIM_SECRET`
- CORS configuration optimized for SSE compatibility
- Security headers (CSP, HSTS, XSS protection, etc.)
- Input validation and command whitelisting
- Non-root container execution
- Environment variable blacklisting

##### Rate Limiting

- Token bucket algorithm per IP address
- Configurable requests per minute and burst limits
- Automatic cleanup of stale rate limit entries

##### Logging

- Structured JSON logging with configurable levels
- Request/response logging with timing information
- Error tracking with stack traces and context

## Type Safety

This implementation prioritizes type safety with:

- Strict TypeScript configuration with comprehensive safety checks
- Readonly interfaces to prevent accidental mutations
- Comprehensive error handling with typed error classes
- Generic types for extensibility and maintainability

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Model Context Protocol](https://modelcontextprotocol.io) - For the standardized protocol that enables AI tool interactions
- [Supergateway](https://github.com/supercorp-ai/supergateway) - For providing the essential MCP stdio to SSE conversion functionality
- [Limiter](https://github.com/jhurliman/node-rate-limiter) - For rate limiting implementation
