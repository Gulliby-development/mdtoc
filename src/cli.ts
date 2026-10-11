import { readFile, writeFile } from "node:fs/promises";
import { updateToc, validateMaxDepth } from "./toc";

export interface CliOptions {
  file?: string;
  check: boolean;
  maxDepth: number;
  help: boolean;
}

export const USAGE = `Usage: bun run src/cli.ts [--check] [--max-depth <1-6>] <file.md>

Generate a Markdown table of contents between <!-- toc --> and <!-- tocstop -->.
  --check             Exit 1 if the TOC is stale; never write the file.
  --max-depth <1-6>   Include heading levels up to this depth (default: 6).
  --help, -h          Show this help.
  --                  Treat remaining arguments as the file path.`;

export function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = { check: false, maxDepth: 6, help: false };
  let positionalOnly = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!positionalOnly && argument === "--") {
      positionalOnly = true;
    } else if (!positionalOnly && (argument === "--help" || argument === "-h")) {
      options.help = true;
    } else if (!positionalOnly && argument === "--check") {
      options.check = true;
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
    } else if (!positionalOnly && argument.startsWith("-")) {
      throw new Error(`Unknown option: ${argument}. Use --help for usage.`);
    } else {
      if (options.file !== undefined) {
        throw new Error("Provide exactly one Markdown file path. Use --help for usage.");
      }
      options.file = argument;
    }
  }
  validateMaxDepth(options.maxDepth);
  if (!options.help && !options.file) {
    throw new Error("Provide a Markdown file path. Use --help for usage.");
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
    const file = options.file;
    if (!file) {
      throw new Error("Provide a Markdown file path.");
    }
    const markdown = await readFile(file, "utf8");
    const updated = updateToc(markdown, options.maxDepth);
    if (options.check) {
      if (updated !== markdown) {
        console.error(`TOC is stale in "${file}". Run without --check to update it.`);
        return 1;
      }
      return 0;
    }
    if (updated !== markdown) {
      await writeFile(file, updated, "utf8");
    }
    return 0;
  } catch (error) {
    console.error(`mdtoc: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = await main();
}
