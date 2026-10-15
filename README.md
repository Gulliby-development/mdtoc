<p align="center"><img src="docs/logo.svg" width="96" alt="" /></p>

# mdtoc

A TypeScript CLI on Bun that generates a Markdown table of contents from your headings and keeps it up to date in place, with a read-only check mode for CI. It is for documentation authors and maintainers.

[![CI](https://github.com/Gulliby-development/mdtoc/actions/workflows/ci.yml/badge.svg)](https://github.com/Gulliby-development/mdtoc/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Why

Documentation authors and maintainers want heading links that stay current without hand-editing them. mdtoc rewrites only the block between two markers, uses GitHub-style anchors, and can fail a CI job when the committed table of contents is stale. It runs on Windows, macOS and Linux.

## Installation

Install [Bun](https://bun.sh), clone this repository, and install the dependencies from its root:

```sh
bun install
```

There is no build step; run the CLI from source with `bun run src/cli.ts`.

## Usage

Add the marker pair where the table of contents should appear:

```markdown
# Guide

<!-- toc -->
<!-- tocstop -->

## Installation

## Usage
```

Generate or refresh the table of contents (prints nothing and exits 0 on success):

```sh
bun run src/cli.ts README.md
```

Given a file with `## Installation`, `## Usage`, `### Sub`, a second `## Usage`, and `## Hello, World!`, the block between the markers becomes:

```markdown
<!-- toc -->
- [Guide](#guide)
  - [Installation](#installation)
  - [Usage](#usage)
    - [Sub](#sub)
  - [Usage](#usage-1)
  - [Hello, World!](#hello-world)
<!-- tocstop -->
```

Only the content between the markers is replaced. Text outside the markers is preserved, including line endings. Missing markers are an error and leave the file unchanged unless `--insert` is given (see "Add the markers").

### Check in CI

```sh
bun run src/cli.ts --check README.md
```

`--check` never writes. It exits with code 0 when the table of contents is current and code 1 when it is stale, printing:

```text
TOC is stale in "README.md". Run without --check to update it.
```

### Several files

```sh
bun run src/cli.ts --check docs/a.md docs/b.md
```

When only `docs/b.md` is stale, this prints to stderr and exits 1:

```text
TOC is stale in "docs/b.md". Run without --check to update it.
```

With more than one file, errors are prefixed with the file path (`mdtoc: docs/a.md: ...`).

### Limit heading depth

```sh
bun run src/cli.ts --max-depth 3 README.md
bun run src/cli.ts --check --max-depth 3 README.md
```

`--max-depth` accepts integers from 1 through 6 and includes heading levels up to that depth. Use the same depth when generating and checking. Errors exit 1:

```text
mdtoc: --max-depth must be an integer from 1 through 6.
mdtoc: ENOENT: no such file or directory, open 'nope.md'
mdtoc: Add exactly one <!-- toc --> followed by <!-- tocstop --> to the Markdown file.
```

Quote paths that contain spaces:

```sh
bun run src/cli.ts "docs/User Guide.md"
```

### Skip the page title

Use `--min-depth` to leave the page title out of the table of contents while keeping deeper headings:

```sh
bun run src/cli.ts --min-depth 2 README.md
```

For a file with `# Guide`, `## Installation`, `## Usage`, and `### Sub`, the generated entries are:

```markdown
- [Installation](#installation)
- [Usage](#usage)
  - [Sub](#sub)
```

`--min-depth` accepts integers from 1 through 6. Entries are indented relative to the selected minimum depth. Use the same depth when generating and checking.

### Leave out headings

Use `--exclude` to leave out headings by their visible text. For a file with `# Guide`, the marker pair, `## Installation`, `## Usage`, `### Sub`, and `## License`, run:

```sh
bun run src/cli.ts --min-depth 2 --exclude License README.md
```

The generated entries are:

```markdown
- [Installation](#installation)
- [Usage](#usage)
  - [Sub](#sub)
```

The match is exact and case-sensitive, and every heading with matching text is left out. Sub-headings stay, and entries keep their indentation relative to the minimum depth, so combine `--exclude` with `--min-depth 2` to omit a `#` page title without indenting the top entries. Anchors are still counted over all headings, including excluded headings. Use the same options when generating and checking.

### Preview without markers

Use `--print` to show the generated entries without touching the file. It needs no marker pair and prints the entries that would go between the markers, with LF line endings and no marker lines.

For a `NOTES.md` file containing `# Guide`, `## Installation`, `## Usage`, `### Sub`, and `## License`, run:

```sh
bun run src/cli.ts --print --min-depth 2 --exclude License NOTES.md
```

The output is:

```markdown
- [Installation](#installation)
- [Usage](#usage)
  - [Sub](#sub)
```

`--print` accepts exactly one file and cannot be combined with `--check`. Either error exits 1:

```text
mdtoc: --print accepts exactly one file.
mdtoc: --print and --check cannot be used together.
```

When no heading is selected, nothing is printed.

### Options

| Option | Description |
|---|---|
| `<file>...` | Markdown files to update (or check). |
| `--check` | Do not write; exit 1 if the table of contents is stale. |
| `--print` | Print the entries to stdout instead of updating the file (one file, no markers needed). |
| `--max-depth <1-6>` | Include headings only up to this level. |
| `--min-depth <1-6>` | Skip heading levels above this depth (default 1). |
| `--exclude <text>` | Leave out headings whose text is exactly this (repeatable). |
| `--insert` | Add the marker pair first when the file has neither marker. |

### Add the markers

Use `--insert` to start a table of contents in a file that has no markers yet. When the file contains neither `<!-- toc -->` nor `<!-- tocstop -->`, mdtoc adds the pair directly after the first level-1 ATX heading outside code fences (or at the start of the file when there is none), with no blank line added, and then generates the entries. A file that already has markers is refreshed as without the flag, so the command is safe to repeat; a file with only one marker is still an error. For a `NOTES.md` file containing `# Guide`, `## Installation` and `## Usage` with blank lines between them, run:

```sh
bun run src/cli.ts --insert NOTES.md
```

The file becomes:

```markdown
# Guide
<!-- toc -->
- [Guide](#guide)
  - [Installation](#installation)
  - [Usage](#usage)
<!-- tocstop -->

## Installation

## Usage
```

`--insert` cannot be combined with `--check` or `--print`; either error exits 1:

```text
mdtoc: --insert and --check cannot be used together.
mdtoc: --insert and --print cannot be used together.
```

### Headings and anchors

ATX headings (`## Setup`) and Setext headings (text underlined with `===` or `---`) are recognized. Headings inside backtick or tilde code fences are ignored; an unclosed fence extends to the end of the file. Anchors are GitHub-style: lowercase, formatting and punctuation removed, whitespace runs turned into hyphens, Unicode letters and digits kept. `## Hello, World!` links to `#hello-world`, and repeated `## Hello` headings link to `#hello`, `#hello-1`, `#hello-2` in document order.

## Development

After `bun install`, run the automated tests, TypeScript check and lint check:

```sh
bun install
bun run typecheck
bun run lint
bun test
```

## License

MIT, see [LICENSE](LICENSE).

---

Built with BAKED, an open-source coding agent (bench loop round 02, BAKED ac45a9c).
