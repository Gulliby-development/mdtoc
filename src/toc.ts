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

/** Parse ATX and single-line Setext headings outside fenced code blocks. */
export function extractHeadings(markdown: string): Heading[] {
  const headings: Heading[] = [];
  const usedAnchors = new Set<string>();
  let fence: { character: string; length: number } | undefined;
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

  for (const line of markdown.split(/\r\n|\n|\r/)) {
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
      previous = "";
      continue;
    }
    if (fenceMatch && (fenceMatch[1][0] !== "`" || !fenceMatch[2].includes("`"))) {
      fence = { character: fenceMatch[1][0], length: fenceMatch[1].length };
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

export function generateToc(markdown: string, maxDepth = 6, newline = "\n"): string {
  validateMaxDepth(maxDepth);
  return extractHeadings(markdown)
    .filter((heading) => heading.level <= maxDepth)
    .map((heading) => {
      const label = heading.text.replace(/\\/g, "\\\\").replace(/[[\]]/g, "\\$&");
      return `${"  ".repeat(heading.level - 1)}- [${label}](#${heading.anchor})`;
    })
    .join(newline);
}

/** Require one ordered marker pair before constructing any replacement. */
export function updateToc(markdown: string, maxDepth = 6): string {
  validateMaxDepth(maxDepth);
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
  const toc = generateToc(source, maxDepth, newline);
  return `${before}${newline}${toc ? toc + newline : ""}${after}`;
}
