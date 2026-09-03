import * as THREE from "three";

import {
  CHARACTERS,
  type GameSnapshot,
  type GridPosition,
  type LandmarkId,
  ZONE_CONTENT,
  type ZoneId,
} from "../app-model";

type LandmarkClick = (landmark: LandmarkId) => void;
type HumanSignalClick = () => void;
type CellClick = (position: { x: number; y: number }, zone: ZoneId) => void;

type ZoneOffset = { x: number; z: number };

const ZONE_OFFSETS: Record<ZoneId, ZoneOffset> = {
  camp: { x: -7.2, z: 1.2 },
  ruins: { x: 0, z: -1.4 },
  core: { x: 7.2, z: 1.2 },
};

const COLORS = {
  canopy: 0x153f35,
  canopyDeep: 0x0f302b,
  canopyMid: 0x235540,
  canopyMist: 0x4e7968,
  moss: 0x41734c,
  mossLight: 0x6d9a5b,
  mossBright: 0x9abb61,
  fern: 0x8dbb72,
  fernDeep: 0x2d5e42,
  soil: 0x75624a,
  soilDark: 0x3d4437,
  clay: 0xb79a6f,
  clayLight: 0xd0b784,
  stone: 0x716e5d,
  stoneLight: 0xa99f82,
  stoneDark: 0x454d49,
  water: 0x64b4a5,
  cyan: 0x77f0e6,
  cyanDeep: 0x1caaa9,
  ember: 0xe36c4f,
  gold: 0xf0c276,
  white: 0xf4f0d8,
};

const gridSize = { width: 10, height: 7 };
const tileSize = 1.15;

export type ZoneSceneIdentity = {
  tileColors: readonly number[];
  ground: number;
  foliage: number;
  stoneCount: number;
  foliageCount: number;
};

export const ZONE_SCENE_IDENTITY: Record<ZoneId, ZoneSceneIdentity> = {
  camp: {
    tileColors: [COLORS.mossLight, COLORS.moss, COLORS.mossBright],
    ground: COLORS.soil,
    foliage: COLORS.mossLight,
    stoneCount: 6,
    foliageCount: 7,
  },
  ruins: {
    tileColors: [COLORS.fernDeep, COLORS.moss, COLORS.stoneDark],
    ground: COLORS.soilDark,
    foliage: COLORS.fern,
    stoneCount: 11,
    foliageCount: 10,
  },
  core: {
    tileColors: [COLORS.canopyDeep, COLORS.fernDeep, COLORS.cyanDeep],
    ground: COLORS.stoneDark,
    foliage: COLORS.fernDeep,
    stoneCount: 5,
    foliageCount: 4,
  },
};

export type PresentationRequest = {
  key: string;
  promise: Promise<void>;
  resolve: () => void;
};

export type PresentationCue =
  | { type: "landmark"; landmark: LandmarkId; actor?: "human" | "echo" | "system" }
  | {
      type: "capability";
      capability: "ignite" | "break" | "interface";
      landmark: LandmarkId;
      actor?: "human" | "echo" | "system";
    }
  | { type: "resonance"; landmark: LandmarkId; actor?: "human" | "echo" | "system" }
  | { type: "battle-impact"; actor?: "human" | "echo" | "system" }
  | { type: "camera-transition"; zone: ZoneId };

/**
 * Derive presentation-only cues from two authoritative snapshots. The engine remains the source
 * of truth; this helper only notices completed transitions so the scene can make them legible.
 */
export const presentationCuesForTransition = (
  previous: GameSnapshot | null,
  current: GameSnapshot,
): PresentationCue[] => {
  if (!previous) return [];
  const cues: PresentationCue[] = [];
  if (previous.zone !== current.zone) cues.push({ type: "camera-transition", zone: current.zone });

  const completed: Array<[keyof GameSnapshot["flags"], LandmarkId, PresentationCue["type"]]> = [
    ["beaconLit", "camp-beacon", "landmark"],
    ["resonanceCalibrated", "relay-station", "resonance"],
    ["rubbleCleared", "ruins-rubble", "capability"],
    ["powerRestored", "ruins-power", "capability"],
    ["sigilRead", "ruins-sigil", "capability"],
    ["vinesDiscovered", "ruins-vines", "landmark"],
    ["coreEntered", "ancient-core", "landmark"],
  ];
  for (const [flag, landmark, type] of completed) {
    if (current.flags[flag] && !previous.flags[flag]) {
      if (type === "capability") {
        const event = [...current.activity].reverse().find((item) => item.accepted !== false);
        const command = event?.commandType ?? "";
        const capability = command.includes("ignite")
          ? "ignite"
          : command.includes("interface")
            ? "interface"
            : "break";
        cues.push({ type, capability, landmark, actor: event?.actor });
      } else if (type === "resonance") {
        const event = [...current.activity].reverse().find((item) => item.accepted !== false);
        cues.push({ type: "resonance", landmark, actor: event?.actor });
      } else {
        const event = [...current.activity].reverse().find((item) => item.accepted !== false);
        cues.push({ type: "landmark", landmark, actor: event?.actor });
      }
    }
  }

  if (current.battle && previous.battle && current.battle.enemyHp < previous.battle.enemyHp) {
    const event = [...current.activity].reverse().find((item) => item.kind === "battle");
    cues.push({ type: "battle-impact", actor: event?.actor });
  }
  return cues;
};

/** Owns one in-flight presentation request and settles superseded requests exactly once. */
export class PresentationGate {
  private pending: PresentationRequest | null = null;

  get key() {
    return this.pending?.key;
  }

  get isPending() {
    return this.pending !== null;
  }

  /** Change the active presentation destination without releasing its waiting caller. */
  retarget(key: string) {
    if (!this.pending) return this.begin(key);
    this.pending.key = key;
    return this.pending.promise;
  }

  begin(key: string) {
    if (this.pending?.key === key) return this.pending.promise;
    this.settle();
    let settled = false;
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
      resolve = () => {
        if (settled) return;
        settled = true;
        done();
      };
    });
    this.pending = { key, promise, resolve };
    return promise;
  }

  settle() {
    const current = this.pending;
    this.pending = null;
    current?.resolve();
  }
}

/** Convert the engine's zero-based grid position into the low-poly world plane. */
export const worldPositionFor = (position: GridPosition, zone: ZoneId) =>
  localPosition(position.x, position.y, zone);

export type CameraPoint = { x: number; y: number; z: number };

export type CameraFrame = {
  position: CameraPoint;
  target: CameraPoint;
};

export type CameraFramingInput = {
  zone: ZoneId;
  player: GridPosition;
  selectedLandmark?: GridPosition | null;
};

export type ResponsiveCameraFrame = CameraFrame & {
  fov: number;
  distanceScale: number;
};

/** Presentation-only horizontal pan limits. The camera remains an authored fixed-angle lens. */
export const CAMERA_PAN_BOUNDS = { x: 3.2, z: 2.2 } as const;

const CAMERA_PLAYER_WEIGHT = 0.78;
const CAMERA_LANDMARK_WEIGHT = 1 - CAMERA_PLAYER_WEIGHT;
const CAMERA_Z_OFFSET = 11;
const AUTHORED_CAMERA_FOV = 35;
const AUTHORED_CAMERA_ASPECT = 16 / 9;
export const RESPONSIVE_CAMERA_FOV_CEILING = 58;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const degrees = (radiansValue: number) => (radiansValue * 180) / Math.PI;
const radians = (degreesValue: number) => (degreesValue * Math.PI) / 180;

/**
 * Preserve the authored 16:9 horizontal view when a narrow viewport would otherwise crop the
 * expedition. The lens opens first; once it reaches its comfortable ceiling, the camera retreats
 * along its authored target vector. This is presentation-only and never changes game state.
 */
export const responsiveCameraFrameFor = (
  frame: CameraFrame,
  aspect: number,
): ResponsiveCameraFrame => {
  const safeAspect = Math.max(aspect, 0.01);
  if (safeAspect >= AUTHORED_CAMERA_ASPECT) {
    return { ...frame, fov: AUTHORED_CAMERA_FOV, distanceScale: 1 };
  }
  const authoredHorizontalFov =
    2 * Math.atan(Math.tan(radians(AUTHORED_CAMERA_FOV / 2)) * AUTHORED_CAMERA_ASPECT);
  const matchingVerticalFov = degrees(
    2 * Math.atan(Math.tan(authoredHorizontalFov / 2) / safeAspect),
  );
  const fov = Math.min(matchingVerticalFov, RESPONSIVE_CAMERA_FOV_CEILING);
  const distanceScale =
    Math.tan(authoredHorizontalFov / 2) / (Math.tan(radians(fov / 2)) * safeAspect);

  return {
    fov,
    distanceScale,
    position: {
      x: frame.target.x + (frame.position.x - frame.target.x) * distanceScale,
      y: frame.target.y + (frame.position.y - frame.target.y) * distanceScale,
      z: frame.target.z + (frame.position.z - frame.target.z) * distanceScale,
    },
    target: { ...frame.target },
  };
};

