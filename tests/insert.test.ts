import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "../src/cli";
import { insertMarkers } from "../src/toc";

const root = resolve(fileURLToPath(new URL("../", import.meta.url)));
const cli = join(root, "src", "cli.ts");
describe("insertMarkers", () => {
  test("inserts after the first outside level-one heading and preserves its line ending", () => {
    expect(insertMarkers("# Guide\n## A\n")).toBe(
      "# Guide\n<!-- toc -->\n<!-- tocstop -->\n## A\n",
    );
  });

  test("prepends the pair when no eligible heading exists", () => {
    expect(insertMarkers("Text\n")).toBe("<!-- toc -->\n<!-- tocstop -->\nText\n");
  });

  test("prepends the pair to an empty file", () => {
    expect(insertMarkers("")).toBe("<!-- toc -->\n<!-- tocstop -->\n");
  });

  test("does not add a final line ending after a last-line heading", () => {
    expect(insertMarkers("# Guide")).toBe("# Guide\n<!-- toc -->\n<!-- tocstop -->");
  });

  test("uses the first eligible H1 only", () => {
    expect(insertMarkers("## Subheading\n# First\n# Later\n")).toBe(
      "## Subheading\n# First\n<!-- toc -->\n<!-- tocstop -->\n# Later\n",
    );
  });

  test("accepts three-space indentation and keeps closing hashes", () => {
    expect(insertMarkers("   # Guide ###  \nTail")).toBe(
      "   # Guide ###  \n<!-- toc -->\n<!-- tocstop -->\nTail",
    );
  });

  test("accepts a tab between the H1 marker and text", () => {
    expect(insertMarkers("#\tGuide\n")).toBe("#\tGuide\n<!-- toc -->\n<!-- tocstop -->\n");
  });

  test("accepts a lone H1 marker", () => {
    expect(insertMarkers("#\n")).toBe("#\n<!-- toc -->\n<!-- tocstop -->\n");
  });

  test("does not treat #Title, Setext, or deeper headings as the insertion heading", () => {
    const markdown = "#Title\nSetext title\n===\n## Subheading\n";
    expect(insertMarkers(markdown)).toBe(`<!-- toc -->\n<!-- tocstop -->\n${markdown}`);
  });

  test("does not treat an indented code heading as an H1", () => {
    expect(insertMarkers("    # Code\n# Real\n")).toBe(
      "    # Code\n# Real\n<!-- toc -->\n<!-- tocstop -->\n",
    );
  });

  test("skips headings inside backtick fences", () => {
    expect(insertMarkers("```\n# Fenced\n```\n# Real\n")).toBe(
      "```\n# Fenced\n```\n# Real\n<!-- toc -->\n<!-- tocstop -->\n",
    );
  });

  test("skips headings inside tilde fences", () => {
    expect(insertMarkers("~~~ info\n# Fenced\n~~~\n# Real\n")).toBe(
      "~~~ info\n# Fenced\n~~~\n# Real\n<!-- toc -->\n<!-- tocstop -->\n",
    );
  });

  test("an unclosed fence hides every later heading", () => {
    expect(insertMarkers("~~~\n# Hidden\n")).toBe(
      "<!-- toc -->\n<!-- tocstop -->\n~~~\n# Hidden\n",
    );
  });

  test("uses the first CRLF separator and preserves later separators", () => {
    expect(insertMarkers("Text\r\n# Guide\n## A\r")).toBe(
      "Text\r\n# Guide\r\n<!-- toc -->\r\n<!-- tocstop -->\n## A\r",
    );
  });

  test("uses a CR-only separator when it appears first", () => {
    expect(insertMarkers("Text\r# Guide\r\n")).toBe(
      "Text\r# Guide\r<!-- toc -->\r<!-- tocstop -->\r\n",
    );
  });

  test("returns the original text when the start marker exists", () => {
    const markdown = "<!-- toc -->\n# Guide\n";
    expect(insertMarkers(markdown)).toBe(markdown);
  });

  test("returns the original text when the stop marker exists", () => {
    const markdown = "<!-- tocstop -->\n# Guide\n";
    expect(insertMarkers(markdown)).toBe(markdown);
  });

  test("returns a valid marker pair unchanged", () => {
    const markdown = "<!-- toc -->\nold\n<!-- tocstop -->\n# Guide\n";
    expect(insertMarkers(markdown)).toBe(markdown);
  });
});

