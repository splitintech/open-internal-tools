import { mkdir } from 'node:fs/promises';
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { chromium } from "playwright";
const children = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function start(file, args, env = {}) {
  const child = spawn(process.execPath, [file, ...args], {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.push(child);
  child.stderr.on("data", (data) => process.stderr.write(data));
  return child;
}
async function ready(url) {
  for (let n = 0; n < 80; n++) {
    try {
      await fetch(url);
      return;
    } catch {
      await sleep(100);
    }
  }
  throw new Error("Service did not start: " + url);
}
let browser;
try {
  const service = start(
    "node_modules/tsx/dist/cli.mjs",
    ["examples/service/main.ts"],
    { SYNTHETIC_DEMO: "1", PORT: "4319", NODE_ENV: "test", DATABASE_URL: "" },
  );
  start("node_modules/vite/bin/vite.js", [
    "--config",
    "examples/demo/vite.config.ts",
  ]);
  await Promise.all([
    ready("http://127.0.0.1:4319"),
    ready("http://127.0.0.1:4320"),
  ]);
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {}),
  });
  const page = await browser.newPage({
    viewport: { width: 320, height: 740 },
    reducedMotion: "reduce",
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  if(process.env.ZELLE_SCREENSHOT_DIR) await mkdir(process.env.ZELLE_SCREENSHOT_DIR,{recursive:true});
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 850 });
    await page.goto("http://127.0.0.1:4320");
    await page
      .getByRole("button", { name: "Zelle Quick Pay", exact: true })
      .waitFor();
    const boxes = await page.locator(".zqp-method").evaluateAll((nodes) =>
      nodes.map((node) => {
        const r = node.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      }),
    );
    assert.equal(boxes.length, 4);
    assert(Math.abs(boxes[0].w - boxes[0].h) < 1);
    assert.equal(boxes[0].y, boxes[1].y);
    assert(boxes[2].y > boxes[0].y);
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
  }
  assert(await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches));
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  const darkColor = await page.locator(".zqp-method").first().evaluate(node => getComputedStyle(node).backgroundColor);
  await page.evaluate(() => document.documentElement.classList.remove("dark"));
  const lightColor = await page.locator(".zqp-method").first().evaluate(node => getComputedStyle(node).backgroundColor);
  assert.notEqual(darkColor, lightColor);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Continue with Zelle" }).click();
  await page.getByRole("dialog").waitFor();
  if(process.env.ZELLE_SCREENSHOT_DIR)await page.screenshot({path:process.env.ZELLE_SCREENSHOT_DIR+"/review-overlay.png"});
  await page.getByText("Review your payment", { exact: true }).waitFor();
  for(let step=0;step<12;step++) {
    await page.keyboard.press("Tab");
    assert(await page.getByRole("dialog").evaluate(node=>node.contains(document.activeElement)));
  }
  await page
    .getByRole("checkbox", {
      name: "I checked the recipient and exact amount.",
    })
    .check();
  await page
    .getByRole("button", { name: "Continue to banking instructions" })
    .click();
  await page.getByRole("button", { name: "I returned from my bank" }).click();
  await page.getByText("Awaiting bank confirmation", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByText("Bank-confirmed payment received", { exact: true })
      .count(),
    0,
  );
  await page.getByRole("button", { name: "Close payment" }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert(
    await page
      .getByRole("button", { name: "Continue with Zelle" })
      .evaluate((node) => node === document.activeElement),
  );
  await page
    .getByRole("button", { name: "Simulate verified bank receipt" })
    .click();
  await page.getByRole("button", { name: "Continue with Zelle" }).click();
  await page
    .getByText("Bank-confirmed payment received", { exact: true })
    .waitFor();
  await page.goBack();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.deepEqual(errors, []);
  // Reset synthetic data between V1 and V2, preserving one mode per obligation.
  service.kill("SIGTERM");
  await new Promise((resolve) => service.once("exit", resolve));
  start("node_modules/tsx/dist/cli.mjs", ["examples/service/main.ts"], {
    SYNTHETIC_DEMO: "1",
    PORT: "4319",
    NODE_ENV: "test",
    DATABASE_URL: "",
  });
  await ready("http://127.0.0.1:4319");
  await page.reload();
  await page.getByRole("combobox").selectOption("embedded");
  await page.setViewportSize({width:1280,height:900});
  await page.getByRole("button", { name: "Continue with Zelle" }).click();
  await page
    .getByRole("checkbox", {
      name: "I checked the recipient and exact amount.",
    })
    .check();
  await page.getByRole("button", { name: "Authorize with your bank" }).click();
  await page.getByRole("button", { name: "Confirm Zelle payment" }).click();
  await page.getByText("Awaiting bank confirmation", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByText("Bank-confirmed payment received", { exact: true })
      .count(),
    0,
  );
  await page.getByRole("button", { name: "Close payment" }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "Simulate verified bank receipt" }).click();
  await page.getByRole("button", { name: "Continue with Zelle" }).click();
  await page.getByText("Bank-confirmed payment received", { exact: true }).waitFor();
  await page.getByText("Applied to your payment record", { exact: true }).waitFor();
  assert(await page.getByRole("dialog").evaluate(node=>node.scrollWidth<=node.clientWidth+1), "Receipt must fit the mobile dialog");
  assert.deepEqual(errors, []);
  console.log(
    "Browser acceptance passed: square grids, mobile overlay, focus/back, V1 unverified return + receipt, V2 confirmation + verified receipt + application. SYNTHETIC ONLY.",
  );
} finally {
  await browser?.close();
  for (const child of children) child.kill("SIGTERM");
}
