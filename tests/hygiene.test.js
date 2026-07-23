import test from "node:test";
import assert from "node:assert";
import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

async function sourceFiles(dir = SRC) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(path)));
    else if (entry.name.endsWith(".js")) files.push(path);
  }
  return files;
}

// Finding #13 — a library must not write to the host application's stdout/stderr.
test("no console.* calls in src/", async () => {
  const offenders = [];

  for (const file of await sourceFiles()) {
    const lines = (await readFile(file, "utf8")).split("\n");
    lines.forEach((line, i) => {
      if (/(^|[^.\w])console\s*\./.test(line)) {
        offenders.push(`${file.replace(SRC, "src")}:${i + 1}: ${line.trim()}`);
      }
    });
  }

  assert.deepStrictEqual(offenders, [], `console.* found in library code:\n${offenders.join("\n")}`);
});

// Finding #12 — the documented example used field names no adapter reads.
test("docs use field names the adapters actually read", async () => {
  const docs = await readFile(join(SRC, "..", "docs", "index.md"), "utf8");

  assert.doesNotMatch(docs, /^\s*address:/m, 'docs still use the unsupported field "address"');
  assert.match(docs, /recipientAddress/, "docs should show the real address field");
  assert.match(docs, /recipientPhone/, "docs should show the real phone field");
});
