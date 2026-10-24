import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, USAGE } from "../src/cli";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = join(root, "src", "cli.ts");

async function spawn(command: string[], cwd: string) {
  const child = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "pipe" });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout, stderr };
}

describe("version option", () => {
  let directory: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "mdtoc version "));
  });

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true });
  });

  test("--version prints the name and the version from package.json", async () => {
    const result = await spawn([process.execPath, "run", cli, "--", "--version"], directory);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.replace(/\r\n/g, "\n")).toBe("mdtoc 0.2.0\n");
    expect(result.stderr).toBe("");
  });

  test("-v is the short form", async () => {
    const result = await spawn([process.execPath, "run", cli, "--", "-v"], directory);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.replace(/\r\n/g, "\n")).toBe("mdtoc 0.2.0\n");
  });

  test("a file argument is neither required nor touched", async () => {
    const file = join(directory, "NOTES.md");
    writeFileSync(file, "# Guide\n\n<!-- toc -->\n<!-- tocstop -->\n", "utf8");
    const result = await spawn([process.execPath, "run", cli, "--", "--version", file], directory);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.replace(/\r\n/g, "\n")).toBe("mdtoc 0.2.0\n");
    expect(readFileSync(file, "utf8")).toBe("# Guide\n\n<!-- toc -->\n<!-- tocstop -->\n");
  });

  test("the version wins over option conflicts but not over a bad option value", async () => {
    const conflict = await spawn(
      [process.execPath, "run", cli, "--", "--print", "--check", "--version"],
      directory,
    );
    expect(conflict.exitCode).toBe(0);
    expect(conflict.stdout.replace(/\r\n/g, "\n")).toBe("mdtoc 0.2.0\n");
    const bad = await spawn(
      [process.execPath, "run", cli, "--", "--version", "--max-depth", "9"],
      directory,
    );
    expect(bad.exitCode).toBe(1);
    expect(bad.stdout).toBe("");
    expect(bad.stderr.replace(/\r\n/g, "\n")).toBe(
      "mdtoc: --max-depth must be an integer from 1 through 6.\n",
    );
  });

  test("--help wins over --version", async () => {
    const result = await spawn(
      [process.execPath, "run", cli, "--", "--version", "--help"],
      directory,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Usage: bun run src/cli.ts");
    expect(result.stdout).not.toContain("mdtoc 0.2.0");
  });

  test("after the -- separator --version is a file name", async () => {
    const result = await spawn([process.execPath, "run", cli, "--", "--", "--version"], directory);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("mdtoc: ENOENT");
  });

  test("parseArgs sets version for both spellings and needs no file", () => {
    expect(parseArgs(["--version"]).version).toBe(true);
    expect(parseArgs(["-v"]).files).toEqual([]);
    expect(parseArgs(["README.md"]).version).toBeUndefined();
  });

  test("the usage text lists the option", () => {
    expect(USAGE).toContain("  --version, -v       Print the version from package.json and exit.");
  });

  test("the start script reports the version bumped from the 0.1.0 baseline", async () => {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expect(manifest.version).not.toBe("0.1.0");
    const result = await spawn([process.execPath, "run", "start", "--", "--version"], root);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.replace(/\r\n/g, "\n")).toBe("mdtoc 0.2.0\n");
  });

  test("package.json holds the new version and the start script", () => {
    const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    expect(manifest.version).toBe("0.2.0");
    expect(manifest.scripts.start).toBe("bun run src/cli.ts");
    expect(manifest.scripts.test).toBe("bun test");
  });

  test("the README documents the option", () => {
    const readme = readFileSync(join(root, "README.md"), "utf8").replace(/\r\n/g, "\n");
    expect(readme).toContain("### Version");
    expect(readme).toContain("bun run src/cli.ts --version");
    expect(readme).toContain("mdtoc 0.2.0");
    expect(readme).toContain(
      "| `--version`, `-v` | Print the version from package.json and exit. |",
    );
  });
});
