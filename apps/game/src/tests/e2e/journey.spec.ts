import { expect, test } from "@playwright/test";

test.describe("WildGent manual expedition", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.removeItem("wildgent.game.snapshot.v1"));
  });

  test("starts the journey and exposes the first field action", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("preflight-screen")).toBeVisible();
    await page.getByTestId("start-journey").click();
    await expect(page.getByTestId("game-shell")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Camp / relay" })).toBeVisible();
    await expect(page.getByTestId("landmark-action")).toContainText("Light beacon");
  });

  test("judge demo begins before Resonance", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("start-judge-demo").click();
    await expect(page.getByTestId("game-shell")).toBeVisible();
    await expect(page.getByText("Relay Resonance")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Calibrate Resonance at the relay." }),
    ).toBeVisible();
    await expect(page.getByText(/starts before Resonance/i)).toHaveCount(0);

    const canvas = page.locator("canvas.world-canvas");
    await expect(canvas).toBeVisible();
    await expect
      .poll(() => canvas.evaluate((element) => (element as HTMLCanvasElement).width))
      .toBeGreaterThan(300);
    await expect
      .poll(() => canvas.evaluate((element) => (element as HTMLCanvasElement).height))
      .toBeGreaterThan(150);
  });

  test("keyboard movement updates the shared authoritative grid", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("start-journey").click();
    const grid = page.getByTestId("grid-position");
    await expect(grid).toHaveText("01 · 01");
    await page.keyboard.press("ArrowRight");
    await expect(grid).toHaveText("02 · 01");
    await expect(page.getByText("ready", { exact: true })).toBeVisible();
    await page.keyboard.press("ArrowLeft");
    await expect(grid).toHaveText("01 · 01");
  });

  test("queues rapid physical taps and ignores browser repeat events", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("start-journey").click();
    const grid = page.getByTestId("grid-position");
    await page.keyboard.down("ArrowRight");
    await page.keyboard.up("ArrowRight");
    await page.keyboard.down("ArrowRight");
    await page.keyboard.up("ArrowRight");
    await expect(grid).toHaveText("03 · 01");
    await page.evaluate(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", repeat: true }));
    });
    await expect(grid).toHaveText("03 · 01");
  });

  test("disables physical actions away from a landmark and enables them on return", async ({
    page,
  }) => {
    await page.goto("/");
    await page.getByTestId("start-journey").click();
    await page.getByTestId("landmark-action").click();
    await page.getByTestId("landmark-relay-station").click();
    await expect(page.getByTestId("grid-position")).toHaveText("05 · 02");
    const action = page.getByTestId("landmark-action");
    await expect(action).toBeEnabled();
    await page.keyboard.press("ArrowLeft");
    await expect(page.getByTestId("grid-position")).toHaveText("04 · 02");
    await expect(action).toBeDisabled();
    await expect(page.getByText("approach", { exact: true })).toBeVisible();
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("grid-position")).toHaveText("05 · 02");
    await expect(action).toBeEnabled();
    await expect(page.locator(".action-state")).toHaveText("ready");
  });

  test("completes the shared human-and-Echo vertical slice", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("start-judge-demo").click();

    // Relay restoration is the visible capability unlock point.
    await page.getByTestId("landmark-action").click();
    await expect(page.getByText("interface · new")).toBeVisible();
    await page.getByRole("button", { name: "Ruins / guardian" }).click();

    await page.getByTestId("landmark-ruins-rubble").click();
    await page.getByTestId("landmark-action").click();
    await page.getByTestId("landmark-ruins-power").click();
    await page.getByTestId("landmark-action").click();
    await page.getByTestId("landmark-ruins-sigil").click();
    await page.getByTestId("landmark-action").click();

    // This is intentionally a human-facing control; the agent receives a structured refusal for
    // the same discovery through WebMCP.
    await page.getByTestId("landmark-ruins-vines").click();
    await page.getByTestId("landmark-action").click();
    await expect(page.getByText("Human lens open")).toBeVisible();
    // Discovery is human-only; approach the sigil again before the agent capability acts on it.
    await page.getByTestId("landmark-ruins-sigil").click();
    await page.getByTestId("landmark-action").click();

    await expect(page.getByTestId("battle-panel")).toBeVisible();
    await page.getByRole("button", { name: /Resonance/ }).click();
    for (let index = 0; index < 5; index += 1) {
      await page.getByRole("button", { name: /Pulse/ }).click();
    }
    await expect(
      page.getByText("Guardian defeated. The Ancient Core shines through."),
    ).toBeVisible();
    await page.getByTestId("landmark-ancient-core").click();
    await page.getByTestId("landmark-action").click();
    await expect(page.getByTestId("complete-panel")).toBeVisible();
    await expect(page.getByText("The forest remembers.")).toBeVisible();
  });
});
