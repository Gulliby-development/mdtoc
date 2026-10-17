import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "../src/cli";
import { generateToc, updateToc } from "../src/toc";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = join(root, "src", "cli.ts");
const exampleMarkdown = [
  "# Guide",
  "## Installation",
  "## Usage",
  "### Sub",
  "### More",
  "## License",
].join("\n");
const numberedMinDepthTwo = [
  "1. [Installation](#installation)",
  "2. [Usage](#usage)",
  "    1. [Sub](#sub)",
  "    2. [More](#more)",
  "3. [License](#license)",
].join("\n");
const numberedDefault = [
  "1. [Guide](#guide)",
  "    1. [Installation](#installation)",
  "    2. [Usage](#usage)",
  "        1. [Sub](#sub)",
  "        2. [More](#more)",
  "    3. [License](#license)",
].join("\n");
const numberedGEntries = [
  "1. [Guide](#guide)",
  "    1. [Installation](#installation)",
  "    2. [Usage](#usage)",
  "        1. [Sub](#sub)",
].join("\n");

function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

describe("numbered table of contents", () => {
  let directory: string;

  beforeEach(() => {
    directory = realpathSync(mkdtempSync(join(tmpdir(), "mdtoc numbered tests ")));
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

  test("keeps the default key absent and accepts the flag among one or two paths", () => {
    const defaults = parseArgs(["NOTES.md"]);
    expect(defaults.numbered).toBeUndefined();
    expect(Object.hasOwn(defaults, "numbered")).toBe(false);

    const cases = [
      { args: ["--numbered", "one.md"], files: ["one.md"] },
      { args: ["one.md", "--numbered"], files: ["one.md"] },
      { args: ["one.md", "--numbered", "two.md"], files: ["one.md", "two.md"] },
      { args: ["one.md", "two.md", "--numbered"], files: ["one.md", "two.md"] },
    ];
    for (const { args, files } of cases) {
      expect(parseArgs(args)).toMatchObject({ files, numbered: true });
    }
  });

  test("rejects the equals form and treats the flag after the delimiter as a path", async () => {
    writeMarkdown("NOTES.md", "<!-- toc -->\n<!-- tocstop -->\n# Guide");
    expect(() => parseArgs(["--numbered=1", "NOTES.md"])).toThrow(
      "Unknown option: --numbered=1. Use --help for usage.",
    );

    const unknown = await run(["--numbered=1", "NOTES.md"]);
    expect(unknown.exitCode).toBe(1);
    expect(unknown.stdout).toBe("");
    expect(normalizeLineEndings(unknown.stderr)).toBe(
      "mdtoc: Unknown option: --numbered=1. Use --help for usage.\n",
    );

    const path = writeMarkdown("--numbered", "<!-- toc -->\n<!-- tocstop -->\n# Guide");
    const result = await run(["--", "--numbered"]);
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    expect(readFileSync(path, "utf8")).toBe(
      "<!-- toc -->\n- [Guide](#guide)\n<!-- tocstop -->\n# Guide",
    );
    expect(parseArgs(["--", "--numbered"]).files).toEqual(["--numbered"]);
    expect(Object.hasOwn(parseArgs(["--", "--numbered"]), "numbered")).toBe(false);
  });

  test("documents the exact help lines and preserves help precedence and conflicts", async () => {
    const help = await run(["--print", "--check", "--help"]);
    const output = normalizeLineEndings(help.stdout);
    expect(help.exitCode).toBe(0);
    expect(help.stderr).toBe("");
    expect(output.split("\n")[0]).toBe(
      "Usage: bun run src/cli.ts [--check] [--print] [--insert] [--numbered] [--max-depth <1-6>] [--min-depth <1-6>] [--exclude <text>]... <file>...",
    );
    const helpLines = output.split("\n");
    const insertLine = helpLines.indexOf(
      "  --insert            Add the marker pair first when the file has neither marker.",
    );
    expect(helpLines[insertLine + 1]).toBe(
      "  --numbered          Write the entries as a numbered list (1. 2. 3.) instead of bullets.",
    );
    expect(() => parseArgs(["--numbered", "--print", "--check", "NOTES.md"])).toThrow(
      "--print and --check cannot be used together.",
    );
    expect(() => parseArgs(["--numbered", "--insert", "--check", "NOTES.md"])).toThrow(
      "--insert and --check cannot be used together.",
    );
  });

  test("matches the default numbered example and preserves omitted and false bullet output", () => {
    expect(generateToc(exampleMarkdown, 6, "\n", 1, [], true)).toBe(numberedDefault);
    const bullets = [
      "- [Guide](#guide)",
      "  - [Installation](#installation)",
      "  - [Usage](#usage)",
      "    - [Sub](#sub)",
      "    - [More](#more)",
      "  - [License](#license)",
    ].join("\n");
    expect(generateToc(exampleMarkdown)).toBe(bullets);
    expect(generateToc(exampleMarkdown, 6, "\n", 1, [], false)).toBe(bullets);
  });

  test("matches the exact min-depth two worked example", () => {
    expect(generateToc(exampleMarkdown, 6, "\n", 2, [], true)).toBe(numberedMinDepthTwo);
  });

  test("restarts every deeper counter when a new shallower parent appears", () => {
    const markdown = [
      "# One",
      "## First",
      "### First child",
      "#### First grandchild",
      "### Second child",
      "# Two",
      "## Second",
      "### Third child",
      "#### Second grandchild",
      "### Fourth child",
    ].join("\n");
    expect(generateToc(markdown, 6, "\n", 1, [], true)).toBe(
      [
        "1. [One](#one)",
        "    1. [First](#first)",
        "        1. [First child](#first-child)",
        "            1. [First grandchild](#first-grandchild)",
        "        2. [Second child](#second-child)",
        "2. [Two](#two)",
        "    1. [Second](#second)",
        "        1. [Third child](#third-child)",
        "            1. [Second grandchild](#second-grandchild)",
        "        2. [Fourth child](#fourth-child)",
      ].join("\n"),
    );
  });

  test("preserves skipped depths without incrementing an intermediate counter", () => {
    const markdown = [
      "# Guide",
      "### Third",
      "## Second",
      "### Child",
      "###### Sixth",
      "### Again",
    ].join("\n");
    expect(generateToc(markdown, 6, "\n", 1, [], true)).toBe(
      [
        "1. [Guide](#guide)",
        "        1. [Third](#third)",
        "    1. [Second](#second)",
        "        1. [Child](#child)",
        "                    1. [Sixth](#sixth)",
        "        2. [Again](#again)",
      ].join("\n"),
    );
  });

  test("does not count headings filtered by min-depth, max-depth, or exclude", () => {
    const markdown = [
      "# Guide",
      "## Keep",
      "### Deep A",
      "#### Too deep",
      "### Excluded",
      "### Deep B",
      "## Next",
      "### More",
    ].join("\n");
    expect(generateToc(markdown, 3, "\n", 2, ["Excluded"], true)).toBe(
      [
        "1. [Keep](#keep)",
        "    1. [Deep A](#deep-a)",
        "    2. [Deep B](#deep-b)",
        "2. [Next](#next)",
        "    1. [More](#more)",
      ].join("\n"),
    );
  });

  test("keeps escaped brackets and backslashes in numbered labels and anchors", () => {
    const markdown = "## [bracket] and \\\\ slash";
    expect(generateToc(markdown, 6, "\n", 1, [], true)).toBe(
      "    1. [\\[bracket\\] and \\\\ slash](#bracket-and-slash)",
    );
  });

  test("uses decimal numbering through ten and four spaces per nested depth", () => {
    const markdown = [
      "# Parent",
      "## Item 1",
      "## Item 2",
      "## Item 3",
      "## Item 4",
      "## Item 5",
      "## Item 6",
      "## Item 7",
      "## Item 8",
      "## Item 9",
      "## Item 10",
      "### Nested",
    ].join("\n");
    expect(generateToc(markdown, 6, "\n", 2, [], true)).toBe(
      [
        "1. [Item 1](#item-1)",
        "2. [Item 2](#item-2)",
        "3. [Item 3](#item-3)",
        "4. [Item 4](#item-4)",
        "5. [Item 5](#item-5)",
        "6. [Item 6](#item-6)",
        "7. [Item 7](#item-7)",
        "8. [Item 8](#item-8)",
        "9. [Item 9](#item-9)",
        "10. [Item 10](#item-10)",
        "    1. [Nested](#nested)",
      ].join("\n"),
    );
  });

  test("returns empty output for empty selections in both APIs and print mode", async () => {
    expect(generateToc("plain text", 6, "\n", 1, [], true)).toBe("");
    expect(generateToc(exampleMarkdown, 6, "\n", 6, [], true)).toBe("");
    expect(updateToc("<!-- toc -->\n<!-- tocstop -->\nplain text", 6, 1, [], true)).toBe(
      "<!-- toc -->\n<!-- tocstop -->\nplain text",
    );

    writeMarkdown("plain.md", "plain text");
    writeMarkdown("NOTES.md", exampleMarkdown);
    const noHeadings = await run(["--print", "--numbered", "plain.md"]);
    expect(noHeadings).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const noSelection = await run(["--print", "--numbered", "--min-depth", "6", "NOTES.md"]);
    expect(noSelection).toEqual({ exitCode: 0, stdout: "", stderr: "" });
  });

  test("updates the exact G.md fixture while preserving LF and CRLF source lines", () => {
    const lines = [
      "# Guide",
      "",
      "<!-- toc -->",
      "<!-- tocstop -->",
      "",
      "## Installation",
      "",
      "## Usage",
      "",
      "### Sub",
    ];
    const markdown = lines.join("\n");
    const expected = [
      "# Guide",
      "",
      "<!-- toc -->",
      "1. [Guide](#guide)",
      "    1. [Installation](#installation)",
      "    2. [Usage](#usage)",
      "        1. [Sub](#sub)",
      "<!-- tocstop -->",
      "",
      "## Installation",
      "",
      "## Usage",
      "",
      "### Sub",
    ].join("\n");
    expect(updateToc(markdown, 6, 1, [], true)).toBe(expected);
    expect(updateToc(markdown.replaceAll("\n", "\r\n"), 6, 1, [], true)).toBe(
      expected.replaceAll("\n", "\r\n"),
    );
  });

  test("prints worked outputs, updates and checks both styles without writing during reads", async () => {
    const notes = writeMarkdown("NOTES.md", exampleMarkdown);
    const beforePrint = snapshot(notes);
    const minDepthPrint = await run(["--print", "--numbered", "--min-depth", "2", "NOTES.md"]);
    expect(minDepthPrint).toEqual({
      exitCode: 0,
      stdout: `${numberedMinDepthTwo}\n`,
      stderr: "",
    });
    const defaultPrint = await run(["--print", "--numbered", "NOTES.md"]);
    expect(defaultPrint).toEqual({
      exitCode: 0,
      stdout: `${numberedDefault}\n`,
      stderr: "",
    });
    expect(readFileSync(notes)).toEqual(beforePrint.bytes);
    expect(statSync(notes).mtimeMs).toBe(beforePrint.modified);

    const gMarkdown = [
      "# Guide",
      "",
      "<!-- toc -->",
      "<!-- tocstop -->",
      "",
      "## Installation",
      "",
      "## Usage",
      "",
      "### Sub",
    ].join("\n");
    const g = writeMarkdown("G.md", gMarkdown);
    const generated = await run(["--numbered", "G.md"]);
    expect(generated).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const numberedFile = [
      "# Guide",
      "",
      "<!-- toc -->",
      "1. [Guide](#guide)",
      "    1. [Installation](#installation)",
      "    2. [Usage](#usage)",
      "        1. [Sub](#sub)",
      "<!-- tocstop -->",
      "",
      "## Installation",
      "",
      "## Usage",
      "",
      "### Sub",
    ].join("\n");
    expect(readFileSync(g, "utf8")).toBe(numberedFile);

    const beforeCheck = snapshot(g);
    expect(await run(["--check", "--numbered", "G.md"])).toEqual({
      exitCode: 0,
      stdout: "",
      stderr: "",
    });
    const numberedStyleStale = await run(["--check", "G.md"]);
    expect(numberedStyleStale.exitCode).toBe(1);
    expect(numberedStyleStale.stdout).toBe("");
    expect(normalizeLineEndings(numberedStyleStale.stderr)).toBe(
      'TOC is stale in "G.md". Run without --check to update it.\n',
    );
    expect(readFileSync(g)).toEqual(beforeCheck.bytes);
    expect(statSync(g).mtimeMs).toBe(beforeCheck.modified);

    writeFileSync(g, updateToc(gMarkdown, 6, 1, [], false));
    const beforeBulletedCheck = snapshot(g);
    expect(await run(["--check", "G.md"])).toEqual({
      exitCode: 0,
      stdout: "",
      stderr: "",
    });
    const bulletedStyleStale = await run(["--check", "--numbered", "G.md"]);
    expect(bulletedStyleStale.exitCode).toBe(1);
    expect(bulletedStyleStale.stdout).toBe("");
    expect(normalizeLineEndings(bulletedStyleStale.stderr)).toBe(
      'TOC is stale in "G.md". Run without --check to update it.\n',
    );
    expect(readFileSync(g)).toEqual(beforeBulletedCheck.bytes);
    expect(statSync(g).mtimeMs).toBe(beforeBulletedCheck.modified);

    const crlfLines = [
      "# Guide",
      "",
      "<!-- toc -->",
      "<!-- tocstop -->",
      "",
      "## Installation",
      "",
      "## Usage",
      "",
      "### Sub",
    ];
    const crlf = writeMarkdown("CRLF.md", `${crlfLines.join("\r\n")}\r\n`);
    const crlfGenerated = await run(["--numbered", "CRLF.md"]);
    expect(crlfGenerated).toEqual({ exitCode: 0, stdout: "", stderr: "" });
    const crlfExpected = `${numberedGEntries.replaceAll("\n", "\r\n")}\r\n`;
    const crlfContents = readFileSync(crlf, "utf8");
    expect(crlfContents).toContain(`<!-- toc -->\r\n${crlfExpected}<!-- tocstop -->`);
    expect(crlfContents).not.toMatch(/(^|[^\r])\n/g);

    const crlfBefore = snapshot(crlf);
    const crlfPrint = await run(["--print", "--numbered", "CRLF.md"]);
    expect(crlfPrint).toEqual({
      exitCode: 0,
      stdout: `${numberedGEntries}\n`,
      stderr: "",
    });
    expect(crlfPrint.stdout).not.toContain("\r");
    expect(await run(["--check", "--numbered", "CRLF.md"])).toEqual({
      exitCode: 0,
      stdout: "",
      stderr: "",
    });
    expect(readFileSync(crlf)).toEqual(crlfBefore.bytes);
    expect(statSync(crlf).mtimeMs).toBe(crlfBefore.modified);
  });

  test("inserts numbered entries in the existing marker position and respects existing markers", async () => {
    const inserted = writeMarkdown("insert.md", "# Guide\n\n## Installation\n\n## Usage");
    expect(await run(["--insert", "--numbered", "insert.md"])).toEqual({
      exitCode: 0,
      stdout: "",
      stderr: "",
    });
    expect(readFileSync(inserted, "utf8")).toBe(
      [
        "# Guide",
        "<!-- toc -->",
        "1. [Guide](#guide)",
        "    1. [Installation](#installation)",
        "    2. [Usage](#usage)",
        "<!-- tocstop -->",
        "",
        "## Installation",
        "",
        "## Usage",
      ].join("\n"),
    );
    expect(await run(["--check", "--numbered", "insert.md"])).toEqual({
      exitCode: 0,
      stdout: "",
      stderr: "",
    });

    const existing = writeMarkdown(
      "existing.md",
      "# Guide\n<!-- toc -->\nstale\n<!-- tocstop -->\n## Existing",
    );
    expect(await run(["--insert", "--numbered", "existing.md"])).toEqual({
      exitCode: 0,
      stdout: "",
      stderr: "",
    });
    const existingContents = readFileSync(existing, "utf8");
    expect(existingContents).toBe(
      "# Guide\n<!-- toc -->\n1. [Guide](#guide)\n    1. [Existing](#existing)\n<!-- tocstop -->\n## Existing",
    );
    expect(existingContents.match(/<!-- toc -->/g)).toHaveLength(1);
    expect(existingContents.match(/<!-- tocstop -->/g)).toHaveLength(1);
    expect(await run(["--check", "--numbered", "existing.md"])).toEqual({
      exitCode: 0,
      stdout: "",
      stderr: "",
    });
  });
});
