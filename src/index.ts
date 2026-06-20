import { access, appendFile, mkdir } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { chromium, type BrowserContext, type Locator, type Page } from "playwright";

const appHome = process.env.WAKE_UP_CLAUDE_HOME
  ? path.resolve(process.env.WAKE_UP_CLAUDE_HOME)
  : path.join(os.homedir(), ".wake-up-claude");

const profileDir = path.join(appHome, "profile");
const logsDir = path.join(appHome, "logs");
const logFile = path.join(logsDir, "run.log");
const claudeNewUrl = "https://claude.ai/new";

const braveExecutableCandidates = [
  process.env.BRAVE_EXECUTABLE_PATH,
  "/usr/bin/brave-browser",
  "/usr/bin/brave",
  "/usr/local/bin/brave-browser",
  "/usr/local/bin/brave",
  "/snap/bin/brave",
  "/opt/brave.com/brave/brave",
  "/var/lib/flatpak/exports/bin/com.brave.Browser",
  path.join(os.homedir(), ".local/share/flatpak/exports/bin/com.brave.Browser")
].filter((candidate): candidate is string => Boolean(candidate));

async function ensureRuntimeDirectories(): Promise<void> {
  await mkdir(profileDir, { recursive: true });
  await mkdir(logsDir, { recursive: true });
}

async function writeLog(message: string): Promise<void> {
  await appendFile(logFile, `${new Date().toISOString()} ${message}\n`, "utf8");
}

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  return String(error);
}

async function detectBraveExecutable(): Promise<string> {
  for (const candidate of braveExecutableCandidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
    }
  }

  throw new Error(
    `Unable to find a Brave executable. Set BRAVE_EXECUTABLE_PATH or install Brave. Checked: ${braveExecutableCandidates.join(", ")}`
  );
}

function isClaudeLoginUrl(url: string): boolean {
  const parsed = new URL(url);
  return parsed.hostname === "claude.ai" && parsed.pathname.startsWith("/login");
}

async function promptForLogin(page: Page): Promise<void> {
  if (!isClaudeLoginUrl(page.url())) {
    return;
  }

  await writeLog("login required");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    await rl.question("Claude login required. Complete login in the Brave window, then press Enter here to continue.");
  } finally {
    rl.close();
  }

  await page.goto(claudeNewUrl, { waitUntil: "domcontentloaded" });

  if (isClaudeLoginUrl(page.url())) {
    throw new Error("Claude login was not completed");
  }

  await writeLog("login completed");
}

async function waitForChatInput(page: Page): Promise<Locator> {
  await page.waitForFunction(
    () => {
      const candidates = Array.from(document.querySelectorAll<HTMLElement>("div.ProseMirror[contenteditable='true']"));

      return candidates.some((candidate) => {
        const style = window.getComputedStyle(candidate);
        const rect = candidate.getBoundingClientRect();
        const disabledContainer = candidate.closest("[aria-disabled='true'], [disabled], [inert]");

        return candidate.isContentEditable &&
          !disabledContainer &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0;
      });
    },
    undefined,
    { timeout: 120_000 }
  );

  const input = page.locator("div.ProseMirror[contenteditable='true']:visible").last();
  await input.click({ timeout: 30_000 });
  return input;
}

async function submitWakeUpMessage(input: Locator): Promise<void> {
  await input.pressSequentially("0");
  await input.press("Enter");
}

async function waitForStreamingToFinish(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const candidates = Array.from(document.querySelectorAll<HTMLElement>("button, [role='button'], [aria-label], [title], [data-testid]"));

      return candidates.some((candidate) => {
        const style = window.getComputedStyle(candidate);
        const rect = candidate.getBoundingClientRect();
        const label = [
          candidate.getAttribute("aria-label"),
          candidate.getAttribute("title"),
          candidate.getAttribute("data-testid"),
          candidate.innerText
        ].filter(Boolean).join(" ");

        return /stop/i.test(label) &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0;
      });
    },
    undefined,
    { timeout: 90_000 }
  );

  await writeLog("streaming started");

  await page.waitForFunction(
    () => {
      const candidates = Array.from(document.querySelectorAll<HTMLElement>("button, [role='button'], [aria-label], [title], [data-testid]"));

      return !candidates.some((candidate) => {
        const style = window.getComputedStyle(candidate);
        const rect = candidate.getBoundingClientRect();
        const label = [
          candidate.getAttribute("aria-label"),
          candidate.getAttribute("title"),
          candidate.getAttribute("data-testid"),
          candidate.innerText
        ].filter(Boolean).join(" ");

        return /stop/i.test(label) &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0;
      });
    },
    undefined,
    { timeout: 600_000 }
  );
}

async function run(): Promise<void> {
  await ensureRuntimeDirectories();
  await writeLog("run started");

  let context: BrowserContext | undefined;
  let runFailed = false;

  try {
    const executablePath = await detectBraveExecutable();
    await writeLog(`brave executable ${executablePath}`);

    context = await chromium.launchPersistentContext(profileDir, {
      executablePath,
      headless: false,
      viewport: null,
      ignoreDefaultArgs: ["--enable-automation"],
      args: [
        "--new-window",
        "--disable-blink-features=AutomationControlled"
      ]
    });

    await context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });

    const existingPages = context.pages();
    const page = existingPages[0] ?? await context.newPage();

    for (const stalePage of existingPages.slice(1)) {
      try {
        await stalePage.close();
      } catch (error) {
        await writeLog(`failed to close stale tab ${formatError(error)}`);
      }
    }

    await writeLog(`closed ${existingPages.length - 1} stale tab(s)`);
    await page.bringToFront();
    await page.goto(claudeNewUrl, { waitUntil: "domcontentloaded" });
    await promptForLogin(page);

    const input = await waitForChatInput(page);
    await writeLog("chat input ready");
    await submitWakeUpMessage(input);
    await writeLog("message submitted");
    await waitForStreamingToFinish(page);
    await writeLog("response completed");
  } catch (error) {
    runFailed = true;
    await writeLog(`run failed ${formatError(error)}`);
    throw error;
  } finally {
    if (context) {
      try {
        await context.close();
        await writeLog("window closed");
      } catch (error) {
        await writeLog(`window close failed ${formatError(error)}`);

        if (!runFailed) {
          throw error;
        }
      }
    }

    await writeLog("run finished");
  }
}

run().catch((error) => {
  console.error(formatError(error));
  process.exitCode = 1;
});