/** Return the authored, zone-relative camera frame before player-led presentation pan. */
const authoredCameraFrameForZone = (zone: ZoneId): CameraFrame => {
  const offset = ZONE_OFFSETS[zone];
  const authored = ZONE_CONTENT[zone].camera;
  return {
    position: {
      x: offset.x + authored.x,
      y: authored.y,
      // Keep the existing authored elevation/composition while honoring all camera coordinates.
      z: offset.z + authored.z - CAMERA_Z_OFFSET,
    },
    target: { x: offset.x, y: 0.35, z: offset.z },
  };
};

/**
 * Derive a bounded player-led camera frame without touching authoritative state. The player is
 * the primary focus; an optional selected landmark supplies a deliberately smaller pull.
 */
export const cameraFrameFor = ({
  zone,
  player,
  selectedLandmark = null,
}: CameraFramingInput): CameraFrame => {
  const base = authoredCameraFrameForZone(zone);
  const zoneOrigin = ZONE_OFFSETS[zone];
  const playerWorld = worldPositionFor(player, zone);
  const landmarkWorld = selectedLandmark ? worldPositionFor(selectedLandmark, zone) : null;
  const focusX = landmarkWorld
    ? playerWorld.x * CAMERA_PLAYER_WEIGHT + landmarkWorld.x * CAMERA_LANDMARK_WEIGHT
    : playerWorld.x;
  const focusZ = landmarkWorld
    ? playerWorld.z * CAMERA_PLAYER_WEIGHT + landmarkWorld.z * CAMERA_LANDMARK_WEIGHT
    : playerWorld.z;
  const panX = clamp(focusX - zoneOrigin.x, -CAMERA_PAN_BOUNDS.x, CAMERA_PAN_BOUNDS.x);
  const panZ = clamp(focusZ - zoneOrigin.z, -CAMERA_PAN_BOUNDS.z, CAMERA_PAN_BOUNDS.z);

  return {
    position: {
      x: base.position.x + panX,
      y: base.position.y,
      z: base.position.z + panZ,
    },
    target: {
      x: base.target.x + panX,
      y: base.target.y,
      z: base.target.z + panZ,
    },
  };
};

/** Shared easing keeps the marker and camera on the exact same presentation timeline. */
export const easedPresentationProgress = (
  elapsed: number,
  duration: number,
  reducedMotion = false,
) => {
  if (reducedMotion || duration <= 0) return 1;
  const progress = Math.min(1, Math.max(0, elapsed / Math.max(duration, 1)));
  return progress * (2 - progress);
};

const material = (color: number, roughness = 0.88, emissive = 0x000000) =>
  new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness: 0.02,
    flatShading: true,
    emissive,
    emissiveIntensity: emissive ? 1.2 : 0,
  });

const effectMaterial = (color: number, opacity = 0.78) =>
  new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

const softGroundShadow = (radius: number, opacity = 0.28) => {
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 12),
    new THREE.MeshBasicMaterial({
      color: COLORS.soilDark,
      transparent: true,
      opacity,
      depthWrite: false,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.015;
  shadow.scale.set(1.35, 0.68, 1);
  return shadow;
};

const box = (size: [number, number, number], color: number, y = 0) => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material(color));
  mesh.position.y = y;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
};

const lowPolyTree = (height: number, tint: number) => {
  const group = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11, 0.18, height * 0.54, 5),
    material(COLORS.soil),
  );
  trunk.position.y = height * 0.27;
  trunk.castShadow = true;
  group.add(trunk);
  const crown = new THREE.Mesh(
    new THREE.ConeGeometry(height * 0.36, height * 0.74, 6),
    material(tint),
  );
  crown.position.y = height * 0.72;
  crown.castShadow = true;
  group.add(crown);
  return group;
};

const createCindra = () => {
  const group = new THREE.Group();
  group.name = "Cindra";
  group.add(softGroundShadow(0.38, 0.3));
  const cloak = new THREE.Mesh(
    new THREE.ConeGeometry(0.4, 0.72, 6),
    material(CHARACTERS.cindra.color),
  );
  cloak.position.y = 0.42;
  cloak.scale.z = 0.86;
  cloak.castShadow = true;
  group.add(cloak);
  const chest = new THREE.Mesh(
    new THREE.DodecahedronGeometry(0.27, 0),
    material(CHARACTERS.cindra.color),
  );
  chest.position.set(0, 0.71, 0.03);
  chest.scale.set(0.86, 1.1, 0.8);
  chest.castShadow = true;
  group.add(chest);
  const hood = new THREE.Mesh(new THREE.ConeGeometry(0.34, 0.36, 6), material(COLORS.ember));
  hood.position.set(0.02, 0.99, 0);
  hood.rotation.z = Math.PI;
  hood.castShadow = true;
  group.add(hood);
  const hoodRim = new THREE.Mesh(
    new THREE.TorusGeometry(0.25, 0.035, 4, 8),
    material(COLORS.gold, 0.6),
  );
  hoodRim.rotation.x = Math.PI / 2;
  hoodRim.position.set(0, 0.91, 0.02);
  group.add(hoodRim);
  for (const x of [-0.1, 0.1]) {
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 6, 4),
      material(COLORS.gold, 0.5, COLORS.gold),
    );
    eye.position.set(x, 0.98, 0.28);
    group.add(eye);
  }
  const ember = new THREE.Mesh(
    new THREE.TetrahedronGeometry(0.15, 0),
    material(COLORS.ember, 0.45, COLORS.ember),
  );
  ember.position.set(0.02, 0.38, -0.31);
  ember.rotation.x = 0.5;
  group.add(ember);
  return group;
};

const createGrum = () => {
  const group = new THREE.Group();
  group.name = "Grum";
  group.add(softGroundShadow(0.56, 0.34));
  const body = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.48, 1),
    material(CHARACTERS.grum.color),
  );
  body.position.y = 0.51;
  body.scale.set(1.28, 0.92, 1.05);
  body.castShadow = true;
  group.add(body);
  for (const x of [-0.28, 0.28]) {
    const foot = box([0.17, 0.2, 0.3], COLORS.soil, 0.18);
    foot.position.x = x;
    foot.position.z = 0.1;
    group.add(foot);
  }
  for (const side of [-1, 1]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.32, 5), material(COLORS.clayLight));
    horn.position.set(side * 0.3, 0.85, 0.02);
    horn.rotation.z = side * -0.55;
    horn.castShadow = true;
    group.add(horn);
  }
  const moss = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), material(COLORS.mossBright));
  moss.position.set(0.12, 0.78, 0.13);
  moss.scale.set(1.25, 0.55, 0.7);
  group.add(moss);
  const pack = box([0.3, 0.42, 0.2], COLORS.clay, 0.53);
  pack.position.set(-0.37, 0.03, -0.05);
  pack.rotation.z = -0.12;
  group.add(pack);
  const eye = new THREE.Mesh(
    new THREE.SphereGeometry(0.055, 6, 4),
    material(COLORS.gold, 0.5, COLORS.gold),
  );
  eye.position.set(0.14, 0.66, 0.42);
  group.add(eye);
  return group;
};

const createVoltyn = () => {
  const group = new THREE.Group();
  group.name = "Voltyn";
  group.add(softGroundShadow(0.34, 0.2));
  const body = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.3, 1),
    material(CHARACTERS.voltyn.color, 0.42, COLORS.cyan),
  );
  body.position.y = 0.9;
  body.scale.set(0.8, 1.18, 0.9);
  body.castShadow = true;
  group.add(body);
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(
      new THREE.ConeGeometry(0.19, 0.5, 4),
      material(side < 0 ? COLORS.cyanDeep : COLORS.cyan, 0.35, COLORS.cyan),
    );
    wing.position.set(side * 0.3, 0.88, 0);
    wing.rotation.set(0, side * 0.16, side * Math.PI * 0.5);
    group.add(wing);
  }
  for (const side of [-1, 1]) {
    const antenna = new THREE.Mesh(
      new THREE.CylinderGeometry(0.018, 0.028, 0.34, 5),
      material(COLORS.gold, 0.55),
    );
    antenna.position.set(side * 0.12, 1.25, 0);
    antenna.rotation.z = side * 0.28;
    group.add(antenna);
    const tip = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.055, 0),
      material(COLORS.gold, 0.4, COLORS.gold),
    );
    tip.position.set(side * 0.17, 1.42, 0);
    group.add(tip);
  }
  const tail = new THREE.Mesh(
    new THREE.TetrahedronGeometry(0.14, 0),
    material(COLORS.cyan, 0.3, COLORS.cyan),
  );
  tail.position.set(0, 0.58, -0.24);
  tail.rotation.x = -0.6;
  group.add(tail);
  return group;
};