describe("insert option parsing", () => {
  test("leaves the optional insert property absent by default", () => {
    expect(parseArgs(["NOTES.md"])).toEqual({
      files: ["NOTES.md"],
      check: false,
      print: false,
      maxDepth: 6,
      minDepth: 1,
      exclude: [],
      help: false,
    });
  });

  test("accepts the flag before, between, or after file arguments", () => {
    for (const args of [
      ["--insert", "one.md"],
      ["one.md", "--insert", "two.md"],
      ["one.md", "two.md", "--insert"],
    ]) {
      expect(parseArgs(args).insert).toBe(true);
    }
  });

  test("accepts repeated insert flags without changing behavior", () => {
    expect(parseArgs(["--insert", "one.md", "--insert"]).insert).toBe(true);
  });

  test("treats --insert after -- as a file name", () => {
    const options = parseArgs(["--", "--insert"]);
    expect(options.files).toEqual(["--insert"]);
    expect(options.insert).toBeUndefined();
    expect(Object.hasOwn(options, "insert")).toBe(false);
  });

  test("rejects an equals value as an unknown option", () => {
    expect(() => parseArgs(["--insert=1", "NOTES.md"])).toThrow(
      "Unknown option: --insert=1. Use --help for usage.",
    );
  });

  test("rejects insert with check or print using the specified errors", () => {
    expect(() => parseArgs(["--insert", "--check", "NOTES.md"])).toThrow(
      "--insert and --check cannot be used together.",
    );
    expect(() => parseArgs(["NOTES.md", "--print", "--insert"])).toThrow(
      "--insert and --print cannot be used together.",
    );
  });

  test("keeps existing print conflicts first and lets help win", () => {
    expect(() => parseArgs(["--insert", "--print", "--check", "one.md", "two.md"])).toThrow(
      "--print and --check cannot be used together.",
    );
    expect(() => parseArgs(["--insert", "--print", "one.md", "two.md"])).toThrow(
      "--print accepts exactly one file.",
    );
    expect(parseArgs(["--insert", "--check", "--print", "--help"]).help).toBe(true);
  });
});

