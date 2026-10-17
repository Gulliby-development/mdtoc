export interface Heading {
  level: number;
  text: string;
  anchor: string;
}

export const TOC_START = "<!-- toc -->";
export const TOC_END = "<!-- tocstop -->";

export function validateMaxDepth(maxDepth: number): void {
  if (!Number.isInteger(maxDepth) || maxDepth < 1 || maxDepth > 6) {
    throw new Error("--max-depth must be an integer from 1 through 6.");
  }
}

export function validateMinDepth(minDepth: number): void {
  if (!Number.isInteger(minDepth) || minDepth < 1 || minDepth > 6) {
    throw new Error("--min-depth must be an integer from 1 through 6.");
  }
}

/** Reduce the supported inline Markdown forms to their visible text. */
export function headingText(markdown: string): string {
  return markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/!?\[([^\]]*)\]\[[^\]]*\]/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g, "$1")
    .replace(/(`+)(.*?)\1/g, "$2")
    .replace(/\*+|~{2,}/g, "")
    .replace(/(^|\s)_{1,3}(?=\S)|_{1,3}(?=\s|$)/g, "$1")
    .trim();
}

export function slugify(text: string): string {
  return headingText(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s-]/gu, "")
    .replace(/\s+/g, "-");
}

interface ScannedLine {
  line: string;
  end: number;
  outsideFence: boolean;
}

/** Iterate source lines while applying the fence rules shared by heading parsing and insertion. */
function* scanMarkdownLines(markdown: string): Generator<ScannedLine> {
  let fence: { character: string; length: number } | undefined;
  const separators = /\r\n|\n|\r/g;
  let lineStart = 0;

  function isOutsideFence(line: string): boolean {
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (
        fenceMatch &&
        fenceMatch[1][0] === fence.character &&
        fenceMatch[1].length >= fence.length &&
        fenceMatch[2].trim() === ""
      ) {
        fence = undefined;
      }
      return false;
    }
    if (fenceMatch && (fenceMatch[1][0] !== "`" || !fenceMatch[2].includes("`"))) {
      fence = { character: fenceMatch[1][0], length: fenceMatch[1].length };
      return false;
    }
    return true;
  }

  let separator = separators.exec(markdown);
  while (separator) {
    const line = markdown.slice(lineStart, separator.index);
    yield { line, end: separator.index, outsideFence: isOutsideFence(line) };
    lineStart = separators.lastIndex;
    separator = separators.exec(markdown);
  }
  const line = markdown.slice(lineStart);
  yield { line, end: markdown.length, outsideFence: isOutsideFence(line) };
}

/** Parse ATX and single-line Setext headings outside fenced code blocks. */
export function extractHeadings(markdown: string): Heading[] {
  const headings: Heading[] = [];
  const usedAnchors = new Set<string>();

  let previous = "";

  function addHeading(level: number, raw: string): void {
    const text = headingText(raw);
    const base = slugify(raw);
    let anchor = base;
    let suffix = 0;
    while (usedAnchors.has(anchor)) {
      suffix += 1;
      anchor = `${base}-${suffix}`;
    }
    usedAnchors.add(anchor);
    headings.push({ level, text, anchor });
  }

  for (const { line, outsideFence } of scanMarkdownLines(markdown)) {
    if (!outsideFence) {
      previous = "";
      continue;
    }

    const atx = /^ {0,3}(#{1,6})(?:[ \t]+(.*)|[ \t]*)$/.exec(line);
    if (atx) {
      const raw = (atx[2] ?? "").replace(/[ \t]+#+[ \t]*$/, "").trim();
      addHeading(atx[1].length, raw);
      previous = "";
      continue;
    }
    const setext = /^ {0,3}(=+|-+)[ \t]*$/.exec(line);
    if (setext && previous) {
      addHeading(setext[1][0] === "=" ? 1 : 2, previous);
      previous = "";
      continue;
    }
    // Indented code, HTML blocks and list/quote prefixes are not Setext titles.
    previous =
      line.trim() && !/^(?: {4}|\t| {0,3}(?:>|<|[-+*][ \t]|\d+[.)][ \t]))/.test(line)
        ? line.trim()
        : "";
  }
  return headings;
}

/** Add a marker pair when neither literal marker is already present. */
export function insertMarkers(markdown: string): string {
  if (markdown.includes(TOC_START) || markdown.includes(TOC_END)) {
    return markdown;
  }

  const newline = /\r\n|\n|\r/.exec(markdown)?.[0] ?? "\n";
  for (const { line, end, outsideFence } of scanMarkdownLines(markdown)) {
    if (outsideFence && /^ {0,3}#(?:[ \t]+.*|[ \t]*)$/.test(line)) {
      return `${markdown.slice(0, end)}${newline}${TOC_START}${newline}${TOC_END}${markdown.slice(end)}`;
    }
  }
  return `${TOC_START}${newline}${TOC_END}${newline}${markdown}`;
}

export function generateToc(
  markdown: string,
  maxDepth = 6,
  newline = "\n",
  minDepth = 1,
  exclude: readonly string[] = [],
  numbered = false,
): string {
  validateMaxDepth(maxDepth);
  validateMinDepth(minDepth);
  const numberedCounts: number[] = [];
  return extractHeadings(markdown)
    .filter(
      (heading) =>
        heading.level >= minDepth && heading.level <= maxDepth && !exclude.includes(heading.text),
    )
    .map((heading) => {
      const label = heading.text.replace(/\\/g, "\\\\").replace(/[[\]]/g, "\\$&");
      const depth = heading.level - minDepth;
      if (!numbered) {
        return `${"  ".repeat(depth)}- [${label}](#${heading.anchor})`;
      }
      numberedCounts[depth] = (numberedCounts[depth] ?? 0) + 1;
      numberedCounts.length = depth + 1;
      return `${"    ".repeat(depth)}${numberedCounts[depth]}. [${label}](#${heading.anchor})`;
    })
    .join(newline);
}

/** Require one ordered marker pair before constructing any replacement. */
export function updateToc(
  markdown: string,
  maxDepth = 6,
  minDepth = 1,
  exclude: readonly string[] = [],
  numbered = false,
): string {
  validateMaxDepth(maxDepth);
  validateMinDepth(minDepth);
  const start = markdown.indexOf(TOC_START);
  const end = markdown.indexOf(TOC_END);
  if (
    start < 0 ||
    end < start + TOC_START.length ||
    markdown.indexOf(TOC_START, start + TOC_START.length) !== -1 ||
    markdown.indexOf(TOC_END, end + TOC_END.length) !== -1
  ) {
    throw new Error(
      "Add exactly one <!-- toc --> followed by <!-- tocstop --> to the Markdown file.",
    );
  }
  const interiorStart = start + TOC_START.length;
  const before = markdown.slice(0, interiorStart);
  const after = markdown.slice(end);
  const newline = /\r\n|\n|\r/.exec(markdown)?.[0] ?? "\n";
  // A stale TOC must not contribute headings to its own replacement.
  const source = `${before}${newline}${after}`;
  const toc = generateToc(source, maxDepth, newline, minDepth, exclude, numbered);
  return `${before}${newline}${toc ? toc + newline : ""}${after}`;
}