const createGuardian = () => {
  const group = new THREE.Group();
  group.name = "Rootbound Guardian";
  group.add(softGroundShadow(0.9, 0.42));
  const torso = new THREE.Mesh(
    new THREE.CylinderGeometry(0.56, 0.78, 1.7, 6),
    material(CHARACTERS.guardian.color),
  );
  torso.position.y = 1.18;
  torso.scale.z = 0.86;
  torso.castShadow = true;
  group.add(torso);
  const shoulder = new THREE.Mesh(
    new THREE.BoxGeometry(1.65, 0.3, 0.52),
    material(COLORS.stoneDark),
  );
  shoulder.position.y = 1.79;
  shoulder.rotation.z = -0.03;
  shoulder.castShadow = true;
  group.add(shoulder);
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.52, 1), material(COLORS.stoneLight));
  head.position.set(0, 2.28, 0.02);
  head.scale.set(0.9, 1.08, 0.86);
  head.castShadow = true;
  group.add(head);
  for (const side of [-1, 1]) {
    const arm = box([0.28, 1.28, 0.32], COLORS.stone, 1.12);
    arm.position.x = side * 0.7;
    arm.rotation.z = side * -0.16;
    group.add(arm);
    const root = new THREE.Mesh(new THREE.ConeGeometry(0.18, 1.3, 5), material(COLORS.soil));
    root.position.set(side * 0.5, 0.18, 0.08);
    root.rotation.z = side * 0.3;
    group.add(root);
  }
  for (const side of [-1, 1]) {
    const crown = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.72, 5), material(COLORS.soil));
    crown.position.set(side * 0.29, 2.77, -0.02);
    crown.rotation.z = side * -0.34;
    crown.castShadow = true;
    group.add(crown);
  }
  const chest = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.2, 0),
    material(COLORS.cyan, 0.3, COLORS.cyan),
  );
  chest.position.set(0, 1.36, 0.48);
  chest.scale.y = 1.35;
  group.add(chest);
  const eye = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 8, 6),
    material(COLORS.cyan, 0.35, COLORS.cyan),
  );
  eye.position.set(0, 2.25, 0.42);
  group.add(eye);
  return group;
};

const makeCharacter = (id: "cindra" | "grum" | "voltyn" | "guardian") => {
  if (id === "cindra") return createCindra();
  if (id === "grum") return createGrum();
  if (id === "voltyn") return createVoltyn();
  return createGuardian();
};

const localPosition = (x: number, y: number, zone: ZoneId) => ({
  x: ZONE_OFFSETS[zone].x + (x - (gridSize.width - 1) / 2) * tileSize,
  z: ZONE_OFFSETS[zone].z + (y - (gridSize.height - 1) / 2) * tileSize,
});

type LandmarkContent = (typeof ZONE_CONTENT)[ZoneId]["landmarks"][number];
const LANDMARK_CONTENT = new Map<LandmarkId, LandmarkContent>(
  (Object.keys(ZONE_CONTENT) as ZoneId[])
    .flatMap((zone) => ZONE_CONTENT[zone].landmarks)
    .map((landmark) => [landmark.id, landmark]),
);

type LandmarkSignalKind = "objective" | "echo" | "human";

type LandmarkPresentation = {
  ring: THREE.Mesh;
  selectionRing: THREE.Mesh;
  roleGlyph: THREE.Mesh;
  lockGlyph: THREE.Mesh;
  completeGlyph: THREE.Mesh;
  signalKind: LandmarkSignalKind;
};

const signalKindForLandmark = (landmark: LandmarkId): LandmarkSignalKind => {
  if (landmark === "ruins-vines") return "human";
  if (
    landmark === "relay-station" ||
    landmark === "ruins-power" ||
    landmark === "ruins-sigil" ||
    landmark === "ancient-core"
  )
    return "echo";
  return "objective";
};

const signalColorForKind = (kind: LandmarkSignalKind) => {
  if (kind === "human") return COLORS.ember;
  if (kind === "echo") return COLORS.cyan;
  return COLORS.gold;
};

const createFoliageTuft = (scale: number, tint: number) => {
  const tuft = new THREE.Group();
  const shadow = softGroundShadow(0.18 * scale, 0.18);
  shadow.scale.set(1.6, 0.5, 1);
  tuft.add(shadow);
  for (const side of [-1, 1]) {
    const blade = new THREE.Mesh(
      new THREE.ConeGeometry(0.08 * scale, 0.52 * scale, 4),
      material(side < 0 ? tint : COLORS.fern, 0.95),
    );
    blade.position.set(side * 0.1 * scale, 0.25 * scale, 0);
    blade.rotation.z = side * 0.26;
    blade.castShadow = true;
    tuft.add(blade);
  }
  return tuft;
};

const createExpeditionMarker = () => {
  const group = new THREE.Group();
  group.name = "Expedition Marker";
  const base = new THREE.Mesh(
    new THREE.CylinderGeometry(0.24, 0.32, 0.12, 6),
    material(COLORS.ember, 0.58, COLORS.ember),
  );
  base.position.y = 0.13;
  base.castShadow = true;
  group.add(base);
  const beacon = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.19, 0),
    material(COLORS.ember, 0.48, COLORS.ember),
  );
  beacon.position.y = 0.48;
  beacon.castShadow = true;
  group.add(beacon);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.37, 0.035, 5, 12),
    material(COLORS.ember, 0.38, COLORS.ember),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.08;
  group.add(ring);
  return group;
};

export class WorldScene {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  private readonly root = new THREE.Group();
  private readonly tileMeshes: THREE.Mesh[] = [];
  private readonly landmarkMeshes = new Map<LandmarkId, THREE.Object3D>();
  private readonly landmarkPresentations = new Map<LandmarkId, LandmarkPresentation>();
  private readonly humanSignalMeshes: THREE.Object3D[] = [];
  private readonly animated: Array<{
    object: THREE.Object3D;
    phase: number;
    amplitude: number;
    speed: number;
  }> = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly clock = new THREE.Clock();
  private activeZone: ZoneId = "camp";
  private cameraTarget = new THREE.Vector3();
  private cameraDestination = new THREE.Vector3();
  private authoredCameraFrame: CameraFrame = authoredCameraFrameForZone("camp");
  private viewportAspect = 1;
  private lookDestination = new THREE.Vector3();
  private readonly onLandmarkClick?: LandmarkClick;
  private readonly onHumanSignalClick?: HumanSignalClick;
  private readonly onCellClick?: CellClick;
  private readonly expeditionMarker = createExpeditionMarker();
  private readonly characterMeshes = new Map<string, THREE.Object3D>();
  private ruinsDoor: THREE.Object3D | null = null;
  private coreVisual: THREE.Object3D | null = null;
  private readonly transientEffects = new Set<{
    group: THREE.Group;
    startedAt: number;
    duration: number;
    resolve: () => void;
  }>();
  private readonly reducedCueTimeouts = new Map<THREE.Group, number>();
  private hasSnapshot = false;
  private previousSnapshot: GameSnapshot | null = null;
  private markerDestination = new THREE.Vector3();
  private markerStart = new THREE.Vector3();
  private cameraStart = new THREE.Vector3();
  private lookStart = new THREE.Vector3();
  private markerStartedAt = 0;
  private markerDuration = 0;
  private readonly presentationGate = new PresentationGate();
  private markerPulseUntil = 0;
  private lastMovementEventId: string | null = null;
  private selectedLandmarkOverride: LandmarkId | null | undefined;
  private frame = 0;

