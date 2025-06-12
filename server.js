require("dotenv").config();
const express = require("express");

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// CORS middleware
app.use((req, res, next) => {
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

// Initialize MCP server (lazy loading to avoid module issues)
let mcpServer = null;
let EnhancedGitHubSegmentMCP = null;

const initializeMCP = async () => {
  if (!mcpServer) {
    try {
      // Lazy load the MCP module
      const mcpModule = require("./dist/src/index");
      EnhancedGitHubSegmentMCP = mcpModule.EnhancedGitHubSegmentMCP;

      if (EnhancedGitHubSegmentMCP) {
        mcpServer = new EnhancedGitHubSegmentMCP();
        console.log("MCP server initialized successfully");
      } else {
        console.log("MCP server not available, running in simple mode");
      }
    } catch (error) {
      console.error("Failed to initialize MCP server:", error.message);
      console.log("Running in simple mode without MCP features");
    }
  }
  return mcpServer;
};

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    timestamp: new Date().toISOString(),
    mcpAvailable: mcpServer !== null,
  });
});

// Main endpoint
app.get("/", async (req, res) => {
  try {
    await initializeMCP();
    res.json({
      message: "Enhanced Segment Analytics MCP Server is running",
      version: "2.0.0",
      timestamp: new Date().toISOString(),
      mcpEnabled: mcpServer !== null,
      environment: process.env.NODE_ENV || "development",
    });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// MCP tools endpoint
app.post("/tools", async (req, res) => {
  try {
    await initializeMCP();

    if (!mcpServer) {
      return res.status(503).json({
        error: "MCP features not available",
        message:
          "The server is running in simple mode without MCP functionality",
      });
    }

    // Here you can implement specific tool handling
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
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Start server
app.listen(port, "0.0.0.0", () => {
  console.log(`Server running on port ${port}`);
  console.log(`Health check: http://localhost:${port}/health`);
  console.log(`Environment: ${process.env.NODE_ENV || "development"}`);

  // Try to initialize MCP in the background
  initializeMCP().catch((err) => {
    console.log("MCP initialization deferred:", err.message);
  });
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("Received SIGTERM, shutting down gracefully");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("Received SIGINT, shutting down gracefully");
  process.exit(0);
});
