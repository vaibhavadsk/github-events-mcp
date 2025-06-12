import { CallToolResult, TextContent } from "@modelcontextprotocol/sdk/types";
import { SearchOrgEventSchema } from "./basicHandlers";
import { SegmentEvent } from "../types";
import { Octokit } from "@octokit/rest";
import { extractSegmentEvents } from "../utils/eventExtraction";

export async function searchOrgEvent(
  octokit: Octokit,
  args: unknown
): Promise<CallToolResult> {
  const { org, event_name, include_patterns, exclude_patterns, max_repos } =
    SearchOrgEventSchema.parse(args);

  console.error(
    `Starting conservative search for event: "${event_name}" in ${org}`
  );

  // PHASE 1: Try exact match first
  console.error("🎯 PHASE 1: Exact match search...");
  const exactMatchRepos = await findReposWithExactMatch(
    org,
    event_name,
    max_repos,
    octokit
  );

  if (exactMatchRepos.length > 0) {
    console.error(
      `✅ Found ${exactMatchRepos.length} repositories with exact match!`
    );

    // Scan the exact match repositories
    const orgResults: any[] = [];
    const processedRepos: string[] = [];
    const errorRepos: string[] = [];

    for (const repo of exactMatchRepos) {
      try {
        console.error(`Scanning repository: ${repo.name}`);

        const repoEvents = await scanRepoForSpecificEvent(
          org,
          repo.name,
          event_name,
          repo.default_branch || "main",
          include_patterns,
          exclude_patterns,
          octokit
        );

        if (repoEvents.length > 0) {
          orgResults.push({
            repository: repo.name,
            default_branch: repo.default_branch,
            events_found: repoEvents.length,
            events: repoEvents,
            repo_url: repo.html_url,
            last_updated: repo.updated_at,
            search_strategy: repo._search_strategy || "exact",
          });
        }

        processedRepos.push(repo.name);
      } catch (error) {
        console.error(`Error scanning repo ${repo.name}:`, error);
        errorRepos.push(repo.name);
      }
    }

    // Analyze cross-repo patterns
    const crossRepoAnalysis = analyzeCrossRepoPatterns(orgResults, event_name);

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              search_query: {
                organization: org,
                event_name: event_name,
                search_phase: "exact_match_success",
                repositories_searched: processedRepos.length,
                repositories_with_event: orgResults.length,
              },
              cross_repo_summary: crossRepoAnalysis,
              repository_results: orgResults,
              processed_repositories: processedRepos,
              error_repositories: errorRepos,
            },
            null,
            2
          ),
        } as TextContent,
      ],
      isError: false,
    };
  }

  // PHASE 2: No exact matches found, show available repositories
  console.error("❌ No exact matches found.");
  console.error("🔍 PHASE 2: Discovering available repositories...");

  const availableRepos = await listAvailableRepos(org, max_repos, octokit);
  console.error(
    `Found ${availableRepos.length} available repositories in ${org}`
  );

  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            search_query: {
              organization: org,
              event_name: event_name,
              search_phase: "exact_match_failed",
              repositories_searched: 0,
              repositories_with_event: 0,
            },
            exact_match_result: {
              found: false,
              message: `No repositories found containing the exact event: "${event_name}"`,
            },
            available_repositories: {
              total_found: availableRepos.length,
              repositories: availableRepos.map((repo) => ({
                name: repo.name,
                language: repo.language,
                description: repo.description,
                last_updated: repo.updated_at,
                url: repo.html_url,
                is_archived: repo.archived,
                default_branch: repo.default_branch,
              })),
            },
            next_steps: {
              message: "Would you like to proceed with a broader search?",
              options: [
                {
                  action: "token_search",
                  description:
                    "Search for individual keywords from the event name",
                  estimated_api_calls: `~${Math.min(
                    10,
                    availableRepos.length
                  )} calls`,
                  keywords_to_search: extractSearchTokens(event_name),
                },
                {
                  action: "scan_specific_repos",
                  description: "Scan specific repositories for all events",
                  estimated_api_calls: "1 call per repository",
                  suggested_repos: availableRepos
                    .filter(
                      (repo) =>
                        repo.name.toLowerCase().includes("analytics") ||
                        repo.name.toLowerCase().includes("tracking") ||
                        repo.name.toLowerCase().includes("event") ||
                        repo.language === "TypeScript" ||
                        repo.language === "JavaScript"
                    )
                    .slice(0, 5)
                    .map((repo) => repo.name),
                },
                {
                  action: "manual_inspection",
                  description: "Manually inspect the most likely repositories",
                  suggested_repos: availableRepos
                    .filter((repo) => !repo.archived)
                    .sort(
                      (a, b) =>
                        new Date(b.updated_at).getTime() -
                        new Date(a.updated_at).getTime()
                    )
                    .slice(0, 3)
                    .map((repo) => ({
                      name: repo.name,
                      reason: "Most recently updated",
                    })),
                },
              ],
            },
          },
          null,
          2
        ),
      } as TextContent,
    ],
    isError: false,
  };
}

