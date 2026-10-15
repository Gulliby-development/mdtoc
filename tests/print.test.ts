import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "../src/cli";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = join(root, "src", "cli.ts");
const exampleMarkdown = ["# Guide", "## Installation", "## Usage", "### Sub", "## License"].join(
  "\n",
);
const exampleEntries = [
  "- [Installation](#installation)",
  "- [Usage](#usage)",
  "  - [Sub](#sub)",
].join("\n");

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

describe("print option parsing", () => {
  test("defaults to false and accepts the flag before, between, or after file arguments", () => {
    expect(parseArgs(["NOTES.md"]).print).toBe(false);

    for (const args of [
      ["--print", "NOTES.md"],
      ["NOTES.md", "--print"],
      ["NOTES.md", "--print", "./NOTES.md"],
    ]) {
      expect(parseArgs(args)).toMatchObject({
        files: ["NOTES.md"],
        print: true,
      });
    }
  });

  test("rejects a value attached to the boolean flag as an unknown option", () => {
    expect(() => parseArgs(["--print=1", "NOTES.md"])).toThrow(
      "Unknown option: --print=1. Use --help for usage.",
    );
  });
});

describe("print mode CLI", () => {
  let directory: string;

  beforeEach(() => {
    directory = realpathSync(mkdtempSync(join(tmpdir(), "mdtoc print tests ")));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  function writeMarkdown(name: string, markdown: string): string {
    const file = join(directory, name);
    writeFileSync(file, markdown);
    return file;
  }

  function snapshot(file: string) {
    return { bytes: readFileSync(file), modified: statSync(file).mtimeMs };
  }

  async function run(args: string[]) {
    const child = Bun.spawn([process.execPath, "run", cli, "--", ...args], {
      cwd: directory,
      stdout: "pipe",
      stderr: "pipe",
    });
    const timeout = setTimeout(() => child.kill(), 30_000);
    try {
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      return { exitCode, stdout, stderr };
    } finally {
      clearTimeout(timeout);
    }
  }

  test("prints the filtered example exactly and leaves file bytes and mtime unchanged", async () => {
    const file = writeMarkdown("NOTES.md", exampleMarkdown);
    const before = snapshot(file);
    const result = await run(["--print", "--min-depth", "2", "--exclude", "License", "NOTES.md"]);

    expect(result).toEqual({
      exitCode: 0,
      stdout: `${exampleEntries}\n`,
      stderr: "",
    });
    expect(readFileSync(file)).toEqual(before.bytes);
    expect(statSync(file).mtimeMs).toBe(before.modified);
  });

  test("prints every heading by default and honors max depth", async () => {
    writeMarkdown("NOTES.md", exampleMarkdown);

    const allLevels = await run(["--print", "NOTES.md"]);
    expect(allLevels.exitCode).toBe(0);
    expect(allLevels.stderr).toBe("");
    expect(allLevels.stdout).toBe(
      [
        "- [Guide](#guide)",
        "  - [Installation](#installation)",
        "  - [Usage](#usage)",
        "    - [Sub](#sub)",
        "  - [License](#license)",
        "",
      ].join("\n"),
    );

    const limited = await run(["NOTES.md", "--max-depth", "2", "--print"]);
    expect(limited.exitCode).toBe(0);
    expect(limited.stderr).toBe("");
    expect(limited.stdout).toBe(
      [
        "- [Guide](#guide)",
        "  - [Installation](#installation)",
        "  - [Usage](#usage)",
        "  - [License](#license)",
        "",
      ].join("\n"),
    );
  });

  test("prints headings from a stale marker block and leaves the file unchanged", async () => {
    const markdown = [
      "<!-- toc -->",
      "- [Old entry](#old-entry)",
      "<!-- tocstop -->",
      "# Guide",
      "## Fresh",
    ].join("\n");
    const file = writeMarkdown("NOTES.md", markdown);
    const before = snapshot(file);
    const result = await run(["--print", "NOTES.md"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("- [Guide](#guide)\n  - [Fresh](#fresh)\n");
    expect(result.stderr).toBe("");
    expect(readFileSync(file)).toEqual(before.bytes);
    expect(statSync(file).mtimeMs).toBe(before.modified);
  });

  test("ignores a damaged marker pair", async () => {
    writeMarkdown("NOTES.md", "<!-- toc -->\nstale\n# Guide\n## Fresh");
    const result = await run(["--print", "NOTES.md"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("- [Guide](#guide)\n  - [Fresh](#fresh)\n");
    expect(result.stderr).toBe("");
  });

  test("uses LF output for a CRLF file", async () => {
    writeMarkdown("NOTES.md", "# Guide\r\n## Usage\r\n### Details");
    const result = await run(["--print", "NOTES.md"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      "- [Guide](#guide)\n  - [Usage](#usage)\n    - [Details](#details)\n",
    );
    expect(result.stdout).not.toContain("\r");
    expect(result.stderr).toBe("");
  });

  test("prints zero bytes successfully when no headings are selected", async () => {
    writeMarkdown("NOTES.md", "just text");
    const noHeadings = await run(["--print", "NOTES.md"]);
    expect(noHeadings).toEqual({ exitCode: 0, stdout: "", stderr: "" });

    writeMarkdown("NOTES.md", exampleMarkdown);
    const noSelectedHeadings = await run(["--print", "--min-depth", "6", "NOTES.md"]);
    expect(noSelectedHeadings).toEqual({ exitCode: 0, stdout: "", stderr: "" });
  });

  test("rejects print and check in either order with the specified error", async () => {
    writeMarkdown("NOTES.md", exampleMarkdown);

    for (const args of [
      ["--print", "--check", "NOTES.md"],
      ["--check", "--print", "NOTES.md"],
    ]) {
      const result = await run(args);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(normalizeLineEndings(result.stderr)).toBe(
        "mdtoc: --print and --check cannot be used together.\n",
      );
    }
  });

  test("checks for a file before conflicts and keeps depth validation first", async () => {
    const noFile = await run(["--print", "--check"]);
    expect(noFile.exitCode).toBe(1);
    expect(noFile.stdout).toBe("");
    expect(normalizeLineEndings(noFile.stderr)).toBe(
      "mdtoc: Provide a Markdown file path. Use --help for usage.\n",
    );

    const invalidDepth = await run(["--print", "--check", "--max-depth", "0", "NOTES.md"]);
    expect(invalidDepth.exitCode).toBe(1);
    expect(invalidDepth.stdout).toBe("");
    expect(normalizeLineEndings(invalidDepth.stderr)).toBe(
      "mdtoc: --max-depth must be an integer from 1 through 6.\n",
    );
  });

  test("rejects multiple files with the specified error", async () => {
    writeMarkdown("one.md", "# One");
    writeMarkdown("two.md", "# Two");
    const result = await run(["--print", "one.md", "two.md"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(normalizeLineEndings(result.stderr)).toBe("mdtoc: --print accepts exactly one file.\n");
  });

  test("accepts duplicate paths that resolve to the same file", async () => {
    const file = writeMarkdown("NOTES.md", "# Guide");
    const result = await run([file, "--print", "./NOTES.md"]);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("- [Guide](#guide)\n");
    expect(result.stderr).toBe("");
  });

  test("reports a missing file without a file prefix", async () => {
    const result = await run(["--print", "nope.md"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(normalizeLineEndings(result.stderr)).toBe(
      "mdtoc: ENOENT: no such file or directory, open 'nope.md'\n",
    );
  });

  test("help takes precedence over print conflicts and documents the flag", async () => {
    const result = await run(["--print", "--check", "--help"]);
    const output = normalizeLineEndings(result.stdout);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(output).toContain(
      "Usage: bun run src/cli.ts [--check] [--print] [--insert] [--max-depth <1-6>] [--min-depth <1-6>] [--exclude <text>]... <file>...",
    );
    const checkLine = output.indexOf(
      "  --check             Exit 1 if the TOC is stale; never write the files.",
    );
    const printLine = output.indexOf(
      "  --print             Print the generated entries to stdout; never write; no markers needed.",
    );
    expect(checkLine).toBeGreaterThanOrEqual(0);
    expect(printLine).toBeGreaterThan(checkLine);
  });
});

describe("print mode README documentation", () => {
  test("documents the marker-free preview and options row", () => {
    const readme = normalizeLineEndings(readFileSync(join(root, "README.md"), "utf8"));
    const previewStart = readme.indexOf("### Preview without markers");
    const optionsStart = readme.indexOf("### Options");
    const checkRow = readme.indexOf("| `--check` |");
    const printRow = readme.indexOf(
      "| `--print` | Print the entries to stdout instead of updating the file (one file, no markers needed). |",
    );

    expect(previewStart).toBeGreaterThanOrEqual(0);
    expect(previewStart).toBeLessThan(optionsStart);
    expect(readme).toContain(
      "Use `--print` to show the generated entries without touching the file.",
    );
    expect(readme).toContain(
      "It needs no marker pair and prints the entries that would go between the markers, with LF line endings and no marker lines.",
    );
    expect(readme).toContain("bun run src/cli.ts --print --min-depth 2 --exclude License NOTES.md");
    expect(readme).toContain(`\`\`\`markdown\n${exampleEntries}\n\`\`\``);
    expect(readme).toContain(
      "`--print` accepts exactly one file and cannot be combined with `--check`.",
    );
    expect(readme).toContain("When no heading is selected, nothing is printed.");
    expect(readme).toContain("mdtoc: --print accepts exactly one file.");
    expect(readme).toContain("mdtoc: --print and --check cannot be used together.");
    expect(checkRow).toBeGreaterThanOrEqual(0);
    expect(printRow).toBeGreaterThan(checkRow);
  });
});
