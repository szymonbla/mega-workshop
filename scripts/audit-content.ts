import { execFileSync } from "node:child_process";
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = realpathSync(
  resolve(process.argv[2] || fileURLToPath(new URL("../", import.meta.url))),
);
const media =
  /\.(?:png|jpe?g|webp|gif|avif|mp3|m4a|wav|ogg|mp4|webm|mov|pdf|zip|tar|gz|sqlite|db|har)$/i;
const privatePath =
  /^(?:\.study-data|course-examples|\.mega-study|\.audit|\.audio-venv|node_modules|s\d{2}e\d{2})(?:\/|$)|(?:^|\/)\.env(?:\.|$)|^study\/(?:content|alignment|public\/(?:audio|figures))(?:\/|$)|^study\/(?:article\.md|curriculum\.json|section-identities\.json|audio-chapters\.json|guides\.json)$/;
let scratch;
let gitArgs = ["-C", root];
try {
  let repository;
  try {
    repository = execFileSync(
      "git",
      [...gitArgs, "rev-parse", "--show-toplevel"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
  } catch {}
  if (repository !== root) {
    scratch = mkdtempSync(join(tmpdir(), "study-git-audit-"));
    execFileSync("git", ["init", "-q", scratch]);
    gitArgs = ["--git-dir", join(scratch, ".git"), "--work-tree", root];
  }
  const git = (args: string[]) =>
    execFileSync("git", [...gitArgs, ...args], { cwd: root, encoding: "utf8" });
  // Tracked paths remain included even if .gitignore now matches them.
  const candidates = [
    ...new Set(
      git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"])
        .split("\0")
        .filter(Boolean),
    ),
  ];
  const findings = [];
  for (const name of candidates) {
    if (privatePath.test(name)) {
      findings.push(`${name}: private data included in Git`);
      continue;
    }
    if (media.test(name)) {
      findings.push(`${name}: media/archive requires review`);
      continue;
    }
    const path = join(root, name);
    let stat;
    try {
      stat = lstatSync(path);
    } catch {
      findings.push(`${name}: tracked file missing; stage its removal`);
      continue;
    }
    if (!stat.isFile()) {
      findings.push(`${name}: symlink or embedded repository requires review`);
      continue;
    }
    const bytes = readFileSync(path);
    if (bytes.includes(0)) findings.push(`${name}: binary file`);
    if (/\.(?:md|json|html|txt)$/.test(name) && bytes.length > 100000)
      findings.push(`${name}: large text requires review`);
  }
  if (findings.length) {
    console.error(findings.join("\n"));
    process.exitCode = 1;
  } else
    console.log(
      `Content audit passed: ${candidates.length} tracked or addable files. Private local data is excluded by Git rules${scratch ? " (checked using a temporary Git index; project has no Git repository)" : ""}.`,
    );
} finally {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
}