// New function for exact match only
export async function findReposWithExactMatch(
  org: string,
  eventName: string,
  maxRepos: number,
  octokit: Octokit
): Promise<any[]> {
  const repos: any[] = [];

  try {
    console.error(`Searching for exact match: "${eventName}"`);
    const exactSearchQuery = `"${eventName}" org:${org} extension:js OR extension:ts OR extension:jsx OR extension:tsx`;

    const { data: exactResults } = await octokit.search.code({
      q: exactSearchQuery,
      per_page: 100,
    });

    exactResults.items.forEach((item) => {
      if (
        item.repository &&
        !repos.find((r) => r.name === item.repository.name)
      ) {
        repos.push({ ...item.repository, _search_strategy: "exact" });
      }
    });

    console.error(`Exact search found ${repos.length} repositories`);
    return repos.slice(0, maxRepos);
  } catch (error) {
    console.error(
      "Exact search failed:",
      error instanceof Error ? error.message : String(error)
    );
    return [];
  }
}

// New function to list available repositories
async function listAvailableRepos(
  org: string,
  maxRepos: number,
  octokit: Octokit
): Promise<any[]> {
  try {
    const { data: orgRepos } = await octokit.repos.listForOrg({
      org,
      type: "all",
      per_page: Math.min(maxRepos, 100),
    });

    // Filter for repos that might contain code
    const codeRepos = orgRepos.filter(
      (repo) =>
        repo.language === "JavaScript" ||
        repo.language === "TypeScript" ||
        repo.language === "Vue" ||
        repo.language === "React" ||
        repo.language === null ||
        repo.name.toLowerCase().includes("analytics") ||
        repo.name.toLowerCase().includes("tracking") ||
        repo.name.toLowerCase().includes("event")
    );

    console.error(
      `Found ${codeRepos.length} potentially relevant repositories`
    );
    return codeRepos;
  } catch (error) {
    console.error(
      "Failed to list organization repositories:",
      error instanceof Error ? error.message : String(error)
    );
    return [];
  }
}

// Helper function to extract meaningful search tokens
function extractSearchTokens(eventName: string): string[] {
  const tokens = [];

  // Split by common delimiters
  const words = eventName
    .split(/[\s\-_\.]+/)
    .filter((word) => word.length >= 3) // Only meaningful words
    .map((word) => word.toLowerCase());

  // Add individual words
  tokens.push(...words);

  // Add camelCase splits
  const camelCaseSplit = eventName
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();
  const camelWords = camelCaseSplit
    .split(/\s+/)
    .filter((word) => word.length >= 3);
  tokens.push(...camelWords);

  // Remove duplicates and common words
  const stopWords = [
    "the",
    "and",
    "or",
    "but",
    "for",
    "with",
    "from",
    "into",
    "over",
  ];
  return [...new Set(tokens)].filter((token) => !stopWords.includes(token));
}

