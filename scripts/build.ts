import { watch as watchFiles } from "node:fs";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type BuildOptions, build, context } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = new URL("../dist/public/", import.meta.url);
const options: BuildOptions = {
  absWorkingDir: root,
  entryPoints: [
    "app",
    "progress",
    "read-along",
    "audio-player",
    "labs",
    "navigation",
    "import-ui",
  ].map((name) => `src/client/${name}.ts`),
  outdir: "dist/public",
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2023",
};
async function copyAssets() {
  for (const name of ["index.html", "style.css"]) {
    await copyFile(
      new URL(`../public/${name}`, import.meta.url),
      new URL(name, output),
    );
  }
}
export async function buildClient(watch = false): Promise<() => Promise<void>> {
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await copyAssets();
  if (!watch) {
    await build(options);
    return async () => {};
  }
  const builder = await context(options);
  try {
    await builder.rebuild();
    await builder.watch();
    const assets = watchFiles(new URL("../public/", import.meta.url), () => {
      copyAssets().catch((error) =>
        console.error("Could not copy public assets:", error),
      );
    });
    return async () => {
      assets.close();
      await builder.dispose();
    };
  } catch (error) {
    await builder.dispose();
    throw error;
  }
}
if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await buildClient();
}
