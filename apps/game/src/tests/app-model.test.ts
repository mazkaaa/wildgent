import { describe, expect, it } from "vitest";

import {
  type Flags,
  getCurrentObjective,
  getObjectiveState,
  normalizeSnapshot,
  PARTY_SKILLS,
  type Phase,
  partySkillStateFor,
  resolveLandmarkAction,
  ZONE_CONTENT,
  type ZoneId,
} from "../app-model";

describe("WildGent static content projection", () => {
  it("keeps presentation-only party skills locked at the Resonance boundary", () => {
    const journey = { ...normalizeSnapshot({ phase: "journey" }), phase: "journey" as const };
    expect(PARTY_SKILLS.map(({ id }) => partySkillStateFor(id, journey))).toEqual([
      "ready",
      "ready",
      "locked",
    ]);
    const resonance = {
      ...journey,
      flags: { ...journey.flags, resonanceCalibrated: true, rubbleCleared: true },
    };
    expect(partySkillStateFor("interface", resonance)).toBe("ready");
    expect(partySkillStateFor("ignite", resonance)).toBe("active");
    expect(partySkillStateFor("break", resonance)).toBe("active");
  });

  it("keeps the expedition to three fixed-camera zones", () => {
    expect(Object.keys(ZONE_CONTENT)).toEqual(["camp", "ruins", "core"]);
    expect(ZONE_CONTENT.camp.landmarks.map((landmark) => landmark.id)).toEqual([
      "camp-beacon",
      "relay-station",
    ]);
  });

  it("accepts a nested engine state without becoming an authoritative store", () => {
    const snapshot = normalizeSnapshot({
      state: {
        phase: "battle",
        zone: "ruins",
        flags: { sigil: true, vines: true },
        battle: { enemyHp: 2, enemyMaxHp: 3, playerHp: 3, playerMaxHp: 3 },
      },
    });
    expect(snapshot.phase).toBe("battle");
    expect(snapshot.zone).toBe("ruins");
    expect(snapshot.flags.sigilRead).toBe(true);
    expect(getCurrentObjective(snapshot)).toContain("guardian");
  });

  it("keeps beacon presentation aligned with the authoritative beacon flag", () => {
    expect(
      normalizeSnapshot({ location: "relay", relay: { restored: true }, beaconLit: false }).flags
        .beaconLit,
    ).toBe(false);
    expect(normalizeSnapshot({ beaconLit: true }).flags.beaconLit).toBe(true);
    expect(normalizeSnapshot({ flags: { beacon: true } }).flags.beaconLit).toBe(true);
  });

  it("accepts only integer zero-based positions inside the field", () => {
    expect(normalizeSnapshot({ position: { x: 0, y: 0 } }).position).toEqual({ x: 0, y: 0 });
    expect(normalizeSnapshot({ position: { x: 9, y: 6 } }).position).toEqual({ x: 9, y: 6 });
    for (const position of [
      { x: -1, y: 1 },
      { x: 10, y: 1 },
      { x: 1.5, y: 1 },
      { x: 1, y: 7 },
      { x: 1 },
      null,
    ]) {
      expect(normalizeSnapshot({ position }).position).toEqual({ x: 1, y: 1 });
    }
  });

  it("resolves landmark actions by exact position, availability, and completion", () => {
    const journey = { ...normalizeSnapshot({ phase: "journey" }), phase: "journey" as const };
    const [beacon, relay] = ZONE_CONTENT.camp.landmarks;
    const [, , sigil, vines] = ZONE_CONTENT.ruins.landmarks;
    if (!beacon || !relay || !sigil || !vines) throw new Error("Expected fixture landmarks");
    expect(resolveLandmarkAction(beacon, { ...journey, position: { x: 0, y: 0 } })).toMatchObject({
      state: "approach",
      position: { x: 1, y: 1 },
    });
    expect(resolveLandmarkAction(beacon, { ...journey, position: beacon.position })).toMatchObject({
      state: "ready",
      label: "Light beacon",
    });
    expect(
      resolveLandmarkAction(relay, {
        ...journey,
        position: { x: 5, y: 2 },
      }),
    ).toMatchObject({ state: "locked", hint: "Light the beacon first." });
    expect(
      resolveLandmarkAction(vines, {
        ...journey,
        zone: "ruins",
        position: { x: 8, y: 2 },
        flags: { ...journey.flags, powerRestored: true, sigilRead: true, vinesDiscovered: true },
      }),
    ).toMatchObject({ state: "complete" });
    expect(
      resolveLandmarkAction(sigil, {
        ...journey,
        zone: "ruins",
        position: { x: 7, y: 6 },
        flags: { ...journey.flags, powerRestored: true, sigilRead: true, vinesDiscovered: true },
      }),
    ).toMatchObject({ state: "ready", label: "Open ruin door with Interface" });
  });

  it("derives one progression objective state for each journey phase", () => {
    const base = { ...normalizeSnapshot({ phase: "journey" }), phase: "journey" as const };
    const cases: Array<[{ phase?: Phase; zone?: ZoneId; flags?: Partial<Flags> }, string, string]> =
      [
        [{}, "beacon", "Light the camp beacon."],
        [
          { flags: { ...base.flags, beaconLit: true } },
          "resonance",
          "Calibrate Resonance at the relay.",
        ],
        [
          { flags: { ...base.flags, beaconLit: true, resonanceCalibrated: true } },
          "travel",
          "Travel to the ruins.",
        ],
        [
          { zone: "ruins", flags: { ...base.flags, beaconLit: true, resonanceCalibrated: true } },
          "rubble",
          "Clear the collapsed rubble.",
        ],
        [
          {
            zone: "ruins",
            flags: {
              ...base.flags,
              beaconLit: true,
              resonanceCalibrated: true,
              rubbleCleared: true,
            },
          },
          "power",
          "Restore the power cradle.",
        ],
        [
          {
            zone: "ruins",
            flags: {
              ...base.flags,
              beaconLit: true,
              resonanceCalibrated: true,
              rubbleCleared: true,
              powerRestored: true,
            },
          },
          "sigil",
          "Read the moss sigil.",
        ],
        [
          {
            zone: "ruins",
            flags: {
              ...base.flags,
              beaconLit: true,
              resonanceCalibrated: true,
              rubbleCleared: true,
              powerRestored: true,
              sigilRead: true,
            },
          },
          "human-discovery",
          "Find the cyan thread by hand.",
        ],
        [
          {
            zone: "ruins",
            flags: {
              ...base.flags,
              beaconLit: true,
              resonanceCalibrated: true,
              rubbleCleared: true,
              powerRestored: true,
              sigilRead: true,
              vinesDiscovered: true,
            },
          },
          "return-sigil",
          "Return to the moss sigil and open the ruin door.",
        ],
        [
          {
            phase: "battle",
            zone: "ruins",
            flags: {
              ...base.flags,
              beaconLit: true,
              resonanceCalibrated: true,
              rubbleCleared: true,
              powerRestored: true,
              sigilRead: true,
              vinesDiscovered: true,
            },
          },
          "battle",
          "Break the guardian's pattern.",
        ],
        [
          {
            zone: "core",
            flags: {
              ...base.flags,
              beaconLit: true,
              resonanceCalibrated: true,
              rubbleCleared: true,
              powerRestored: true,
              sigilRead: true,
              vinesDiscovered: true,
              guardianDefeated: true,
            },
          },
          "core",
          "Enter the ancient core.",
        ],
      ];
    for (const [overrides, id, title] of cases) {
      const snapshot = { ...base, ...overrides, flags: { ...base.flags, ...overrides.flags } };
      const state = getObjectiveState(snapshot);
      expect(state).toMatchObject({ id, title });
      expect(getCurrentObjective(snapshot)).toBe(title);
    }
    expect(
      getObjectiveState({
        ...base,
        phase: "complete",
        flags: { ...base.flags, coreEntered: true },
      }),
    ).toMatchObject({ id: "complete" });
  });
});