async function scanRepoForSpecificEvent(
  owner: string,
  repo: string,
  targetEvent: string,
  ref: string,
  includePatterns: string[],
  excludePatterns: string[],
  octokit: Octokit
): Promise<SegmentEvent[]> {
  const matchingEvents: SegmentEvent[] = [];

  // Try multiple branch names if the default fails
  const branchesToTry = [
    ref,
    "main",
    "master",
    "develop",
    "development",
    "staging",
  ];
  let successfulBranch = null;
  let repoTree = null;

  for (const branch of branchesToTry) {
    try {
      console.error(`  Trying branch: ${branch}`);
      const { data: tree } = await octokit.git.getTree({
        owner,
        repo,
        tree_sha: branch,
        recursive: "true",
      });

      repoTree = tree;
      successfulBranch = branch;
      console.error(
        `  ✅ Successfully accessed repository on branch: ${branch}`
      );
      break;
    } catch (error) {
      console.error(
        `  ❌ Branch '${branch}' failed:`,
        error instanceof Error ? error.message : String(error)
      );
      continue;
    }
  }

  if (!repoTree) {
    console.error(
      `  ❌ Could not access repository ${owner}/${repo} on any branch`
    );
    throw new Error(
      `Repository ${owner}/${repo} is not accessible. It might be private or you may lack permissions.`
    );
  }

  try {
    // Filter relevant files with smarter prioritization
    const allFiles = repoTree.tree.filter((item) => {
      if (item.type !== "blob" || !item.path) return false;

      // Check exclude patterns
      if (
        excludePatterns.some((pattern) =>
          item.path!.includes(pattern.replace("*", ""))
        )
      )
        return false;

      // Check include patterns
      return includePatterns.some((pattern) => {
        const regex = new RegExp(pattern.replace("*", ".*"));
        return regex.test(item.path!);
      });
    });

    // Smart prioritization: files most likely to contain the target event
    const prioritizedFiles = allFiles.sort((a, b) => {
      const pathA = a.path!.toLowerCase();
      const pathB = b.path!.toLowerCase();
      const targetLower = targetEvent.toLowerCase();

      // Priority scoring
      let scoreA = 0;
      let scoreB = 0;

      // Highest priority: files with similar names to the event
      const eventWords = targetEvent
        .toLowerCase()
        .split(/[\s\-_\.]+/)
        .filter((w) => w.length > 2);
      eventWords.forEach((word) => {
        if (pathA.includes(word)) scoreA += 10;
        if (pathB.includes(word)) scoreB += 10;
      });

      // High priority: component/dialog/modal files
      if (pathA.includes("dialog") || pathA.includes("modal")) scoreA += 8;
      if (pathB.includes("dialog") || pathB.includes("modal")) scoreB += 8;

      // Medium priority: analytics/tracking files
      if (
        pathA.includes("analytic") ||
        pathA.includes("track") ||
        pathA.includes("event")
      )
        scoreA += 5;
      if (
        pathB.includes("analytic") ||
        pathB.includes("track") ||
        pathB.includes("event")
      )
        scoreB += 5;

      // Lower priority for test files, config files, etc.
      if (pathA.includes("test") || pathA.includes("spec")) scoreA -= 3;
      if (pathB.includes("test") || pathB.includes("spec")) scoreB -= 3;

      return scoreB - scoreA; // Higher score first
    });

    console.error(
      `  Found ${allFiles.length} relevant files, prioritized for smart scanning`
    );

    // Process high-priority files first with a smaller batch size
    const batchSize = 5; // Smaller to respect rate limits
    let foundEvents = 0;
    const maxFilesToScan = 50; // Limit initial scan to most promising files

    const filesToScan = prioritizedFiles.slice(0, maxFilesToScan);
    console.error(
      `  Scanning top ${filesToScan.length} prioritized files for target event`
    );

    for (let i = 0; i < filesToScan.length; i += batchSize) {
      const batch = filesToScan.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async (file) => {
          try {
            const { data: fileContent } = await octokit.repos.getContent({
              owner,
              repo,
              path: file.path!,
              ref: successfulBranch!,
            });

            if ("content" in fileContent) {
              const content = Buffer.from(
                fileContent.content,
                "base64"
              ).toString();

              // Quick check if file contains the target event string
              if (content.includes(targetEvent)) {
                console.error(`  🎯 FOUND target event in: ${file.path}`);
                const events = extractSegmentEvents(content, file.path!);

                // Filter events that match our target
                const targetEvents = events.filter(
                  (event) =>
                    event.name === targetEvent ||
                    event.name.includes(targetEvent) ||
                    targetEvent.includes(event.name)
                );

                if (targetEvents.length > 0) {
                  foundEvents += targetEvents.length;
                  matchingEvents.push(...targetEvents);
                  console.error(
                    `  ✅ Added ${targetEvents.length} matching events from ${file.path}`
                  );
                }
              }
            }
          } catch (fileError) {
            console.error(
              `  ⚠️  Error processing file ${file.path}:`,
              fileError instanceof Error ? fileError.message : String(fileError)
            );
          }
        })
      );

      // Longer delay between batches to respect rate limits
      if (i + batchSize < filesToScan.length) {
        await new Promise((resolve) => setTimeout(resolve, 500)); // Increased delay
      }

      // Early exit if we found what we're looking for
      if (foundEvents > 0) {
        console.error(
          `  🎉 Found ${foundEvents} target events, stopping early scan`
        );
        break;
      }
    }

    console.error(`  📊 Total matching events found: ${matchingEvents.length}`);
    return matchingEvents;
  } catch (error) {
    console.error(
      `Error scanning repository ${owner}/${repo}:`,
      error instanceof Error ? error.message : String(error)
    );
    throw error;
  }
}

