import { describe, expect, it } from "vitest";

import {
  CAMERA_PAN_BOUNDS,
  cameraFrameFor,
  easedPresentationProgress,
  RESPONSIVE_CAMERA_FOV_CEILING,
  responsiveCameraFrameFor,
  ZONE_SCENE_IDENTITY,
} from "../rendering/world-scene";

describe("world scene identity", () => {
  it("uses deterministic, distinct density for each authored zone", () => {
    expect(ZONE_SCENE_IDENTITY.camp.foliageCount).toBeLessThan(
      ZONE_SCENE_IDENTITY.ruins.foliageCount,
    );
    expect(ZONE_SCENE_IDENTITY.ruins.stoneCount).toBeGreaterThan(
      ZONE_SCENE_IDENTITY.core.stoneCount,
    );
    expect(ZONE_SCENE_IDENTITY.camp.tileColors).not.toEqual(ZONE_SCENE_IDENTITY.core.tileColors);
  });
});

describe("authored camera framing", () => {
  it("keeps player-led framing inside the authored pan bounds", () => {
    const frame = cameraFrameFor({ zone: "camp", player: { x: 9, y: 6 } });

    expect(frame.target.x).toBeCloseTo(-7.2 + CAMERA_PAN_BOUNDS.x);
    expect(frame.target.z).toBeCloseTo(1.2 + CAMERA_PAN_BOUNDS.z);
    expect(frame.position.y).toBe(11);
  });

  it("keeps the player primary while a selected landmark supplies a smaller pull", () => {
    const player = { x: 4, y: 3 };
    const playerFrame = cameraFrameFor({ zone: "ruins", player });
    const selectedFrame = cameraFrameFor({
      zone: "ruins",
      player,
      selectedLandmark: { x: 8, y: 6 },
    });

    expect(selectedFrame.target.x).toBeGreaterThan(playerFrame.target.x);
    expect(selectedFrame.target.x - playerFrame.target.x).toBeLessThan(0.25 * (8 - 4) * 1.15);
  });

  it("uses one eased progress value for travel marker and camera", () => {
    const progress = easedPresentationProgress(180, 360);
    const markerStart = 0;
    const markerDestination = 10;
    const cameraStart = 4;
    const cameraDestination = 14;

    const marker = markerStart + (markerDestination - markerStart) * progress;
    const camera = cameraStart + (cameraDestination - cameraStart) * progress;
    expect(progress).toBeCloseTo(0.75);
    expect((marker - markerStart) / (markerDestination - markerStart)).toBeCloseTo(
      (camera - cameraStart) / (cameraDestination - cameraStart),
    );
  });

  it("reaches the exact camera endpoint when motion settles immediately", () => {
    expect(easedPresentationProgress(0, 0)).toBe(1);
    expect(easedPresentationProgress(0, 600, true)).toBe(1);
    expect(easedPresentationProgress(600, 600)).toBe(1);
  });

  it("keeps the desktop camera unchanged at its authored aspect", () => {
    const frame = cameraFrameFor({ zone: "camp", player: { x: 1, y: 1 } });
    const responsive = responsiveCameraFrameFor(frame, 16 / 9);

    expect(responsive.fov).toBe(35);
    expect(responsive.distanceScale).toBe(1);
    expect(responsive.position).toEqual(frame.position);
  });

  it("opens the projection before reaching the narrow-screen ceiling", () => {
    const frame = cameraFrameFor({ zone: "ruins", player: { x: 4, y: 3 } });
    const responsive = responsiveCameraFrameFor(frame, 4 / 3);

    expect(responsive.fov).toBeGreaterThan(35);
    expect(responsive.fov).toBeLessThan(RESPONSIVE_CAMERA_FOV_CEILING);
    expect(responsive.distanceScale).toBeCloseTo(1);
  });

  it("caps the portrait-phone lens and retreats the camera for remaining width", () => {
    const frame = cameraFrameFor({ zone: "core", player: { x: 8, y: 5 } });
    const responsive = responsiveCameraFrameFor(frame, 320 / 568);

    expect(responsive.fov).toBe(RESPONSIVE_CAMERA_FOV_CEILING);
    expect(responsive.distanceScale).toBeGreaterThan(1);
    expect(responsive.target).toEqual(frame.target);
  });
});