describe("insert option CLI", () => {
  let directory: string;

  beforeEach(() => {
    directory = realpathSync(mkdtempSync(join(tmpdir(), "mdtoc insert tests ")));
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

  test("creates the requested table of contents for a new file", async () => {
    writeMarkdown("NOTES.md", "# Guide\n\n## Installation\n\n## Usage\n");
    const result = await run(["--insert", "NOTES.md"]);

    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(readFileSync(join(directory, "NOTES.md"), "utf8")).toBe(
      "# Guide\n<!-- toc -->\n- [Guide](#guide)\n  - [Installation](#installation)\n  - [Usage](#usage)\n<!-- tocstop -->\n\n## Installation\n\n## Usage\n",
    );
  });

  test("a second run preserves file bytes and modification time", async () => {
    const file = writeMarkdown("NOTES.md", "# Guide\n\n## Installation\n");
    expect((await run(["--insert", "NOTES.md"])).exitCode).toBe(0);
    const oldTime = new Date("2000-01-01T00:00:00Z");
    utimesSync(file, oldTime, oldTime);
    const before = snapshot(file);

    const result = await run(["NOTES.md", "--insert"]);

    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(readFileSync(file)).toEqual(before.bytes);
    expect(statSync(file).mtimeMs).toBe(before.modified);
  });

  test("refreshes an existing valid pair as usual", async () => {
    const file = writeMarkdown(
      "NOTES.md",
      "<!-- toc -->\nold entry\n<!-- tocstop -->\n# Guide\n## Fresh\n",
    );
    const result = await run(["--insert", "NOTES.md"]);

    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(readFileSync(file, "utf8")).toBe(
      "<!-- toc -->\n- [Guide](#guide)\n  - [Fresh](#fresh)\n<!-- tocstop -->\n# Guide\n## Fresh\n",
    );
  });

  test("keeps one-marker and wrong-order files unchanged with the existing error", async () => {
    const invalidDocuments = [
      "<!-- toc -->\n# Guide\n",
      "<!-- tocstop -->\n# Guide\n",
      "<!-- tocstop -->\n<!-- toc -->\n# Guide\n",
    ];

    for (const markdown of invalidDocuments) {
      const file = writeMarkdown("invalid.md", markdown);
      const before = snapshot(file);
      const result = await run(["--insert", "invalid.md"]);

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(
        "mdtoc: Add exactly one <!-- toc --> followed by <!-- tocstop --> to the Markdown file.",
      );
      expect(readFileSync(file)).toEqual(before.bytes);
    }
  });

  test("applies depth and exclusion options while generating the inserted TOC", async () => {
    const file = writeMarkdown("NOTES.md", "# Guide\n## Keep\n## Skip\n### Child\n");
    const result = await run([
      "--insert",
      "--min-depth",
      "2",
      "--max-depth",
      "3",
      "--exclude",
      "Skip",
      "NOTES.md",
    ]);

    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(readFileSync(file, "utf8")).toBe(
      "# Guide\n<!-- toc -->\n- [Keep](#keep)\n  - [Child](#child)\n<!-- tocstop -->\n## Keep\n## Skip\n### Child\n",
    );
  });

  test("preserves CRLF bytes in the inserted markers and generated TOC", async () => {
    const file = writeMarkdown("NOTES.md", "# Guide\r\n## More\r\n");
    const result = await run(["--insert", "NOTES.md"]);

    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(readFileSync(file)).toEqual(
      Buffer.from(
        "# Guide\r\n<!-- toc -->\r\n- [Guide](#guide)\r\n  - [More](#more)\r\n<!-- tocstop -->\r\n## More\r\n",
      ),
    );
  });

  test("continues through multiple files and prefixes a marker error", async () => {
    const good = writeMarkdown("good.md", "# Good\n");
    writeMarkdown("bad.md", "<!-- tocstop -->\n");
    const result = await run(["--insert", "good.md", "bad.md"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain(
      "mdtoc: bad.md: Add exactly one <!-- toc --> followed by <!-- tocstop --> to the Markdown file.",
    );
    expect(readFileSync(good, "utf8")).toBe(
      "# Good\n<!-- toc -->\n- [Good](#good)\n<!-- tocstop -->\n",
    );
  });

  test("treats --insert after -- as a file path, not as an option", async () => {
    const file = writeMarkdown("--insert", "# Guide\n");
    const result = await run(["--", "--insert"]);

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Add exactly one <!-- toc --> followed by <!-- tocstop -->");
    expect(readFileSync(file, "utf8")).toBe("# Guide\n");
  });

  test("rejects conflicts before reading or writing any file", async () => {
    const file = writeMarkdown("NOTES.md", "# Guide\n");
    const before = snapshot(file);
    const cases = [
      [
        ["--insert", "--check", "missing.md"],
        "mdtoc: --insert and --check cannot be used together.",
      ],
      [
        ["--insert", "--print", "missing.md"],
        "mdtoc: --insert and --print cannot be used together.",
      ],
    ] as const;

    for (const [args, message] of cases) {
      const result = await run([...args]);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain(message);
      expect(result.stderr).not.toContain("ENOENT");
    }
    expect(readFileSync(file)).toEqual(before.bytes);
    expect(statSync(file).mtimeMs).toBe(before.modified);
  });

  test("keeps help ahead of all flag conflicts and documents insert", async () => {
    const result = await run(["--insert", "--print", "--check", "--help"]);
    const output = result.stdout.replace(/\r\n/g, "\n");
    const printLine = output.indexOf(
      "  --print             Print the generated entries to stdout; never write; no markers needed.",
    );
    const insertLine = output.indexOf(
      "  --insert            Add the marker pair first when the file has neither marker.",
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(output).toContain(
      "Usage: bun run src/cli.ts [--check] [--print] [--insert] [--max-depth <1-6>] [--min-depth <1-6>] [--exclude <text>]... <file>...",
    );
    expect(insertLine).toBeGreaterThan(printLine);
  });
});

describe("insert option README documentation", () => {
  test("documents insertion, its option row, placement, and supplied example", () => {
    const readme = readFileSync(join(root, "README.md"), "utf8").replace(/\r\n/g, "\n");
    const optionsStart = readme.indexOf("### Options");
    const insertStart = readme.indexOf("### Add the markers");
    const headingsStart = readme.indexOf("### Headings and anchors");
    const expectedSection = [
      "### Add the markers",
      "",
      "Use `--insert` to start a table of contents in a file that has no markers yet. When the file contains neither `<!-- toc -->` nor `<!-- tocstop -->`, mdtoc adds the pair directly after the first level-1 ATX heading outside code fences (or at the start of the file when there is none), with no blank line added, and then generates the entries. A file that already has markers is refreshed as without the flag, so the command is safe to repeat; a file with only one marker is still an error. For a `NOTES.md` file containing `# Guide`, `## Installation` and `## Usage` with blank lines between them, run:",
      "",
      "```sh",
      "bun run src/cli.ts --insert NOTES.md",
      "```",
      "",
      "The file becomes:",
      "",
      "```markdown",
      "# Guide",
      "<!-- toc -->",
      "- [Guide](#guide)",
      "  - [Installation](#installation)",
      "  - [Usage](#usage)",
      "<!-- tocstop -->",
      "",
      "## Installation",
      "",
      "## Usage",
      "```",
      "",
      "`--insert` cannot be combined with `--check` or `--print`; either error exits 1:",
      "",
      "```text",
      "mdtoc: --insert and --check cannot be used together.",
      "mdtoc: --insert and --print cannot be used together.",
      "```",
    ]
      .join("\n")
      .replaceAll("`", String.fromCharCode(96));

    expect(readme).toContain(
      'Missing markers are an error and leave the file unchanged unless `--insert` is given (see "Add the markers").'.replaceAll(
        "`",
        String.fromCharCode(96),
      ),
    );
    expect(readme).toContain(
      "| `--insert` | Add the marker pair first when the file has neither marker. |".replaceAll(
        "`",
        String.fromCharCode(96),
      ),
    );
    expect(optionsStart).toBeGreaterThanOrEqual(0);
    expect(insertStart).toBeGreaterThan(optionsStart);
    expect(headingsStart).toBeGreaterThan(insertStart);
    expect(readme.slice(insertStart, headingsStart).trim()).toBe(expectedSection);
  });
});
