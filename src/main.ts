
import {
  initializeAuth,
  onProfileChange,
  currentPlayer,
  signOutPlayer,
  startAccountLockMonitor
} from "./auth-ui";

import { supabase } from "./supabase";

type Zombie = {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  speed: number;
  radius: number;
  kind: number;
  phase: number;
};

type Bullet = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  damage: number;
};

type UpgradeKey =
  | "health"
  | "armor"
  | "stamina"
  | "damage"
  | "fireRate";

type SaveData = {
  coins: number;
  campaignLevel: number;
  bestEndless: number;
  upgrades: Record<UpgradeKey, number>;
};

type GameScreen =
  | "menu"
  | "playing"
  | "paused"
  | "confirmExit"
  | "shop"
  | "complete"
  | "gameover"
  | "admin";

type GameMode = "campaign" | "endless";

type AdminSection =
  | "home"
  | "players"
  | "coins"
  | "locks"
  | "accounts"
  | "history";

type GameButton = {
  x: number;
  y: number;
  w: number;
  h: number;
  action: () => void;
};

type AdminPlayer = {
  id: string;
  username: string;
  coins: number;
  campaign_level: number;
  best_endless: number;
  is_admin: boolean;
  is_disabled: boolean;
  created_at: string;
};

const SAVE_KEY = "apex-zombie-survival-v2";

const ACCOUNT_SAVE_PREFIX =
  "apex-zombie-survival-v3-player-";

const LEGACY_BACKUP_KEY =
  "apex-zombie-survival-v2-backup";

const LEGACY_OWNER_KEY =
  "apex-zombie-survival-v2-owner";

const upgradeInfo: {
  key: UpgradeKey;
  name: string;
  price: number;
  max: number;
}[] = [
  {
    key: "health",
    name: "Health +20",
    price: 100,
    max: 10
  },
  {
    key: "armor",
    name: "Armor +1",
    price: 150,
    max: 8
  },
  {
    key: "stamina",
    name: "Speed +10%",
    price: 125,
    max: 8
  },
  {
    key: "damage",
    name: "Damage +1",
    price: 200,
    max: 10
  },
  {
    key: "fireRate",
    name: "Fire Rate",
    price: 250,
    max: 8
  }
];

function defaultSave(): SaveData {
  return {
    coins: 0,
    campaignLevel: 1,
    bestEndless: 0,
    upgrades: {
      health: 0,
      armor: 0,
      stamina: 0,
      damage: 0,
      fireRate: 0
    }
  };
}

function parseSave(raw: string | null): SaveData {
  const defaults = defaultSave();

  if (!raw) {
    return defaults;
  }

  try {
    const data: unknown = JSON.parse(raw);

    if (!data || typeof data !== "object") {
      return defaults;
    }

    const record =
      data as Record<string, unknown>;

    const rawUpgrades =
      record.upgrades &&
      typeof record.upgrades === "object"
        ? record.upgrades as Record<string, unknown>
        : {};

    const number = (
      value: unknown,
      fallback: number
    ): number =>
      typeof value === "number" &&
      Number.isFinite(value) &&
      value >= 0
        ? Math.floor(value)
        : fallback;

    const upgrades = {
      ...defaults.upgrades
    };

    for (const item of upgradeInfo) {
      upgrades[item.key] = Math.min(
        item.max,
        number(rawUpgrades[item.key], 0)
      );
    }

    return {
      coins: number(record.coins, 0),
      campaignLevel: Math.max(
        1,
        number(record.campaignLevel, 1)
      ),
      bestEndless: number(
        record.bestEndless,
        0
      ),
      upgrades
    };
  } catch {
    return defaults;
  }
}

let save = defaultSave();

let activeSaveOwner: string | null = null;

let walletReady = false;
let walletLoading = false;
let walletError = "";
let walletRequestVersion = 0;

let adminSection: AdminSection = "home";

let adminPlayers: AdminPlayer[] = [];

let adminPlayersLoading = false;
let adminPlayersError = "";
let adminPlayersLoaded = false;
let adminPlayersPage = 0;

let coinSelectedPlayerId: string | null = null;
let coinGrantPending = false;
let coinGrantMessage = "";
let coinGrantError = "";

const ADMIN_PLAYERS_PER_PAGE = 4;

function isAdministrator(): boolean {
  const profile = currentPlayer();

  return Boolean(
    profile &&
    profile.is_admin &&
    !profile.is_disabled &&
    activeSaveOwner === profile.id
  );
}

function playerSaveKey(
  playerId: string
): string {
  return `${ACCOUNT_SAVE_PREFIX}${playerId}`;
}

function invalidateWallet(): void {
  walletRequestVersion++;
  walletReady = false;
  walletLoading = false;
  walletError = "";
}

async function loadPlayerWallet(): Promise<void> {
  const profile = currentPlayer();

  if (
    !profile ||
    profile.is_disabled ||
    activeSaveOwner !== profile.id
  ) {
    return;
  }

  const ownerId = profile.id;
  const requestVersion = ++walletRequestVersion;

  walletReady = false;
  walletLoading = true;
  walletError = "";

  try {
    const {
      data,
      error
    } = await supabase
      .from("player_profiles")
      .select("coins")
      .eq("id", ownerId)
      .single();

    if (error) {
      throw error;
    }

    if (
      !data ||
      !Number.isSafeInteger(data.coins) ||
      data.coins < 0
    ) {
      throw new Error(
        "Invalid wallet balance returned."
      );
    }

    if (
      walletRequestVersion !== requestVersion ||
      activeSaveOwner !== ownerId ||
      currentPlayer()?.id !== ownerId
    ) {
      return;
    }

    save.coins = data.coins;
    walletReady = true;
    walletError = "";

    // Local save remains a gameplay cache.
    // Supabase is authoritative for coins.
    persist();
  } catch (error) {
    if (
      walletRequestVersion !== requestVersion ||
      activeSaveOwner !== ownerId
    ) {
      return;
    }

    walletReady = false;

    walletError =
      error instanceof Error
        ? error.message
        : "Unable to synchronize wallet.";

    console.error(
      "Wallet synchronization failed:",
      error
    );
  } finally {
    if (
      walletRequestVersion === requestVersion &&
      activeSaveOwner === ownerId
    ) {
      walletLoading = false;
    }
  }
}

function activatePlayerSave(profile: {
  id: string;
  is_admin: boolean;
}): void {
  if (activeSaveOwner === profile.id) {
    return;
  }

  invalidateWallet();

  activeSaveOwner = null;
  save = defaultSave();

  try {
    const key = playerSaveKey(profile.id);
    const existing = localStorage.getItem(key);

    if (existing !== null) {
      save = parseSave(existing);
    } else {
      const legacy =
        localStorage.getItem(SAVE_KEY);

      if (
        legacy !== null &&
        localStorage.getItem(
          LEGACY_BACKUP_KEY
        ) === null
      ) {
        localStorage.setItem(
          LEGACY_BACKUP_KEY,
          legacy
        );
      }

      const legacyOwner =
        localStorage.getItem(
          LEGACY_OWNER_KEY
        );

      if (
        profile.is_admin &&
        legacy !== null &&
        (
          legacyOwner === null ||
          legacyOwner === profile.id
        )
      ) {
        if (legacyOwner === null) {
          localStorage.setItem(
            LEGACY_OWNER_KEY,
            profile.id
          );
        }

        save = parseSave(legacy);
      }

      localStorage.setItem(
        key,
        JSON.stringify(save)
      );
    }

    activeSaveOwner = profile.id;

    // Never display cached coins as verified.
    save.coins = 0;

    void loadPlayerWallet();
  } catch (error) {
    activeSaveOwner = null;
    save = defaultSave();

    console.error(
      "Unable to initialize account save:",
      error
    );

    showError(
      "Account save could not be initialized."
    );
  }
}

