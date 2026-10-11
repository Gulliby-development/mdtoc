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

Only the content between the markers is replaced. Text outside the markers is preserved, including line endings. Missing markers are an error and leave the file unchanged: mdtoc does not add them for you.

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

### Options

| Option | Description |
|---|---|
| `<file>...` | Markdown files to update (or check). |
| `--check` | Do not write; exit 1 if the table of contents is stale. |
| `--max-depth <1-6>` | Include headings only up to this level. |

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
