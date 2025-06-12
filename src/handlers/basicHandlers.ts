import { Octokit } from "@octokit/rest";
import { z } from "zod";
import {
  TextContent,
  CallToolResult,
} from "@modelcontextprotocol/sdk/types";
import {
  SegmentEvent,
  EventImprovement,
  EventDocumentation,
} from "../types";
import {
  extractSegmentEvents,
  analyzeEvents,
} from "../utils/eventExtraction";

// Schema definitions
const AnalyzePREventsSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  pull_number: z.number(),
});

const ExtractEventsSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  path: z.string(),
  ref: z.string().optional().default("main"),
});

const SuggestImprovementsSchema = z.object({
  events: z.array(
    z.object({
      name: z.string(),
      properties: z.record(z.unknown()).optional(),
    })
  ),
});

const CreateDocumentationSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  events: z.array(
    z.object({
      name: z.string(),
      properties: z.record(z.unknown()).optional(),
      description: z.string().optional(),
    })
  ),
});

const ValidateEventSchemaSchema = z.object({
  events: z.array(
    z.object({
      name: z.string(),
      properties: z.record(z.unknown()).optional(),
    })
  ),
});

export const SearchOrgEventSchema = z.object({
  org: z.string(),
  event_name: z.string(),
  include_patterns: z
    .array(z.string())
    .optional()
    .default(["*.js", "*.ts", "*.jsx", "*.tsx", "*.vue"]),
  exclude_patterns: z
    .array(z.string())
    .optional()
    .default(["node_modules/", "dist/", "build/", ".git/"]),
  max_repos: z.number().optional().default(50),
});

// Handler functions
export async function analyzePREventsHandler(
  octokit: Octokit,
  args: unknown
): Promise<CallToolResult> {
  const { owner, repo, pull_number } = AnalyzePREventsSchema.parse(args);

  try {
    console.error(`Analyzing PR #${pull_number} in ${owner}/${repo}`);

    // Get PR files
    const { data: files } = await octokit.pulls.listFiles({
      owner,
      repo,
      pull_number,
    });

    console.error(`Found ${files.length} files in PR`);

    const changedEvents: SegmentEvent[] = [];

    for (const file of files) {
      if (file.status === "removed") continue;

      try {
        const { data: fileContent } = await octokit.repos.getContent({
          owner,
          repo,
          path: file.filename,
          ref: `refs/pull/${pull_number}/head`,
        });

        if ("content" in fileContent) {
          const content = Buffer.from(fileContent.content, "base64").toString();
          const events = extractSegmentEvents(content, file.filename);
          changedEvents.push(...events);

          if (events.length > 0) {
            console.error(`Found ${events.length} events in ${file.filename}`);
          }
        }
      } catch (error) {
        console.error(`Error processing file ${file.filename}:`, error);
      }
    }

    const analysis = analyzeEvents(changedEvents);

    const result = {
      pr_number: pull_number,
      total_events: changedEvents.length,
      events: changedEvents,
      analysis,
    };

    console.error(`PR analysis complete: ${changedEvents.length} events found`);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result, null, 2),
        } as TextContent,
      ],
      isError: false,
    };
  } catch (error) {
    console.error("Error in analyzePREventsHandler:", error);
    throw error;
  }
}

export async function extractEventsFromFileHandler(
  octokit: Octokit,
  args: unknown
): Promise<CallToolResult> {
  const { owner, repo, path, ref } = ExtractEventsSchema.parse(args);

  try {
    console.error(`Extracting events from ${path} in ${owner}/${repo}@${ref}`);

    const { data: fileContent } = await octokit.repos.getContent({
      owner,
      repo,
      path,
      ref,
    });

    if (!("content" in fileContent)) {
      throw new Error("File not found or is a directory");
    }

    const content = Buffer.from(fileContent.content, "base64").toString();
    const events = extractSegmentEvents(content, path);

    console.error(`Found ${events.length} events in ${path}`);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              file: path,
              total_events: events.length,
              events,
            },
            null,
            2
          ),
        } as TextContent,
      ],
      isError: false,
    };
  } catch (error) {
    console.error("Error in extractEventsFromFileHandler:", error);
    throw error;
  }
}

export async function suggestEventImprovementsHandler(
  args: unknown
): Promise<CallToolResult> {
  const { events } = SuggestImprovementsSchema.parse(args);

  try {
    console.error(`Suggesting improvements for ${events.length} events`);

    const improvements: EventImprovement[] = events.map((event) => {
      const suggestions: string[] = [];
      let improvedName = event.name;
      const improvedProperties: Record<string, unknown> = {
        ...event.properties,
      };

      // Naming improvements
      if (!event.name.match(/^[A-Z][a-zA-Z\s]*$/)) {
        improvedName = event.name
          .split(/[\s_-]+/)
          .map(
            (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
          )
          .join(" ");
        suggestions.push(`Rename to: "${improvedName}"`);
      }

      // Property improvements
      const props = Object.keys(event.properties || {});

      if (props.length === 0) {
        suggestions.push(
          "Consider adding contextual properties like userId, timestamp, or relevant business metrics"
        );
      }

      // Convert snake_case to camelCase
      const snakeCaseProps = props.filter((p) => p.includes("_"));
      if (snakeCaseProps.length > 0) {
        snakeCaseProps.forEach((prop) => {
          const camelCase = prop.replace(/_([a-z])/g, (_, letter) =>
            letter.toUpperCase()
          );
          improvedProperties[camelCase] = improvedProperties[prop];
          delete improvedProperties[prop];
        });
        suggestions.push(`Convert to camelCase: ${snakeCaseProps.join(", ")}`);
      }

      // Suggest standard properties if missing
      const standardProps = ["userId", "timestamp", "source"];
      const missingStandardProps = standardProps.filter(
        (prop) =>
          !props.some((p) => p.toLowerCase().includes(prop.toLowerCase()))
      );

      if (missingStandardProps.length > 0) {
        suggestions.push(`Consider adding: ${missingStandardProps.join(", ")}`);
      }

      return {
        event: event.name,
        suggestions,
        improvedName: improvedName,
        improvedProperties: improvedProperties,
      };
    });

    console.error(`Generated improvements for ${improvements.length} events`);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ improvements }, null, 2),
        } as TextContent,
      ],
      isError: false,
    };
  } catch (error) {
    console.error("Error in suggestEventImprovementsHandler:", error);
    throw error;
  }
}

