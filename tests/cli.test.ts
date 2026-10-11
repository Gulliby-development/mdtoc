import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "../src/cli";
import { extractHeadings, generateToc, slugify, updateToc } from "../src/toc";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = join(root, "src", "cli.ts");
const marked = (body: string, interior = "outdated"): string =>
  `<!-- toc -->\n${interior}\n<!-- tocstop -->\n${body}`;

describe("heading extraction and anchors", () => {
  test("extracts ATX and Setext headings in document order", () => {
    const markdown = [
      "# Guide",
      "## Hello, World! ###",
      "Setext title",
      "============",
      "Setext subtitle",
      "---------------",
      "   ### Indented heading",
      "#### Four",
      "##### Five",
      "###### Six",
      "####### Not a heading",
      "#No separating space",
      "    ## Indented code",
    ].join("\n");
    expect(extractHeadings(markdown)).toEqual([
      { level: 1, text: "Guide", anchor: "guide" },
      { level: 2, text: "Hello, World!", anchor: "hello-world" },
      { level: 1, text: "Setext title", anchor: "setext-title" },
      { level: 2, text: "Setext subtitle", anchor: "setext-subtitle" },
      { level: 3, text: "Indented heading", anchor: "indented-heading" },
      { level: 4, text: "Four", anchor: "four" },
      { level: 5, text: "Five", anchor: "five" },
      { level: 6, text: "Six", anchor: "six" },
    ]);
  });

  test("ignores backtick and tilde fences, including longer runs and false closers", () => {
    const markdown = [
      "# Before",
      "````ts",
      "## Hidden",
      "```",
      "Still hidden",
      "===",
      "~~~~",
      "## Still hidden",
      "```` trailing text",
      "## Also hidden",
      "`````",
      "## Between",
      "   ~~~~markdown",
      "# Hidden again",
      "~~~",
      "Hidden Setext",
      "---",
      "~~~~~",
      "After",
      "===",
    ].join("\n");
    expect(extractHeadings(markdown)).toEqual([
      { level: 1, text: "Before", anchor: "before" },
      { level: 2, text: "Between", anchor: "between" },
      { level: 1, text: "After", anchor: "after" },
    ]);
  });

  test.each(["```", "~~~~"])("an unclosed %s fence continues to EOF", (fence) => {
    expect(extractHeadings(`# Visible\n${fence}\n## Hidden\nHidden\n===`)).toEqual([
      { level: 1, text: "Visible", anchor: "visible" },
    ]);
  });

  test("supports CRLF and lone CR lines", () => {
    expect(extractHeadings("# One\r\nTwo\r\n---\r### Three").map((h) => h.anchor)).toEqual([
      "one",
      "two",
      "three",
    ]);
  });

  test("does not treat separated text or code/list/quote lines as Setext titles", () => {
    expect(extractHeadings("Text\n\n---\n    Code\n===\n> Quote\n---\n- List\n---")).toEqual([]);
  });

  test.each([
    ["Hello, World!", "hello-world"],
    ["foo_bar", "foobar"],
    ["**Bold** _italic_ ~~strike~~ `code`", "bold-italic-strike-code"],
    ["[Setup](https://example.com) and ![Logo](logo.png)", "setup-and-logo"],
    ["[Reference][id] <em>Text</em>", "reference-text"],
    ["Crème 東京 123", "crème-東京-123"],
    ["One  \t Two", "one-two"],
  ])("slugifies %s", (heading, anchor) => {
    expect(slugify(heading)).toBe(anchor);
  });

  test("removes underscores from anchors while preserving visible heading text", () => {
    expect(generateToc("## foo_bar\n## foobar\n## foo_bar")).toBe(
      "  - [foo_bar](#foobar)\n  - [foobar](#foobar-1)\n  - [foo_bar](#foobar-2)",
    );
  });

  test("assigns duplicate suffixes after slug normalization", () => {
    expect(
      extractHeadings("## Hello, World!\n## Hello\n## Hello\n## HELLO!\n## **Hello**").map(
        (h) => h.anchor,
      ),
    ).toEqual(["hello-world", "hello", "hello-1", "hello-2", "hello-3"]);
  });

  test("avoids collisions with explicitly suffixed heading text", () => {
    expect(extractHeadings("# Hello\n# Hello-1\n# Hello\n# Hello").map((h) => h.anchor)).toEqual([
      "hello",
      "hello-1",
      "hello-2",
      "hello-3",
    ]);
  });
});

