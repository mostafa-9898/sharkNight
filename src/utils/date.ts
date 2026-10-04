/**
 * Convert a Date to Unix timestamp in milliseconds
 */
export function toTimestamp(date: Date): number {
  return date.getTime();
}

/**
 * Convert Unix timestamp in milliseconds to Date
 */
export function fromTimestamp(timestamp: number): Date {
  return new Date(timestamp);
}

/**
 * Format a timestamp to a readable date string
 */
export function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString();
}