export async function createEventDocumentationHandler(
  args: unknown
): Promise<CallToolResult> {
  const { owner, repo, events } = CreateDocumentationSchema.parse(args);

  try {
    console.error(`Creating documentation for ${events.length} events`);

    const documentation: EventDocumentation[] = events.map((event) => ({
      name: event.name,
      description:
        event.description || `Tracks when ${event.name.toLowerCase()} occurs`,
      properties: Object.entries(event.properties || {}).map(
        ([key, value]) => ({
          name: key,
          type: getPropertyType(value),
          example: value,
          required: true, // Default to required, could be made configurable
          description: generatePropertyDescription(key, value),
        })
      ),
    }));

    const markdownDoc = generateMarkdownDocumentation(documentation);

    console.error(`Generated documentation for ${documentation.length} events`);

    return {
      content: [
        {
          type: "text",
          text: markdownDoc,
        } as TextContent,
      ],
      isError: false,
    };
  } catch (error) {
    console.error("Error in createEventDocumentationHandler:", error);
    throw error;
  }
}

export async function validateEventSchemaHandler(
  args: unknown
): Promise<CallToolResult> {
  const { events } = ValidateEventSchemaSchema.parse(args);

  try {
    console.error(`Validating schema for ${events.length} events`);

    const validationResults = events.map((event) => {
      const errors: string[] = [];
      const warnings: string[] = [];

      // Required field validation
      if (!event.name || event.name.trim().length === 0) {
        errors.push("Event name is required");
      }

      // Property validation
      const props = event.properties || {};
      Object.entries(props).forEach(([key, value]) => {
        // Check for null/undefined values
        if (value === null || value === undefined) {
          warnings.push(`Property "${key}" has null/undefined value`);
        }

        // Check for empty strings
        if (typeof value === "string" && value.trim().length === 0) {
          warnings.push(`Property "${key}" is an empty string`);
        }

        // Check for very long property names
        if (key.length > 50) {
          warnings.push(
            `Property "${key}" has a very long name (${key.length} characters)`
          );
        }
      });

      return {
        event: event.name,
        valid: errors.length === 0,
        errors,
        warnings,
      };
    });

    const validCount = validationResults.filter((r) => r.valid).length;
    console.error(
      `Validation complete: ${validCount}/${events.length} events valid`
    );

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ validation: validationResults }, null, 2),
        } as TextContent,
      ],
      isError: false,
    };
  } catch (error) {
    console.error("Error in validateEventSchemaHandler:", error);
    throw error;
  }
}

// Helper functions
function getPropertyType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function generatePropertyDescription(key: string, value: unknown): string {
  // Generate smart descriptions based on common property patterns
  const lowerKey = key.toLowerCase();

  if (lowerKey.includes("id"))
    return `Unique identifier for ${key.replace(/id$/i, "").toLowerCase()}`;
  if (lowerKey.includes("time") || lowerKey.includes("date"))
    return "Timestamp of the event";
  if (lowerKey.includes("count") || lowerKey.includes("number"))
    return `Number of ${key.replace(/count$/i, "").toLowerCase()}`;
  if (lowerKey.includes("email")) return "Email address";
  if (lowerKey.includes("name"))
    return `Name of the ${key.replace(/name$/i, "").toLowerCase()}`;
  if (typeof value === "boolean") return `Whether ${key} is true or false`;

  return `${key} property`;
}

function generateMarkdownDocumentation(events: EventDocumentation[]): string {
  let markdown = "# Segment Events Documentation\n\n";
  markdown += "This documentation was auto-generated from your codebase.\n\n";

  events.forEach((event) => {
    markdown += `## ${event.name}\n\n`;
    markdown += `${event.description}\n\n`;

    if (event.properties.length > 0) {
      markdown += "### Properties\n\n";
      markdown += "| Property | Type | Required | Description | Example |\n";
      markdown += "|----------|------|----------|-------------|----------|\n";

      event.properties.forEach((prop) => {
        const example =
          typeof prop.example === "string"
            ? `"${prop.example}"`
            : JSON.stringify(prop.example);
        markdown += `| \`${prop.name}\` | ${prop.type} | ${
          prop.required ? "✓" : "○"
        } | ${prop.description} | \`${example}\` |\n`;
      });
    } else {
      markdown += "*No properties defined for this event.*\n";
    }

    markdown += "\n---\n\n";
  });

  return markdown;
}
