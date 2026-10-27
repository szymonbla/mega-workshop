// Only the external MEGA service is substituted. Local HTTP authorization stays real.
import { dirname, join } from 'node:path';
import { startStudy } from '../../../../study/server.mjs';
import { AccessError } from '../../../../study/mega-source.mjs';
let signedIn = false;
const source = {
  async availableLessons() { if (!signedIn) throw new AccessError(); return ['s01e01','s01e02']; },
  async login() { signedIn = true; },
  async check() { if (!signedIn) throw new AccessError(); return {}; },
  async logout() { signedIn = false; },
  async close() {},
};
const viewer = await startStudy({source, stateDirectory: join(dirname(process.env.MEX_ENV_FILE), 'state')});
console.log(`MEGA Workshop → ${viewer.url}`);
process.on('SIGTERM', async () => { await viewer.close(); process.exit(0); });
