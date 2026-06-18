export function safeJsonParse<T>(input: string, fallback: T): T {
  try {
    return JSON.parse(input) as T;
  } catch {
    return fallback;
  }
}

export function safeJsonStringify(input: unknown, fallback = "{}"): string {
  try {
    return JSON.stringify(input);
  } catch {
    return fallback;
  }
}
