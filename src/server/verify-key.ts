/** Authentication checks only: no model generation or billing probe. */
export async function verifyProviderKey(
  provider: "openai" | "openrouter",
  key: string,
  request: typeof fetch = fetch,
): Promise<{ status: number; error: string } | undefined> {
  const name = provider === "openai" ? "OpenAI" : "OpenRouter";
  const endpoint =
    provider === "openai"
      ? "https://api.openai.com/v1/models"
      : "https://openrouter.ai/api/v1/key";
  let response: Response;
  try {
    response = await request(endpoint, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(10000),
      redirect: "error",
    });
    // Never expose provider response bodies: they can contain credentials.
    await response.body?.cancel();
  } catch (error) {
    const timeout =
      error instanceof Error &&
      ["TimeoutError", "AbortError"].includes(error.name);
    return {
      status: timeout ? 504 : 502,
      error: timeout
        ? `${name} verification timed out. Try again. Your key was not saved.`
        : `Could not reach ${name} to verify the key. Check your connection and try again. Your key was not saved.`,
    };
  }
  if (response.ok) return;
  const messages: Record<number, string> = {
    401: `${name} rejected this API key. Check the selected provider and copy an active key.`,
    403: `${name} denied the verification request. Check the key's permissions and account access.`,
    402: `${name} requires credits. Check your account billing.`,
    429: `${name} could not verify the key because of a rate or quota limit. Check your account limits and try again.`,
  };
  return {
    status: [401, 402, 403].includes(response.status)
      ? 400
      : response.status === 429
        ? 429
        : 502,
    error: `${messages[response.status] || `${name} verification is unavailable. Try again later.`} Your key was not saved.`,
  };
}
