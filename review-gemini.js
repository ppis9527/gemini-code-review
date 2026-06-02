#!/usr/bin/env node
'use strict';

const https = require('https');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// --- CLI args ---
const args = process.argv.slice(2);
let model = 'gemini-3.1-flash-lite-preview';
let concurrency = 5;
let baseRef = 'HEAD';
let reviewMode = 'diff'; // diff | full | both
const files = [];

for (let i = 0; i < args.length; i++) {
    if (args[i] === '--model' && args[i + 1]) { model = args[++i]; continue; }
    if (args[i] === '--concurrency' && args[i + 1]) { concurrency = parseInt(args[++i], 10); continue; }
    if (args[i] === '--base' && args[i + 1]) { baseRef = args[++i]; continue; }
    if (args[i] === '--mode' && args[i + 1]) { reviewMode = args[++i]; continue; }
    // legacy flags
    if (args[i] === '--full') { reviewMode = 'full'; continue; }
    files.push(args[i]);
}

if (!['diff', 'full', 'both'].includes(reviewMode)) {
    process.stderr.write(`Error: --mode must be diff, full, or both. Got: ${reviewMode}\n`);
    process.exit(1);
}

// --- API key ---
const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
    process.stderr.write('Error: GEMINI_API_KEY environment variable is not set.\n');
    process.exit(1);
}

// --- Semaphore ---
function createSemaphore(limit) {
    let active = 0;
    const queue = [];
    return function acquire() {
        return new Promise(resolve => {
            const run = () => { active++; resolve(() => { active--; if (queue.length) queue.shift()(); }); };
            if (active < limit) run();
            else queue.push(run);
        });
    };
}

// --- Gemini API call ---
function callGemini(prompt, responseSchema) {
    return new Promise((resolve, reject) => {
        const requestBody = { contents: [{ parts: [{ text: prompt }] }] };
        if (responseSchema) {
            requestBody.generationConfig = {
                responseMimeType: 'application/json',
                responseSchema,
            };
        }
        const payload = JSON.stringify(requestBody);
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
        const req = https.request(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
                'x-goog-api-key': apiKey,
            },
            timeout: 60000,
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode !== 200) {
                    reject(new Error(`Gemini API error (status=${res.statusCode}): ${data}`));
                    return;
                }
                try {
                    const parsed = JSON.parse(data);
                    const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
                    if (!text) { reject(new Error(`Invalid response structure: ${data}`)); return; }
                    resolve(text.trim());
                } catch (e) { reject(e); }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Gemini API request timeout')); });
        req.write(payload);
        req.end();
    });
}

function callGeminiJson(prompt, responseSchema) {
    return callGemini(prompt, responseSchema).then(text => {
        const cleaned = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
        return JSON.parse(cleaned);
    });
}

// --- Git diff helpers ---
function getDiff(filePath) {
    if (reviewMode === 'full') return null;
    try {
        const diff = execSync(`git diff ${baseRef} -- ${JSON.stringify(filePath)}`, {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        if (diff.trim()) return diff.trim();
    } catch {}
    // Fallback: staged diff (new files not yet committed)
    try {
        const diff = execSync(`git diff --cached -- ${JSON.stringify(filePath)}`, {
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        if (diff.trim()) return diff.trim();
    } catch {}
    return null;
}

// --- File resolution ---
function resolveFiles() {
    if (files.length > 0) return files.filter(f => fs.existsSync(f));
    try {
        const output = execSync(`git diff --name-only ${baseRef}`, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
        const changed = output.trim().split('\n').filter(Boolean);
        if (changed.length > 0) return changed.filter(f => fs.existsSync(f));
    } catch {}
    try {
        const output = execSync('git diff --name-only --cached', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
        return output.trim().split('\n').filter(Boolean).filter(f => fs.existsSync(f));
    } catch {}
    return [];
}

// --- Phase 1: per-file review ---
const REVIEW_SCHEMA = {
    type: 'object',
    properties: {
        bugs: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    severity: { type: 'string' },
                    title: { type: 'string' },
                    line_hint: { type: 'string' },
                    description: { type: 'string' },
                    fix: { type: 'string' },
                },
                required: ['severity', 'title', 'description'],
            },
        },
        improvements: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    severity: { type: 'string' },
                    title: { type: 'string' },
                    line_hint: { type: 'string' },
                    description: { type: 'string' },
                    fix: { type: 'string' },
                },
                required: ['severity', 'title', 'description'],
            },
        },
        summary: { type: 'string' },
    },
    required: ['bugs', 'improvements', 'summary'],
};

