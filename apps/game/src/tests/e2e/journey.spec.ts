import { expect, type Page, test } from "@playwright/test";
import { getLandmark, type LandmarkId } from "../../app-model";

type LandmarkExpectation = {
  testId: string;
  gridPosition: string;
  actionLabel: string;
};

const formatGridPosition = (position: { x: number; y: number }) =>
  `${String(position.x).padStart(2, "0")} · ${String(position.y).padStart(2, "0")}`;

const landmarkExpectation = (
  landmarkId: LandmarkId,
  actionLabel = getLandmark(landmarkId)?.actionLabel,
): LandmarkExpectation => {
  const landmark = getLandmark(landmarkId);
  if (landmark === undefined || actionLabel === undefined) {
    throw new Error(`Missing E2E landmark fixture for ${landmarkId}`);
  }
  return {
    testId: `landmark-${landmarkId}`,
    gridPosition: formatGridPosition(landmark.position),
    actionLabel,
  };
};

const RUINS_LANDMARKS = {
  rubble: landmarkExpectation("ruins-rubble"),
  power: landmarkExpectation("ruins-power"),
  sigil: landmarkExpectation("ruins-sigil"),
  vines: landmarkExpectation("ruins-vines"),
  door: landmarkExpectation("ruins-sigil", "Open ruin door with Interface"),
  core: landmarkExpectation("ancient-core"),
} as const;

const startAndDismissCoach = async (
  page: Page,
  startTestId: "start-journey" | "start-judge-demo",
) => {
  await page.getByTestId(startTestId).click();
  await expect(page.getByTestId("game-shell")).toBeVisible();
  const coach = page.getByTestId("first-run-coach");
  await expect(coach).toBeVisible();
  await coach.getByRole("button", { name: "Skip" }).click();
  await expect(coach).toHaveCount(0);
  await expect(page.getByTestId("pause-expedition")).toHaveAttribute("aria-pressed", "false");
};

const clickLandmarkAction = async (page: Page, expected: LandmarkExpectation) => {
  const landmark = page.getByTestId(expected.testId);
  await expect(landmark).toBeEnabled();
  await landmark.click();

  await expect(page.getByTestId("grid-position")).toHaveText(expected.gridPosition);
  const action = page.getByTestId("landmark-action");
  await expect(action.getByText(expected.actionLabel, { exact: true })).toBeVisible();
  await expect(action.locator(".action-state")).toHaveText("ready");
  await expect(action).toBeEnabled();
  await action.click();
};

