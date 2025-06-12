import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import { EnhancedGitHubSegmentMCP } from "./index";

const app = express();
const port = process.env.PORT || 3000;

// Instantiate MCP server (same tool definitions) once for all requests
const mcp = new EnhancedGitHubSegmentMCP();
const mcpServer = mcp.getServer();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS middleware
app.use((req: Request, res: Response, next: NextFunction) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept, Authorization"
  );

  if (req.method === "OPTIONS") {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Health check endpoint
app.get("/health", (req: Request, res: Response) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
  });
});

// Main endpoint
app.get("/", (req: Request, res: Response) => {
  res.json({
    message: "Enhanced Segment Analytics MCP Server",
    version: "2.0.0",
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || "development",
    endpoints: {
      health: "/health",
      tools: "/tools",
    },
  });
});

// MCP tools endpoint
app.get("/tools", (req: Request, res: Response) => {
  res.json({
    tools: [
      {
        name: "scan_repo_events",
        description: "Scans a repository for event usage.",
      },
      {
        name: "extract_events_from_file",
        description: "Extracts analytics events from a file.",
      },
      {
        name: "analyze_pr_events",
        description: "Analyzes pull requests for event changes.",
      },
      {
        name: "suggest_event_improvements",
        description: "Suggests improvements for detected events.",
      },
      {
        name: "create_event_documentation",
        description: "Generates documentation for analytics events.",
      },
      {
        name: "validate_event_schema",
        description: "Validates events against the analytics schema.",
      },
      {
        name: "search_org_event",
        description: "Searches an organization for specific events.",
      },
    ],
  });
});

// MCP tools endpoint
app.post("/tools", (req: Request, res: Response) => {
  res.json({
    message: "MCP tools endpoint",
    availableTools: [
      "scan_repo_events",
      "extract_events_from_file",
      "analyze_pr_events",
      "suggest_event_improvements",
      "create_event_documentation",
      "validate_event_schema",
      "search_org_event",
    ],
  });
});

// JSON-RPC endpoint for MCP
app.post("/service/request", async (req: Request, res: Response) => {
  try {
    // @ts-ignore - handleRequest is available at runtime but not in type defs
    const result = await (mcpServer as any).handleRequest(req.body);
    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

// Start server
const server = app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
  console.log(`🏥 Health check: http://localhost:${port}/health`);
  console.log(`🏠 Main endpoint: http://localhost:${port}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || "development"}`);
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM signal received: closing HTTP server");
  server.close(() => {
    console.log("HTTP server closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("SIGINT signal received: closing HTTP server");
  server.close(() => {
    console.log("HTTP server closed");
    process.exit(0);
  });
});
