import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { generateToc, insertMarkers, updateToc, validateMaxDepth, validateMinDepth } from "./toc";

export interface CliOptions {
  files: string[];
  check: boolean;
  print: boolean;
  insert?: boolean;
  numbered?: boolean;
  maxDepth: number;
  minDepth: number;
  exclude: string[];
  help: boolean;
}

export const USAGE = `Usage: bun run src/cli.ts [--check] [--print] [--insert] [--numbered] [--max-depth <1-6>] [--min-depth <1-6>] [--exclude <text>]... <file>...

Generate a Markdown table of contents between <!-- toc --> and <!-- tocstop -->.
  <file>...           Markdown files to update (or check).
  --check             Exit 1 if the TOC is stale; never write the files.
  --print             Print the generated entries to stdout; never write; no markers needed.
  --insert            Add the marker pair first when the file has neither marker.
  --numbered          Write the entries as a numbered list (1. 2. 3.) instead of bullets.
  --max-depth <1-6>   Include heading levels up to this depth (default: 6).
  --min-depth <1-6>   Skip heading levels above this depth (default: 1).
  --exclude <text>    Leave out headings with this exact text (repeatable).
  --help, -h          Show this help.
  --                  Treat remaining arguments as file paths.`;

export function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    files: [],
    check: false,
    print: false,
    maxDepth: 6,
    minDepth: 1,
    exclude: [],
    help: false,
  };
  let positionalOnly = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!positionalOnly && argument === "--") {
      positionalOnly = true;
    } else if (!positionalOnly && (argument === "--help" || argument === "-h")) {
      options.help = true;
    } else if (!positionalOnly && argument === "--check") {
      options.check = true;
    } else if (!positionalOnly && argument === "--print") {
      options.print = true;
    } else if (!positionalOnly && argument === "--insert") {
      options.insert = true;
    } else if (!positionalOnly && argument === "--numbered") {
      options.numbered = true;
    } else if (
      !positionalOnly &&
      (argument === "--max-depth" || argument.startsWith("--max-depth="))
    ) {
      const value =
        argument === "--max-depth" ? args[++index] : argument.slice("--max-depth=".length);
      if (!value || !/^[1-6]$/.test(value)) {
        throw new Error("--max-depth must be an integer from 1 through 6.");
      }
      options.maxDepth = Number(value);
    } else if (
      !positionalOnly &&
      (argument === "--min-depth" || argument.startsWith("--min-depth="))
    ) {
      const value =
        argument === "--min-depth" ? args[++index] : argument.slice("--min-depth=".length);
      if (!value || !/^[1-6]$/.test(value)) {
        throw new Error("--min-depth must be an integer from 1 through 6.");
      }
      options.minDepth = Number(value);
    } else if (!positionalOnly && (argument === "--exclude" || argument.startsWith("--exclude="))) {
      const value = argument === "--exclude" ? args[++index] : argument.slice("--exclude=".length);
      const text = value?.trim();
      if (!text) {
        throw new Error("--exclude requires a non-empty heading text.");
      }
      options.exclude.push(text);
    } else if (!positionalOnly && argument.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}. Use --help for usage.`);
    } else if (!options.files.some((file) => resolve(file) === resolve(argument))) {
      options.files.push(argument);
    }
  }
  validateMaxDepth(options.maxDepth);
  validateMinDepth(options.minDepth);
  if (options.minDepth > options.maxDepth) {
    throw new Error("--min-depth must not be greater than --max-depth.");
  }
  if (!options.help && options.files.length === 0) {
    throw new Error("Provide a Markdown file path. Use --help for usage.");
  }
  if (!options.help && options.print && options.check) {
    throw new Error("--print and --check cannot be used together.");
  }
  if (!options.help && options.print && options.files.length > 1) {
    throw new Error("--print accepts exactly one file.");
  }
  if (!options.help && options.insert && options.check) {
    throw new Error("--insert and --check cannot be used together.");
  }
  if (!options.help && options.insert && options.print) {
    throw new Error("--insert and --print cannot be used together.");
  }
  return options;
}

/** Return an exit code so importing the CLI does not terminate the caller. */
export async function main(args: string[] = Bun.argv.slice(2)): Promise<number> {
  try {
    const options = parseArgs(args);
    if (options.help) {
      console.log(USAGE);
      return 0;
    }
    if (options.print) {
      const markdown = await readFile(options.files[0], "utf8");
      const entries = generateToc(
        markdown,
        options.maxDepth,
        "\n",
        options.minDepth,
        options.exclude,
        options.numbered,
      );
      if (entries) {
        console.log(entries);
      }
      return 0;
    }
    let failed = false;
    const prefixErrors = options.files.length > 1;
    for (const file of options.files) {
      try {
        const markdown = await readFile(file, "utf8");
        const source = options.insert ? insertMarkers(markdown) : markdown;
        const updated = updateToc(
          source,
          options.maxDepth,
          options.minDepth,
          options.exclude,
          options.numbered,
        );
        if (options.check) {
          if (updated !== markdown) {
            console.error(`TOC is stale in "${file}". Run without --check to update it.`);
            failed = true;
          }
        } else if (updated !== markdown) {
          await writeFile(file, updated, "utf8");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`mdtoc: ${prefixErrors ? `${file}: ` : ""}${message}`);
        failed = true;
      }
    }
    return failed ? 1 : 0;
  } catch (error) {
    console.error(`mdtoc: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await main();
}