function analyzeCrossRepoPatterns(orgResults: any[], eventName: string): any {
  const allEvents = orgResults.flatMap((repo) => repo.events);

  if (allEvents.length === 0) {
    return {
      total_occurrences: 0,
      repositories_count: 0,
      message: `No occurrences of "${eventName}" found in the organization`,
    };
  }

  // Analyze property patterns across repos
  const propertyVariations = analyzePropertyVariations(allEvents);

  // Find implementation inconsistencies
  const inconsistencies = findImplementationInconsistencies(allEvents);

  // Repository usage ranking
  const repoUsage = orgResults
    .map((repo) => ({
      repository: repo.repository,
      occurrences: repo.events_found,
      files: [
        ...new Set(repo.events.map((e: SegmentEvent) => e.location.file)),
      ],
      last_updated: repo.last_updated,
    }))
    .sort((a, b) => b.occurrences - a.occurrences);

  return {
    total_occurrences: allEvents.length,
    repositories_count: orgResults.length,
    most_used_properties: getMostUsedProperties(allEvents),
    property_variations: propertyVariations,
    implementation_inconsistencies: inconsistencies,
    repository_usage_ranking: repoUsage,
    recommendations: generateCrossRepoRecommendations(
      allEvents,
      inconsistencies
    ),
  };
}

function analyzePropertyVariations(events: SegmentEvent[]): any {
  const propertyPatterns = events.reduce((acc, event) => {
    const propKeys = Object.keys(event.properties).sort().join(", ");
    if (!acc[propKeys]) {
      acc[propKeys] = {
        pattern: propKeys,
        count: 0,
        repositories: new Set(),
        example_properties: event.properties,
      };
    }
    acc[propKeys].count++;
    acc[propKeys].repositories.add(event.location.file.split("/")[0]);
    return acc;
  }, {} as Record<string, any>);

  return Object.values(propertyPatterns).map((pattern: any) => ({
    ...pattern,
    repositories: Array.from(pattern.repositories),
  }));
}

function findImplementationInconsistencies(events: SegmentEvent[]): string[] {
  const inconsistencies: string[] = [];

  // Check for property naming inconsistencies
  const allProperties = events.flatMap((e) => Object.keys(e.properties));
  const propertyGroups = groupSimilarProperties(allProperties);

  propertyGroups.forEach((group) => {
    if (group.length > 1) {
      inconsistencies.push(
        `Property naming inconsistency: ${group.join(
          ", "
        )} - consider standardizing`
      );
    }
  });

  return inconsistencies;
}

function groupSimilarProperties(properties: string[]): string[][] {
  const groups: string[][] = [];
  const processed = new Set<string>();

  properties.forEach((prop) => {
    if (processed.has(prop)) return;

    const similar = properties.filter(
      (p) => !processed.has(p) && arePropertiesSimilar(prop, p)
    );

    if (similar.length > 1) {
      groups.push(similar);
      similar.forEach((p) => processed.add(p));
    }
  });

  return groups;
}

function arePropertiesSimilar(prop1: string, prop2: string): boolean {
  // Simple similarity check for common variations
  const normalize = (str: string) => str.toLowerCase().replace(/[_-]/g, "");
  return normalize(prop1) === normalize(prop2) && prop1 !== prop2;
}

function getMostUsedProperties(
  events: SegmentEvent[]
): Array<{ property: string; count: number }> {
  const propCounts = events.reduce((acc, event) => {
    Object.keys(event.properties).forEach((prop) => {
      acc[prop] = (acc[prop] || 0) + 1;
    });
    return acc;
  }, {} as Record<string, number>);

  return Object.entries(propCounts)
    .map(([property, count]) => ({ property, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
}

function generateCrossRepoRecommendations(
  events: SegmentEvent[],
  inconsistencies: string[]
): string[] {
  const recommendations: string[] = [];

  if (inconsistencies.length > 0) {
    recommendations.push("Standardize property naming across repositories");
  }

  const uniquePropertySets = new Set(
    events.map((e) => JSON.stringify(Object.keys(e.properties).sort()))
  );

  if (uniquePropertySets.size > 3) {
    recommendations.push(
      "Consider creating a shared event schema to ensure consistency"
    );
  }

  if (events.length > 20) {
    recommendations.push(
      "High usage detected - consider adding this event to your tracking documentation"
    );
  }

  return recommendations;
}