function buildReviewPrompt(filePath, content, diff, mode) {
    const ext = path.extname(filePath).slice(1) || 'text';
    const focus = mode === 'full'
        ? 'Review the entire file thoroughly for bugs and logic errors.'
        : '**Focus primarily on the changed lines in the diff.** Use the full file for context only.';

    const diffSection = diff
        ? `## What changed (git diff vs ${baseRef})\n\`\`\`diff\n${diff}\n\`\`\``
        : `## Note\nNo git diff available — reviewing full file.`;

    return `You are a senior software engineer performing a code review.

${focus}

Return a JSON object with:
- bugs: array of bug findings (each with severity: CRITICAL|HIGH|MEDIUM|LOW, title, line_hint, description, fix)
- improvements: array of improvement suggestions (same structure)
- summary: one-sentence overall assessment

${diffSection}

## Full file: ${filePath}
\`\`\`${ext}
${content}
\`\`\`

Focus on:
- Correctness bugs, logic errors, off-by-one errors
- Error handling gaps
- Code clarity and correctness of the changes

Return only valid JSON matching the schema.`;
}

function mergeReviews(diffResult, fullResult) {
    const seen = new Set();
    const dedupe = arr => arr.filter(item => {
        const key = (item.title || '').toLowerCase().trim();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    return {
        file: diffResult.file,
        hasDiff: diffResult.hasDiff,
        bugs: dedupe([...diffResult.bugs, ...fullResult.bugs]),
        improvements: dedupe([...diffResult.improvements, ...fullResult.improvements]),
        summary: `[diff] ${diffResult.summary} | [full] ${fullResult.summary}`,
    };
}

async function reviewFileSingle(filePath, mode, acquire) {
    const release = await acquire();
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const diff = getDiff(filePath);
        const prompt = buildReviewPrompt(filePath, content, diff, mode);
        process.stderr.write(`[Phase 1] Reviewing: ${filePath} (${mode}${diff ? '+diff' : ''})\n`);
        const result = await callGeminiJson(prompt, REVIEW_SCHEMA);
        return { file: filePath, hasDiff: !!diff, ...result };
    } catch (e) {
        process.stderr.write(`[Phase 1] Failed to review ${filePath}: ${e.message}\n`);
        return { file: filePath, hasDiff: false, bugs: [], improvements: [], summary: `Review failed: ${e.message}` };
    } finally {
        release();
    }
}

async function reviewFile(filePath, acquire) {
    if (reviewMode === 'both') {
        const [diffResult, fullResult] = await Promise.all([
            reviewFileSingle(filePath, 'diff', acquire),
            reviewFileSingle(filePath, 'full', acquire),
        ]);
        return mergeReviews(diffResult, fullResult);
    }
    return reviewFileSingle(filePath, reviewMode, acquire);
}

// --- Phase 2: adversarial verify ---
const VERIFY_SCHEMA = {
    type: 'object',
    properties: {
        refuted: { type: 'boolean' },
        reason: { type: 'string' },
    },
    required: ['refuted', 'reason'],
};

async function verifyFinding(finding, filePath, fileContent, fileDiff, acquire) {
    const release = await acquire();
    try {
        const ext = path.extname(filePath).slice(1) || 'text';
        const diffSection = fileDiff
            ? `## Diff (what changed)\n\`\`\`diff\n${fileDiff}\n\`\`\``
            : '';

        const prompt = `You are a skeptical code reviewer tasked with REFUTING the following finding.

Try your hardest to show this finding is a false positive, incorrect, or not actually a problem.
Default to refuted=true if you are uncertain.

Finding:
- Title: ${finding.title}
- Severity: ${finding.severity}
- Description: ${finding.description}
- Line hint: ${finding.line_hint || 'N/A'}
- Suggested fix: ${finding.fix || 'N/A'}

${diffSection}

## Full file: ${filePath}
\`\`\`${ext}
${fileContent}
\`\`\`

Return JSON: { "refuted": boolean, "reason": "explanation" }`;

        process.stderr.write(`[Phase 2] Verifying: ${finding.title} in ${filePath}\n`);
        return await callGeminiJson(prompt, VERIFY_SCHEMA);
    } catch (e) {
        process.stderr.write(`[Phase 2] Verify failed for "${finding.title}": ${e.message}\n`);
        return { refuted: false, reason: `Verification failed: ${e.message}` };
    } finally {
        release();
    }
}

// --- Phase 3: synthesize ---
async function synthesizeReport(reviewResults, verifiedFindings) {
    process.stderr.write('[Phase 3] Synthesizing final report...\n');
    const summaryData = JSON.stringify({ reviews: reviewResults, verified: verifiedFindings }, null, 2);
    const prompt = `You are a senior tech lead writing a final code review report.

Given the following review results and adversarial verification outcomes, produce a well-structured Markdown report.

Data:
${summaryData}

Format the report as:
# Code Review Report

## Summary
Brief overall assessment.

## Critical & High Issues
List confirmed CRITICAL and HIGH bugs (not refuted).

## Medium & Low Issues
List confirmed MEDIUM and LOW bugs (not refuted).

## Improvements
Notable improvement suggestions.

## Files Reviewed
Table of files with their assessment.

Use clear Markdown formatting. Be concise and actionable.`;

    return callGemini(prompt);
}

// --- Main ---
async function main() {
    const targetFiles = resolveFiles();
    if (targetFiles.length === 0) {
        process.stderr.write('No files to review. Pass files as arguments or run in a git repo with changes.\n');
        process.exit(1);
    }

    process.stderr.write(`Using model: ${model}\n`);
    process.stderr.write(`Concurrency: ${concurrency}\n`);
    process.stderr.write(`Mode: ${reviewMode}${reviewMode !== 'full' ? ` (base: ${baseRef})` : ''}\n`);
    process.stderr.write(`Files to review (${targetFiles.length}): ${targetFiles.join(', ')}\n\n`);

    const acquire = createSemaphore(concurrency);

    // Phase 1: parallel per-file review
    process.stderr.write('=== Phase 1: Parallel Review ===\n');
    const reviewResults = await Promise.all(
        targetFiles.map(f => reviewFile(f, acquire))
    );

    // Collect CRITICAL/HIGH findings for adversarial verify
    const highFindings = [];
    for (const review of reviewResults) {
        const fileContent = fs.existsSync(review.file) ? fs.readFileSync(review.file, 'utf8') : '';
        const fileDiff = getDiff(review.file);
        for (const bug of review.bugs) {
            if (['CRITICAL', 'HIGH'].includes(bug.severity?.toUpperCase())) {
                highFindings.push({ finding: bug, file: review.file, fileContent, fileDiff });
            }
        }
    }

    // Phase 2: adversarial verification
    process.stderr.write(`\n=== Phase 2: Adversarial Verify (${highFindings.length} findings) ===\n`);
    const verifiedFindings = await Promise.all(
        highFindings.map(({ finding, file, fileContent, fileDiff }) =>
            verifyFinding(finding, file, fileContent, fileDiff, acquire).then(verdict => ({
                finding,
                file,
                refuted: verdict.refuted,
                reason: verdict.reason,
            }))
        )
    );

    // Phase 3: synthesize
    process.stderr.write('\n=== Phase 3: Synthesize Report ===\n');
    const report = await synthesizeReport(reviewResults, verifiedFindings);

    // Output to stdout
    process.stdout.write(report + '\n');
}

main().catch(e => {
    process.stderr.write(`Fatal error: ${e.message}\n${e.stack}\n`);
    process.exit(1);
});