  constructor(
    canvas: HTMLCanvasElement,
    options: {
      onLandmarkClick?: LandmarkClick;
      onHumanSignalClick?: HumanSignalClick;
      onCellClick?: CellClick;
    } = {},
  ) {
    this.onLandmarkClick = options.onLandmarkClick;
    this.onHumanSignalClick = options.onHumanSignalClick;
    this.onCellClick = options.onCellClick;
    this.camera = new THREE.PerspectiveCamera(AUTHORED_CAMERA_FOV, 1, 0.1, 100);
    this.camera.position.set(0, 10, 14);
    this.cameraTarget.set(0, 0, 0);
    this.camera.lookAt(this.cameraTarget);
    this.cameraDestination.copy(this.camera.position);
    this.lookDestination.copy(this.cameraTarget);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.scene.background = new THREE.Color(COLORS.canopy);
    this.scene.fog = new THREE.Fog(COLORS.canopy, 15, 32);
    this.scene.add(this.root);
    this.root.add(this.expeditionMarker);
    this.addLights();
    this.buildWorld();
    this.setCameraForZone("camp");
    canvas.addEventListener("pointerdown", this.handlePointerDown);
    this.resize(canvas.clientWidth || 800, canvas.clientHeight || 560);
    this.animate();
  }

  setSelectedLandmark(landmark: LandmarkId | null) {
    this.selectedLandmarkOverride = landmark;
    if (this.previousSnapshot) {
      this.updateLandmarkPresentation(this.previousSnapshot, landmark);
    }
  }

