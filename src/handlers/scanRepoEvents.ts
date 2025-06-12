import { Octokit } from "@octokit/rest";
import { z } from "zod";
import {
  TextContent,
  CallToolResult,
} from "@modelcontextprotocol/sdk/types";
import { SegmentEvent, EventAnalysis } from "../types";
import {
  extractSegmentEvents,
  analyzeEvents,
} from "../utils/eventExtraction";
import { generateEventSummary } from "../utils/eventSummary";

const ScanRepoEventsSchema = z.object({
  owner: z.string(),
  repo: z.string(),
  ref: z.string().optional().default("main"),
  include_patterns: z
    .array(z.string())
    .optional()
    .default(["*.js", "*.ts", "*.jsx", "*.tsx", "*.vue"]),
  exclude_patterns: z
    .array(z.string())
    .optional()
    .default(["node_modules/", "dist/", "build/", ".git/"]),
});

export async function scanRepoEventsHandler(
  octokit: Octokit,
  args: unknown
): Promise<CallToolResult> {
  const { owner, repo, ref, include_patterns, exclude_patterns } =
    ScanRepoEventsSchema.parse(args);

  try {
    console.error(`Starting repository scan for ${owner}/${repo}@${ref}`);

    // Get repository tree recursively
    const { data: tree } = await octokit.git.getTree({
      owner,
      repo,
      tree_sha: ref,
      recursive: "true",
    });

    console.error(`Found ${tree.tree.length} total files in repository`);

    const allEvents: SegmentEvent[] = [];
    const processedFiles: string[] = [];
    const errorFiles: string[] = [];

    // Filter files based on patterns
    const relevantFiles = tree.tree.filter((item) => {
      if (item.type !== "blob" || !item.path) return false;

      // Check exclude patterns
      if (
        exclude_patterns.some((pattern) =>
          item.path!.includes(pattern.replace("*", ""))
        )
      )
        return false;

      // Check include patterns
      return include_patterns.some((pattern) => {
        const regex = new RegExp(pattern.replace("*", ".*"));
        return regex.test(item.path!);
      });
    });

    console.error(`Filtered to ${relevantFiles.length} relevant files`);

    // Process files in batches to avoid rate limits
    const batchSize = 10;
    for (let i = 0; i < relevantFiles.length; i += batchSize) {
      const batch = relevantFiles.slice(i, i + batchSize);
      console.error(
        `Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(
          relevantFiles.length / batchSize
        )}`
      );

      await Promise.all(
        batch.map(async (file) => {
          try {
            const { data: fileContent } = await octokit.repos.getContent({
              owner,
              repo,
              path: file.path!,
              ref,
            });

            if ("content" in fileContent) {
              const content = Buffer.from(
                fileContent.content,
                "base64"
              ).toString();
              const events = extractSegmentEvents(content, file.path!);
              allEvents.push(...events);
              processedFiles.push(file.path!);

              if (events.length > 0) {
                console.error(`Found ${events.length} events in ${file.path}`);
              }
            }
          } catch (error) {
            console.error(`Error processing file ${file.path}:`, error);
            errorFiles.push(file.path!);
          }
        })
      );
    }

    // Analyze and categorize events
    console.error(`Processing ${allEvents.length} total events found`);
    const eventSummary = generateEventSummary(allEvents);
    const analysis = analyzeEvents(allEvents);

    const result = {
      repository: `${owner}/${repo}`,
      ref,
      scan_results: {
        total_files_scanned: processedFiles.length,
        total_events_found: allEvents.length,
        unique_event_names: [...new Set(allEvents.map((e) => e.name))].length,
        files_with_errors: errorFiles.length,
      },
      event_summary: eventSummary,
      all_events: allEvents,
      analysis,
      processed_files: processedFiles,
      error_files: errorFiles,
    };

    console.error(
      `Scan complete: ${allEvents.length} events found in ${processedFiles.length} files`
    );

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
    console.error("Error in scanRepoEventsHandler:", error);
    throw error;
  }
}
