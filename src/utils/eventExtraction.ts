import { SegmentEvent, EventAnalysis } from "../types";

export function extractSegmentEvents(
  content: string,
  filename: string
): SegmentEvent[] {
  const events: SegmentEvent[] = [];
  const lines = content.split("\n");

  // PRIORITY 1: Simple exact string match for quoted strings
  // This catches cases like: CONSTANT = "Exact Event Name"
  lines.forEach((line, index) => {
    // Look for any quoted string that could be an event name
    const quotedStrings = line.match(/['"`]([^'"`]{3,}?)['"`]/g);
    if (quotedStrings) {
      quotedStrings.forEach((quotedString) => {
        const eventName = quotedString.slice(1, -1); // Remove quotes

        // Only consider strings that look like event names (have spaces, colons, or meaningful words)
        if (
          eventName.includes(" ") ||
          eventName.includes(":") ||
          eventName.match(
            /\b(user|event|click|view|submit|complete|start|end|sent|received|invitation|dialog|modal|analysis|selection)\b/i
          )
        ) {
          events.push({
            name: eventName,
            properties: {
              _analytics_type: "exact_match",
              _context: "direct",
              _file_type: getFileType(filename),
            },
            location: {
              file: filename,
              line: index + 1,
            },
          });
        }
      });
    }
  });

  // Enhanced patterns for different segment event calls
  const patterns = [
    // Modern Analytics.track calls with EventName enum
    /Analytics\.track\s*\(\s*EventName\.(\w+)/g,
    // Legacy AnalyticsLegacy.track calls with strings
    /AnalyticsLegacy\.track\s*\(\s*['"`]([^'"`]+)['"`]/g,
    // Direct analytics.track calls
    /analytics\.track\s*\(\s*['"`]([^'"`]+)['"`]\s*,?\s*({[^}]*})?/g,
    // segment.track calls
    /segment\.track\s*\(\s*['"`]([^'"`]+)['"`]\s*,?\s*({[^}]*})?/g,
    // Direct track calls
    /(?:^|\s)track\s*\(\s*['"`]([^'"`]+)['"`]\s*,?\s*({[^}]*})?/g,
    // React/JS tracking with objects
    /\.track\s*\(\s*['"`]([^'"`]+)['"`]\s*,?\s*({[\s\S]*?})?/g,

    // NEW: Trait assignments (traits['eventName'] = value)
    /traits\s*\[\s*['"`]([^'"`]+)['"`]\s*\]\s*=/g,
    // NEW: Trait dot notation (traits.eventName = value)
    /traits\.([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=/g,

    // NEW: Property assignments that look like analytics events
    /['"`]([a-zA-Z][a-zA-Z0-9_]*(?:Manager|Event|Action|Click|View|Submit|Complete|Start|End|Track))['"`]\s*\]\s*=/g,

    // NEW: Analytics object property assignments
    /analytics\s*\[\s*['"`]([^'"`]+)['"`]\s*\]\s*=/g,
    /analytics\.([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=/g,

    // NEW: Event constants or enums (EventName.SOMETHING, EVENT_NAME, etc.)
    /EventName\.([A-Z_][A-Z0-9_]*)/g,
    /EVENT_([A-Z_][A-Z0-9_]*)/g,

    // NEW: Enum/constant definitions with string values (USER_INVITATION_SENT_RECEIVER = "Event Name")
    /([A-Z_][A-Z0-9_]*)\s*=\s*['"`]([^'"`]+)['"`]/g,

    // NEW: Object property definitions with event strings
    /(\w+)\s*:\s*['"`]([^'"`]+)['"`]/g,

    // NEW: Mixpanel, GA, and other analytics patterns
    /mixpanel\.track\s*\(\s*['"`]([^'"`]+)['"`]/g,
    /gtag\s*\(\s*['"`]event['"`]\s*,\s*['"`]([^'"`]+)['"`]/g,
    /ga\s*\(\s*['"`]send['"`]\s*,\s*['"`]event['"`]\s*,\s*['"`]([^'"`]+)['"`]/g,
  ];

  lines.forEach((line, index) => {
    patterns.forEach((pattern, patternIndex) => {
      pattern.lastIndex = 0; // Reset regex state
      const matches = [...line.matchAll(pattern)];
      matches.forEach((match) => {
        try {
          let eventName = match[1];
          let properties = {};
          let eventType = "track"; // Default type

          // Determine event type based on pattern
          if (patternIndex >= 6 && patternIndex <= 7) {
            eventType = "trait";
          } else if (patternIndex >= 8 && patternIndex <= 11) {
            eventType = "property";
          } else if (patternIndex >= 12 && patternIndex <= 13) {
            eventType = "constant";
          } else if (patternIndex === 14) {
            // Enum/constant definitions - use the string value as event name
            eventType = "constant";
            eventName = match[2]; // Use the string value, not the constant name
          } else if (patternIndex === 15) {
            // Object property definitions - use the string value as event name
            eventType = "property";
            eventName = match[2]; // Use the string value, not the property name
          } else if (patternIndex >= 16) {
            eventType = "third_party";
          }

          // Parse properties if available
          if (match[2] && eventType !== "constant") {
            properties = parseEventProperties(match[2]);
          }

          // Enhanced event name processing
          if (eventName) {
            // Convert snake_case and SCREAMING_CASE to camelCase for consistency
            // BUT NOT for enum/constant string values (patternIndex 14-15)
            if (
              eventType === "constant" &&
              eventName.includes("_") &&
              patternIndex < 14
            ) {
              eventName = eventName
                .toLowerCase()
                .replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
            }

            // Add context information
            const contextInfo = getContextInfo(line, lines, index, filename);

            events.push({
              name: eventName,
              properties: {
                ...properties,
                _analytics_type: eventType,
                _context: contextInfo,
                _file_type: getFileType(filename),
              },
              location: {
                file: filename,
                line: index + 1,
              },
            });
          }
        } catch (error) {
          console.warn(
            `Failed to parse event "${match[1]}" at ${filename}:${index + 1}:`,
            error instanceof Error ? error.message : String(error)
          );
          // Still add the event without properties
          if (match[1]) {
            events.push({
              name: match[1],
              properties: {
                _analytics_type: "unknown",
                _parsing_error: true,
              },
              location: {
                file: filename,
                line: index + 1,
              },
            });
          }
        }
      });
    });
  });

  // Deduplicate events with priority for exact matches
  const uniqueEvents = events.filter((event, index, self) => {
    const duplicates = self.filter(
      (e) =>
        e.location.line === event.location.line &&
        e.location.file === event.location.file
    );

    // If there are multiple events from the same line, prioritize exact_match
    if (duplicates.length > 1) {
      const exactMatch = duplicates.find(
        (e) => e.properties._analytics_type === "exact_match"
      );
      if (exactMatch) {
        return event === exactMatch; // Only keep the exact match
      }
    }

    // Otherwise, keep the first occurrence
    return (
      index ===
      self.findIndex(
        (e) => e.name === event.name && e.location.line === event.location.line
      )
    );
  });

  return uniqueEvents;
}

// NEW: Get context information about the event
function getContextInfo(
  line: string,
  lines: string[],
  lineIndex: number,
  filename: string
): string {
  const context = [];

  // Check if it's in a function
  for (let i = lineIndex - 1; i >= 0; i--) {
    const prevLine = lines[i].trim();
    if (prevLine.match(/function\s+(\w+)|(\w+)\s*[:=]\s*function|(\w+)\s*\(/)) {
      context.push(`in_function`);
      break;
    }
    if (prevLine.match(/class\s+(\w+)/)) {
      context.push(`in_class`);
      break;
    }
  }

  // Check if it's in a switch/case
  if (line.includes("case ") || lines[lineIndex - 1]?.includes("case ")) {
    context.push("in_switch_case");
  }

  // Check if it's conditional
  if (
    line.includes("if (") ||
    line.includes("if(") ||
    lines[lineIndex - 1]?.includes("if ")
  ) {
    context.push("conditional");
  }

  // Check file context
  if (filename.includes("analytics")) {
    context.push("analytics_file");
  }

  return context.join(",") || "direct";
}

// NEW: Determine file type for better context
function getFileType(filename: string): string {
  if (filename.includes("analytics")) return "analytics";
  if (filename.includes("tracking")) return "tracking";
  if (filename.includes("events")) return "events";
  if (filename.includes("service")) return "service";
  if (filename.includes("component")) return "component";
  if (filename.includes("page")) return "page";
  if (filename.includes("test")) return "test";

  const ext = filename.split(".").pop()?.toLowerCase();
  return ext || "unknown";
}

export function parseEventProperties(
  propertiesString: string
): Record<string, unknown> {
  try {
    // Remove comments and clean up the string
    const cleaned = propertiesString
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .trim();

    // If empty or just braces, return empty object
    if (!cleaned || cleaned === "{}" || cleaned === "") {
      return {};
    }

    // Use Function constructor for safer evaluation than eval
    const func = new Function(`return ${cleaned}`);
    return func() as Record<string, unknown>;
  } catch {
    // If parsing fails, return empty object
    return {};
  }
}

export function analyzeEvents(events: SegmentEvent[]): EventAnalysis {
  const issues: string[] = [];
  const suggestions: string[] = [];
  let score = 100; // Start with perfect score

  // Naming convention analysis
  events.forEach((event) => {
    // Check PascalCase or Title Case
    if (!event.name.match(/^[A-Z][a-zA-Z\s]*$/)) {
      issues.push(
        `Event "${event.name}" doesn't follow proper naming convention (should be Title Case)`
      );
      score -= 10;
    }

    // Check for underscores or dashes
    if (event.name.includes("_") || event.name.includes("-")) {
      issues.push(`Event "${event.name}" contains underscores or dashes`);
      score -= 5;
    }

    // Property analysis
    const props = Object.keys(event.properties);

    // Check for user identification
    const hasUserId = props.some((p) =>
      ["userId", "user_id", "id", "customerId", "customer_id"].includes(
        p.toLowerCase()
      )
    );

    if (!hasUserId && props.length > 0) {
      suggestions.push(
        `Event "${event.name}" might benefit from user identification property`
      );
      score -= 5;
    }

    // Check property count
    if (props.length > 15) {
      issues.push(
        `Event "${event.name}" has too many properties (${props.length}). Consider grouping related properties.`
      );
      score -= 10;
    } else if (props.length === 0) {
      suggestions.push(
        `Event "${event.name}" has no properties. Consider adding contextual information.`
      );
      score -= 3;
    }

    // Check for snake_case properties
    const snakeCaseProps = props.filter((p) => p.includes("_"));
    if (snakeCaseProps.length > 0) {
      issues.push(
        `Event "${event.name}" has snake_case properties: ${snakeCaseProps.join(
          ", "
        )}. Consider camelCase.`
      );
      score -= 5;
    }

    // Check for common missing properties
    const hasTimestamp = props.some((p) =>
      ["timestamp", "time", "createdAt", "created_at"].includes(p.toLowerCase())
    );

    if (!hasTimestamp && props.length > 0) {
      suggestions.push(
        `Event "${event.name}" might benefit from a timestamp property`
      );
    }
  });

  return {
    issues,
    suggestions,
    score: Math.max(0, score),
  };
}
