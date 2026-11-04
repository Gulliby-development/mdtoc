import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "../src/cli";
import { generateToc, updateToc } from "../src/toc";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = join(root, "src", "cli.ts");
const sample = ["# Guide", "## Installation", "### Sub", "## Usage"].join("\n");

describe("bullet marker", () => {
  let directory: string;

  beforeEach(() => {
    directory = realpathSync(mkdtempSync(join(tmpdir(), "mdtoc bullet tests ")));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  function writeMarkdown(name: string, markdown: string): string {
    const file = join(directory, name);
    writeFileSync(file, markdown);
    return file;
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
      return {
        exitCode,
        stdout: stdout.replace(/\r\n/g, "\n"),
        stderr: stderr.replace(/\r\n/g, "\n"),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  test("keeps the default key absent and accepts the three markers in both spellings", () => {
    const defaults = parseArgs(["NOTES.md"]);
    expect(defaults.bullet).toBeUndefined();
    expect(Object.hasOwn(defaults, "bullet")).toBe(false);

    for (const marker of ["-", "*", "+"]) {
      expect(parseArgs(["--bullet", marker, "NOTES.md"])).toMatchObject({ bullet: marker });
      expect(parseArgs([`--bullet=${marker}`, "NOTES.md"])).toMatchObject({ bullet: marker });
      expect(parseArgs(["NOTES.md", "--bullet", marker])).toMatchObject({
        files: ["NOTES.md"],
        bullet: marker,
      });
    }
  });

  test("the last occurrence wins and the value is the next argument whatever it is", () => {
    expect(parseArgs(["--bullet", "*", "--bullet=+", "NOTES.md"]).bullet).toBe("+");
    expect(() => parseArgs(["--bullet", "--check", "NOTES.md"])).toThrow(
      "--bullet must be -, * or +.",
    );
    expect(parseArgs(["--bullet", "-", "NOTES.md"]).files).toEqual(["NOTES.md"]);
  });

  test("rejects every other value and a missing value", () => {
    for (const args of [
      ["--bullet", "x", "NOTES.md"],
      ["--bullet", "", "NOTES.md"],
      ["--bullet=", "NOTES.md"],
      ["--bullet=**", "NOTES.md"],
      ["--bullet", "1.", "NOTES.md"],
      ["--bullet", " -", "NOTES.md"],
      ["NOTES.md", "--bullet"],
    ]) {
      expect(() => parseArgs(args)).toThrow("--bullet must be -, * or +.");
    }
  });

  test("treats the flag after the delimiter as a path", () => {
    const parsed = parseArgs(["--", "--bullet"]);
    expect(parsed.files).toEqual(["--bullet"]);
    expect(Object.hasOwn(parsed, "bullet")).toBe(false);
  });

  test("writes the chosen marker and keeps the two-space nesting", () => {
    expect(generateToc(sample, 6, "\n", 1, [], false, "*")).toBe(
      [
        "* [Guide](#guide)",
        "  * [Installation](#installation)",
        "    * [Sub](#sub)",
        "  * [Usage](#usage)",
      ].join("\n"),
    );
    expect(generateToc(sample, 6, "\n", 2, [], false, "+")).toBe(
      ["+ [Installation](#installation)", "  + [Sub](#sub)", "+ [Usage](#usage)"].join("\n"),
    );
    expect(generateToc(sample, 6, "\n", 1, [], false, "-")).toBe(generateToc(sample));
  });

  test("leaves labels, anchors and the numbered list alone", () => {
    const markdown = ["# A [b] \\ c", "## Hello, World!", "## Hello, World!"].join("\n");
    expect(generateToc(markdown, 6, "\n", 1, [], false, "*")).toBe(
      [
        "* [A \\[b\\] \\\\ c](#a-b-c)",
        "  * [Hello, World!](#hello-world)",
        "  * [Hello, World!](#hello-world-1)",
      ].join("\n"),
    );
    expect(generateToc(sample, 6, "\n", 1, [], true, "*")).toBe(
      generateToc(sample, 6, "\n", 1, [], true),
    );
  });

  test("updates the block between the markers with the chosen marker", () => {
    const source = ["<!-- toc -->", "<!-- tocstop -->", "# Guide", "## Usage"].join("\n");
    expect(updateToc(source, 6, 1, [], false, "+")).toBe(
      [
        "<!-- toc -->",
        "+ [Guide](#guide)",
        "  + [Usage](#usage)",
        "<!-- tocstop -->",
        "# Guide",
        "## Usage",
      ].join("\n"),
    );
  });

  test("rejects the combination with --numbered but lets help and version win", () => {
    expect(() => parseArgs(["--bullet", "*", "--numbered", "NOTES.md"])).toThrow(
      "--bullet and --numbered cannot be used together.",
    );
    expect(() => parseArgs(["--numbered", "--bullet=+", "NOTES.md"])).toThrow(
      "--bullet and --numbered cannot be used together.",
    );
    expect(parseArgs(["--bullet", "*", "--numbered", "--help"])).toMatchObject({ help: true });
    expect(parseArgs(["--bullet", "*", "--numbered", "-v"])).toMatchObject({ version: true });
    expect(() => parseArgs(["--bullet", "?", "--numbered", "--help"])).toThrow(
      "--bullet must be -, * or +.",
    );
  });

  test("generates, checks and prints with the marker through the command line", async () => {
    const file = writeMarkdown("NOTES.md", "<!-- toc -->\n<!-- tocstop -->\n# Guide\n## Usage\n");

    expect(await run(["--bullet", "*", "NOTES.md"])).toEqual({
      exitCode: 0,
      stdout: "",
      stderr: "",
    });
    expect(readFileSync(file, "utf8")).toBe(
      "<!-- toc -->\n* [Guide](#guide)\n  * [Usage](#usage)\n<!-- tocstop -->\n# Guide\n## Usage\n",
    );
    expect(await run(["--check", "--bullet=*", "NOTES.md"])).toEqual({
      exitCode: 0,
      stdout: "",
      stderr: "",
    });

    const stale = await run(["--check", "NOTES.md"]);
    expect(stale.exitCode).toBe(1);
    expect(stale.stderr).toBe('TOC is stale in "NOTES.md". Run without --check to update it.\n');

    const printed = await run(["--print", "--bullet", "+", "--min-depth", "2", "NOTES.md"]);
    expect(printed).toEqual({ exitCode: 0, stdout: "+ [Usage](#usage)\n", stderr: "" });
  });

  test("works with --insert and reports an invalid marker with exit code 1", async () => {
    const file = writeMarkdown("NOTES.md", "# Guide\n\n## Usage\n");

    expect((await run(["--insert", "--bullet", "*", "NOTES.md"])).exitCode).toBe(0);
    expect(readFileSync(file, "utf8")).toBe(
      "# Guide\n<!-- toc -->\n* [Guide](#guide)\n  * [Usage](#usage)\n<!-- tocstop -->\n\n## Usage\n",
    );

    const invalid = await run(["--bullet", "x", "NOTES.md"]);
    expect(invalid).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "mdtoc: --bullet must be -, * or +.\n",
    });
    const both = await run(["--bullet", "*", "--numbered", "NOTES.md"]);
    expect(both).toEqual({
      exitCode: 1,
      stdout: "",
      stderr: "mdtoc: --bullet and --numbered cannot be used together.\n",
    });
  });

  test("documents the option in the help text and in the README", async () => {
    const help = await run(["--help"]);
    const lines = help.stdout.split("\n");
    expect(lines[0]).toContain("[--numbered] [--bullet <-|*|+>] [--max-depth <1-6>]");
    const numberedLine = lines.indexOf(
      "  --numbered          Write the entries as a numbered list (1. 2. 3.) instead of bullets.",
    );
    expect(lines[numberedLine + 1]).toBe(
      "  --bullet <-|*|+>    Use this marker for the bullets instead of - (not with --numbered).",
    );

    const readme = readFileSync(join(root, "README.md"), "utf8").replace(/\r\n/g, "\n");
    expect(readme.indexOf("### Bullet marker")).toBeGreaterThan(
      readme.indexOf("### Numbered list"),
    );
    expect(readme.indexOf("### Bullet marker")).toBeLessThan(readme.indexOf("### Version"));
    expect(readme).toContain(
      "| `--bullet <marker>` | Use `-`, `*` or `+` for the bullets (default `-`; not with `--numbered`). |",
    );
  });
});