test.describe("WildGent manual expedition", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const initializedKey = "wildgent.e2e.storage-cleared.v1";
      if (sessionStorage.getItem(initializedKey) === "true") return;
      localStorage.removeItem("wildgent.game.snapshot.v1");
      localStorage.removeItem("wildgent.guide.dismissed.v1");
      sessionStorage.setItem(initializedKey, "true");
    });
  });

  test("starts the journey and exposes the first field action", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByTestId("preflight-screen")).toBeVisible();
    await expect(page.getByTestId("landing-page")).toBeVisible();
    await expect(page).toHaveTitle("WildGent — Find the signal");
    await expect(page.locator("canvas")).toHaveCount(0);
    await startAndDismissCoach(page, "start-journey");
    await expect(page).toHaveURL(/\/play$/);
    await expect(page).toHaveTitle("WildGent — The Living Signal");
    await expect(page.getByRole("heading", { name: "Camp / relay" })).toBeVisible();
    await expect(page.getByTestId("landmark-action")).toContainText("Light beacon");
  });

  test("judge demo begins before Resonance", async ({ page }) => {
    await page.goto("/");
    await startAndDismissCoach(page, "start-judge-demo");
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
    await startAndDismissCoach(page, "start-journey");
    const grid = page.getByTestId("grid-position");
    await expect(grid).toHaveText("01 · 01");
    await page.keyboard.press("ArrowRight");
    await expect(grid).toHaveText("02 · 01");
    await page.keyboard.press("ArrowLeft");
    await expect(grid).toHaveText("01 · 01");
  });

  test("keeps the expedition playable and contained after a narrow viewport resize", async ({
    page,
  }) => {
    await page.goto("/");
    await startAndDismissCoach(page, "start-journey");
    await page.setViewportSize({ width: 320, height: 568 });

    await expect(page.getByTestId("desktop-required")).toHaveCount(0);
    const canvas = page.locator("canvas.world-canvas");
    await expect(canvas).toBeVisible();
    await expect
      .poll(() => canvas.evaluate((element) => (element as HTMLCanvasElement).width))
      .toBeGreaterThan(300);

    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("grid-position")).toHaveText("02 · 01");

    const viewport = page.viewportSize();
    const actionBox = await page.getByTestId("landmark-action").boundingBox();
    if (!viewport || !actionBox) throw new Error("Responsive action prompt did not render.");
    expect(actionBox.x).toBeGreaterThanOrEqual(0);
    expect(actionBox.x + actionBox.width).toBeLessThanOrEqual(viewport.width);
    expect(actionBox.y + actionBox.height).toBeLessThanOrEqual(viewport.height);
  });

  test("queues rapid physical taps and ignores browser repeat events", async ({ page }) => {
    await page.goto("/");
    await startAndDismissCoach(page, "start-journey");
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
    await startAndDismissCoach(page, "start-journey");
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
    test.slow();
    await page.goto("/");
    await startAndDismissCoach(page, "start-judge-demo");

    // Relay restoration is the visible capability unlock point.
    const relayAction = page.getByTestId("landmark-action");
    await expect(page.getByTestId("grid-position")).toHaveText("05 · 02");
    await expect(relayAction.getByText("Calibrate Resonance", { exact: true })).toBeVisible();
    await expect(relayAction.locator(".action-state")).toHaveText("ready");
    await expect(relayAction).toBeEnabled();
    await relayAction.click();
    await expect(page.getByText("interface · new")).toBeVisible();
    await page.getByRole("button", { name: "Ruins / guardian" }).click();

    await clickLandmarkAction(page, RUINS_LANDMARKS.rubble);
    await clickLandmarkAction(page, RUINS_LANDMARKS.power);
    await clickLandmarkAction(page, RUINS_LANDMARKS.sigil);

    // This is intentionally a human-facing control; the agent receives a structured refusal for
    // the same discovery through WebMCP.
    await clickLandmarkAction(page, RUINS_LANDMARKS.vines);
    await expect(page.getByTestId("landmark-ruins-vines")).toHaveClass(/is-complete/);
    // Discovery is human-only; approach the sigil again before the agent capability acts on it.
    await clickLandmarkAction(page, RUINS_LANDMARKS.door);

    await expect(page.getByTestId("battle-panel")).toBeVisible();
    await page.getByRole("button", { name: /Resonance/ }).click();
    for (let index = 0; index < 5; index += 1) {
      await page.getByRole("button", { name: /Pulse/ }).click();
    }
    await expect(page.getByRole("heading", { name: "Enter the ancient core." })).toBeVisible();
    await clickLandmarkAction(page, RUINS_LANDMARKS.core);
    await expect(page.getByTestId("complete-panel")).toBeVisible();
    await expect(page.getByText("The forest remembers.")).toBeVisible();
  });

  for (const mode of ["journey", "demo"] as const) {
    test(`shows the first-run coach once for ${mode}`, async ({ page }) => {
      test.slow();
      await page.goto("/");
      const startTestId = mode === "journey" ? "start-journey" : "start-judge-demo";
      await page.getByTestId(startTestId).click();
      const coach = page.getByTestId("first-run-coach");
      await expect(coach).toBeVisible();
      await expect(page.getByRole("heading", { name: "Move and select" })).toBeVisible();
      await expect(page.getByTestId("pause-expedition")).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByTestId("coach-next")).toBeFocused();

      await page.getByTestId("coach-next").click();
      await expect(
        page.getByRole("heading", { name: "Interact at the edge of the world" }),
      ).toBeVisible();
      await page.getByTestId("coach-next").click();
      await expect(page.getByRole("heading", { name: "Cooperate with Echo" })).toBeVisible();
      await page.getByTestId("coach-back").click();
      await expect(
        page.getByRole("heading", { name: "Interact at the edge of the world" }),
      ).toBeVisible();
      await page.getByTestId("coach-next").click();
      await page.getByTestId("coach-finish").click();
      await expect(coach).toHaveCount(0);
      await expect(page.getByTestId("pause-expedition")).toHaveAttribute("aria-pressed", "false");
      await expect
        .poll(() => page.evaluate(() => localStorage.getItem("wildgent.guide.dismissed.v1")))
        .toBe("true");

      await page.reload();
      await expect(page.getByTestId("game-shell")).toBeVisible();
      await expect(page.getByTestId("first-run-coach")).toHaveCount(0);
    });
  }

  test("keeps coach focus contained and Escape dismisses it", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("start-journey").click();
    const coach = page.getByTestId("first-run-coach");
    await expect(coach).toBeVisible();
    await expect(page.getByTestId("coach-next")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByTestId("coach-skip")).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByTestId("coach-next")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(coach).toHaveCount(0);
    await expect(page.getByTestId("open-field-guide")).toBeFocused();
  });

  test("reopens the player guide from the HUD and exposes Echo Link details", async ({ page }) => {
    await page.goto("/");
    await startAndDismissCoach(page, "start-judge-demo");
    await expect(page.getByTestId("echo-link-status")).toBeVisible();
    await page.getByTestId("open-field-guide").click();
    const guide = page.getByTestId("field-guide-drawer");
    await expect(guide).toBeVisible();
    await expect(guide.getByText("How to Play")).toBeVisible();
    await expect(guide.getByText("Human + Echo")).toBeVisible();
    await expect(guide.locator("summary").filter({ hasText: "Echo Link" })).toBeVisible();
    await expect(guide.getByText("Connect Echo", { exact: true })).toBeVisible();
    const connectionGuide = guide.locator(".guide-connect");
    await expect(connectionGuide).toContainText(
      "current ChatGPT desktop app with GPT-5.6 Sol or Terra",
    );
    await expect(connectionGuide).toContainText("Use @Browser to open the local /play page");
    await expect(connectionGuide).toContainText(
      "Inspect Site tools, then ask Echo to call get_game_state followed by look_around",
    );
    await expect(guide.getByTestId("echo-capability-note")).toContainText(
      "interface capability unlocks only after Voltyn Resonance",
    );
    await expect(guide.getByTestId("echo-capability-note")).toContainText(
      "no gameplay objective is blocked",
    );
    await expect(
      guide.getByRole("link", { name: "Read the README WebMCP setup guide" }),
    ).toHaveAttribute("href", "https://github.com/mazkaaa/wildgent#webmcp-setup");
    await guide.getByText("Technical connection notes", { exact: true }).click();
    await expect(guide.getByText("chrome://flags/#enable-webmcp-testing")).toBeVisible();
    await expect(guide.getByText(/Hosted acceptance is separate/)).toBeVisible();
    await expect(guide.getByText("Diagnostics")).toBeVisible();
    await expect(guide.getByText("Judge Demo details")).toBeVisible();
    await guide.getByRole("button", { name: "Close field guide" }).click();
    await expect(guide).toHaveCount(0);

    const relayAction = page.getByTestId("landmark-action");
    await expect(relayAction.getByText("Calibrate Resonance", { exact: true })).toBeVisible();
    await relayAction.click();
    await expect(page.getByText("interface · new")).toBeVisible();

    await page.getByTestId("open-field-guide").click();
    const reopenedGuide = page.getByTestId("field-guide-drawer");
    await expect(reopenedGuide.getByTestId("echo-capability-note")).toContainText(
      "Echo can use it now",
    );
    await reopenedGuide.getByText("Judge Demo details").click();
    await expect(reopenedGuide.getByText("voltyn-relay").first()).toBeVisible();
    await expect(reopenedGuide.getByText("HUMAN_DISCOVERY_REQUIRED").first()).toBeVisible();
    await reopenedGuide.getByRole("button", { name: "Close field guide" }).click();
    await expect(reopenedGuide).toHaveCount(0);
  });

  test("continues a saved expedition without resetting it", async ({ page }) => {
    await page.goto("/");
    await startAndDismissCoach(page, "start-journey");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("grid-position")).toHaveText("02 · 01");

    await page.getByTestId("return-to-landing").click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("landing-page")).toBeVisible();
    await expect(page).toHaveTitle("WildGent — Find the signal");
    await expect(page.locator("canvas")).toHaveCount(0);
    await expect(page.getByTestId("continue-journey")).toBeVisible();

    await page.getByTestId("continue-journey").click();
    await expect(page).toHaveURL(/\/play$/);
    await expect(page.getByTestId("game-shell")).toBeVisible();
    await expect(page).toHaveTitle("WildGent — The Living Signal");
    await expect(page.getByTestId("grid-position")).toHaveText("02 · 01");
    await expect(page.getByTestId("first-run-coach")).toHaveCount(0);
  });

  test("focuses the game when a previously dismissed coach stays suppressed", async ({ page }) => {
    await page.goto("/");
    await startAndDismissCoach(page, "start-journey");
    await page.getByTestId("return-to-landing").click();
    await expect(page.getByTestId("landing-page")).toBeVisible();

    await page.getByTestId("start-journey").click();
    await expect(page.getByTestId("first-run-coach")).toHaveCount(0);
    await expect(page.getByTestId("game-shell")).toBeFocused();
  });

  test("redirects a direct preflight visit to the landing page", async ({ page }) => {
    await page.goto("/play");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("landing-page")).toBeVisible();
    await expect(page.getByTestId("preflight-screen")).toBeVisible();
    await expect(page.locator("canvas")).toHaveCount(0);
  });

  test("preserves the authoritative snapshot through browser Back and Forward", async ({
    page,
  }) => {
    await page.goto("/");
    await startAndDismissCoach(page, "start-journey");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByTestId("grid-position")).toHaveText("02 · 01");

    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("landing-page")).toBeVisible();
    await expect(page.getByTestId("continue-journey")).toBeVisible();
    await expect(page.locator("canvas")).toHaveCount(0);

    await page.goForward();
    await expect(page).toHaveURL(/\/play$/);
    await expect(page.getByTestId("game-shell")).toBeVisible();
    await expect(page.getByTestId("grid-position")).toHaveText("02 · 01");
    await expect(page.getByTestId("first-run-coach")).toHaveCount(0);
    await expect(page.getByTestId("pause-expedition")).toHaveAttribute("aria-pressed", "false");
  });
});