  setSnapshot(snapshot: GameSnapshot, selectedLandmark?: LandmarkId | null): Promise<void> {
    const presentationSelection =
      selectedLandmark === undefined
        ? this.selectedLandmarkOverride === undefined
          ? snapshot.selectedLandmark
          : this.selectedLandmarkOverride
        : selectedLandmark;
    this.selectedLandmarkOverride = presentationSelection;
    const target = worldPositionFor(snapshot.position, snapshot.zone);
    const key = `${snapshot.zone}:${snapshot.position.x}:${snapshot.position.y}:${presentationSelection ?? ""}`;
    if (snapshot.zone !== this.activeZone) {
      this.activeZone = snapshot.zone;
    }
    const selectedContent = presentationSelection
      ? LANDMARK_CONTENT.get(presentationSelection)
      : undefined;
    const cameraFrame = cameraFrameFor({
      zone: snapshot.zone,
      player: snapshot.position,
      selectedLandmark:
        selectedContent?.zone === snapshot.zone ? selectedContent.position : undefined,
    });
    this.setResponsiveCameraDestination(cameraFrame);
    this.updateLandmarkPresentation(snapshot, presentationSelection);
    this.setMarkerActor(snapshot);
    const cuePromises = presentationCuesForTransition(this.previousSnapshot, snapshot).map((cue) =>
      this.presentCue(cue),
    );
    this.previousSnapshot = snapshot;

    if (!this.hasSnapshot) {
      this.hasSnapshot = true;
      this.expeditionMarker.position.set(target.x, 0.03, target.z);
      this.markerDestination.set(target.x, 0.03, target.z);
      this.camera.position.copy(this.cameraDestination);
      this.cameraTarget.copy(this.lookDestination);
      return Promise.all(cuePromises).then(() => undefined);
    }
    if (this.presentationGate.key === key) return this.presentationGate.begin(key);
    this.markerStart.copy(this.expeditionMarker.position);
    this.markerDestination.set(target.x, 0.03, target.z);
    this.cameraStart.copy(this.camera.position);
    this.lookStart.copy(this.cameraTarget);
    const markerDistance = this.markerStart.distanceTo(this.markerDestination);
    const cameraDistance = this.cameraStart.distanceTo(this.cameraDestination);
    const lookDistance = this.lookStart.distanceTo(this.lookDestination);
    const presentationDistance = Math.max(markerDistance, cameraDistance, lookDistance);
    if (presentationDistance < 0.0001) {
      this.presentationGate.settle();
      return Promise.all(cuePromises).then(() => undefined);
    }

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reduced) {
      this.expeditionMarker.position.copy(this.markerDestination);
      this.camera.position.copy(this.cameraDestination);
      this.cameraTarget.copy(this.lookDestination);
      this.presentationGate.settle();
      return Promise.all(cuePromises).then(() => undefined);
    }
    this.markerDuration = Math.min(600, Math.max(140, presentationDistance * 180));
    this.markerStartedAt = performance.now();
    const presentation = this.presentationGate.isPending
      ? this.presentationGate.retarget(key)
      : this.presentationGate.begin(key);
    return Promise.all([presentation, ...cuePromises]).then(() => undefined);
  }

  /** Play an authored in-world cue. Reduced-motion users receive the settled presentation. */
  presentCue(cue: PresentationCue): Promise<void> {
    if (cue.type === "camera-transition") return Promise.resolve();
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const target = this.worldPositionForCue(cue);
    const color =
      cue.actor === "human" ? COLORS.ember : cue.actor === "system" ? COLORS.gold : COLORS.cyan;
    const group = this.createCueEffect(cue, color);
    group.position.set(target.x, 0.05, target.z);
    this.root.add(group);
    if (reduced) {
      group.scale.setScalar(1);
      const timeout = window.setTimeout(() => {
        this.reducedCueTimeouts.delete(group);
        this.root.remove(group);
        group.traverse((object) => {
          const mesh = object as THREE.Mesh;
          mesh.geometry?.dispose?.();
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((entry) => {
              entry.dispose();
            });
          } else mesh.material?.dispose?.();
        });
      }, 720);
      this.reducedCueTimeouts.set(group, timeout);
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.transientEffects.add({ group, startedAt: performance.now(), duration: 720, resolve });
    });
  }

  private worldPositionForCue(cue: Exclude<PresentationCue, { type: "camera-transition" }>) {
    if (cue.type === "battle-impact") return worldPositionFor({ x: 7, y: 4 }, this.activeZone);
    for (const zone of Object.keys(ZONE_CONTENT) as ZoneId[]) {
      const landmark = ZONE_CONTENT[zone].landmarks.find((entry) => entry.id === cue.landmark);
      if (landmark) return worldPositionFor(landmark.position, zone);
    }
    return worldPositionFor({ x: 1, y: 1 }, this.activeZone);
  }

  private createCueEffect(
    cue: Exclude<PresentationCue, { type: "camera-transition" }>,
    color: number,
  ) {
    const group = new THREE.Group();
    group.name = `presentation-${cue.type}`;
    const radius = cue.type === "resonance" ? 1.6 : cue.type === "battle-impact" ? 0.95 : 0.72;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius, cue.type === "battle-impact" ? 0.06 : 0.035, 5, 18),
      effectMaterial(color, cue.type === "resonance" ? 0.9 : 0.75),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.08;
    group.add(ring);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(
        0.035,
        cue.type === "resonance" ? 0.15 : 0.08,
        cue.type === "resonance" ? 3.4 : 1.25,
        6,
      ),
      effectMaterial(color, cue.type === "resonance" ? 0.42 : 0.55),
    );
    beam.position.y = cue.type === "resonance" ? 1.7 : 0.7;
    group.add(beam);
    for (let index = 0; index < (cue.type === "resonance" ? 10 : 6); index += 1) {
      const shard = new THREE.Mesh(
        new THREE.TetrahedronGeometry(cue.type === "battle-impact" ? 0.1 : 0.075, 0),
        effectMaterial(color, 0.85),
      );
      const angle = (index / (cue.type === "resonance" ? 10 : 6)) * Math.PI * 2;
      shard.position.set(
        Math.cos(angle) * radius,
        0.15 + (index % 3) * 0.24,
        Math.sin(angle) * radius,
      );
      group.add(shard);
    }
    return group;
  }

  resize(width: number, height: number) {
    const safeHeight = Math.max(height, 1);
    this.viewportAspect = Math.max(width, 1) / safeHeight;
    this.setResponsiveCameraDestination(this.authoredCameraFrame);
    if (!this.presentationGate.isPending) {
      this.camera.position.copy(this.cameraDestination);
      this.cameraTarget.copy(this.lookDestination);
    }
    this.camera.aspect = this.viewportAspect;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(Math.max(width, 1), safeHeight, false);
  }

  dispose(canvas: HTMLCanvasElement) {
    canvas.removeEventListener("pointerdown", this.handlePointerDown);
    cancelAnimationFrame(this.frame);
    this.presentationGate.settle();
    for (const effect of this.transientEffects) {
      effect.resolve();
      effect.group.traverse((object) => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose?.();
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((entry) => {
            entry.dispose();
          });
        } else mesh.material?.dispose?.();
      });
    }
    this.transientEffects.clear();
    for (const timeout of this.reducedCueTimeouts.values()) window.clearTimeout(timeout);
    this.reducedCueTimeouts.clear();
    this.renderer.dispose();
    this.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      mesh.geometry?.dispose?.();
      if (Array.isArray(mesh.material)) {
        mesh.material.forEach((entry) => {
          entry.dispose();
        });
      } else mesh.material?.dispose?.();
    });
  }

  private addLights() {
    const sun = new THREE.DirectionalLight(0xfff4d6, 3.1);
    sun.position.set(-8, 16, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 42;
    sun.shadow.camera.left = -18;
    sun.shadow.camera.right = 18;
    sun.shadow.camera.top = 18;
    sun.shadow.camera.bottom = -18;
    this.scene.add(sun);
    this.scene.add(new THREE.HemisphereLight(0xa8d4ae, 0x18352c, 1.2));
    const rim = new THREE.DirectionalLight(0x62c8c4, 0.75);
    rim.position.set(8, 8, -10);
    this.scene.add(rim);
    for (const [zone, color, intensity] of [
      ["camp", 0xffa35c, 1.35],
      ["ruins", 0x61d8d2, 1.1],
      ["core", 0x75e8e1, 1.2],
    ] as const) {
      const light = new THREE.PointLight(color, intensity, 8, 2);
      const offset = ZONE_OFFSETS[zone];
      light.position.set(offset.x, 2.2, offset.z - 0.8);
      this.scene.add(light);
    }
  }

  private buildWorld() {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(34, 24), material(COLORS.moss));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.06;
    ground.receiveShadow = true;
    this.root.add(ground);

    for (const zone of Object.keys(ZONE_CONTENT) as ZoneId[]) {
      this.buildZone(zone);
    }
    this.buildConnectingPath();
    this.buildCampComposition();
    this.buildRuinsComposition();
    this.buildCoreComposition();
    this.buildCharacters();
    this.buildAmbientTrees();
    this.buildAtmosphere();
  }

  private buildZone(zone: ZoneId) {
    const zoneGroup = new THREE.Group();
    zoneGroup.name = `${zone}-zone`;
    this.root.add(zoneGroup);
    const zoneOffset = ZONE_OFFSETS[zone];
    const identity = ZONE_SCENE_IDENTITY[zone];
    for (let y = 0; y < gridSize.height; y += 1) {
      for (let x = 0; x < gridSize.width; x += 1) {
        const tileMaterial = material(
          identity.tileColors[(x * 7 + y * 3 + zone.length) % identity.tileColors.length] ??
            identity.ground,
        );
        const tile = new THREE.Mesh(
          new THREE.PlaneGeometry(tileSize * 0.94, tileSize * 0.94),
          tileMaterial,
        );
        tile.rotation.x = -Math.PI / 2;
        const position = localPosition(x, y, zone);
        tile.position.set(position.x, 0, position.z);
        tile.userData = { type: "cell", zone, position: { x, y } };
        tile.receiveShadow = true;
        zoneGroup.add(tile);
        this.tileMeshes.push(tile);
      }
    }

    const clearing = new THREE.Mesh(
      new THREE.CylinderGeometry(5.7, 5.7, 0.08, 12),
      material(identity.ground),
    );
    clearing.position.set(zoneOffset.x, -0.04, zoneOffset.z);
    clearing.scale.z = 0.68;
    clearing.receiveShadow = true;
    zoneGroup.add(clearing);

    for (let index = 0; index < identity.stoneCount; index += 1) {
      const angle = (index / 8) * Math.PI * 2 + zone.length * 0.2;
      const stone = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.12 + (index % 3) * 0.06, 0),
        material(index % 2 ? COLORS.stone : COLORS.soilDark),
      );
      stone.position.set(
        zoneOffset.x + Math.cos(angle) * (4.1 + (index % 2) * 0.45),
        0.1,
        zoneOffset.z + Math.sin(angle) * (2.7 + (index % 3) * 0.2),
      );
      stone.rotation.set(index * 0.4, index * 0.8, index * 0.2);
      stone.castShadow = true;
      zoneGroup.add(stone);
    }

    // A small deterministic fringe makes each clearing feel grown-in without adding
    // another simulation or touching the grid that owns interaction coordinates.
    for (let index = 0; index < identity.foliageCount; index += 1) {
      const angle = zone.length * 0.31 + index * 1.21;
      const tuft = createFoliageTuft(0.72 + (index % 3) * 0.14, identity.foliage);
      tuft.position.set(
        zoneOffset.x + Math.cos(angle) * (3.35 + (index % 2) * 0.5),
        0.02,
        zoneOffset.z + Math.sin(angle) * (2.3 + (index % 3) * 0.25),
      );
      tuft.rotation.y = angle;
      zoneGroup.add(tuft);
    }

    for (const landmark of ZONE_CONTENT[zone].landmarks) {
      const landmarkObject = this.createLandmark(landmark.id);
      const position = localPosition(landmark.position.x, landmark.position.y, zone);
      landmarkObject.position.set(position.x, 0.04, position.z);
      landmarkObject.userData = { type: "landmark", landmark: landmark.id, zone };
      zoneGroup.add(landmarkObject);
      this.landmarkMeshes.set(landmark.id, landmarkObject);
      if (landmark.id === "ruins-vines") {
        const signal = new THREE.Mesh(
          new THREE.SphereGeometry(0.09, 8, 6),
          material(COLORS.cyan, 0.28, COLORS.cyan),
        );
        signal.position.set(position.x + 0.19, 0.83, position.z + 0.22);
        signal.userData = { type: "human-signal", zone };
        zoneGroup.add(signal);
        this.humanSignalMeshes.push(signal);
        this.animated.push({ object: signal, phase: 0.8, amplitude: 0.1, speed: 2.1 });
      }
    }
  }

  private buildConnectingPath() {
    const path = new THREE.Mesh(new THREE.PlaneGeometry(16, 0.62), material(COLORS.clay));
    path.rotation.x = -Math.PI / 2;
    path.position.set(0, 0.01, 1.15);
    path.receiveShadow = true;
    this.root.add(path);
    const marker = new THREE.Mesh(
      new THREE.BoxGeometry(0.22, 0.04, 0.22),
      material(COLORS.gold, 0.52, COLORS.gold),
    );
    marker.position.set(0, 0.08, 1.15);
    this.root.add(marker);
    this.animated.push({ object: marker, phase: 0, amplitude: 0.04, speed: 1.4 });

    for (let index = 0; index < 9; index += 1) {
      const stone = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.12 + (index % 3) * 0.025, 0),
        material(index % 2 ? COLORS.clayLight : COLORS.soilDark),
      );
      stone.position.set(-6.8 + index * 1.7, 0.06, 1.15 + (index % 2 ? 0.13 : -0.08));
      stone.rotation.set(index * 0.2, index * 0.55, index * 0.12);
      stone.scale.set(1.25, 0.42, 0.86);
      stone.castShadow = true;
      this.root.add(stone);
    }
  }

  private buildCampComposition() {
    const { x, z } = ZONE_OFFSETS.camp;
    const camp = new THREE.Group();
    camp.name = "camp-diorama";
    camp.position.set(x - 0.2, 0, z + 0.15);

    const deck = box([4.2, 0.12, 2.3], COLORS.soilDark, 0.02);
    deck.position.set(-1.1, 0, 0.9);
    camp.add(deck);
    const fireRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.52, 0.11, 5, 8),
      material(COLORS.stoneLight),
    );
    fireRing.rotation.x = Math.PI / 2;
    fireRing.position.set(-2.4, 0.18, 0.15);
    camp.add(fireRing);
    const fire = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.24, 0),
      material(COLORS.ember, 0.38, COLORS.ember),
    );
    fire.position.set(-2.4, 0.54, 0.15);
    camp.add(fire);
    this.animated.push({ object: fire, phase: 0.4, amplitude: 0.09, speed: 2.2 });

    const tent = new THREE.Mesh(new THREE.ConeGeometry(1.5, 1.45, 4), material(COLORS.clay));
    tent.scale.z = 0.76;
    tent.position.set(-0.4, 0.8, 0.75);
    tent.rotation.y = Math.PI / 4;
    tent.castShadow = true;
    camp.add(tent);
    for (const side of [-1, 1]) {
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.035, 0.05, 1.8, 5),
        material(COLORS.gold),
      );
      pole.position.set(-0.4 + side * 1.28, 0.9, 0.75);
      pole.rotation.z = side * 0.22;
      camp.add(pole);
    }

    for (const index of [0, 1, 2]) {
      const crate = box([0.44, 0.34, 0.44], index === 1 ? COLORS.clayLight : COLORS.clay, 0.2);
      crate.position.set(0.75 + index * 0.52, 0.04, 1.06 + (index % 2) * 0.32);
      crate.rotation.y = index * 0.16;
      camp.add(crate);
    }
    const signalAntenna = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.08, 1.9, 6),
      material(COLORS.stoneLight),
    );
    signalAntenna.position.set(1.45, 0.97, -0.6);
    camp.add(signalAntenna);
    const signalOrb = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.16, 0),
      material(COLORS.cyan, 0.3, COLORS.cyan),
    );
    signalOrb.position.set(1.45, 1.98, -0.6);
    camp.add(signalOrb);
    this.animated.push({ object: signalOrb, phase: 1.3, amplitude: 0.1, speed: 1.65 });
    this.root.add(camp);
  }

  private buildRuinsComposition() {
    const { x, z } = ZONE_OFFSETS.ruins;
    const ruins = new THREE.Group();
    ruins.name = "ruins-diorama";
    ruins.position.set(x, 0, z);

    const steps = box([4.2, 0.16, 1.8], COLORS.stoneDark, 0.08);
    steps.position.set(0, 0, -1.5);
    ruins.add(steps);
    for (const side of [-1, 1]) {
      const pillar = box([0.7, 2.8, 0.7], COLORS.stone, 1.4);
      pillar.position.set(side * 1.75, 0, -2.28);
      pillar.rotation.z = side * 0.035;
      ruins.add(pillar);
      const cap = box([0.95, 0.24, 0.95], COLORS.stoneLight, 2.85);
      cap.position.set(side * 1.75, 0, -2.28);
      cap.rotation.y = side * 0.12;
      ruins.add(cap);
    }
    const lintel = box([3.6, 0.5, 0.72], COLORS.stone, 2.52);
    lintel.position.set(0, 0, -2.28);
    ruins.add(lintel);
    const door = new THREE.Mesh(
      new THREE.TorusGeometry(0.75, 0.12, 6, 12, Math.PI),
      material(COLORS.cyan, 0.4, COLORS.cyan),
    );
    door.rotation.set(Math.PI / 2, 0, Math.PI / 2);
    door.position.set(0, 1.5, -2.62);
    door.name = "ruins-door";
    ruins.add(door);
    this.ruinsDoor = door;
    this.animated.push({ object: door, phase: 0.7, amplitude: 0.035, speed: 0.9 });

    for (let index = 0; index < 7; index += 1) {
      const fragment = box(
        [0.26 + (index % 3) * 0.12, 0.6 + (index % 2) * 0.38, 0.3],
        index % 2 ? COLORS.stone : COLORS.stoneLight,
        0.3 + (index % 2) * 0.18,
      );
      fragment.position.set(-3 + index * 0.8, 0, -0.7 - (index % 2) * 0.28);
      fragment.rotation.set(0, index * 0.43, index * 0.08);
      ruins.add(fragment);
    }
    this.root.add(ruins);
  }

  private buildCoreComposition() {
    const { x, z } = ZONE_OFFSETS.core;
    const core = new THREE.Group();
    core.name = "core-diorama";
    core.position.set(x, 0, z);
    const dais = new THREE.Mesh(
      new THREE.CylinderGeometry(2.25, 2.8, 0.3, 8),
      material(COLORS.stoneDark),
    );
    dais.position.y = 0.15;
    dais.scale.z = 0.76;
    core.add(dais);
    for (const side of [-1, 1]) {
      const monolith = new THREE.Mesh(
        new THREE.CylinderGeometry(0.36, 0.6, 2.9, 5),
        material(side < 0 ? COLORS.stone : COLORS.stoneLight),
      );
      monolith.position.set(side * 1.35, 1.45, -0.2);
      monolith.rotation.z = side * 0.09;
      monolith.castShadow = true;
      core.add(monolith);
      const glyph = new THREE.Mesh(
        new THREE.BoxGeometry(0.08, 0.8, 0.04),
        material(COLORS.cyan, 0.3, COLORS.cyan),
      );
      glyph.position.set(side * 1.35, 1.55, -0.58);
      core.add(glyph);
    }
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(1.45, 0.055, 6, 20),
      material(COLORS.cyan, 0.3, COLORS.cyan),
    );
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 0.44;
    core.add(halo);
    this.animated.push({ object: halo, phase: 0, amplitude: 0.05, speed: 0.8 });
    this.root.add(core);
  }

  private buildCharacters() {
    const placements: Array<{
      id: "cindra" | "grum" | "voltyn" | "guardian";
      zone: ZoneId;
      x: number;
      y: number;
    }> = [
      { id: "cindra", zone: "camp", x: 3, y: 4 },
      { id: "grum", zone: "camp", x: 4, y: 5 },
      { id: "voltyn", zone: "camp", x: 6, y: 3 },
      { id: "guardian", zone: "ruins", x: 7, y: 4 },
    ];
    for (const placement of placements) {
      const character = makeCharacter(placement.id);
      const position = localPosition(placement.x, placement.y, placement.zone);
      character.position.set(position.x, 0.03, position.z);
      character.userData = { type: "character", character: placement.id };
      this.root.add(character);
      this.characterMeshes.set(placement.id, character);
      this.animated.push({
        object: character,
        phase: placement.x * 0.8,
        amplitude: placement.id === "guardian" ? 0.025 : 0.06,
        speed: placement.id === "voltyn" ? 1.8 : 1.1,
      });
    }
  }

  private buildAmbientTrees() {
    const trees: Array<{ x: number; z: number; h: number; tint: number }> = [
      { x: -13, z: -4, h: 3.6, tint: COLORS.canopyDeep },
      { x: -11.8, z: 5.2, h: 4.8, tint: COLORS.canopy },
      { x: -3.7, z: -5.8, h: 3.4, tint: COLORS.moss },
      { x: 3.8, z: -6, h: 4.1, tint: COLORS.canopyDeep },
      { x: 10.8, z: -4.2, h: 4.9, tint: COLORS.canopy },
      { x: 12.7, z: 5.1, h: 3.6, tint: COLORS.moss },
    ];
    for (const entry of trees) {
      const tree = lowPolyTree(entry.h, entry.tint);
      tree.position.set(entry.x, 0, entry.z);
      this.root.add(tree);
    }
  }

  private buildAtmosphere() {
    const haze = new THREE.MeshBasicMaterial({
      color: COLORS.canopyMist,
      transparent: true,
      opacity: 0.085,
      depthWrite: false,
    });
    for (const [index, zone] of (Object.keys(ZONE_OFFSETS) as ZoneId[]).entries()) {
      const veil = new THREE.Mesh(new THREE.CircleGeometry(3.4 + index * 0.25, 16), haze);
      veil.rotation.x = -Math.PI / 2;
      veil.position.set(ZONE_OFFSETS[zone].x, 0.018, ZONE_OFFSETS[zone].z - 0.35);
      veil.scale.set(1.12, 0.42, 1);
      this.root.add(veil);
    }
    const horizon = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 4.5),
      new THREE.MeshBasicMaterial({
        color: COLORS.canopyDeep,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
      }),
    );
    horizon.position.set(0, 2.1, -9.5);
    this.root.add(horizon);
  }

  private createLandmark(landmark: LandmarkId) {
    const group = new THREE.Group();
    if (landmark === "camp-beacon") {
      const base = box([0.44, 0.15, 0.44], COLORS.stone, 0.11);
      group.add(base);
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.08, 1.2, 6),
        material(COLORS.stoneLight),
      );
      pole.position.y = 0.72;
      group.add(pole);
      const light = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.2, 0),
        material(COLORS.cyan, 0.25, COLORS.cyan),
      );
      light.position.y = 1.42;
      light.name = "beacon-light";
      light.userData = { type: "beacon-light" };
      group.add(light);
      this.animated.push({ object: light, phase: 0.2, amplitude: 0.08, speed: 1.7 });
    } else if (landmark === "relay-station") {
      const base = box([0.68, 0.18, 0.55], COLORS.clay, 0.12);
      group.add(base);
      for (const x of [-0.22, 0.22]) {
        const coil = new THREE.Mesh(
          new THREE.TorusGeometry(0.16, 0.035, 5, 10),
          material(COLORS.gold, 0.4),
        );
        coil.rotation.x = Math.PI / 2;
        coil.position.set(x, 0.57, 0);
        group.add(coil);
      }
      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(0.16, 8, 6),
        material(COLORS.cyan, 0.3, COLORS.cyan),
      );
      cap.position.y = 0.88;
      cap.name = "relay-cap";
      group.add(cap);
      this.animated.push({ object: cap, phase: 0.5, amplitude: 0.07, speed: 1.9 });
    } else if (landmark === "ruins-rubble") {
      for (let index = 0; index < 4; index += 1) {
        const stone = new THREE.Mesh(
          new THREE.DodecahedronGeometry(0.35 + index * 0.04, 0),
          material(COLORS.stone),
        );
        stone.name = "rubble-fragment";
        stone.position.set((index - 1.5) * 0.27, 0.31, Math.sin(index) * 0.18);
        stone.rotation.set(index * 0.4, index * 0.6, index * 0.25);
        stone.castShadow = true;
        group.add(stone);
      }
    } else if (landmark === "ruins-power") {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.48, 0.12, 5, 8),
        material(COLORS.stoneLight),
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 0.45;
      group.add(ring);
      const core = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.19, 0),
        material(COLORS.gold, 0.38, COLORS.gold),
      );
      core.position.y = 0.47;
      core.name = "power-core";
      group.add(core);
      this.animated.push({ object: core, phase: 0.2, amplitude: 0.12, speed: 1.45 });
    } else if (landmark === "ruins-sigil") {
      const plate = new THREE.Mesh(
        new THREE.BoxGeometry(0.9, 0.14, 0.7),
        material(COLORS.stoneLight),
      );
      plate.position.y = 0.16;
      plate.rotation.y = -0.18;
      group.add(plate);
      const glyph = new THREE.Mesh(
        new THREE.TorusGeometry(0.19, 0.04, 4, 6),
        material(COLORS.cyan, 0.42, COLORS.cyan),
      );
      glyph.rotation.x = Math.PI / 2;
      glyph.position.y = 0.27;
      glyph.name = "sigil-glyph";
      group.add(glyph);
    } else if (landmark === "ruins-vines") {
      const wall = box([0.8, 0.72, 0.16], COLORS.stone, 0.4);
      wall.rotation.y = -0.24;
      group.add(wall);
      for (let index = 0; index < 5; index += 1) {
        const vine = new THREE.Mesh(
          new THREE.CylinderGeometry(0.025, 0.04, 0.7, 5),
          material(COLORS.fern),
        );
        vine.position.set(-0.28 + index * 0.14, 0.55 + Math.sin(index) * 0.08, 0.1);
        vine.rotation.z = (index - 2) * 0.16;
        group.add(vine);
      }
    } else {
      const plinth = new THREE.Mesh(
        new THREE.CylinderGeometry(0.85, 1.1, 0.25, 8),
        material(COLORS.stone),
      );
      plinth.position.y = 0.13;
      group.add(plinth);
      const core = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.55, 0),
        material(COLORS.cyan, 0.22, COLORS.cyan),
      );
      core.name = "ancient-core-crystal";
      core.position.y = 0.92;
      group.add(core);
      this.coreVisual = core;
      this.animated.push({ object: core, phase: 1, amplitude: 0.14, speed: 1.1 });
    }
    this.decorateLandmark(group, landmark);
    return group;
  }

  private decorateLandmark(group: THREE.Group, landmark: LandmarkId) {
    const signalKind = signalKindForLandmark(landmark);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.58, 0.035, 5, 14),
      material(COLORS.stoneDark, 0.92),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.055;
    ring.userData.presentationPart = true;
    group.add(ring);

    const roleGeometry =
      signalKind === "human"
        ? new THREE.ConeGeometry(0.105, 0.25, 4)
        : signalKind === "echo"
          ? new THREE.OctahedronGeometry(0.14, 0)
          : new THREE.TetrahedronGeometry(0.15, 0);
    const roleGlyph = new THREE.Mesh(roleGeometry, material(COLORS.stoneDark, 0.8));
    roleGlyph.position.y = 0.23;
    roleGlyph.userData.presentationPart = true;
    roleGlyph.castShadow = true;
    group.add(roleGlyph);

    const lockGlyph = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.2, 0.2),
      material(COLORS.stoneDark, 0.95),
    );
    lockGlyph.position.y = 0.23;
    lockGlyph.userData.presentationPart = true;
    lockGlyph.rotation.y = Math.PI / 4;
    lockGlyph.castShadow = true;
    group.add(lockGlyph);

    const completeGlyph = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.14, 0),
      material(COLORS.cyan, 0.38, COLORS.cyan),
    );
    completeGlyph.position.y = 0.23;
    completeGlyph.userData.presentationPart = true;
    completeGlyph.visible = false;
    group.add(completeGlyph);

    const selectionRing = new THREE.Mesh(
      new THREE.TorusGeometry(0.79, 0.04, 5, 16),
      material(COLORS.gold, 0.45, COLORS.gold),
    );
    selectionRing.rotation.x = Math.PI / 2;
    selectionRing.position.y = 0.072;
    selectionRing.userData.presentationPart = true;
    selectionRing.visible = false;
    group.add(selectionRing);
    this.landmarkPresentations.set(landmark, {
      ring,
      selectionRing,
      roleGlyph,
      lockGlyph,
      completeGlyph,
      signalKind,
    });
    this.animated.push({
      object: roleGlyph,
      phase: landmark.length * 0.2,
      amplitude: 0.035,
      speed: 1.15,
    });
    this.animated.push({
      object: completeGlyph,
      phase: landmark.length * 0.17,
      amplitude: 0.03,
      speed: 0.85,
    });
  }

  private updateLandmarkPresentation(snapshot: GameSnapshot, selectedLandmark: LandmarkId | null) {
    for (const [id, object] of this.landmarkMeshes) {
      const landmark = LANDMARK_CONTENT.get(id);
      const isCurrentZone = landmark?.zone === snapshot.zone;
      const isSelected = isCurrentZone && selectedLandmark === id;
      const isComplete = landmark?.complete(snapshot) ?? false;
      const isAvailable = landmark?.available(snapshot) ?? false;
      const isInactive = !isCurrentZone;
      const presentation = this.landmarkPresentations.get(id);
      object.visible = true;
      object.scale.setScalar(isSelected ? 1.08 : isComplete ? 1.04 : 1);
      object.userData.available = isAvailable;
      object.userData.complete = isComplete;
      object.userData.currentZone = isCurrentZone;
      object.userData.inactive = isInactive;
      object.userData.presentationState = isInactive
        ? "inactive"
        : isSelected
          ? "selected"
          : isComplete
            ? "complete"
            : isAvailable
              ? "available"
              : "locked";
      if (presentation) {
        const stateColor = isSelected
          ? COLORS.gold
          : isInactive
            ? COLORS.canopyMid
            : isComplete
              ? COLORS.cyan
              : isAvailable
                ? signalColorForKind(presentation.signalKind)
                : COLORS.stoneDark;
        const ringMaterial = presentation.ring.material as THREE.MeshStandardMaterial;
        ringMaterial.color.setHex(stateColor);
        ringMaterial.emissive.setHex(
          isSelected || (!isInactive && isComplete) ? stateColor : 0x000000,
        );
        ringMaterial.emissiveIntensity = isSelected ? 0.85 : !isInactive && isComplete ? 0.58 : 0;
        const roleMaterial = presentation.roleGlyph.material as THREE.MeshStandardMaterial;
        roleMaterial.color.setHex(isInactive ? COLORS.canopyMid : stateColor);
        roleMaterial.emissive.setHex(
          isSelected || (!isInactive && isAvailable) ? stateColor : 0x000000,
        );
        roleMaterial.emissiveIntensity = isSelected ? 0.8 : !isInactive && isAvailable ? 0.35 : 0;
        presentation.selectionRing.visible = isSelected;
        presentation.roleGlyph.visible = !isComplete && (isAvailable || isSelected);
        presentation.lockGlyph.visible = !isAvailable && !isComplete;
        presentation.completeGlyph.visible = isComplete;
        const completeMaterial = presentation.completeGlyph.material as THREE.MeshStandardMaterial;
        completeMaterial.color.setHex(isSelected ? COLORS.gold : COLORS.cyan);
        completeMaterial.emissive.setHex(isSelected ? COLORS.gold : COLORS.cyan);
        completeMaterial.emissiveIntensity = isInactive ? 0.16 : isSelected ? 0.75 : 0.5;
      }
      object.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.userData.presentationPart) return;
        const entries = Array.isArray(mesh.material)
          ? mesh.material
          : mesh.material
            ? [mesh.material]
            : [];
        for (const entry of entries) {
          const standard = entry as THREE.MeshStandardMaterial;
          standard.userData.baseColor ??= standard.color.getHex();
          standard.userData.baseEmissive ??= standard.emissive.getHex();
          standard.userData.baseEmissiveIntensity ??= standard.emissiveIntensity;
          standard.color.setHex(
            isInactive
              ? COLORS.canopyDeep
              : !isAvailable && !isComplete && !isSelected
                ? COLORS.stoneDark
                : standard.userData.baseColor,
          );
          standard.emissive.setHex(
            !isInactive && isComplete ? COLORS.cyan : standard.userData.baseEmissive,
          );
          standard.emissiveIntensity =
            !isInactive && isComplete ? 0.48 : standard.userData.baseEmissiveIntensity;
        }
      });
    }
    const showSignal =
      snapshot.zone === "ruins" && snapshot.flags.sigilRead && !snapshot.flags.vinesDiscovered;
    for (const object of this.humanSignalMeshes) object.visible = showSignal;
    this.updateStatePresentation(snapshot);
  }

  private updateStatePresentation(snapshot: GameSnapshot) {
    const beacon = this.landmarkMeshes.get("camp-beacon")?.getObjectByName("beacon-light");
    const relay = this.landmarkMeshes.get("relay-station")?.getObjectByName("relay-cap");
    const power = this.landmarkMeshes.get("ruins-power")?.getObjectByName("power-core");
    const sigil = this.landmarkMeshes.get("ruins-sigil")?.getObjectByName("sigil-glyph");
    const rubble = this.landmarkMeshes.get("ruins-rubble");

    beacon?.scale.setScalar(snapshot.flags.beaconLit ? 1.2 : 0.68);
    relay?.scale.setScalar(snapshot.flags.resonanceCalibrated ? 1.2 : 0.72);
    power?.scale.setScalar(snapshot.flags.powerRestored ? 1.18 : 0.72);
    sigil?.scale.setScalar(snapshot.flags.sigilRead ? 1.18 : 0.72);
    rubble?.traverse((child) => {
      if (child.name === "rubble-fragment") child.visible = !snapshot.flags.rubbleCleared;
    });

    if (this.ruinsDoor) {
      this.ruinsDoor.scale.setScalar(snapshot.flags.sigilRead ? 1.16 : 0.76);
      this.ruinsDoor.visible = !snapshot.flags.vinesDiscovered;
    }
    const guardian = this.characterMeshes.get("guardian");
    if (guardian) guardian.visible = snapshot.zone === "ruins" && !snapshot.flags.guardianDefeated;
    if (this.coreVisual) {
      this.coreVisual.scale.setScalar(snapshot.flags.coreEntered ? 1.16 : 0.74);
      this.coreVisual.visible = snapshot.zone === "core" || snapshot.flags.coreEntered;
    }
  }

  private setMarkerActor(snapshot: GameSnapshot) {
    const latest = [...snapshot.activity].reverse().find((event) => {
      const command = event.commandType ?? "";
      return /(^|_)(move|step|travel|enter)(_|$)/.test(command);
    });
    if (!latest?.actor || latest.accepted === false || latest.id === this.lastMovementEventId)
      return;
    this.lastMovementEventId = latest.id;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reduced) {
      this.markerPulseUntil = 0;
      this.expeditionMarker.scale.setScalar(1);
      return;
    }
    this.markerPulseUntil = performance.now() + 520;
  }

  private setCameraForZone(zone: ZoneId) {
    this.setResponsiveCameraDestination(authoredCameraFrameForZone(zone));
  }

  private setResponsiveCameraDestination(frame: CameraFrame) {
    this.authoredCameraFrame = frame;
    const responsive = responsiveCameraFrameFor(frame, this.viewportAspect);
    this.camera.fov = responsive.fov;
    this.cameraDestination.set(responsive.position.x, responsive.position.y, responsive.position.z);
    this.lookDestination.set(responsive.target.x, responsive.target.y, responsive.target.z);
  }

  private handlePointerDown = (event: PointerEvent) => {
    const canvas = event.currentTarget as HTMLCanvasElement;
    const bounds = canvas.getBoundingClientRect();
    this.pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    this.pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const intersections = this.raycaster.intersectObjects(this.root.children, true);
    const findTagged = (type: string) =>
      intersections.find((entry) => {
        let object: THREE.Object3D | null = entry.object;
        while (object) {
          if (object.userData.type === type) return true;
          object = object.parent;
        }
        return false;
      });
    const findTaggedObject = (type: string) => {
      const entry = findTagged(type);
      let object: THREE.Object3D | null = entry?.object ?? null;
      while (object && object.userData.type !== type) object = object.parent;
      return object;
    };
    const humanSignal = findTaggedObject("human-signal");
    if (humanSignal) {
      this.onHumanSignalClick?.();
      return;
    }
    const landmarkHit = findTaggedObject("landmark");
    if (landmarkHit?.userData.landmark) {
      this.onLandmarkClick?.(landmarkHit.userData.landmark as LandmarkId);
      return;
    }
    const cellHit = findTaggedObject("cell");
    if (cellHit?.userData.position) {
      const { x, y } = cellHit.userData.position as { x: number; y: number };
      const target = ZONE_CONTENT[this.activeZone].landmarks.find(
        (landmark) => landmark.position.x === x && landmark.position.y === y,
      );
      if (target) this.onLandmarkClick?.(target.id);
      else this.onCellClick?.({ x, y }, this.activeZone);
    }
  };

  private animate = () => {
    this.frame = requestAnimationFrame(this.animate);
    const elapsed = this.clock.getElapsedTime();
    const now = performance.now();
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (this.presentationGate.isPending) {
      if (reduced) {
        this.expeditionMarker.position.copy(this.markerDestination);
        this.camera.position.copy(this.cameraDestination);
        this.cameraTarget.copy(this.lookDestination);
        this.presentationGate.settle();
      } else {
        const eased = easedPresentationProgress(now - this.markerStartedAt, this.markerDuration);
        this.expeditionMarker.position.lerpVectors(this.markerStart, this.markerDestination, eased);
        this.camera.position.lerpVectors(this.cameraStart, this.cameraDestination, eased);
        this.cameraTarget.lerpVectors(this.lookStart, this.lookDestination, eased);
        if (eased >= 1) this.presentationGate.settle();
      }
    }
    if (this.markerPulseUntil > 0) {
      if (reduced) {
        this.markerPulseUntil = 0;
        this.expeditionMarker.scale.setScalar(1);
      } else {
        const pulseProgress = Math.max(0, this.markerPulseUntil - now) / 520;
        this.expeditionMarker.scale.setScalar(1 + Math.sin(pulseProgress * Math.PI) * 0.14);
        if (pulseProgress === 0) {
          this.markerPulseUntil = 0;
          this.expeditionMarker.scale.setScalar(1);
        }
      }
    }
    for (const effect of this.transientEffects) {
      const progress = Math.min(1, (now - effect.startedAt) / effect.duration);
      effect.group.scale.setScalar(0.72 + progress * 0.68);
      effect.group.rotation.y += reduced ? 0 : 0.018;
      effect.group.traverse((object) => {
        const mesh = object as THREE.Mesh;
        const effectEntry = mesh.material;
        for (const entry of Array.isArray(effectEntry)
          ? effectEntry
          : effectEntry
            ? [effectEntry]
            : []) {
          const animatedMaterial = entry as THREE.MeshBasicMaterial;
          animatedMaterial.opacity = (1 - progress) * 0.86;
        }
      });
      if (progress >= 1) {
        this.transientEffects.delete(effect);
        this.root.remove(effect.group);
        effect.group.traverse((object) => {
          const mesh = object as THREE.Mesh;
          mesh.geometry?.dispose?.();
          if (Array.isArray(mesh.material)) {
            mesh.material.forEach((entry) => {
              entry.dispose();
            });
          } else mesh.material?.dispose?.();
        });
        effect.resolve();
      }
    }
    for (const entry of this.animated) {
      const y = reduced ? 0 : Math.sin(elapsed * entry.speed + entry.phase) * entry.amplitude;
      entry.object.userData.baseY ??= entry.object.position.y;
      entry.object.position.y = entry.object.userData.baseY + y;
      entry.object.rotation.y += reduced ? 0 : 0.003 * entry.speed;
    }
    this.camera.lookAt(this.cameraTarget);
    this.renderer.render(this.scene, this.camera);
  };
}
