// Core types for segment events
export interface SegmentEvent {
  name: string;
  properties: Record<string, unknown>;
  location: {
    file: string;
    line: number;
  };
}

export interface EventAnalysis {
  issues: string[];
  suggestions: string[];
  score: number;
}

export interface EventImprovement {
  event: string;
  suggestions: string[];
  improvedName: string;
  improvedProperties: Record<string, unknown>;
}

export interface EventDocumentation {
  name: string;
  description: string;
  properties: Array<{
    name: string;
    type: string;
    example: unknown;
    required: boolean;
    description: string;
  }>;
}

// Enhanced types for future flow analysis (placeholder for now)
export interface EventLocation {
  file: string;
  line: number;
  column?: number;
  context: string;
}

export interface FlowAnalysis {
  eventName: string;
  triggerLocations: EventLocation[];
  userFlows: UserFlow[];
  missingImplementations: string[];
  componentHierarchy: ComponentTree[];
}

export interface UserFlow {
  id: string;
  description: string;
  steps: FlowStep[];
  components: string[];
  userActions: string[];
  technicalFlow: string[];
}

export interface ComponentTree {
  name: string;
  file: string;
  children: ComponentTree[];
  eventTriggers: EventTrigger[];
  imports: string[];
  exports: string[];
}

export interface FlowStep {
  stepNumber: number;
  userAction: string;
  technicalAction: string;
  component: string;
  file: string;
  conditions?: string[];
}

export interface EventTrigger {
  eventName: string;
  triggerType: "click" | "hover" | "form" | "keyboard" | "lifecycle";
  handler: string;
  line: number;
  conditions?: string[];
}

export interface TrackingGap {
  expectedEvent: string;
  missingLocations: string[];
  suggestedImplementation: string;
  relatedEvents: string[];
}

export interface AnalyticsPattern {
  type: "modern" | "legacy" | "direct";
  pattern: string;
  file: string;
  line: number;
  eventName: string;
  properties?: Record<string, any>;
}
