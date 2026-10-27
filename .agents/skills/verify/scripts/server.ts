// Only the external MEGA service is substituted. Local HTTP authorization stays real.
import { dirname, join } from "node:path";
import { AccessError } from "../../../../src/server/mega-source.ts";
import { startStudy } from "../../../../src/server/server.ts";
import type { LessonSource } from "../../../../src/server/types.ts";
import { syntheticProviderFetch } from "../../../../test/fixtures/provider.ts";
import { sourceMetadata } from "../../../../test/fixtures/synthetic.ts";

let signedIn = false;
const source: LessonSource = {
  async get() {
    throw Error("No remote downloads in verification");
  },
  async availableLessons() {
    if (!signedIn) throw new AccessError();
    return ["s01e01", "s01e02"];
  },
  async login() {
    signedIn = true;
  },
  async check() {
    if (!signedIn) throw new AccessError();
    return sourceMetadata;
  },
  async logout() {
    signedIn = false;
  },
  async close() {},
};
const viewer = await startStudy({
  providerFetch: syntheticProviderFetch,
  source,
  stateDirectory: join(dirname(process.env.MEX_ENV_FILE!), "state"),
});
console.log(`MEGA Workshop → ${viewer.url}`);
process.on("SIGTERM", async () => {
  await viewer.close();
  process.exit(0);
});
