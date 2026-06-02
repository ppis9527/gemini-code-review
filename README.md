# gemini-code-review

A CLI tool that runs a **fan-out code review** using the Gemini API. It reviews changed files in parallel, adversarially verifies critical findings, and synthesises a final Markdown report.

## How it works

```
Phase 1 — Parallel review     Each file gets its own Gemini call
          ↓
Phase 2 — Adversarial verify  CRITICAL/HIGH findings are challenged by a separate Gemini call
          ↓
Phase 3 — Synthesise          One final Gemini call produces the Markdown report
```

## Requirements

- Node.js 18+
- A [Gemini API key](https://aistudio.google.com/app/apikey)

## Usage

```bash
# Review files changed since HEAD (default)
GEMINI_API_KEY=your_key node review-gemini.js

# Review specific files
GEMINI_API_KEY=your_key node review-gemini.js src/auth.js src/api.js

# Run both diff and full-file review, merge results
GEMINI_API_KEY=your_key node review-gemini.js --mode both

# Compare against a branch instead of HEAD
GEMINI_API_KEY=your_key node review-gemini.js --mode diff --base main

# Save report to file
GEMINI_API_KEY=your_key node review-gemini.js 2>/dev/null > review.md
```

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--mode diff` | ✓ | Review only the changed lines (git diff) |
| `--mode full` | | Review the entire file |
| `--mode both` | | Run diff + full in parallel, deduplicate and merge findings |
| `--base <ref>` | `HEAD` | Git ref to diff against (branch, tag, commit SHA) |
| `--model <name>` | `gemini-3.1-flash-lite-preview` | Gemini model to use |
| `--concurrency <n>` | `5` | Max parallel Gemini API calls |

## Output

Progress logs go to **stderr**. The Markdown report goes to **stdout**.

```
[Phase 1] Reviewing: src/auth.js (diff+diff)
[Phase 1] Reviewing: src/api.js (diff+diff)
[Phase 2] Adversarial Verify (2 findings)
[Phase 3] Synthesizing final report...
```

Report format:

```markdown
# Code Review Report

## Summary
...

## Critical & High Issues
...

## Medium & Low Issues
...

## Improvements
...

## Files Reviewed
| File | Mode | Issues |
|------|------|--------|
```

## Review modes

**`--mode diff`** (recommended for PRs)
Sends the git diff alongside the full file. Gemini focuses on changed lines only — faster, fewer false positives about pre-existing issues.

**`--mode full`**
Sends the full file content. Useful for reviewing files not tracked by git or for a thorough audit of a single file.

**`--mode both`**
Runs diff and full review in parallel for each file, then merges and deduplicates findings by title. Best coverage before a release.

## License

MIT
