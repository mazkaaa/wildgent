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
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.25, 0.42, 3, 6),
    material(CHARACTERS.cindra.color),
  );
  body.position.y = 0.52;
  body.rotation.z = -0.1;
  body.castShadow = true;
  group.add(body);
  const hood = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.34, 6), material(COLORS.ember));
  hood.position.set(0.02, 0.93, 0);
  hood.rotation.z = Math.PI;
  hood.castShadow = true;
  group.add(hood);
  const eye = new THREE.Mesh(
    new THREE.SphereGeometry(0.048, 6, 4),
    material(COLORS.gold, 0.5, COLORS.gold),
  );
  eye.position.set(0.12, 0.93, 0.28);
  group.add(eye);
  return group;
};

const createGrum = () => {
  const group = new THREE.Group();
  group.name = "Grum";
  const body = new THREE.Mesh(
    new THREE.DodecahedronGeometry(0.45, 0),
    material(CHARACTERS.grum.color),
  );
  body.position.y = 0.48;
  body.scale.set(1.18, 0.9, 0.96);
  body.castShadow = true;
  group.add(body);
  for (const x of [-0.22, 0.22]) {
    const foot = box([0.14, 0.18, 0.24], COLORS.soil, 0.17);
    foot.position.x = x;
    foot.position.z = 0.06;
    group.add(foot);
  }
  const moss = new THREE.Mesh(new THREE.IcosahedronGeometry(0.18, 0), material(COLORS.mossLight));
  moss.position.set(0.1, 0.78, 0.13);
  group.add(moss);
  return group;
};

const createVoltyn = () => {
  const group = new THREE.Group();
  group.name = "Voltyn";
  const body = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.27, 0),
    material(CHARACTERS.voltyn.color, 0.42, COLORS.cyan),
  );
  body.position.y = 0.86;
  body.castShadow = true;
  group.add(body);
  for (const side of [-1, 1]) {
    const wing = new THREE.Mesh(
      new THREE.ConeGeometry(0.16, 0.44, 4),
      material(COLORS.cyan, 0.35, COLORS.cyan),
    );
    wing.position.set(side * 0.29, 0.85, 0);
    wing.rotation.z = side * Math.PI * 0.5;
    group.add(wing);
  }
  return group;
};

