const RESET = "\x1b[0m";

const COLORS = {
  info: "\x1b[36m", // cyan
  warning: "\x1b[33m", // yellow
  error: "\x1b[31m", // red
} as const;

type Level = keyof typeof COLORS;

const LABELS: Record<Level, string> = {
  info: "INFO",
  warning: "WARNING",
  error: "ERROR",
};

const colorEnabled = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;

function write(level: Level, args: unknown[]): void {
  const tag = `[${LABELS[level]}]`;
  const prefix = colorEnabled ? `${COLORS[level]}${tag}${RESET}` : tag;
  const stream = level === "error" ? console.error : console.log;
  stream(prefix, ...args);
}

export const logger = {
  info: (...args: unknown[]) => write("info", args),
  warn: (...args: unknown[]) => write("warning", args),
  error: (...args: unknown[]) => write("error", args),
};