describe("TOC rendering and marker replacement", () => {
  const levels = "# One\n## Two\n### Three\n#### Four\n##### Five\n###### Six";

  test("renders every level by default with two-space nesting", () => {
    expect(generateToc(levels)).toBe(
      "- [One](#one)\n  - [Two](#two)\n    - [Three](#three)\n      - [Four](#four)\n        - [Five](#five)\n          - [Six](#six)",
    );
  });

  test.each([
    [1, "- [One](#one)"],
    [3, "- [One](#one)\n  - [Two](#two)\n    - [Three](#three)"],
  ])("limits rendering to depth %i", (depth, expected) => {
    expect(generateToc(levels, depth)).toBe(expected);
  });

  test("depth filtering retains anchors assigned in full document order", () => {
    expect(generateToc("#### Hello\n## Hello", 3)).toBe("  - [Hello](#hello-1)");
  });

  test("uses visible inline text in link labels", () => {
    expect(generateToc("## **Bold** and [Setup](https://example.com)")).toBe(
      "  - [Bold and Setup](#bold-and-setup)",
    );
  });

  test.each([0, 7, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid API depth %s",
    (depth) => {
      expect(() => generateToc(levels, depth)).toThrow("integer from 1 through 6");
      expect(() => updateToc(marked(levels), depth)).toThrow("integer from 1 through 6");
    },
  );

  test.each(["\n", "\r\n", "\r"])("preserves surrounding bytes and %j newlines", (eol) => {
    const before = `# Before${eol}intro  ${eol}<!-- toc -->`;
    const after = `<!-- tocstop -->${eol}## After${eol}tail  `;
    const document = `${before}${eol}# Stale heading${eol}${after}`;
    const expected = `${before}${eol}- [Before](#before)${eol}  - [After](#after)${eol}${after}`;
    expect(updateToc(document)).toBe(expected);
    expect(updateToc(expected)).toBe(expected);
  });

  test("produces a stable empty TOC for a document without headings", () => {
    const expected = "<!-- toc -->\n<!-- tocstop -->\nPlain text";
    expect(updateToc(marked("Plain text"))).toBe(expected);
    expect(updateToc(expected)).toBe(expected);
  });

  test.each([
    "# No markers",
    "<!-- toc -->\n# Missing end",
    "# Missing start\n<!-- tocstop -->",
    "<!-- tocstop -->\n<!-- toc -->",
    "<!-- toc -->\n<!-- toc -->\n<!-- tocstop -->",
    "<!-- toc -->\n<!-- tocstop -->\n<!-- tocstop -->",
  ])("rejects missing or ambiguous markers: %s", (document) => {
    expect(() => updateToc(document)).toThrow(
      "Add exactly one <!-- toc --> followed by <!-- tocstop -->",
    );
  });
});

describe("CLI argument parsing", () => {
  test("uses depth 6 and generation mode by default", () => {
    expect(parseArgs(["guide.md"])).toEqual({
      files: ["guide.md"],
      check: false,
      maxDepth: 6,
      help: false,
    });
  });

  test("accepts multiple paths in order and deduplicates resolved paths", () => {
    expect(parseArgs(["guide.md", "other.md", "./guide.md"]).files).toEqual([
      "guide.md",
      "other.md",
    ]);
  });

  test("retains the no-path error while allowing help without a path", () => {
    expect(() => parseArgs([])).toThrow("Provide a Markdown file path. Use --help for usage.");
    expect(parseArgs(["--help"]).files).toEqual([]);
  });

  test("accepts options before or after the path and equals-style depth", () => {
    expect(parseArgs(["--check", "guide.md", "--max-depth", "3"])).toEqual(
      parseArgs(["--max-depth=3", "guide.md", "--check"]),
    );
  });

  test("supports help and option-like paths after --", () => {
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
    expect(parseArgs(["--", "-guide.md", "another.md"]).files).toEqual(["-guide.md", "another.md"]);
  });
});

describe("CLI subprocess behavior", () => {
  let directory: string;
  let file: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "mdtoc tests "));
    file = join(directory, "User Guide.md");
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  async function run(args: string[]) {
    // Bun consumes its own separator; preserve any separator in the CLI arguments.
    const child = Bun.spawn([process.execPath, "run", cli, "--", ...args], {
      cwd: directory,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    return { exitCode, stdout, stderr };
  }

  function snapshot() {
    return { bytes: readFileSync(file), modified: statSync(file).mtimeMs };
  }

  test("generates a TOC in place using a path with spaces", async () => {
    writeFileSync(file, marked("# Guide\n## Hello, World!\n## Hello\n## Hello"));
    const result = await run([file]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(readFileSync(file, "utf8")).toBe(
      "<!-- toc -->\n- [Guide](#guide)\n  - [Hello, World!](#hello-world)\n  - [Hello](#hello)\n  - [Hello](#hello-1)\n<!-- tocstop -->\n# Guide\n## Hello, World!\n## Hello\n## Hello",
    );
  });

  test("check exits 1 for stale content and 0 after generation, without writing", async () => {
    writeFileSync(file, marked("# Guide"));
    const stale = snapshot();
    const result = await run(["--check", file]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("stale");
    expect(result.stderr).toContain("Run without --check");
    expect(snapshot()).toEqual(stale);

    expect((await run([file])).exitCode).toBe(0);
    const current = snapshot();
    const checked = await run([file, "--check"]);
    expect(checked.exitCode).toBe(0);
    expect(checked.stderr).toBe("");
    expect(snapshot()).toEqual(current);
  });

  test("checks multiple current files successfully and silently", async () => {
    const first = join(directory, "first.md");
    const second = join(directory, "second.md");
    writeFileSync(first, updateToc(marked("# First")));
    writeFileSync(second, updateToc(marked("# Second")));

    const result = await run(["--check", first, second]);
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
  });

  test("reports only stale files in multi-file check mode without writing", async () => {
    const files = ["one.md", "stale.md", "three.md"].map((name) => join(directory, name));
    writeFileSync(files[0], updateToc(marked("# One")));
    writeFileSync(files[1], marked("# Stale"));
    writeFileSync(files[2], updateToc(marked("# Three")));
    const before = files.map((path) => readFileSync(path));

    const result = await run(["--check", ...files]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe(
      `TOC is stale in "${files[1]}". Run without --check to update it.\n`,
    );
    expect(files.map((path) => readFileSync(path))).toEqual(before);
  });

  test("updates only stale files in a multi-file run", async () => {
    const current = join(directory, "current.md");
    const stale = join(directory, "stale.md");
    writeFileSync(current, updateToc(marked("# Current")));
    writeFileSync(stale, marked("# Stale"));
    const currentBefore = readFileSync(current);

    const result = await run([current, stale]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
    expect(readFileSync(current)).toEqual(currentBefore);
    expect(readFileSync(stale, "utf8")).toBe(updateToc(marked("# Stale")));
  });

  test("continues after a missing file and prefixes its error", async () => {
    const stale = join(directory, "later.md");
    writeFileSync(stale, marked("# Later"));
    const result = await run(["missing.md", stale]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/^mdtoc: missing\.md: .*\n$/);
    expect(readFileSync(stale, "utf8")).toBe(updateToc(marked("# Later")));
  });

  test("continues after invalid markers and reports the exact prefixed error", async () => {
    const invalid = join(directory, "invalid.md");
    const stale = join(directory, "later.md");
    writeFileSync(invalid, "# Missing markers");
    writeFileSync(stale, marked("# Later"));
    const result = await run([invalid, stale]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      "mdtoc: " +
        invalid +
        ": Add exactly one <!-- toc --> followed by <!-- tocstop --> to the Markdown file.\n",
    );
    expect(readFileSync(stale, "utf8")).toBe(updateToc(marked("# Later")));
  });

  test("processes a resolved duplicate path once", async () => {
    const duplicate = join(directory, "duplicate.md");
    writeFileSync(duplicate, marked("# Duplicate"));
    const result = await run(["--check", "duplicate.md", duplicate]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      'TOC is stale in "duplicate.md". Run without --check to update it.\n',
    );
  });

  test("applies --max-depth to every file", async () => {
    const first = join(directory, "first.md");
    const second = join(directory, "second.md");
    const body = "# One\n## Two\n### Three";
    writeFileSync(first, marked(body));
    writeFileSync(second, marked(body));
    const result = await run(["--max-depth", "1", first, second]);
    expect(result.exitCode).toBe(0);
    expect(readFileSync(first, "utf8")).toBe(updateToc(marked(body), 1));
    expect(readFileSync(second, "utf8")).toBe(updateToc(marked(body), 1));
  });

  test("single-file failures retain the unprefixed error", async () => {
    writeFileSync(file, "# Missing markers");
    const result = await run([file]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe(
      "mdtoc: Add exactly one <!-- toc --> followed by <!-- tocstop --> to the Markdown file.\n",
    );
  });

  test("preserves CRLF endings when updating a file", async () => {
    const crlf = join(directory, "windows.md");
    const original = marked("# Windows\n## Child").replaceAll("\n", "\r\n");
    writeFileSync(crlf, original);
    const result = await run([crlf]);
    expect(result.exitCode).toBe(0);
    const updated = readFileSync(crlf, "utf8");
    expect(updated).toContain("\r\n");
    expect(updated.replaceAll("\r\n", "")).not.toContain("\n");
  });

  test.each([1, 3])("generates and checks with --max-depth %i", async (depth) => {
    writeFileSync(file, marked("# One\n## Two\n### Three\n#### Four\n##### Five\n###### Six"));
    const result = await run(["--max-depth", String(depth), file]);
    expect(result.exitCode).toBe(0);
    const interior = readFileSync(file, "utf8").split("<!-- tocstop -->")[0];
    expect(interior).toBe(
      depth === 1
        ? "<!-- toc -->\n- [One](#one)\n"
        : "<!-- toc -->\n- [One](#one)\n  - [Two](#two)\n    - [Three](#three)\n",
    );
    const current = snapshot();
    expect((await run(["--check", `--max-depth=${depth}`, file])).exitCode).toBe(0);
    expect(snapshot()).toEqual(current);
  });

  test.each([
    "# No markers",
    "<!-- toc -->\n# Missing end",
    "# Missing start\n<!-- tocstop -->",
    "<!-- tocstop -->\n<!-- toc -->",
    "<!-- toc -->\n<!-- toc -->\n<!-- tocstop -->",
  ])("marker errors leave the file untouched: %s", async (document) => {
    writeFileSync(file, document);
    const before = snapshot();
    for (const args of [[file], ["--check", file]]) {
      const result = await run(args);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("<!-- toc -->");
      expect(result.stderr).toContain("<!-- tocstop -->");
      expect(snapshot()).toEqual(before);
    }
  });

  test.each(["0", "7", "-1", "1.5", "NaN", "abc", ""])(
    "invalid --max-depth %j fails before writing",
    async (value) => {
      writeFileSync(file, marked("# Guide"));
      const before = snapshot();
      const result = await run([file, `--max-depth=${value}`]);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("integer from 1 through 6");
      expect(snapshot()).toEqual(before);
    },
  );

  test.each([
    { args: [], message: "Markdown file path" },
    { args: ["--unknown"], message: "Unknown option" },
    { args: ["--max-depth"], message: "integer from 1 through 6" },
  ])("rejects invalid arguments: $args", async ({ args, message }) => {
    writeFileSync(file, marked("# Guide"));
    const before = snapshot();
    const result = await run([...args]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain(message);
    expect(snapshot()).toEqual(before);
  });

  test("reports an unreadable path without changing an existing document", async () => {
    writeFileSync(file, marked("# Guide"));
    const before = snapshot();
    const result = await run(["missing.md"]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("mdtoc:");
    expect(result.stderr).toContain("missing.md");
    expect(snapshot()).toEqual(before);
  });

  test("help exits successfully without a file", async () => {
    const result = await run(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("--check");
    expect(result.stdout).toContain("--max-depth");
    expect(result.stderr).toBe("");
  });

  test("accepts a relative, option-like filename after --", async () => {
    const name = "-guide.md";
    writeFileSync(join(directory, name), marked("# Guide"));
    const result = await run(["--", name]);
    expect(result.stderr).toBe("");
    expect(result.exitCode).toBe(0);
    expect(readFileSync(join(directory, name), "utf8")).toContain("- [Guide](#guide)");
  });
});

// Artifact assertions run in the same Bun suite as the application behavior tests.
describe("documentation, license, and existing scaffold", () => {
  const readme = readFileSync(join(root, "README.md"), "utf8");
  const prose = readme.replace(/\s+/g, " ");

  test("README explains purpose, audience, and supported platforms in English", () => {
    expect(prose).toMatch(/TypeScript CLI on Bun.*generates a Markdown table of contents/i);
    expect(prose).toMatch(/for documentation authors and maintainers/i);
    for (const platform of ["Windows", "macOS", "Linux"]) {
      expect(prose).toContain(platform);
    }
  });

  test("README provides installation and generation examples with the marker pair", () => {
    expect(readme).toMatch(/^## Installation$/m);
    expect(prose).toMatch(/Install.*Bun.*dependencies/i);
    expect(readme).toContain("bun install");
    expect(readme).toMatch(/^## Usage$/m);
    expect(readme).toContain("bun run src/cli.ts README.md");
    expect(readme).toContain("<!-- toc -->");
    expect(readme).toContain("<!-- tocstop -->");
    expect(prose).toMatch(/outside the markers is preserved/i);
  });

  test("README multi-file example matches real CLI output", async () => {
    expect(readme).toContain("bun run src/cli.ts --check docs/a.md docs/b.md");
    const example = 'TOC is stale in "docs/b.md". Run without --check to update it.';
    expect(readme).toContain(example);
    expect(readme).toContain("With more than one file, errors are prefixed with the file path");

    const directory = mkdtempSync(join(tmpdir(), "mdtoc README example "));
    try {
      const docs = join(directory, "docs");
      mkdirSync(docs);
      writeFileSync(join(docs, "a.md"), updateToc(marked("# A")));
      writeFileSync(join(docs, "b.md"), marked("# B"));
      const child = Bun.spawn([process.execPath, "run", cli, "--check", "docs/a.md", "docs/b.md"], {
        cwd: directory,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [exitCode, stderr] = await Promise.all([
        child.exited,
        new Response(child.stderr).text(),
      ]);
      expect(exitCode).toBe(1);
      expect(stderr.trimEnd()).toBe(example);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  test("README documents check-mode exit codes and maximum depth with examples", () => {
    expect(readme).toContain("bun run src/cli.ts --check README.md");
    expect(prose).toMatch(/--check.*never writes.*code 0.*current.*code 1.*stale/i);
    expect(readme).toContain("bun run src/cli.ts --max-depth 3 README.md");
    expect(readme).toContain("bun run src/cli.ts --check --max-depth 3 README.md");
    expect(prose).toMatch(/--max-depth.*integers from 1 through 6/i);
  });

  test("README includes development instructions for all required checks", () => {
    expect(readme).toMatch(/^## Development$/m);
    expect(prose).toMatch(/run the automated tests/i);
    for (const command of ["bun test", "bun run typecheck", "bun run lint"]) {
      expect(readme).toContain(command);
    }
    expect(readme).toContain("[LICENSE](LICENSE)");
  });

  test("LICENSE contains the complete standard MIT grant, notice, and disclaimer", () => {
    const license = readFileSync(join(root, "LICENSE"), "utf8");
    const normalized = license.replace(/\s+/g, " ").trim();
    expect(normalized).toMatch(/^MIT License Copyright \(c\) \d{4} \S/);
    const terms = [
      'Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:',
      "The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.",
      'THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.',
    ];
    const grantStart = normalized.indexOf("Permission is hereby granted");
    expect(grantStart).toBeGreaterThan(0);
    expect(normalized.slice(grantStart)).toBe(terms.join(" "));
  });

  test("existing package scripts expose Bun tests, typecheck, and lint", () => {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expect(manifest.type).toBe("module");
    expect(manifest.scripts).toMatchObject({
      test: "bun test",
      typecheck: "tsc --noEmit",
      lint: "biome check .",
    });
  });
});
