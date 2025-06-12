#!/usr/bin/env node

import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
  TextContent,
  CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";
import { Octokit } from "@octokit/rest";
import { z } from "zod";

// Import our modular handlers
import { scanRepoEventsHandler } from "./handlers/scanRepoEvents.js";

// Import types
import {
  SegmentEvent,
  EventAnalysis,
  EventImprovement,
  EventDocumentation,
} from "./types.js";

import {
  extractEventsFromFileHandler,
  analyzePREventsHandler,
  suggestEventImprovementsHandler,
  createEventDocumentationHandler,
  validateEventSchemaHandler,
} from "./handlers/index.js";
import { searchOrgEvent } from "./handlers/repoWithEventHandler.js";

export class EnhancedGitHubSegmentMCP {
  private server: Server;
  private octokit: Octokit;

  constructor() {
    this.server = new Server(
      {
        name: "enhanced-github-segment-events",
        version: "2.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    const token = process.env.GITHUB_TOKEN;
    if (!token) {
      throw new Error("GITHUB_TOKEN environment variable is required");
    }

    this.octokit = new Octokit({
      auth: token,
    });

    this.setupTools();
    this.setupRequestHandlers();
  }

  private setupTools(): void {
    const tools: Tool[] = [
      // PRIORITY 1: Core scanning functionality
      {
        name: "scan_repo_events",
        description:
          "Scan entire repository for all segment events across all files",
        inputSchema: {
          type: "object",
          properties: {
            owner: { type: "string", description: "Repository owner" },
            repo: { type: "string", description: "Repository name" },
            ref: {
              type: "string",
              description: "Git reference (branch/commit)",
              default: "main",
            },
            include_patterns: {
              type: "array",
              items: { type: "string" },
              description:
                "File patterns to include (e.g., ['*.js', '*.ts', '*.jsx'])",
              default: ["*.js", "*.ts", "*.jsx", "*.tsx", "*.vue"],
            },
            exclude_patterns: {
              type: "array",
              items: { type: "string" },
              description:
                "File patterns to exclude (e.g., ['node_modules/', 'dist/'])",
              default: ["node_modules/", "dist/", "build/", ".git/"],
            },
          },
          required: ["owner", "repo"],
        },
      },

      // PRIORITY 2: Basic existing functionality
      {
        name: "extract_events_from_file",
        description: "Extract segment events from a specific file",
        inputSchema: {
          type: "object",
          properties: {
            owner: { type: "string", description: "Repository owner" },
            repo: { type: "string", description: "Repository name" },
            path: { type: "string", description: "File path" },
            ref: {
              type: "string",
              description: "Git reference (branch/commit)",
              default: "main",
            },
          },
          required: ["owner", "repo", "path"],
        },
      },

      {
        name: "analyze_pr_events",
        description:
          "Analyze segment events in a GitHub PR and suggest improvements",
        inputSchema: {
          type: "object",
          properties: {
            owner: { type: "string", description: "Repository owner" },
            repo: { type: "string", description: "Repository name" },
            pull_number: { type: "number", description: "PR number" },
          },
          required: ["owner", "repo", "pull_number"],
        },
      },

      {
        name: "suggest_event_improvements",
        description:
          "Suggest improvements for segment event naming and properties",
        inputSchema: {
          type: "object",
          properties: {
            events: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  properties: { type: "object" },
                },
                required: ["name"],
              },
            },
          },
          required: ["events"],
        },
      },

      {
        name: "create_event_documentation",
        description: "Generate documentation for segment events",
        inputSchema: {
          type: "object",
          properties: {
            owner: { type: "string", description: "Repository owner" },
            repo: { type: "string", description: "Repository name" },
            events: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  properties: { type: "object" },
                  description: { type: "string" },
                },
                required: ["name"],
              },
            },
          },
          required: ["owner", "repo", "events"],
        },
      },

      {
        name: "validate_event_schema",
        description: "Validate segment events against common schema patterns",
        inputSchema: {
          type: "object",
          properties: {
            events: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  properties: { type: "object" },
                },
                required: ["name"],
              },
            },
          },
          required: ["events"],
        },
      },
      {
        name: "search_org_event",
        description:
          "Search for a specific analytics event across all repositories in an organization",
        inputSchema: {
          type: "object",
          properties: {
            org: { type: "string", description: "Organization name" },
            event_name: {
              type: "string",
              description: "Specific event name to search for",
            },
            include_patterns: {
              type: "array",
              items: { type: "string" },
              description: "File patterns to include",
              default: ["*.js", "*.ts", "*.jsx", "*.tsx", "*.vue"],
            },
            exclude_patterns: {
              type: "array",
              items: { type: "string" },
              description: "File patterns to exclude",
              default: ["node_modules/", "dist/", "build/", ".git/"],
            },
            max_repos: {
              type: "number",
              description: "Maximum number of repositories to scan",
              default: 50,
            },
          },
          required: ["org", "event_name"],
        },
      },
    ];

    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools,
    }));
  }

  private setupRequestHandlers(): void {
    this.server.setRequestHandler(
      CallToolRequestSchema,
      async (request): Promise<CallToolResult> => {
        const { name, arguments: args } = request.params;

        try {
          switch (name) {
            // PRIORITY 1: Core scanning
            case "scan_repo_events":
              return await scanRepoEventsHandler(this.octokit, args);
            case "search_org_event":
              return await searchOrgEvent(this.octokit, args);

            // PRIORITY 2: Basic functionality
            case "extract_events_from_file":
              return await extractEventsFromFileHandler(this.octokit, args);
            case "analyze_pr_events":
              return await analyzePREventsHandler(this.octokit, args);
            case "suggest_event_improvements":
              return await suggestEventImprovementsHandler(args);
            case "create_event_documentation":
              return await createEventDocumentationHandler(args);
            case "validate_event_schema":
              return await validateEventSchemaHandler(args);

            default:
              throw new Error(`Unknown tool: ${name}`);
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          return {
            content: [
              {
                type: "text",
                text: `Error: ${errorMessage}`,
              } as TextContent,
            ],
            isError: true,
          };
        }
      }
    );
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    // Log to stderr to avoid interfering with stdio transport
    console.error("Enhanced GitHub Segment Events MCP Server running");
    console.error(
      `Using GitHub token: ${process.env.GITHUB_TOKEN?.substring(0, 4)}...`
    );
  }

  public getServer(): Server {
    return this.server;
  }
}

// Handle process termination gracefully
process.on("SIGINT", () => {
  console.error("\nReceived SIGINT, shutting down gracefully");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.error("\nReceived SIGTERM, shutting down gracefully");
  process.exit(0);
});

// Handle uncaught errors
process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled rejection at:", promise, "reason:", reason);
  process.exit(1);
});

// Run the server
if (require.main === module) {
  const server = new EnhancedGitHubSegmentMCP();
  server.run().catch((error) => {
    console.error("Failed to start server:", error);
    process.exit(1);
  });
}
