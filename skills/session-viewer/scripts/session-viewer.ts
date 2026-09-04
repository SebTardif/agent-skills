import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { parseSessionDocument } from "./core/detect.ts";
import { parseJsonl } from "./core/jsonl.ts";
import { buildSessionViewerHtml } from "./html.ts";
import { resolveOpenBrowserCommand } from "./open-browser.ts";

const MAX_SESSION_BYTES = 8 * 1024 * 1024;

type Options = {
  blank: boolean;
  inputPath?: string;
  maxReadBytes: number;
  open: boolean;
  outPath?: string;
  raw: boolean;
};

function usage(): string {
  return [
    "Usage:",
    "  node session-viewer.ts <session.jsonl> --out session.html [--open] [--raw] [--max-read-bytes N]",
    "  node session-viewer.ts --blank --out viewer.html [--open]",
    "",
    "Options:",
    "  --blank             Write reusable file-picker viewer",
    "  --out PATH          Output HTML path",
    "  --open              Open output path in the browser",
    "  --raw               Embed raw JSONL instead of normalized data",
    "  --max-read-bytes N   Max session bytes to read (default 8388608)",
    "  -h, --help          Show help",
  ].join("\n");
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    blank: false,
    maxReadBytes: MAX_SESSION_BYTES,
    open: false,
    raw: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--blank") {
      options.blank = true;
      continue;
    }
    if (arg === "--open") {
      options.open = true;
      continue;
    }
    if (arg === "--raw") {
      options.raw = true;
      continue;
    }
    if (arg === "--out") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("missing value after --out");
      }
      options.outPath = value;
      index += 1;
      continue;
    }
    if (arg === "--max-read-bytes") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error("missing value after --max-read-bytes");
      }
      options.maxReadBytes = parsePositiveInteger(value, "--max-read-bytes");
      index += 1;
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`unknown option: ${arg}`);
    }
    if (options.inputPath) {
      throw new Error(`unexpected extra input: ${arg}`);
    }
    options.inputPath = arg;
  }
  if (!options.blank && !options.inputPath) {
    throw new Error("missing input session path");
  }
  return options;
}

async function readBoundedText(
  file: string,
  maxBytes = MAX_SESSION_BYTES,
): Promise<{ size: number; text: string; truncated: boolean }> {
  const handle = await fs.open(file, "r");
  try {
    const stat = await handle.stat();
    if (stat.size <= maxBytes) {
      const buffer = Buffer.alloc(stat.size);
      const { bytesRead } = await handle.read(buffer, 0, stat.size, 0);
      return {
        size: stat.size,
        text: buffer.subarray(0, bytesRead).toString("utf8"),
        truncated: false,
      };
    }
    const half = Math.floor(maxBytes / 2);
    const head = Buffer.alloc(half);
    const tail = Buffer.alloc(half);
    const { bytesRead: headBytes } = await handle.read(head, 0, half, 0);
    const { bytesRead: tailBytes } = await handle.read(
      tail,
      0,
      half,
      Math.max(0, stat.size - half),
    );
    return {
      size: stat.size,
      text: `${head.subarray(0, headBytes).toString("utf8")}\n[...middle omitted for scan...]\n${tail.subarray(0, tailBytes).toString("utf8")}`,
      truncated: true,
    };
  } finally {
    await handle.close();
  }
}

function defaultOutputPath(inputPath: string | undefined, blank: boolean): string {
  if (blank || !inputPath) {
    return path.resolve("session-viewer.html");
  }
  const parsed = path.parse(inputPath);
  return path.join(parsed.dir, `${parsed.name}.html`);
}

async function openBrowser(filePath: string): Promise<void> {
  const command = resolveOpenBrowserCommand(process.platform, filePath);
  spawn(command.executable, command.args, { detached: true, stdio: "ignore" }).unref();
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const outputPath = path.resolve(
    options.outPath ?? defaultOutputPath(options.inputPath, options.blank),
  );
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  if (options.blank) {
    const html = buildSessionViewerHtml(null, { embedMode: "blank" });
    await fs.writeFile(outputPath, html, "utf8");
    console.log(`wrote: ${outputPath}`);
    if (options.open) {
      await openBrowser(outputPath);
    }
    return;
  }

  const inputPath = path.resolve(options.inputPath ?? "");
  const bounded = await readBoundedText(inputPath, options.maxReadBytes);
  const rawText = bounded.text;
  const { records, warnings } = parseJsonl(rawText);
  const document = parseSessionDocument(records, inputPath);
  document.warnings.unshift(...warnings);
  if (bounded.truncated) {
    const warning = `source truncated: omitted middle of ${inputPath} (${bounded.size} bytes, read cap ${options.maxReadBytes} bytes)`;
    document.warnings.unshift(warning);
    console.log(warning);
  }
  const html = buildSessionViewerHtml(document, {
    embedMode: options.raw ? "raw" : "normalized",
    rawText,
  });
  await fs.writeFile(outputPath, html, "utf8");
  console.log(`wrote: ${outputPath}`);
  console.log(`format: ${document.format}`);
  console.log(`events: ${document.events.length}`);
  if (document.warnings.length > 0) {
    console.log(`warnings: ${document.warnings.length}`);
  }
  if (options.open) {
    await openBrowser(outputPath);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
