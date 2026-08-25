// Prints a release's notes as Markdown, taken from the in-app changelog so the
// GitHub release and the app's "what's new" dialog can never drift apart.
//
// Run with the version to describe, or with none for the current one:
//   node --experimental-strip-types scripts/release-notes.mjs [1.2.3]
//
// Reading the .ts source directly is deliberate — Node strips the types, so
// this needs no build step and no dependency of its own.

const source = new URL("../web/src/lib/releases.ts", import.meta.url);
const { RELEASES } = await import(source.href);

const wanted = process.argv[2]?.replace(/^v/, "") ?? RELEASES[0].version;
const release = RELEASES.find((r) => r.version === wanted);
if (!release) {
  console.error(`no changelog entry for ${wanted} — add one to web/src/lib/releases.ts`);
  process.exit(1);
}

const lines = [];
for (const kind of ["feature", "fix"]) {
  const changes = release.changes.filter((c) => c.kind === kind);
  if (changes.length === 0) continue;
  lines.push(`### ${kind === "feature" ? "New" : "Fixed"}`, "");
  for (const c of changes) {
    lines.push(`- **${c.text}**${c.note ? ` — ${c.note}` : ""}`);
  }
  lines.push("");
}

lines.push(
  "### Install",
  "",
  "```sh",
  `docker pull ghcr.io/unmaykr-a/taskrr:${release.version}`,
  "```",
  "",
  "Or download the binary for your platform below — each one is the whole",
  "application, frontend included, with no runtime to install. Verify a download",
  "against `checksums.txt`:",
  "",
  "```sh",
  "sha256sum --check --ignore-missing checksums.txt",
  "```",
);

console.log(lines.join("\n"));
