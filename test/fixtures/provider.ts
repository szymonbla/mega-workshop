// Substitute only the external provider boundary. Never send synthetic keys online.
export const syntheticProviderFetch: typeof fetch = async (_url, init) => {
  await new Promise((resolve) => setTimeout(resolve, 200));
  const authorization = new Headers(init?.headers).get("Authorization");
  return new Response(null, {
    status: authorization === "Bearer synthetic-browser-test-key" ? 200 : 401,
  });
};