const createGuardian = () => {
  const group = new THREE.Group();
  group.name = "Rootbound Guardian";
  const torso = new THREE.Mesh(
    new THREE.CylinderGeometry(0.52, 0.72, 1.7, 6),
    material(CHARACTERS.guardian.color),
  );
  torso.position.y = 1.18;
  torso.castShadow = true;
  group.add(torso);
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.48, 0), material(COLORS.stoneLight));
  head.position.y = 2.24;
  head.castShadow = true;
  group.add(head);
  for (const side of [-1, 1]) {
    const arm = box([0.24, 1.25, 0.28], COLORS.stone, 1.12);
    arm.position.x = side * 0.7;
    arm.rotation.z = side * -0.16;
    group.add(arm);
    const root = new THREE.Mesh(new THREE.ConeGeometry(0.18, 1.3, 5), material(COLORS.soil));
    root.position.set(side * 0.5, 0.18, 0.08);
    root.rotation.z = side * 0.3;
    group.add(root);
  }
  const eye = new THREE.Mesh(
    new THREE.SphereGeometry(0.08, 8, 6),
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
  private lookDestination = new THREE.Vector3();
  private readonly onLandmarkClick?: LandmarkClick;
  private readonly onHumanSignalClick?: HumanSignalClick;
  private readonly onCellClick?: CellClick;
  private readonly expeditionMarker = createExpeditionMarker();
  private readonly transientEffects = new Set<{
    group: THREE.Group;
    startedAt: number;
    duration: number;
    resolve: () => void;
  }>();
  private hasSnapshot = false;
  private previousSnapshot: GameSnapshot | null = null;
  private markerDestination = new THREE.Vector3();
  private markerStart = new THREE.Vector3();
  private markerStartedAt = 0;
  private markerDuration = 0;
  private readonly presentationGate = new PresentationGate();
  private markerPulseUntil = 0;
  private lastMovementEventId: string | null = null;
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
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
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

  setSnapshot(snapshot: GameSnapshot): Promise<void> {
    const target = worldPositionFor(snapshot.position, snapshot.zone);
    const key = `${snapshot.zone}:${snapshot.position.x}:${snapshot.position.y}`;
    if (snapshot.zone !== this.activeZone) {
      this.activeZone = snapshot.zone;
      this.setCameraForZone(snapshot.zone);
    }
    this.updateLandmarkPresentation(snapshot);
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
    this.presentationGate.settle();
    if (
      this.expeditionMarker.position.x === target.x &&
      this.expeditionMarker.position.z === target.z
    ) {
      return Promise.all(cuePromises).then(() => undefined);
    }

    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    this.markerStart.copy(this.expeditionMarker.position);
    this.markerDestination.set(target.x, 0.03, target.z);
    if (reduced) {
      this.expeditionMarker.position.copy(this.markerDestination);
      this.camera.position.copy(this.cameraDestination);
      this.cameraTarget.copy(this.lookDestination);
      return Promise.all(cuePromises).then(() => undefined);
    }
    const distance = this.markerStart.distanceTo(this.markerDestination);
    this.markerDuration = Math.min(600, Math.max(140, distance * 180));
    this.markerStartedAt = performance.now();
    return Promise.all([this.presentationGate.begin(key), ...cuePromises]).then(() => undefined);
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
      group.visible = true;
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
    this.camera.aspect = Math.max(width, 1) / safeHeight;
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
  }

  private buildZone(zone: ZoneId) {
    const zoneGroup = new THREE.Group();
    zoneGroup.name = `${zone}-zone`;
    this.root.add(zoneGroup);
    const zoneOffset = ZONE_OFFSETS[zone];
    for (let y = 0; y < gridSize.height; y += 1) {
      for (let x = 0; x < gridSize.width; x += 1) {
        const tileColors = [COLORS.mossLight, COLORS.moss, COLORS.fernDeep, COLORS.mossBright];
        const tileMaterial = material(
          tileColors[(x * 7 + y * 3 + zone.length) % tileColors.length] ?? COLORS.moss,
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
      material(COLORS.soil),
    );
    clearing.position.set(zoneOffset.x, -0.04, zoneOffset.z);
    clearing.scale.z = 0.68;
    clearing.receiveShadow = true;
    zoneGroup.add(clearing);

    for (let index = 0; index < 8; index += 1) {
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
    ruins.add(door);
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
      group.add(cap);
      this.animated.push({ object: cap, phase: 0.5, amplitude: 0.07, speed: 1.9 });
    } else if (landmark === "ruins-rubble") {
      for (let index = 0; index < 4; index += 1) {
        const stone = new THREE.Mesh(
          new THREE.DodecahedronGeometry(0.35 + index * 0.04, 0),
          material(COLORS.stone),
        );
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
      core.position.y = 0.92;
      group.add(core);
      this.animated.push({ object: core, phase: 1, amplitude: 0.14, speed: 1.1 });
    }
    return group;
  }

  private updateLandmarkPresentation(snapshot: GameSnapshot) {
    for (const [id, object] of this.landmarkMeshes) {
      const landmark = ZONE_CONTENT[snapshot.zone].landmarks.find(
        (candidate) => candidate.id === id,
      );
      const isCurrentZone = landmark?.zone === snapshot.zone;
      const isSelected = snapshot.selectedLandmark === id;
      const isComplete = landmark?.complete(snapshot) ?? false;
      object.visible = true;
      object.scale.setScalar(isSelected ? 1.08 : isComplete ? 1.04 : 1);
      object.userData.available = landmark?.available(snapshot) ?? false;
      object.userData.complete = isComplete;
      object.userData.currentZone = isCurrentZone;
      object.traverse((child) => {
        const mesh = child as THREE.Mesh;
        const entries = Array.isArray(mesh.material)
          ? mesh.material
          : mesh.material
            ? [mesh.material]
            : [];
        for (const entry of entries) {
          const standard = entry as THREE.MeshStandardMaterial;
          standard.userData.baseEmissive ??= standard.emissive.getHex();
          standard.userData.baseEmissiveIntensity ??= standard.emissiveIntensity;
          standard.emissive.setHex(isComplete ? COLORS.cyan : standard.userData.baseEmissive);
          standard.emissiveIntensity = isComplete ? 0.48 : standard.userData.baseEmissiveIntensity;
        }
      });
    }
    const showSignal =
      snapshot.zone === "ruins" && snapshot.flags.sigilRead && !snapshot.flags.vinesDiscovered;
    for (const object of this.humanSignalMeshes) object.visible = showSignal;
  }

  private setMarkerActor(snapshot: GameSnapshot) {
    const latest = [...snapshot.activity].reverse().find((event) => {
      const command = event.commandType ?? "";
      return /(^|_)(move|step|travel|enter)(_|$)/.test(command);
    });
    if (!latest?.actor || latest.accepted === false || latest.id === this.lastMovementEventId)
      return;
    this.lastMovementEventId = latest.id;
    this.markerPulseUntil = performance.now() + 520;
  }

  private setCameraForZone(zone: ZoneId) {
    const offset = ZONE_OFFSETS[zone];
    this.cameraDestination.set(
      offset.x,
      ZONE_CONTENT[zone].camera.y,
      offset.z + ZONE_CONTENT[zone].camera.z - 11,
    );
    this.lookDestination.set(offset.x, 0.35, offset.z);
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
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (this.presentationGate.isPending) {
      const elapsed = performance.now() - this.markerStartedAt;
      const progress = Math.min(1, elapsed / this.markerDuration);
      const eased = progress * (2 - progress);
      this.expeditionMarker.position.lerpVectors(this.markerStart, this.markerDestination, eased);
      if (progress >= 1) {
        this.expeditionMarker.position.copy(this.markerDestination);
        this.camera.position.copy(this.cameraDestination);
        this.cameraTarget.copy(this.lookDestination);
        this.presentationGate.settle();
      }
    }
    if (this.markerPulseUntil > 0) {
      const pulseProgress = Math.max(0, this.markerPulseUntil - performance.now()) / 520;
      this.expeditionMarker.scale.setScalar(1 + Math.sin(pulseProgress * Math.PI) * 0.14);
      if (pulseProgress === 0) {
        this.markerPulseUntil = 0;
        this.expeditionMarker.scale.setScalar(1);
      }
    }
    for (const effect of this.transientEffects) {
      const progress = Math.min(1, (performance.now() - effect.startedAt) / effect.duration);
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
    this.camera.position.lerp(this.cameraDestination, reduced ? 0.14 : 0.055);
    this.cameraTarget.lerp(this.lookDestination, reduced ? 0.14 : 0.055);
    this.camera.lookAt(this.cameraTarget);
    this.renderer.render(this.scene, this.camera);
  };
}
