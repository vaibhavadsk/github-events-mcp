import { SegmentEvent } from "../types";

export function generateEventSummary(
  events: SegmentEvent[]
): Record<string, any> {
  const eventsByName = events.reduce((acc, event) => {
    if (!acc[event.name]) {
      acc[event.name] = [];
    }
    acc[event.name]!.push(event);
    return acc;
  }, {} as Record<string, SegmentEvent[]>);

  const summary = Object.entries(eventsByName).map(([name, eventList]) => ({
    event_name: name,
    occurrences: eventList.length,
    files: [...new Set(eventList.map((e) => e.location.file))],
    unique_property_sets: getUniquePropertySets(eventList),
  }));

  return {
    events_by_frequency: summary.sort((a, b) => b.occurrences - a.occurrences),
    files_by_event_count: getFilesByEventCount(events),
  };
}

function getUniquePropertySets(events: SegmentEvent[]): string[] {
  const propertySets = events.map((e) =>
    JSON.stringify(Object.keys(e.properties).sort())
  );
  return [...new Set(propertySets)];
}

function getFilesByEventCount(
  events: SegmentEvent[]
): Array<{ file: string; event_count: number }> {
  const fileEventCounts = events.reduce((acc, event) => {
    acc[event.location.file] = (acc[event.location.file] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return Object.entries(fileEventCounts)
    .map(([file, count]) => ({ file, event_count: count }))
    .sort((a, b) => b.event_count - a.event_count);
}