function persist(): void {
  const profile = currentPlayer();

  if (
    !profile ||
    activeSaveOwner !== profile.id
  ) {
    return;
  }

  try {
    localStorage.setItem(
      playerSaveKey(profile.id),
      JSON.stringify(save)
    );
  } catch (error) {
    console.warn(
      "Unable to save player progress:",
      error
    );
  }
}

async function loadAdminPlayers(): Promise<void> {
  if (!isAdministrator()) {
    return;
  }

  const ownerId = activeSaveOwner;

  adminPlayersLoading = true;
  adminPlayersError = "";
  adminPlayersLoaded = false;

  try {
    const {
      data: sessionData,
      error: sessionError
    } = await supabase.auth.getSession();

    if (sessionError) {
      throw sessionError;
    }

    const token =
      sessionData.session?.access_token;

    if (!token) {
      throw new Error(
        "Administrator session expired."
      );
    }

    const {
      data,
      error
    } = await supabase.functions.invoke(
      "apex-admin",
      {
        body: {
          action: "list_players"
        },
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    if (error) {
      throw error;
    }

    if (
      !data ||
      !Array.isArray(data.players)
    ) {
      throw new Error(
        "Invalid player list response."
      );
    }

    if (
      !isAdministrator() ||
      activeSaveOwner !== ownerId
    ) {
      return;
    }

    adminPlayers = data.players as AdminPlayer[];
    adminPlayersPage = 0;
    adminPlayersLoaded = true;
  } catch (error) {
    if (
      !isAdministrator() ||
      activeSaveOwner !== ownerId
    ) {
      return;
    }

    adminPlayersError =
      error instanceof Error
        ? error.message
        : "Unable to load accounts.";

    adminPlayers = [];
  } finally {
    if (
      isAdministrator() &&
      activeSaveOwner === ownerId
    ) {
      adminPlayersLoading = false;
    }
  }
}

function openAdminDashboard(): void {
  if (!isAdministrator()) {
    return;
  }

  resetJoystick();
  adminSection = "home";
  gameScreen = "admin";
}

function closeAdminDashboard(): void {
  adminSection = "home";
  gameScreen = "menu";
}

function openAdminSection(
  section: AdminSection
): void {
  if (!isAdministrator()) {
    return;
  }

  adminSection = section;

  if (
    section === "coins" ||
    section === "players"
  ) {
    adminPlayers = [];
    adminPlayersPage = 0;
    coinSelectedPlayerId = null;
    coinGrantMessage = "";
    coinGrantError = "";

    void loadAdminPlayers();
  }
}

function clearAdminPlayerData(): void {
  adminPlayers = [];
  adminPlayersLoading = false;
  adminPlayersError = "";
  adminPlayersLoaded = false;
  adminPlayersPage = 0;
  coinSelectedPlayerId = null;
  coinGrantPending = false;
  coinGrantMessage = "";
  coinGrantError = "";
}

// PHASE 1 SECURITY:
// Gameplay coins and shop spending will remain
// disabled until secure server-side transactions
// are implemented in the following phase.

const canvas = document.createElement("canvas");

const context = canvas.getContext("2d");

if (!context) {
  throw new Error("Canvas 2D unavailable");
}

const ctx: CanvasRenderingContext2D = context;

document.documentElement.style.cssText =
  "margin:0;overflow:hidden";

document.body.style.cssText =
  "margin:0;overflow:hidden;background:#101510";

canvas.id = "apex-game-canvas";

canvas.style.cssText =
  "position:fixed;inset:0;width:100vw;height:100dvh;" +
  "display:block;touch-action:none;z-index:10";

document.body.appendChild(canvas);

for (const selector of [
  "#loading",
  "#loader",
  "#loading-screen",
  ".loading",
  ".loading-screen",
  ".loader"
]) {
  document
    .querySelectorAll(selector)
    .forEach(element => element.remove());
}

document
  .querySelectorAll(
    "body > div,body > p,body > h1,body > h2"
  )
  .forEach(element => {
    if (
      element.textContent?.trim() ===
      "Loading APEX Zombie Survival..."
    ) {
      element.remove();
    }
  });

let width = 0;
let height = 0;
let initialized = false;

const player = {
  x: 0,
  y: 0,
  hp: 100,
  maxHp: 100,
  radius: 15,
  angle: -Math.PI / 2
};

const zombies: Zombie[] = [];
const bullets: Bullet[] = [];

let gameScreen: GameScreen = "menu";
let gameMode: GameMode = "campaign";

let shopReturn: "menu" | "complete" = "menu";

let kills = 0;
let runCoins = 0;
let waveKills = 0;
let targetKills = 15;
let difficulty = 1;
let elapsed = 0;
let noDamage = true;

let spawnTimer = 0;
let shootTimer = 0;
let invulnerable = 0;
let lastTime = 0;
let lastMilestone = 0;
let levelReward = 0;
let waveBreak = 0;
let waveTime = 0;

let buttons: GameButton[] = [];

const keys = new Set<string>();

const joystick = {
  active: false,
  pointerId: -1,
  dx: 0,
  dy: 0
};

const JOYSTICK_RADIUS = 48;

const maxHealth = () =>
  100 + save.upgrades.health * 20;

const movementSpeed = () =>
  190 * (1 + save.upgrades.stamina * 0.1);

const bulletDamage = () =>
  1 + save.upgrades.damage;

const fireDelay = () =>
  Math.max(
    0.1,
    0.35 * Math.pow(0.9, save.upgrades.fireRate)
  );

function upgradePrice(key: UpgradeKey): number {
  const item = upgradeInfo.find(
    upgrade => upgrade.key === key
  )!;

  return Math.floor(
    item.price *
    Math.pow(1.5, save.upgrades[key])
  );
}

function buyUpgrade(key: UpgradeKey): void {
  const profile = currentPlayer();

  if (
    !profile ||
    activeSaveOwner !== profile.id
  ) {
    return;
  }

  if (!walletReady) {
    showError(
      "Wallet is not synchronized. Please wait."
    );
    return;
  }

  // Secure purchase transactions are not
  // implemented yet. Never deduct coins
  // from the local cache.
  showError(
    "Upgrade purchases are temporarily disabled " +
    "while secure wallet transactions are being added."
  );

  void key;
}

function resize(): void {
  const oldWidth = width;
  const oldHeight = height;

  width = window.innerWidth;
  height = window.innerHeight;

  const ratio = Math.min(
    window.devicePixelRatio || 1,
    2
  );

  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);

  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

  if (!initialized) {
    player.x = width / 2;
    player.y = height / 2;
    initialized = true;
  } else {
    player.x = Math.max(
      15,
      Math.min(
        width - 15,
        player.x + (width - oldWidth) / 2
      )
    );

    player.y = Math.max(
      15,
      Math.min(
        height - 15,
        player.y + (height - oldHeight) / 2
      )
    );
  }
}

window.addEventListener("resize", resize);

resize();

const joystickHome = () => ({
  x: Math.min(83, width * 0.23),
  y: height - 100
});

function resetJoystick(): void {
  joystick.active = false;
  joystick.pointerId = -1;
  joystick.dx = 0;
  joystick.dy = 0;
}

function updateJoystick(
  x: number,
  y: number
): void {
  const home = joystickHome();

  const dx = x - home.x;
  const dy = y - home.y;

  const distance = Math.hypot(dx, dy);

  const factor = Math.min(
    1,
    JOYSTICK_RADIUS / Math.max(1, distance)
  );

  joystick.dx =
    distance < 8
      ? 0
      : dx * factor / JOYSTICK_RADIUS;

  joystick.dy =
    distance < 8
      ? 0
      : dy * factor / JOYSTICK_RADIUS;
}

function pauseGame(): void {
  gameScreen = "paused";
  resetJoystick();
}

function resumeGame(): void {
  gameScreen = "playing";
  lastTime = 0;
}

function abandonRun(): void {
  runCoins = 0;
  zombies.length = 0;
  bullets.length = 0;
  waveBreak = 0;

  resetJoystick();

  gameScreen = "menu";
}

function pauseButtonBounds() {
  return {
    x: width - 62,
    y: 15,
    w: 48,
    h: 42
  };
}

window.addEventListener("keydown", event => {
  const key = event.key.toLowerCase();

  keys.add(key);

  if (key === "escape" || key === "p") {
    if (gameScreen === "playing") {
      pauseGame();
    } else if (gameScreen === "paused") {
      resumeGame();
    }
  }
});

window.addEventListener("keyup", event => {
  keys.delete(event.key.toLowerCase());
});

window.addEventListener("blur", () => {
  keys.clear();
  resetJoystick();

  if (gameScreen === "playing") {
    pauseGame();
  }
});

canvas.addEventListener("pointerdown", event => {
  const profile = currentPlayer();

  if (
    !profile ||
    activeSaveOwner !== profile.id
  ) {
    return;
  }

  if (gameScreen === "playing") {
    const pause = pauseButtonBounds();

    if (
      event.clientX >= pause.x &&
      event.clientX <= pause.x + pause.w &&
      event.clientY >= pause.y &&
      event.clientY <= pause.y + pause.h
    ) {
      pauseGame();
      return;
    }

    if (
      event.clientX < width * 0.55 &&
      !joystick.active &&
      waveBreak <= 0
    ) {
      joystick.active = true;
      joystick.pointerId = event.pointerId;

      updateJoystick(
        event.clientX,
        event.clientY
      );

      canvas.setPointerCapture(event.pointerId);
    }

    return;
  }

  const button = [...buttons]
    .reverse()
    .find(item =>
      event.clientX >= item.x &&
      event.clientX <= item.x + item.w &&
      event.clientY >= item.y &&
      event.clientY <= item.y + item.h
    );

  button?.action();
});

canvas.addEventListener("pointermove", event => {
  if (
    joystick.active &&
    joystick.pointerId === event.pointerId
  ) {
    updateJoystick(
      event.clientX,
      event.clientY
    );
  }
});

function releasePointer(
  event: PointerEvent
): void {
  if (event.pointerId === joystick.pointerId) {
    resetJoystick();
  }
}

canvas.addEventListener(
  "pointerup",
  releasePointer
);

canvas.addEventListener(
  "pointercancel",
  releasePointer
);

function startGame(mode: GameMode): void {
  const profile = currentPlayer();

  if (
    !profile ||
    activeSaveOwner !== profile.id
  ) {
    return;
  }

  if (!walletReady) {
    showError(
      "Please wait for your wallet to synchronize."
    );
    return;
  }

  gameMode = mode;
  gameScreen = "playing";

  player.x = width / 2;
  player.y = height / 2;

  player.maxHp = maxHealth();
  player.hp = player.maxHp;
  player.angle = -Math.PI / 2;

  zombies.length = 0;
  bullets.length = 0;

  kills = 0;
  runCoins = 0;
  waveKills = 0;
  elapsed = 0;
  waveTime = 0;
  waveBreak = 0;
  spawnTimer = 0;
  shootTimer = 0;
  invulnerable = 0;
  lastMilestone = 0;
  noDamage = true;

  difficulty =
    mode === "campaign"
      ? save.campaignLevel
      : 1;

  targetKills = 10 + difficulty * 5;

  resetJoystick();
  lastTime = 0;
}

function awardCoins(amount: number): void {
  if (
    Number.isFinite(amount) &&
    amount > 0
  ) {
    runCoins += Math.floor(amount);
  }
}

function bankRunCoins(): void {
  const profile = currentPlayer();

  if (
    !profile ||
    activeSaveOwner !== profile.id ||
    !walletReady
  ) {
    return;
  }

  // PHASE 1:
  // Run rewards are calculated for display,
  // but cannot modify the Supabase wallet.
  // Server-side reward verification is required
  // before banking is enabled.
}

function finishCampaign(): void {
  const bonus = noDamage
    ? difficulty * 50
    : 0;

  levelReward = difficulty * 25 + bonus;

  awardCoins(levelReward);
  bankRunCoins();

  save.campaignLevel++;

  persist();

  gameScreen = "complete";

  resetJoystick();
}

function endGame(): void {
  bankRunCoins();

  if (
    gameMode === "endless" &&
    kills > save.bestEndless
  ) {
    save.bestEndless = kills;
  }

  persist();

  gameScreen = "gameover";

  resetJoystick();
}

function spawnZombie(): void {
  const side = Math.floor(Math.random() * 4);

  let x = 0;
  let y = 0;

  if (side === 0) {
    x = -30;
    y = Math.random() * height;
  } else if (side === 1) {
    x = width + 30;
    y = Math.random() * height;
  } else if (side === 2) {
    x = Math.random() * width;
    y = -30;
  } else {
    x = Math.random() * width;
    y = height + 30;
  }

  const kind =
    Math.random() <
    Math.min(0.45, 0.1 + difficulty * 0.02)
      ? 1
      : 0;

  const hp =
    1 + Math.floor(difficulty / 3) + kind;

  zombies.push({
    x,
    y,
    hp,
    maxHp: hp,
    speed: 45 + difficulty * 5 - kind * 8,
    radius: kind ? 17 : 13,
    kind,
    phase: Math.random() * Math.PI * 2
  });
}

function update(dt: number): void {
  const profile = currentPlayer();

  if (
    !profile ||
    activeSaveOwner !== profile.id ||
    !walletReady ||
    gameScreen !== "playing"
  ) {
    return;
  }

  if (waveBreak > 0) {
    waveBreak = Math.max(0, waveBreak - dt);

    if (waveBreak === 0) {
      difficulty++;
      waveTime = 0;
      spawnTimer = 0;
    }

    return;
  }

  elapsed += dt;

  if (gameMode === "endless") {
    waveTime += dt;

    if (waveTime >= 35) {
      waveTime = 0;

      if (difficulty >= 10) {
        waveBreak = 3;

        zombies.length = 0;
        bullets.length = 0;

        resetJoystick();
        return;
      }

      difficulty++;
    }

    const milestone = Math.floor(
      elapsed / 30
    );

    if (milestone > lastMilestone) {
      lastMilestone = milestone;

      awardCoins(
        20 + milestone * 10
      );
    }
  }

  let dx = 0;
  let dy = 0;

  if (
    keys.has("a") ||
    keys.has("arrowleft")
  ) {
    dx--;
  }

  if (
    keys.has("d") ||
    keys.has("arrowright")
  ) {
    dx++;
  }

  if (
    keys.has("w") ||
    keys.has("arrowup")
  ) {
    dy--;
  }

  if (
    keys.has("s") ||
    keys.has("arrowdown")
  ) {
    dy++;
  }

  if (joystick.active) {
    dx = joystick.dx;
    dy = joystick.dy;
  }

  const length = Math.hypot(dx, dy);

  if (length > 0) {
    const strength = Math.min(1, length);

    player.x +=
      dx / length *
      movementSpeed() *
      strength *
      dt;

    player.y +=
      dy / length *
      movementSpeed() *
      strength *
      dt;
  }

  player.x = Math.max(
    player.radius,
    Math.min(width - player.radius, player.x)
  );

  player.y = Math.max(
    player.radius,
    Math.min(height - player.radius, player.y)
  );

  spawnTimer -= dt;

  if (spawnTimer <= 0) {
    spawnZombie();

    spawnTimer = Math.max(
      0.25,
      1.5 - difficulty * 0.075
    );
  }

  shootTimer -= dt;

  if (
    shootTimer <= 0 &&
    zombies.length > 0
  ) {
    let nearest: Zombie | null = null;
    let bestDistance = Infinity;

    for (const zombie of zombies) {
      if (zombie.hp <= 0) {
        continue;
      }

      const distance =
        (zombie.x - player.x) ** 2 +
        (zombie.y - player.y) ** 2;

      if (distance < bestDistance) {
        bestDistance = distance;
        nearest = zombie;
      }
    }

    if (nearest !== null) {
      const target: Zombie = nearest;

      const angle = Math.atan2(
        target.y - player.y,
        target.x - player.x
      );

      player.angle = angle;

      bullets.push({
        x: player.x + Math.cos(angle) * 19,
        y: player.y + Math.sin(angle) * 19,
        vx: Math.cos(angle) * 430,
        vy: Math.sin(angle) * 430,
        life: 1.5,
        damage: bulletDamage()
      });

      shootTimer = fireDelay();
    }
  }

  invulnerable = Math.max(
    0,
    invulnerable - dt
  );

  for (const zombie of zombies) {
    if (zombie.hp <= 0) {
      continue;
    }

    zombie.phase += dt * 8;

    const angle = Math.atan2(
      player.y - zombie.y,
      player.x - zombie.x
    );

    zombie.x +=
      Math.cos(angle) * zombie.speed * dt;

    zombie.y +=
      Math.sin(angle) * zombie.speed * dt;

    const distance = Math.hypot(
      zombie.x - player.x,
      zombie.y - player.y
    );

    if (
      distance <
        zombie.radius + player.radius &&
      invulnerable <= 0
    ) {
      const damage = Math.max(
        2,
        10 - save.upgrades.armor
      );

      player.hp = Math.max(
        0,
        player.hp - damage
      );

      noDamage = false;
      invulnerable = 0.7;

      if (player.hp <= 0) {
        endGame();
        return;
      }
    }
  }

  for (const bullet of bullets) {
    bullet.x += bullet.vx * dt;
    bullet.y += bullet.vy * dt;
    bullet.life -= dt;

    if (bullet.life <= 0) {
      continue;
    }

    for (const zombie of zombies) {
      if (zombie.hp <= 0) {
        continue;
      }

      const distance = Math.hypot(
        bullet.x - zombie.x,
        bullet.y - zombie.y
      );

      if (distance < zombie.radius + 4) {
        zombie.hp -= bullet.damage;
        bullet.life = 0;

        if (zombie.hp <= 0) {
          kills++;
          waveKills++;

          awardCoins(
            zombie.kind ? 10 : 5
          );
        }

        break;
      }
    }
  }

  for (
    let i = zombies.length - 1;
    i >= 0;
    i--
  ) {
    if (zombies[i].hp <= 0) {
      zombies.splice(i, 1);
    }
  }

  for (
    let i = bullets.length - 1;
    i >= 0;
    i--
  ) {
    const bullet = bullets[i];

    if (
      bullet.life <= 0 ||
      bullet.x < -40 ||
      bullet.x > width + 40 ||
      bullet.y < -40 ||
      bullet.y > height + 40
    ) {
      bullets.splice(i, 1);
    }
  }

  if (
    gameMode === "campaign" &&
    waveKills >= targetKills
  ) {
    finishCampaign();
  }
}

function drawText(
  value: string,
  x: number,
  y: number,
  size = 16,
  color = "#ffffff",
  align: CanvasTextAlign = "left"
): void {
  ctx.fillStyle = color;
  ctx.font = `bold ${size}px Arial`;
  ctx.textAlign = align;
  ctx.fillText(value, x, y);
}

function drawBackground(): void {
  ctx.fillStyle = "#152219";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "#23382a";
  ctx.lineWidth = 1;

  for (let x = 0; x < width; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  for (let y = 0; y < height; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  ctx.fillStyle = "#26392b";

  for (let x = 25; x < width; x += 95) {
    for (let y = 35; y < height; y += 110) {
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawPlayer(): void {
  ctx.save();

  ctx.translate(player.x, player.y);
  ctx.rotate(player.angle);

  if (
    invulnerable > 0 &&
    Math.floor(invulnerable * 12) % 2 === 0
  ) {
    ctx.globalAlpha = 0.55;
  }

  ctx.fillStyle = "#090d0a";
  ctx.beginPath();
  ctx.ellipse(
    2, 5, 21, 17,
    0, 0, Math.PI * 2
  );
  ctx.fill();

  ctx.fillStyle = "#242a24";
  ctx.fillRect(-14, -13, 10, 8);
  ctx.fillRect(-14, 5, 10, 8);

  ctx.fillStyle = "#465842";
  ctx.fillRect(-12, -12, 25, 24);

  ctx.fillStyle = "#8d7949";
  ctx.fillRect(-7, -10, 17, 20);

  ctx.fillStyle = "#2b3228";
  ctx.fillRect(-5, -10, 4, 20);
  ctx.fillRect(6, -10, 4, 20);

  ctx.fillStyle = "#cba77a";
  ctx.beginPath();
  ctx.arc(3, 0, 9, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#53624a";
  ctx.beginPath();
  ctx.arc(
    1, 0, 9,
    Math.PI * 0.55,
    Math.PI * 1.45
  );
  ctx.fill();

  ctx.fillStyle = "#ad8b67";
  ctx.fillRect(8, -11, 12, 6);
  ctx.fillRect(8, 5, 12, 6);

  ctx.fillStyle = "#22282a";
  ctx.fillRect(15, -5, 22, 10);

  ctx.fillStyle = "#69706d";
  ctx.fillRect(32, -2, 10, 4);

  ctx.fillStyle = "#111617";
  ctx.fillRect(21, -7, 7, 3);

  ctx.restore();
}

function drawZombie(zombie: Zombie): void {
  ctx.save();

  ctx.translate(zombie.x, zombie.y);

  const angle = Math.atan2(
    player.y - zombie.y,
    player.x - zombie.x
  );

  ctx.rotate(angle);

  const wobble = Math.sin(zombie.phase) * 2;

  ctx.fillStyle = "#0a100d";
  ctx.beginPath();
  ctx.ellipse(
    2, 5,
    zombie.radius + 4,
    zombie.radius + 2,
    0, 0, Math.PI * 2
  );
  ctx.fill();

  ctx.fillStyle = zombie.kind
    ? "#4d5540"
    : "#515c4b";

  ctx.fillRect(
    -zombie.radius + 2,
    -zombie.radius + 3,
    zombie.radius * 2 - 4,
    zombie.radius * 2 - 6
  );

  ctx.fillStyle = zombie.kind
    ? "#75845b"
    : "#82a477";

  ctx.fillRect(7, -13 + wobble, 13, 6);
  ctx.fillRect(7, 7 - wobble, 13, 6);

  ctx.fillStyle = zombie.kind
    ? "#60774f"
    : "#83a778";

  ctx.beginPath();
  ctx.arc(
    0, 0,
    zombie.radius - 3,
    0, Math.PI * 2
  );
  ctx.fill();

  ctx.fillStyle = "#435943";
  ctx.fillRect(-6, -5, 5, 4);
  ctx.fillRect(-3, 6, 6, 3);

  ctx.fillStyle = "#e6dfaa";
  ctx.fillRect(3, -6, 4, 3);
  ctx.fillRect(3, 3, 4, 3);

  ctx.fillStyle = "#382e2a";
  ctx.fillRect(8, -2, 4, 4);

  ctx.restore();

  if (zombie.maxHp > 1) {
    const barWidth = zombie.radius * 2 + 6;

    ctx.fillStyle = "#382626";
    ctx.fillRect(
      zombie.x - barWidth / 2,
      zombie.y - zombie.radius - 13,
      barWidth,
      5
    );

    ctx.fillStyle = "#e07560";
    ctx.fillRect(
      zombie.x - barWidth / 2,
      zombie.y - zombie.radius - 13,
      barWidth *
        Math.max(0, zombie.hp) /
        zombie.maxHp,
      5
    );
  }
}

function drawJoystick(): void {
  const home = joystickHome();

  ctx.fillStyle = "rgba(255,255,255,0.1)";
  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.arc(
    home.x,
    home.y,
    JOYSTICK_RADIUS,
    0,
    Math.PI * 2
  );
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "rgba(225,194,110,0.8)";

  ctx.beginPath();
  ctx.arc(
    home.x + joystick.dx * JOYSTICK_RADIUS,
    home.y + joystick.dy * JOYSTICK_RADIUS,
    22,
    0,
    Math.PI * 2
  );
  ctx.fill();
}

function addButton(
  label: string,
  y: number,
  action: () => void
): void {
  const buttonWidth = Math.min(width - 40, 300);
  const buttonHeight = 46;
  const x = (width - buttonWidth) / 2;

  ctx.fillStyle = "#a78439";
  ctx.fillRect(
    x, y,
    buttonWidth,
    buttonHeight
  );

  ctx.strokeStyle = "#e7c76c";
  ctx.lineWidth = 2;
  ctx.strokeRect(
    x, y,
    buttonWidth,
    buttonHeight
  );

  drawText(
    label,
    width / 2,
    y + 29,
    15,
    "#101510",
    "center"
  );

  buttons.push({
    x,
    y,
    w: buttonWidth,
    h: buttonHeight,
    action
  });
}

function drawPanel(title: string): void {
  ctx.fillStyle = "rgba(5,12,8,0.96)";
  ctx.fillRect(0, 0, width, height);

  drawText(
    title,
    width / 2,
    65,
    Math.min(25, width / 15),
    "#e8c66d",
    "center"
  );
}

function drawMenu(): void {
  drawPanel("APEX ZOMBIE SURVIVAL");

  const profile = currentPlayer();
  const admin = isAdministrator();

  let walletText = "WALLET: NOT AVAILABLE";
  let walletColor = "#ff9999";

  if (walletLoading) {
    walletText = "WALLET: SYNCHRONIZING...";
    walletColor = "#e8c66d";
  } else if (walletReady) {
    walletText =
      `WALLET: ${save.coins.toLocaleString()} COINS`;
    walletColor = "#8ee29a";
  } else if (walletError) {
    walletText = "WALLET: SYNC FAILED";
  }

  drawText(
    walletText,
    width / 2,
    110,
    16,
    walletColor,
    "center"
  );

  if (walletError) {
    drawText(
      walletError.slice(0, 48),
      width / 2,
      130,
      11,
      "#ff9999",
      "center"
    );
  }

  drawText(
    `Campaign Level: ${save.campaignLevel}`,
    width / 2,
    155,
    15,
    "#a5c9a5",
    "center"
  );

  drawText(
    `Best Endless Kills: ${save.bestEndless}`,
    width / 2,
    180,
    15,
    "#a5c9a5",
    "center"
  );

  const startY = Math.max(
    205,
    height / 2 - (admin ? 95 : 65)
  );

  addButton(
    "CAMPAIGN MODE",
    startY,
    () => startGame("campaign")
  );

  addButton(
    "ENDLESS SURVIVAL",
    startY + 55,
    () => startGame("endless")
  );

  addButton(
    "UPGRADE SHOP",
    startY + 110,
    () => {
      if (
        !currentPlayer() ||
        activeSaveOwner !== currentPlayer()?.id
      ) {
        return;
      }

      shopReturn = "menu";
      gameScreen = "shop";
    }
  );

  if (admin) {
    addButton(
      "ADMIN DASHBOARD",
      startY + 165,
      openAdminDashboard
    );
  }

  if (profile) {
    drawText(
      `Signed in: ${profile.username}`,
      width / 2,
      height - 155,
      13,
      "#e8c66d",
      "center"
    );

    if (profile.is_admin) {
      drawText(
        "ADMINISTRATOR",
        width / 2,
        height - 135,
        12,
        "#8ee29a",
        "center"
      );
    }

    addButton(
      "LOG OUT",
      height - 115,
      () => {
        void signOutPlayer().catch(showError);
      }
    );
  }

  drawText(
    "DEVELOPED BY: APEX LABS",
    width / 2,
    height - 52,
    12,
    "#e8c66d",
    "center"
  );

  drawText(
    "DEVELOPERD3",
    width / 2,
    height - 34,
    11,
    "#e8c66d",
    "center"
  );
}

function drawAdminPlayerList(): void {
  if (adminPlayersLoading) {
    drawText(
      "Loading player accounts...",
      width / 2,
      height / 2,
      15,
      "#e8c66d",
      "center"
    );
    return;
  }

  if (adminPlayersError) {
    drawText(
      "Unable to load player accounts",
      width / 2,
      height / 2 - 50,
      15,
      "#ff7777",
      "center"
    );

    drawText(
      adminPlayersError.slice(0, 42),
      width / 2,
      height / 2 - 20,
      11,
      "#ffffff",
      "center"
    );

    addButton(
      "RETRY",
      height / 2 + 20,
      () => {
        void loadAdminPlayers();
      }
    );

    return;
  }

  if (!adminPlayersLoaded) {
    drawText(
      "Select REFRESH to load accounts.",
      width / 2,
      height / 2,
      13,
      "#ffffff",
      "center"
    );
    return;
  }

  if (adminPlayers.length === 0) {
    drawText(
      "No player accounts found.",
      width / 2,
      height / 2,
      15,
      "#ffffff",
      "center"
    );
    return;
  }

  const totalPages = Math.ceil(
    adminPlayers.length /
    ADMIN_PLAYERS_PER_PAGE
  );

  adminPlayersPage = Math.max(
    0,
    Math.min(
      adminPlayersPage,
      totalPages - 1
    )
  );

  const startIndex =
    adminPlayersPage *
    ADMIN_PLAYERS_PER_PAGE;

  const visiblePlayers = adminPlayers.slice(
    startIndex,
    startIndex + ADMIN_PLAYERS_PER_PAGE
  );

  const compact = height < 740;
  const rowHeight = compact ? 70 : 82;
  const startY = compact ? 155 : 170;

  visiblePlayers.forEach((account, index) => {
    const y = startY + index * rowHeight;

    ctx.fillStyle = "#151b15";
    ctx.fillRect(
      15,
      y,
      width - 30,
      rowHeight - 8
    );

    ctx.strokeStyle = "#a78439";
    ctx.lineWidth = 1;

    ctx.strokeRect(
      15,
      y,
      width - 30,
      rowHeight - 8
    );

    drawText(
      account.username,
      26,
      y + 20,
      15,
      "#e8c66d"
    );

    drawText(
      `Coins: ${(account.coins ?? 0).toLocaleString()}`,
      26,
      y + 39,
      12,
      "#ffffff"
    );

    drawText(
      account.is_disabled
        ? "LOCKED"
        : "ACTIVE",
      width - 26,
      y + 20,
      12,
      account.is_disabled
        ? "#ff7777"
        : "#8ee29a",
      "right"
    );

    drawText(
      account.is_admin
        ? "ADMIN"
        : "PLAYER",
      width - 26,
      y + 39,
      11,
      "#bbbbbb",
      "right"
    );

    if (
      account.campaign_level !== undefined &&
      account.campaign_level !== null
    ) {
      drawText(
        `Campaign: ${account.campaign_level}`,
        26,
        y + 57,
        11,
        "#a5c9a5"
      );
    }
  });

  const pageY = Math.min(
    height - 195,
    startY +
      ADMIN_PLAYERS_PER_PAGE * rowHeight + 8
  );

  drawText(
    `PAGE ${adminPlayersPage + 1} / ${totalPages}`,
    width / 2,
    pageY,
    12,
    "#e8c66d",
    "center"
  );

  if (adminPlayersPage > 0) {
    addButton(
      "PREVIOUS PAGE",
      pageY + 10,
      () => {
        adminPlayersPage--;
      }
    );
  }

  if (adminPlayersPage < totalPages - 1) {
    addButton(
      "NEXT PAGE",
      pageY + 60,
      () => {
        adminPlayersPage++;
      }
    );
  }
}

async function grantAdminCoins(
  account: AdminPlayer,
  amount: number
): Promise<void> {
  if (!isAdministrator() || coinGrantPending) {
    return;
  }

  if (
    !Number.isSafeInteger(amount) ||
    amount < 1 ||
    amount > 1000000
  ) {
    coinGrantError =
      "Enter a whole number from 1 to 1,000,000.";
    return;
  }

  if (
    !window.confirm(
      `Add ${amount.toLocaleString()} coins to ${account.username}?`
    )
  ) {
    return;
  }

  const owner = activeSaveOwner;

  coinGrantPending = true;
  coinGrantMessage = "";
  coinGrantError = "";

  try {
    const {
      data: sessionData,
      error: sessionError
    } = await supabase.auth.getSession();

    if (sessionError) {
      throw sessionError;
    }

    const token =
      sessionData.session?.access_token;

    if (!token) {
      throw new Error(
        "Administrator session expired. Log in again."
      );
    }

    const {
      data,
      error
    } = await supabase.functions.invoke(
      "apex-admin",
      {
        body: {
          action: "add_coins",
          player_id: account.id,
          amount
        },
        headers: {
          Authorization: `Bearer ${token}`
        }
      }
    );

    if (error) {
      throw error;
    }

    if (!data?.success) {
      throw new Error(
        String(
          data?.error ||
          "Coin grant was not confirmed."
        )
      );
    }

    if (
      !isAdministrator() ||
      activeSaveOwner !== owner
    ) {
      return;
    }

    const balance = Number(data.new_balance);

    if (
      !Number.isSafeInteger(balance) ||
      balance < 0
    ) {
      throw new Error(
        "Grant completed, but the new balance was not readable. Refresh accounts."
      );
    }

    const target = adminPlayers.find(
      player => player.id === account.id
    );

    if (target) {
      target.coins = balance;
    }

    coinGrantMessage =
      `Granted ${amount.toLocaleString()} coins to ${account.username}.`;

    // Refresh this admin's own wallet if applicable.
    if (account.id === owner) {
      void loadPlayerWallet();
    }
  } catch (error) {
    if (
      isAdministrator() &&
      activeSaveOwner === owner
    ) {
      coinGrantError =
        error instanceof Error
          ? error.message
          : "Coin grant failed.";
    }
  } finally {
    coinGrantPending = false;
  }
}

function promptAdminCoinGrant(
  account: AdminPlayer,
  preset?: number
): void {
  if (!isAdministrator() || coinGrantPending) {
    return;
  }

  let amount = preset;

  if (amount === undefined) {
    const value = window.prompt(
      `Coins to add to ${account.username} (1–1,000,000):`,
      "1000"
    );

    if (value === null) {
      return;
    }

    if (!/^\d+$/.test(value.trim())) {
      coinGrantError =
        "Enter a whole number from 1 to 1,000,000.";
      return;
    }

    amount = Number(value.trim());
  }

  void grantAdminCoins(account, amount);
}

function drawAdminCoins(): void {
  drawText(
    "SELECT PLAYER / GRANT COINS",
    width / 2,
    110,
    13,
    "#a5c9a5",
    "center"
  );

  if (adminPlayersLoading) {
    drawText(
      "Loading players...",
      width / 2,
      170,
      15,
      "#e8c66d",
      "center"
    );
  } else if (adminPlayersError) {
    drawText(
      "Unable to load players",
      width / 2,
      170,
      15,
      "#ff7777",
      "center"
    );

    addButton(
      "RETRY",
      195,
      () => void loadAdminPlayers()
    );
  } else if (!adminPlayersLoaded) {
    drawText(
      "Refresh to load accounts",
      width / 2,
      170,
      14,
      "#ffffff",
      "center"
    );
  } else {
    const selected = adminPlayers.find(
      player => player.id === coinSelectedPlayerId
    );

    if (!selected) {
      const pages = Math.max(
        1,
        Math.ceil(adminPlayers.length / 4)
      );

      adminPlayersPage = Math.min(
        adminPlayersPage,
        pages - 1
      );

      adminPlayers
        .slice(
          adminPlayersPage * 4,
          adminPlayersPage * 4 + 4
        )
        .forEach((account, index) => {
          addButton(
            `${account.username.slice(0, 19)} (${account.coins.toLocaleString()} coins)`,
            155 + index * 57,
            () => {
              coinSelectedPlayerId = account.id;
              coinGrantMessage = "";
              coinGrantError = "";
            }
          );
        });

      drawText(
        `PAGE ${adminPlayersPage + 1} / ${pages}`,
        width / 2,
        405,
        12,
        "#e8c66d",
        "center"
      );

      if (adminPlayersPage > 0) {
        addButton(
          "PREVIOUS",
          420,
          () => {
            adminPlayersPage--;
          }
        );
      }

      if (adminPlayersPage < pages - 1) {
        addButton(
          "NEXT",
          475,
          () => {
            adminPlayersPage++;
          }
        );
      }
    } else {
      drawText(
        selected.username.slice(0, 26),
        width / 2,
        155,
        19,
        "#e8c66d",
        "center"
      );

      drawText(
        `SUPABASE BALANCE: ${selected.coins.toLocaleString()}`,
        width / 2,
        188,
        14,
        "#ffffff",
        "center"
      );

      drawText(
        coinGrantPending
          ? "PROCESSING - DO NOT RETRY"
          : "CHOOSE AMOUNT",
        width / 2,
        223,
        12,
        "#a5c9a5",
        "center"
      );

      if (!coinGrantPending) {
        addButton(
          "+100 COINS",
          242,
          () => promptAdminCoinGrant(selected, 100)
        );

        addButton(
          "+1,000 COINS",
          295,
          () => promptAdminCoinGrant(selected, 1000)
        );

        addButton(
          "+10,000 COINS",
          348,
          () => promptAdminCoinGrant(selected, 10000)
        );

        addButton(
          "CUSTOM AMOUNT",
          401,
          () => promptAdminCoinGrant(selected)
        );

        addButton(
          "CHANGE PLAYER",
          454,
          () => {
            coinSelectedPlayerId = null;
            coinGrantMessage = "";
            coinGrantError = "";
          }
        );
      }
    }
  }

  if (coinGrantMessage) {
    drawText(
      coinGrantMessage.slice(0, 44),
      width / 2,
      height - 213,
      11,
      "#8ee29a",
      "center"
    );
  }

  if (coinGrantError) {
    drawText(
      coinGrantError.slice(0, 44),
      width / 2,
      height - 213,
      11,
      "#ff7777",
      "center"
    );
  }

  addButton(
    "REFRESH BALANCES",
    height - 150,
    () => {
      if (!coinGrantPending) {
        void loadAdminPlayers();
      }
    }
  );

  addButton(
    "BACK TO ADMIN MENU",
    height - 90,
    () => {
      if (!coinGrantPending) {
        adminSection = "home";
      }
    }
  );
}

function drawAdminDashboard(): void {
  if (!isAdministrator()) {
    gameScreen = "menu";
    clearAdminPlayerData();
    return;
  }

  drawPanel("APEX ADMIN DASHBOARD");

  if (adminSection === "home") {
    drawText(
      "ADMINISTRATOR CONTROL CENTER",
      width / 2,
      115,
      14,
      "#ffffff",
      "center"
    );

    const startY = Math.max(
      145,
      height / 2 - 160
    );

    const sections: {
      title: string;
      section: AdminSection;
    }[] = [
      {
        title: "PLAYER ACCOUNTS",
        section: "players"
      },
      {
        title: "COIN MANAGEMENT",
        section: "coins"
      },
      {
        title: "LOCK / UNLOCK",
        section: "locks"
      },
      {
        title: "ACCOUNT MANAGEMENT",
        section: "accounts"
      },
      {
        title: "ADMIN ACTION HISTORY",
        section: "history"
      }
    ];

    sections.forEach((item, index) => {
      addButton(
        item.title,
        startY + index * 54,
        () => openAdminSection(item.section)
      );
    });

    addButton(
      "RETURN TO GAME",
      Math.min(height - 100, startY + 285),
      closeAdminDashboard
    );

    return;
  }

  if (adminSection === "players") {
    drawText(
      "LIVE SUPABASE PLAYER DIRECTORY",
      width / 2,
      110,
      13,
      "#a5c9a5",
      "center"
    );

    drawAdminPlayerList();

    addButton(
      "REFRESH ACCOUNTS",
      height - 150,
      () => {
        void loadAdminPlayers();
      }
    );

    addButton(
      "BACK TO ADMIN MENU",
      height - 90,
      () => {
        adminSection = "home";
      }
    );

    return;
  }

  if (adminSection === "coins") {
    drawAdminCoins();
    return;
  }

  const labels: Record<
    Exclude<AdminSection, "home" | "players">,
    string
  > = {
    coins: "COIN MANAGEMENT",
    locks: "LOCK / UNLOCK ACCOUNTS",
    accounts: "ACCOUNT MANAGEMENT",
    history: "ADMIN ACTION HISTORY"
  };

  drawText(
    labels[adminSection],
    width / 2,
    height / 2 - 45,
    19,
    "#e8c66d",
    "center"
  );

  drawText(
    "Section integration coming next.",
    width / 2,
    height / 2,
    13,
    "#ffffff",
    "center"
  );

  addButton(
    "BACK TO ADMIN MENU",
    height - 100,
    () => {
      adminSection = "home";
    }
  );
}

function drawShop(): void {
  drawPanel("UPGRADE SHOP");

  drawText(
    walletReady
      ? `AVAILABLE COINS: ${save.coins.toLocaleString()}`
      : "WALLET: NOT SYNCHRONIZED",
    width / 2,
    105,
    16,
    walletReady ? "#e8c66d" : "#ff9999",
    "center"
  );

  drawText(
    "PURCHASES TEMPORARILY DISABLED",
    width / 2,
    130,
    11,
    "#ff9999",
    "center"
  );

  const startY = Math.max(
    155,
    height / 2 - 145
  );

  upgradeInfo.forEach((item, index) => {
    const level = save.upgrades[item.key];
    const price = upgradePrice(item.key);

    const label =
      level >= item.max
        ? `${item.name} - MAX LEVEL`
        : `${item.name} LV ${level} - ${price} COINS`;

    addButton(
      label,
      startY + index * 54,
      () => buyUpgrade(item.key)
    );
  });

  addButton(
    "BACK",
    height - 95,
    () => {
      gameScreen = shopReturn;
    }
  );
}

function drawGame(): void {
  drawBackground();

  for (const zombie of zombies) {
    drawZombie(zombie);
  }

  for (const bullet of bullets) {
    ctx.fillStyle = "#ffe6a0";

    ctx.beginPath();
    ctx.arc(
      bullet.x,
      bullet.y,
      4,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }

  drawPlayer();

  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.fillRect(10, 10, 195, 90);

  drawText(
    `HP: ${Math.ceil(player.hp)} / ${player.maxHp}`,
    20,
    32,
    14,
    "#ffffff"
  );

  drawText(
    `KILLS: ${kills}`,
    20,
    54,
    14,
    "#e8c66d"
  );

  drawText(
    `RUN COINS: ${runCoins}`,
    20,
    76,
    14,
    "#e8c66d"
  );

  drawText(
    gameMode === "campaign"
      ? `LEVEL ${save.campaignLevel}: ${waveKills}/${targetKills}`
      : `ENDLESS WAVE ${difficulty}`,
    width / 2,
    32,
    14,
    "#ffffff",
    "center"
  );

  const pause = pauseButtonBounds();

  ctx.fillStyle = "#a78439";
  ctx.fillRect(
    pause.x,
    pause.y,
    pause.w,
    pause.h
  );

  drawText(
    "II",
    pause.x + pause.w / 2,
    pause.y + 28,
    20,
    "#101510",
    "center"
  );

  drawJoystick();

  if (waveBreak > 0) {
    drawText(
      `NEXT WAVE IN ${Math.ceil(waveBreak)}`,
      width / 2,
      height / 2,
      22,
      "#e8c66d",
      "center"
    );
  }
}

function drawPaused(): void {
  drawPanel("GAME PAUSED");

  drawText(
    `KILLS: ${kills}`,
    width / 2,
    height / 2 - 95,
    18,
    "#ffffff",
    "center"
  );

  drawText(
    `RUN COINS: ${runCoins}`,
    width / 2,
    height / 2 - 65,
    16,
    "#e8c66d",
    "center"
  );

  addButton(
    "RESUME GAME",
    height / 2 - 25,
    resumeGame
  );

  addButton(
    "RESTART RUN",
    height / 2 + 35,
    () => startGame(gameMode)
  );

  addButton(
    "EXIT TO MENU",
    height / 2 + 95,
    () => {
      gameScreen = "confirmExit";
    }
  );
}

function drawConfirmExit(): void {
  drawPanel("EXIT CURRENT RUN?");

  drawText(
    "Unbanked run coins will be lost.",
    width / 2,
    height / 2 - 70,
    14,
    "#ff9999",
    "center"
  );

  addButton(
    "CANCEL",
    height / 2 - 15,
    () => {
      gameScreen = "paused";
    }
  );

  addButton(
    "EXIT WITHOUT SAVING",
    height / 2 + 45,
    abandonRun
  );
}

function drawComplete(): void {
  drawPanel("LEVEL COMPLETED");

  drawText(
    `LEVEL ${save.campaignLevel - 1} CLEARED`,
    width / 2,
    height / 2 - 115,
    19,
    "#a5e8a5",
    "center"
  );

  drawText(
    `KILLS: ${kills}`,
    width / 2,
    height / 2 - 80,
    16,
    "#ffffff",
    "center"
  );

  drawText(
    `RUN REWARD (NOT BANKED): ${runCoins}`,
    width / 2,
    height / 2 - 50,
    14,
    "#e8c66d",
    "center"
  );

  if (noDamage) {
    drawText(
      "PERFECT LEVEL BONUS!",
      width / 2,
      height / 2 - 20,
      14,
      "#a5e8a5",
      "center"
    );
  }

  addButton(
    "NEXT LEVEL",
    height / 2 + 25,
    () => startGame("campaign")
  );

  addButton(
    "UPGRADE SHOP",
    height / 2 + 85,
    () => {
      shopReturn = "complete";
      gameScreen = "shop";
    }
  );

  addButton(
    "MAIN MENU",
    height / 2 + 145,
    () => {
      gameScreen = "menu";
    }
  );
}

function drawGameOver(): void {
  drawPanel("GAME OVER");

  drawText(
    `TOTAL KILLS: ${kills}`,
    width / 2,
    height / 2 - 100,
    18,
    "#ffffff",
    "center"
  );

  drawText(
    `RUN COINS (NOT BANKED): ${runCoins}`,
    width / 2,
    height / 2 - 65,
    14,
    "#e8c66d",
    "center"
  );

  drawText(
    walletReady
      ? `WALLET BALANCE: ${save.coins.toLocaleString()}`
      : "WALLET NOT SYNCHRONIZED",
    width / 2,
    height / 2 - 35,
    15,
    "#ffffff",
    "center"
  );

  addButton(
    "TRY AGAIN",
    height / 2 + 15,
    () => startGame(gameMode)
  );

  addButton(
    "MAIN MENU",
    height / 2 + 75,
    () => {
      gameScreen = "menu";
    }
  );
}

function showError(error: unknown): void {
  const message =
    error instanceof Error
      ? error.message
      : String(error);

  console.error(
    "APEX Zombie Survival:",
    message
  );

  window.alert(message);
}

function render(): void {
  buttons = [];

  ctx.clearRect(0, 0, width, height);

  if (gameScreen === "playing") {
    drawGame();
    return;
  }

  if (gameScreen === "menu") {
    drawMenu();
    return;
  }

  if (gameScreen === "admin") {
    drawAdminDashboard();
    return;
  }

  if (gameScreen === "shop") {
    drawShop();
    return;
  }

  if (gameScreen === "paused") {
    drawPaused();
    return;
  }

  if (gameScreen === "confirmExit") {
    drawConfirmExit();
    return;
  }

  if (gameScreen === "complete") {
    drawComplete();
    return;
  }

  if (gameScreen === "gameover") {
    drawGameOver();
  }
}

function frame(timestamp: number): void {
  if (lastTime === 0) {
    lastTime = timestamp;
  }

  const dt = Math.min(
    (timestamp - lastTime) / 1000,
    0.05
  );

  lastTime = timestamp;

  if (gameScreen === "playing") {
    update(dt);
  }

  render();

  requestAnimationFrame(frame);
}

onProfileChange(profile => {
  if (!profile || profile.is_disabled) {
    invalidateWallet();

    activeSaveOwner = null;
    save = defaultSave();

    clearAdminPlayerData();
    adminSection = "home";

    gameScreen = "menu";
    resetJoystick();

    return;
  }

  if (activeSaveOwner !== profile.id) {
    clearAdminPlayerData();
    adminSection = "home";

    gameScreen = "menu";
    resetJoystick();

    activatePlayerSave(profile);
  }

  if (
    !profile.is_admin &&
    gameScreen === "admin"
  ) {
    gameScreen = "menu";
    clearAdminPlayerData();
  }
});

async function initializeGame(): Promise<void> {
  try {
    await initializeAuth();

    startAccountLockMonitor();

    const profile = currentPlayer();

    if (profile && !profile.is_disabled) {
      activatePlayerSave(profile);
    }

    requestAnimationFrame(frame);
  } catch (error) {
    showError(error);
  }
}

void initializeGame();
