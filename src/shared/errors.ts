export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
export function errorStatus(error: unknown): number | undefined {
  return error instanceof Error &&
    "status" in error &&
    typeof error.status === "number"
    ? error.status
    : undefined;
}
