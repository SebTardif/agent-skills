---
name: session-viewer
description: "Render Codex, Claude Code, OpenClaw, or Pi session JSONL transcripts as a searchable, shareable single-file HTML viewer."
---

# Session Viewer

Use when asked to view, export, inspect, or share a Codex, Claude Code, OpenClaw, or Pi session transcript in a browser.

## Commands

When the session path is not known and the `agent-transcript` skill is available, use it first to find the likely JSONL session:

```bash
.agents/skills/agent-transcript/scripts/agent-transcript find \
  --query "$USER_GOAL_OR_TITLE $BRANCH_OR_URL" \
  --cwd "$PWD" \
  --since-days 14
```

Pick the highest-confidence `file` result, then render it with `session-viewer`.

From a repo that has this skill:

```bash
node skills/session-viewer/scripts/session-viewer.ts <session.jsonl> --out /tmp/session.html --open
```

Useful modes:

```bash
node skills/session-viewer/scripts/session-viewer.ts <session.jsonl> --out session.html
node skills/session-viewer/scripts/session-viewer.ts <session.jsonl> --raw --out session.html
node skills/session-viewer/scripts/session-viewer.ts --blank --out viewer.html --open
```

In a downstream repo that syncs shared skills under `.agents/skills`, replace
`skills/session-viewer` with `.agents/skills/session-viewer`.

Defaults:

- detects `codex`, `claude`, or `pi-openclaw`
- embeds normalized session data into one HTML file
- keeps tool input/output text in the DOM so browser search can find it
- reads at most 8 MiB of a session file; oversized files retain the head and tail, with a visible omission warning in the CLI and exported viewer
- `--max-read-bytes N` overrides that positive byte limit; raise it explicitly when a complete larger export is needed
- `--raw` embeds the retained JSONL and lets the browser parse it; truncated boundary records may be omitted
- `--blank` creates a reusable file-picker viewer

The read limit applies to CLI file exports, not files loaded through the browser's file picker.

## Where Sessions Live

Codex:

```bash
find "${CODEX_HOME:-$HOME/.codex}/sessions" -name 'rollout-*.jsonl' -type f | sort
ls -t "${CODEX_HOME:-$HOME/.codex}"/sessions/*/*/*/rollout-*.jsonl | head
```

OpenClaw/Pi:

```bash
AGENT_ID="<agentId>"
SESSION_DIR="${OPENCLAW_STATE_DIR:-$HOME/.openclaw}/agents/$AGENT_ID/sessions"
ls -t "$SESSION_DIR"/*.jsonl | head
find "${OPENCLAW_STATE_DIR:-$HOME/.openclaw}/agents" -path '*/sessions/*.jsonl' -type f | sort
```

Use `sessions.json` in the same directory to map session keys to session ids.

Claude Code:

```bash
find "$HOME/.claude/projects" -name '*.jsonl' -type f | sort
ls -t "$HOME/.claude/projects"/**/*.jsonl | head
```

Some Claude installs also keep exported JSON/JSONL under project-specific cache folders; prefer the newest JSONL with the target repo path in its parent folder.

## Development

Scripts are native Node TypeScript. Keep them erasable:

- ok: types, interfaces, unions, `satisfies`
- avoid: enums, namespaces, decorators, parameter properties
- no tsconfig path aliases; use relative imports

Importer ownership:

- `scripts/importers/codex.ts`: Codex rollout JSONL
- `scripts/importers/claude.ts`: Claude Code JSONL
- `scripts/importers/pi-openclaw.ts`: Pi/OpenClaw session JSONL

Validate:

```bash
pnpm exec tsgo -p skills/session-viewer/tsconfig.json
node --test skills/session-viewer/scripts/session-viewer.test.ts
scripts/validate-skills
```
