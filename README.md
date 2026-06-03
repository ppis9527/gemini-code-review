# gemini-code-review

A CLI tool that runs **AI-powered code review and analysis** using the Gemini API. Two modes: **review** (find bugs in changed code) and **analyze** (comprehensive codebase analysis).

## How it works

### Review Mode (default)
```
Phase 1 — Parallel review     Each file gets its own Gemini call
          ↓
Phase 2 — Adversarial verify  CRITICAL/HIGH findings are challenged by a separate Gemini call
          ↓
Phase 3 — Synthesise          One final Gemini call produces the Markdown report
```

### Analyze Mode
```
Phase 1 — Per-file analysis    Each file analyzed for complexity, security, tech debt, patterns
          ↓
Phase 2 — Architecture         Cross-file dependency graph, coupling, data flow, layering
          ↓
Phase 3 — Comprehensive report Unified report with all findings, stats, and recommendations
```

## Requirements

- Node.js 18+
- A [Gemini API key](https://aistudio.google.com/app/apikey)

## Usage

### Code Review

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

### Code Analysis

```bash
# Analyze the current directory
GEMINI_API_KEY=your_key node review-gemini.js --action analyze

# Analyze a specific project directory
GEMINI_API_KEY=your_key node review-gemini.js --action analyze --dir ./my-project

# Analyze specific files
GEMINI_API_KEY=your_key node review-gemini.js --action analyze src/main.js src/utils.js

# Use a more capable model for deeper analysis
GEMINI_API_KEY=your_key node review-gemini.js --action analyze --dir . --model gemini-2.5-pro

# Save analysis report
GEMINI_API_KEY=your_key node review-gemini.js --action analyze --dir . 2>/dev/null > analysis.md
```

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `--action review` | ✓ | Code review with adversarial verification |
| `--action analyze` | | Comprehensive code analysis |
| `--mode diff` | ✓ | Review only the changed lines (git diff) |
| `--mode full` | | Review the entire file |
| `--mode both` | | Run diff + full in parallel, deduplicate and merge findings |
| `--base <ref>` | `HEAD` | Git ref to diff against (branch, tag, commit SHA) |
| `--dir <path>` | cwd | Directory to scan recursively (analyze mode) |
| `--model <name>` | `gemini-2.5-flash` | Gemini model to use |
| `--concurrency <n>` | `5` | Max parallel Gemini API calls |
| `--max-file-size <n>` | `100000` | Skip files larger than N bytes |

## Output

Progress logs go to **stderr**. The Markdown report goes to **stdout**.

### Review output
```
[Phase 1] Reviewing: src/auth.js (diff+diff)
[Phase 2] Adversarial Verify (2 findings)
[Phase 3] Synthesizing final report...
```

### Analyze output
```
Action: analyze
Detected project type: node/javascript
Config files found: package.json, tsconfig.json
[Phase 1] Analyzing: src/auth.js
[Phase 1] Analyzing: src/api.js
[Phase 2] Analyzing architecture & dependencies...
[Phase 3] Synthesizing comprehensive analysis report...
```

## Analysis Report Sections

The analyze mode produces a comprehensive report covering:

| Section | What it covers |
|---------|---------------|
| **Executive Summary** | Health score (A–F), key stats, high-level assessment |
| **Architecture Overview** | Architecture pattern, module organization, Mermaid dependency graph |
| **Complexity Analysis** | Per-file complexity, hotspot functions, nesting depth |
| **Security Audit** | OWASP categories, severity-ranked findings |
| **Tech Debt** | TODO/HACK markers, deprecated APIs, dead code, missing types |
| **Performance** | Bottlenecks, resource management, optimization opportunities |
| **Design Patterns & SOLID** | Identified patterns, SOLID principle violations |
| **Recommendations** | Top 5 prioritized actions, quick wins vs strategic improvements |

## Review Modes

**`--mode diff`** (recommended for PRs)
Sends the git diff alongside the full file. Gemini focuses on changed lines only — faster, fewer false positives about pre-existing issues.

**`--mode full`**
Sends the full file content. Useful for reviewing files not tracked by git or for a thorough audit of a single file.

**`--mode both`**
Runs diff and full review in parallel for each file, then merges and deduplicates findings by title. Best coverage before a release.

## Supported Languages

The analyze mode auto-detects and scans files with these extensions:

JavaScript/TypeScript, Python, Java/Kotlin/Scala, Go, Rust, C/C++, C#, Ruby, PHP, Swift, Dart, Elixir, Haskell, SQL, Solidity, and more. Config files (Dockerfile, Makefile) are also included.

Directories like `node_modules`, `.git`, `dist`, `build`, `__pycache__`, `vendor` are automatically skipped.

## License

MIT
