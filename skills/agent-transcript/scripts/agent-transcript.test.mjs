import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const script = path.resolve("skills/agent-transcript/scripts/agent-transcript");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "agent-transcript-test-"));
}

function writeJsonl(file, rows) {
  fs.writeFileSync(file, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
}

function run(args, options = {}) {
  return execFileSync(process.execPath, [script, ...args], {
    cwd: path.resolve("."),
    encoding: "utf8",
    ...options,
  });
}

test("render redacts common secrets and local identifiers", () => {
  const dir = tempDir();
  const session = path.join(dir, "session.jsonl");
  writeJsonl(session, [
    {
      type: "response_item",
      payload: {
        role: "user",
        content: [
          {
            type: "text",
            text: "Use /Users/ahmed/project, email person@example.com, and header Bearer abcdefghijklmnopqrstuvwxyz123456.",
          },
        ],
      },
    },
    { type: "response_item", payload: { role: "assistant", content: [{ type: "text", text: "Done." }] } },
  ]);

  const output = run(["render", "--session", session]);
  assert.match(output, /\[LOCAL_PATH\]/);
  assert.match(output, /\[REDACTED_EMAIL\]/);
  assert.match(output, /\[REDACTED_AUTH_HEADER\]/);
  assert.doesNotMatch(output, /person@example\.com/);
  assert.doesNotMatch(output, /abcdefghijklmnopqrstuvwxyz123456/);
});

test("render tokenizes Linux, Windows, file, and quoted paths without smashing HTTP routes", () => {
  const dir = tempDir();
  const session = path.join(dir, "session.jsonl");
  writeJsonl(session, [
    {
      type: "response_item",
      payload: {
        role: "user",
        content: [
          {
            type: "text",
            text: "~/notes/todo.md. Inspect /home/alice/project and C:\\Users\\bob\\src and file:///home/alice/x and '/home/alice/Client Secret/file.js' plus /Users/ahmed/project. See https://example.test/home/docs",
          },
        ],
      },
    },
    { type: "response_item", payload: { role: "assistant", content: [{ type: "text", text: "Done." }] } },
  ]);

  const output = run(["render", "--session", session]);
  assert.match(output, /\[LOCAL_PATH\]/);
  assert.match(output, /\[HOME_PATH\]/);
  assert.match(output, /https:\/\/example\.test\/home\/docs/);
  assert.doesNotMatch(output, /\/home\/alice/);
  assert.doesNotMatch(output, /C:\\Users\\bob/);
  assert.doesNotMatch(output, /file:\/\/\/home\/alice/);
  assert.doesNotMatch(output, /Client Secret/);
  assert.doesNotMatch(output, /\/Users\/ahmed/);
  assert.doesNotMatch(output, /~\/notes/);
});

test("render redacts compiler-attached macOS paths", () => {
  const dir = tempDir();
  const session = path.join(dir, "session.jsonl");
  writeJsonl(session, [
    {
      type: "response_item",
      payload: {
        role: "user",
        content: [
          {
            type: "text",
            text: "cc -I/Users/alice/private/include main.c",
          },
        ],
      },
    },
    { type: "response_item", payload: { role: "assistant", content: [{ type: "text", text: "Done." }] } },
  ]);

  const output = run(["render", "--session", session]);
  assert.match(output, /cc -I\[LOCAL_PATH\]/);
  assert.doesNotMatch(output, /\/Users\/alice/);
  assert.doesNotMatch(output, /private\/include/);
});

test("render keeps prose and URLs between two local paths", () => {
  const dir = tempDir();
  const session = path.join(dir, "session.jsonl");
  writeJsonl(session, [
    {
      type: "response_item",
      payload: {
        role: "user",
        content: [
          {
            type: "text",
            text: "Read /Users/alice/a then https://example.test/docs and /Users/bob/b",
          },
        ],
      },
    },
    { type: "response_item", payload: { role: "assistant", content: [{ type: "text", text: "Done." }] } },
  ]);

  const output = run(["render", "--session", session]);
  assert.match(output, /Read \[LOCAL_PATH\] then https:\/\/example\.test\/docs and \[LOCAL_PATH\]/);
  assert.doesNotMatch(output, /\/Users\/alice/);
  assert.doesNotMatch(output, /\/Users\/bob/);
});

test("render redacts local fields adjacent to a protected URL", () => {
  const dir = tempDir();
  const session = path.join(dir, "session.jsonl");
  writeJsonl(session, [
    {
      type: "response_item",
      payload: {
        role: "user",
        content: [
          {
            type: "text",
            text: "url=https://example.test/docs,local=/Users/alice/private",
          },
        ],
      },
    },
    { type: "response_item", payload: { role: "assistant", content: [{ type: "text", text: "Done." }] } },
  ]);

  const output = run(["render", "--session", session]);
  assert.match(output, /https:\/\/example\.test\/docs/);
  assert.match(output, /local=\[LOCAL_PATH\]/);
  assert.doesNotMatch(output, /\/Users\/alice/);
  assert.doesNotMatch(output, /alice\/private/);
});

test("render redacts compiler response-file arguments", () => {
  const dir = tempDir();
  const session = path.join(dir, "session.jsonl");
  writeJsonl(session, [
    {
      type: "response_item",
      payload: {
        role: "user",
        content: [
          {
            type: "text",
            text: "cc @/Users/alice/private/args.rsp",
          },
        ],
      },
    },
    { type: "response_item", payload: { role: "assistant", content: [{ type: "text", text: "Done." }] } },
  ]);

  const output = run(["render", "--session", session]);
  assert.match(output, /cc @\[LOCAL_PATH\]/);
  assert.doesNotMatch(output, /\/Users\/alice/);
  assert.doesNotMatch(output, /args\.rsp/);
});

test("render redacts semicolon-adjacent local fields beside a URL", () => {
  const dir = tempDir();
  const session = path.join(dir, "session.jsonl");
  writeJsonl(session, [
    {
      type: "response_item",
      payload: {
        role: "user",
        content: [
          {
            type: "text",
            text: "url=https://example.test/docs;local=/Users/alice/private",
          },
        ],
      },
    },
    { type: "response_item", payload: { role: "assistant", content: [{ type: "text", text: "Done." }] } },
  ]);

  const output = run(["render", "--session", session]);
  assert.match(output, /https:\/\/example\.test\/docs/);
  assert.match(output, /local=\[LOCAL_PATH\]/);
  assert.doesNotMatch(output, /\/Users\/alice/);
  assert.doesNotMatch(output, /alice\/private/);
});

test("render redacts hyphenated local fields beside a URL", () => {
  const dir = tempDir();
  const session = path.join(dir, "session.jsonl");
  writeJsonl(session, [
    {
      type: "response_item",
      payload: {
        role: "user",
        content: [
          {
            type: "text",
            text: "url=https://example.test/docs,local-path=/Users/alice/private",
          },
        ],
      },
    },
    { type: "response_item", payload: { role: "assistant", content: [{ type: "text", text: "Done." }] } },
  ]);

  const output = run(["render", "--session", session]);
  assert.match(output, /https:\/\/example\.test\/docs/);
  assert.match(output, /local-path=\[LOCAL_PATH\]/);
  assert.doesNotMatch(output, /\/Users\/alice/);
  assert.doesNotMatch(output, /alice\/private/);
});

test("render redacts unquoted paths with a comma in a filename", () => {
  const dir = tempDir();
  const session = path.join(dir, "session.jsonl");
  writeJsonl(session, [
    {
      type: "response_item",
      payload: {
        role: "user",
        content: [
          {
            type: "text",
            text: "Read /Users/alice/Acme,Private/plan.md",
          },
        ],
      },
    },
    { type: "response_item", payload: { role: "assistant", content: [{ type: "text", text: "Done." }] } },
  ]);

  const output = run(["render", "--session", session]);
  assert.match(output, /Read \[LOCAL_PATH\]/);
  assert.doesNotMatch(output, /\/Users\/alice/);
  assert.doesNotMatch(output, /Private\/plan/);
  assert.doesNotMatch(output, /plan\.md/);
});

test("render redacts markdown-emphasis local paths", () => {
  const dir = tempDir();
  const session = path.join(dir, "session.jsonl");
  writeJsonl(session, [
    {
      type: "response_item",
      payload: {
        role: "user",
        content: [
          {
            type: "text",
            text: "Inspect **/Users/alice/private/plan.md** and _/Users/bob/secret.txt_",
          },
        ],
      },
    },
    { type: "response_item", payload: { role: "assistant", content: [{ type: "text", text: "Done." }] } },
  ]);

  const output = run(["render", "--session", session]);
  assert.match(output, /\[LOCAL_PATH\]/);
  assert.doesNotMatch(output, /\/Users\/alice/);
  assert.doesNotMatch(output, /\/Users\/bob/);
  assert.doesNotMatch(output, /private\/plan/);
  assert.doesNotMatch(output, /secret\.txt/);
});

test("render redacts backtick paths that contain a semicolon", () => {
  const dir = tempDir();
  const session = path.join(dir, "session.jsonl");
  writeJsonl(session, [
    {
      type: "response_item",
      payload: {
        role: "user",
        content: [
          {
            type: "text",
            text: "Open `/Users/alice/Acme;Private/plan.md` and `~/Acme;Private/plan.md`",
          },
        ],
      },
    },
    { type: "response_item", payload: { role: "assistant", content: [{ type: "text", text: "Done." }] } },
  ]);

  const output = run(["render", "--session", session]);
  assert.match(output, /\[LOCAL_PATH\]/);
  assert.match(output, /\[HOME_PATH\]/);
  assert.doesNotMatch(output, /\/Users\/alice/);
  assert.doesNotMatch(output, /;Private/);
  assert.doesNotMatch(output, /plan\.md/);
});

test("render keeps a URL field after a comma-bearing local path", () => {
  const dir = tempDir();
  const session = path.join(dir, "session.jsonl");
  writeJsonl(session, [
    {
      type: "response_item",
      payload: {
        role: "user",
        content: [
          {
            type: "text",
            text: "local=/Users/alice/a,url=https://example.test/docs",
          },
        ],
      },
    },
    { type: "response_item", payload: { role: "assistant", content: [{ type: "text", text: "Done." }] } },
  ]);

  const output = run(["render", "--session", session]);
  assert.match(output, /local=\[LOCAL_PATH\]/);
  assert.match(output, /https:\/\/example\.test\/docs/);
  assert.doesNotMatch(output, /\/Users\/alice/);
});

test("render leaves literal URL placeholders in dialogue", () => {
  const dir = tempDir();
  const session = path.join(dir, "session.jsonl");
  writeJsonl(session, [
    {
      type: "response_item",
      payload: {
        role: "user",
        content: [
          {
            type: "text",
            text: "Explain BEAMNETWORKURL0END then https://example.test/docs",
          },
        ],
      },
    },
    { type: "response_item", payload: { role: "assistant", content: [{ type: "text", text: "Done." }] } },
  ]);

  const output = run(["render", "--session", session]);
  assert.match(output, /Explain BEAMNETWORKURL0END/);
  assert.match(output, /https:\/\/example\.test\/docs/);
  assert.doesNotMatch(output, /Explain undefined/);
});

test("render drops raw tool outputs but keeps a compact tool summary", () => {
  const dir = tempDir();
  const session = path.join(dir, "session.jsonl");
  writeJsonl(session, [
    { type: "response_item", payload: { role: "user", content: [{ type: "text", text: "Run tests." }] } },
    { type: "response_item", payload: { type: "function_call", name: "exec_command", arguments: "npm test" } },
    {
      type: "response_item",
      payload: { type: "function_call_output", output: "raw output with sk-abcdefghijklmnopqrstuvwxyz123456" },
    },
  ]);

  const output = run(["render", "--session", session]);
  assert.match(output, /tool summary/);
  assert.match(output, /1 execute/);
  assert.doesNotMatch(output, /raw output/);
  assert.doesNotMatch(output, /sk-abcdefghijklmnopqrstuvwxyz123456/);
});

test("append-body replaces an existing transcript section", () => {
  const dir = tempDir();
  const session = path.join(dir, "session.jsonl");
  const body = path.join(dir, "body.md");
  writeJsonl(session, [
    { type: "response_item", payload: { role: "user", content: [{ type: "text", text: "New scoped work." }] } },
    { type: "response_item", payload: { role: "assistant", content: [{ type: "text", text: "Implemented." }] } },
  ]);
  fs.writeFileSync(
    body,
    "# PR\n\n<!-- agent-transcript:start -->\nold transcript\n<!-- agent-transcript:end -->\n"
  );

  const output = run(["append-body", "--body", body, "--session", session]);
  assert.match(output, /# PR/);
  assert.match(output, /New scoped work/);
  assert.doesNotMatch(output, /old transcript/);
  assert.equal((output.match(/agent-transcript:start/g) || []).length, 1);
});

test("find scans CLAUDE_CONFIG_DIR projects and labels them as Claude", () => {
  const dir = tempDir();
  const home = tempDir();
  const projectDir = path.join(dir, "projects", "-tmp-agent-transcript");
  fs.mkdirSync(projectDir, { recursive: true });
  const session = path.join(projectDir, "11111111-2222-4333-8444-555555555555.jsonl");
  writeJsonl(session, [
    { type: "user", message: { role: "user", content: "claude-config-dir-marker" } },
    { type: "assistant", message: { role: "assistant", content: "Done." } },
  ]);

  const output = run(["find", "--query", "claude-config-dir-marker", "--since-days", "1", "--max-files", "20"], {
    env: { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: `${dir}${path.sep}` },
  });
  const matches = JSON.parse(output);

  assert.equal(matches.length, 1);
  assert.equal(matches[0].file, session);
  assert.equal(matches[0].agent, "claude");
});

test("find labels explicit roots under trailing-slash CLAUDE_CONFIG_DIR as Claude", () => {
  const dir = tempDir();
  const home = tempDir();
  const projectRoot = path.join(dir, "projects");
  const projectDir = path.join(projectRoot, "-tmp-agent-transcript");
  fs.mkdirSync(projectDir, { recursive: true });
  const session = path.join(projectDir, "22222222-3333-4444-8555-666666666666.jsonl");
  writeJsonl(session, [
    { type: "user", message: { role: "user", content: "claude-config-dir-explicit-root-marker" } },
    { type: "assistant", message: { role: "assistant", content: "Done." } },
  ]);

  const output = run(
    [
      "find",
      "--query",
      "claude-config-dir-explicit-root-marker",
      "--since-days",
      "1",
      "--max-files",
      "20",
      "--root",
      projectRoot,
    ],
    { env: { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: `${dir}${path.sep}` } }
  );
  const matches = JSON.parse(output);

  assert.equal(matches.length, 1);
  assert.equal(matches[0].file, session);
  assert.equal(matches[0].agent, "claude");
});

function oversizedSession(dir) {
  const session = path.join(dir, "session.jsonl");
  const pad = JSON.stringify({
    type: "user",
    message: { role: "user", content: `pad-${"x".repeat(80)}` },
  });
  const lines = [
    JSON.stringify({ type: "user", message: { role: "user", content: "HEAD_READ_BOUND_MARKER" } }),
    ...Array.from({ length: 40 }, () => pad),
    JSON.stringify({ type: "user", message: { role: "user", content: "MIDDLE_READ_BOUND_MARKER" } }),
    ...Array.from({ length: 40 }, () => pad),
    JSON.stringify({ type: "user", message: { role: "user", content: "TAIL_READ_BOUND_MARKER" } }),
  ];
  fs.writeFileSync(session, `${lines.join("\n")}\n`);
  return session;
}

test("render bounds oversized JSONL reads before parse", () => {
  const dir = tempDir();
  const session = oversizedSession(dir);

  const output = run(["render", "--session", session, "--max-read-bytes", "400"]);
  assert.match(output, /HEAD_READ_BOUND_MARKER/);
  assert.match(output, /TAIL_READ_BOUND_MARKER/);
  assert.doesNotMatch(output, /MIDDLE_READ_BOUND_MARKER/);
  assert.match(output, /source truncated:/);
  assert.match(output, /"sourceTruncated":true/);
});

test("html bounds oversized JSONL reads before parse", () => {
  const dir = tempDir();
  const home = tempDir();
  oversizedSession(dir);
  const prs = path.join(dir, "prs.json");
  fs.writeFileSync(prs, JSON.stringify([{ title: "HEAD_READ_BOUND_MARKER", url: "https://example.com/pr/1" }]));

  const output = run(
    ["html", "--prs", prs, "--root", dir, "--since-days", "1", "--min-score", "1", "--max-read-bytes", "400"],
    { env: { ...process.env, HOME: home } },
  );
  assert.match(output, /HEAD_READ_BOUND_MARKER/);
  assert.match(output, /TAIL_READ_BOUND_MARKER/);
  assert.doesNotMatch(output, /MIDDLE_READ_BOUND_MARKER/);
  assert.match(output, /source truncated:/);
  assert.match(output, /&quot;sourceTruncated&quot;:true/);
});

test("preview and append-body retain source truncation notices even when output is shortened", () => {
  const dir = tempDir();
  const session = oversizedSession(dir);
  const body = path.join(dir, "body.md");
  fs.writeFileSync(body, "# Synthetic PR\n");
  for (const command of [["render"], ["preview"], ["append-body", "--body", body]]) {
    const output = run([...command, "--session", session, "--max-read-bytes", "400", "--max-chars", "1"]);
    assert.match(output, /source truncated:/);
    assert.match(output, /this transcript is partial/);
  }
});

test("default read cap discloses omitted content in a file larger than eight MiB", () => {
  const dir = tempDir();
  const session = path.join(dir, "large.jsonl");
  const row = (content) => ({ type: "user", message: { role: "user", content } });
  writeJsonl(session, [row("HEAD_DEFAULT_MARKER"), row("x".repeat(5 * 1024 * 1024)), row("MIDDLE_DEFAULT_MARKER"), row("y".repeat(5 * 1024 * 1024)), row("TAIL_DEFAULT_MARKER")]);
  const output = run(["render", "--session", session]);
  assert.match(output, /HEAD_DEFAULT_MARKER/);
  assert.match(output, /TAIL_DEFAULT_MARKER/);
  assert.doesNotMatch(output, /MIDDLE_DEFAULT_MARKER/);
  assert.match(output, /source truncated:/);
});

test("exact byte limit and small sessions remain complete", () => {
  const dir = tempDir();
  const session = path.join(dir, "small.jsonl");
  writeJsonl(session, [{ type: "user", message: { role: "user", content: "complete-session-marker" } }]);
  for (const options of [[], ["--max-read-bytes", String(fs.statSync(session).size)]]) {
    const output = run(["render", "--session", session, ...options]);
    assert.match(output, /complete-session-marker/);
    assert.match(output, /"sourceTruncated":false/);
    assert.doesNotMatch(output, /source truncated:/);
  }
});

test("line-limited sessions disclose omitted source content", () => {
  const dir = tempDir();
  const session = path.join(dir, "many-lines.jsonl");
  const row = { type: "user", message: { role: "user", content: "line-cap-marker" } };
  writeJsonl(session, Array.from({ length: 12001 }, () => row));
  const output = run(["render", "--session", session]);
  assert.match(output, /source truncated:/);
  assert.match(output, /"sourceTruncated":true/);
});

test("render rejects invalid and missing byte limits", () => {
  const dir = tempDir();
  const session = path.join(dir, "small.jsonl");
  writeJsonl(session, []);
  for (const value of ["1.5", "0", "-1", "NaN", "Infinity", "9007199254740992", null]) {
    assert.throws(
      () => run(["render", "--session", session, "--max-read-bytes", ...(value === null ? [] : [value])]),
      (error) => /--max-read-bytes must be a positive integer/.test(String(error.stderr)),
    );
  }
});

test("find fails closed when session discovery exceeds the walk cap", () => {
  const dir = tempDir();
  const home = tempDir();
  writeJsonl(path.join(dir, "a.jsonl"), [
    { type: "user", message: { role: "user", content: "walk-cap-find-marker" } },
  ]);
  writeJsonl(path.join(dir, "b.jsonl"), [
    { type: "user", message: { role: "user", content: "walk-cap-find-marker" } },
  ]);

  assert.throws(
    () =>
      run(
        [
          "find",
          "--query",
          "walk-cap-find-marker",
          "--root",
          dir,
          "--since-days",
          "1",
          "--max-files",
          "20",
          "--max-discovery-files",
          "1",
        ],
        { env: { ...process.env, HOME: home } },
      ),
    (error) => {
      assert.match(String(error.stderr || ""), /session discovery exceeded its file limit/);
      return true;
    },
  );
});

test("html fails closed when session discovery exceeds the walk cap", () => {
  const dir = tempDir();
  const home = tempDir();
  writeJsonl(path.join(dir, "a.jsonl"), [
    { type: "user", message: { role: "user", content: "walk-cap-html-marker" } },
  ]);
  writeJsonl(path.join(dir, "b.jsonl"), [
    { type: "user", message: { role: "user", content: "walk-cap-html-marker" } },
  ]);
  const prs = path.join(dir, "prs.json");
  fs.writeFileSync(prs, JSON.stringify([{ title: "walk-cap-html-marker", url: "https://example.com/pr/1" }]));

  assert.throws(
    () =>
      run(["html", "--prs", prs, "--root", dir, "--since-days", "1", "--max-discovery-files", "1"], {
        env: { ...process.env, HOME: home },
      }),
    (error) => {
      assert.match(String(error.stderr || ""), /session discovery exceeded its file limit/);
      return true;
    },
  );
});

test("discovery accepts exactly the cap across roots and ignores trailing non-session entries", () => {
  const dir = tempDir();
  const empty = tempDir();
  writeJsonl(path.join(dir, "a.jsonl"), [
    { type: "user", message: { role: "user", content: "exact-cap-marker" } },
  ]);
  fs.mkdirSync(path.join(dir, "z-empty"));
  fs.writeFileSync(path.join(dir, "z-not-session.txt"), "ignored");
  const prs = path.join(empty, "prs.json");
  fs.writeFileSync(prs, JSON.stringify([{ title: "exact-cap-marker", url: "https://example.com/pr/1" }]));
  for (const root of [dir, path.join(dir, "a.jsonl")]) {
    const options = ["--root", root, "--root", empty, "--max-discovery-files", "1"];
    const matches = JSON.parse(run(["find", "--query", "exact-cap-marker", ...options]));
    assert.equal(matches.length, 1);
    assert.match(run(["html", "--prs", prs, "--min-score", "1", ...options]), /exact-cap-marker/);
  }
});

test("discovery shares its cap across roots and counts old JSONL files", () => {
  const dir = tempDir();
  const roots = ["a.jsonl", "b.jsonl"].map((name) => path.join(dir, name));
  for (const file of roots) {
    writeJsonl(file, [{ type: "user", message: { role: "user", content: "old-marker" } }]);
    fs.utimesSync(file, new Date(0), new Date(0));
  }
  assert.throws(
    () => run(["find", "--query", "old-marker", "--root", roots[0], "--root", roots[1], "--since-days", "1", "--max-discovery-files", "1"]),
    (error) => /session discovery exceeded its file limit/.test(String(error.stderr)),
  );
});

test("discovery rejects invalid and missing file limits", () => {
  const dir = tempDir();
  const prs = path.join(dir, "prs.json");
  fs.writeFileSync(prs, "[]");
  for (const value of ["1.5", "0", "-1", "NaN", "Infinity", "9007199254740992", null]) {
    for (const command of [["find", "--query", "marker"], ["html", "--prs", prs]]) {
      assert.throws(
        () => run([...command, "--root", dir, "--max-discovery-files", ...(value === null ? [] : [value])]),
        (error) => /--max-discovery-files must be a positive integer/.test(String(error.stderr)),
      );
    }
  }
});
