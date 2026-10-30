
import {
  initializeAuth,
  onProfileChange,
  currentPlayer,
  signOutPlayer,
  startAccountLockMonitor
} from "./auth-ui";

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

type GameButton = {
  x: number;
  y: number;
  w: number;
  h: number;
  action: () => void;
};

type AdminSection =
  | "home"
  | "players"
  | "coins"
  | "locks"
  | "accounts"
  | "history";

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
  { key: "health", name: "Health +20", price: 100, max: 10 },
  { key: "armor", name: "Armor +1", price: 150, max: 8 },
  { key: "stamina", name: "Speed +10%", price: 125, max: 8 },
  { key: "damage", name: "Damage +1", price: 200, max: 10 },
  { key: "fireRate", name: "Fire Rate", price: 250, max: 8 }
];

// DEFAULT PLAYER PROGRESS

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

// VALIDATE STORED PLAYER PROGRESS

function parseSave(raw: string | null): SaveData {
  const defaults = defaultSave();

  if (!raw) return defaults;

  try {
    const data: unknown = JSON.parse(raw);

    if (!data || typeof data !== "object") {
      return defaults;
    }

    const record = data as Record<string, unknown>;

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

    const upgrades = { ...defaults.upgrades };

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
      bestEndless: number(record.bestEndless, 0),
      upgrades
    };
  } catch {
    return defaults;
  }
}

// ACTIVE ACCOUNT DATA

let save = defaultSave();
let activeSaveOwner: string | null = null;

// ADMINISTRATOR DASHBOARD STATE

let adminSection: AdminSection = "home";

function isAdministrator(): boolean {
  const profile = currentPlayer();

  return Boolean(
    profile &&
    profile.is_admin &&
    !profile.is_disabled &&
    activeSaveOwner === profile.id
  );
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

// ACCOUNT-SPECIFIC STORAGE

function playerSaveKey(playerId: string): string {
  return `${ACCOUNT_SAVE_PREFIX}${playerId}`;
}

function activatePlayerSave(profile: {
  id: string;
  is_admin: boolean;
}): void {
  if (activeSaveOwner === profile.id) return;

  activeSaveOwner = null;
  save = defaultSave();

  try {
    const key = playerSaveKey(profile.id);
    const existing = localStorage.getItem(key);

    if (existing !== null) {
      save = parseSave(existing);
      activeSaveOwner = profile.id;
      return;
    }

    const legacy = localStorage.getItem(SAVE_KEY);

    if (
      legacy !== null &&
      localStorage.getItem(LEGACY_BACKUP_KEY) === null
    ) {
      localStorage.setItem(
        LEGACY_BACKUP_KEY,
        legacy
      );
    }

    const legacyOwner =
      localStorage.getItem(LEGACY_OWNER_KEY);

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

    activeSaveOwner = profile.id;
  } catch (error) {
    activeSaveOwner = null;
    save = defaultSave();

    console.error(
      "Unable to initialize account save",
      error
    );

    showError(
      "Account save could not be initialized. Storage may be full or disabled."
    );
  }
}

// SAVE PROGRESS

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
    console.warn("Unable to save", error);
  }
}

// CANVAS SETUP

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
  "position:fixed;inset:0;width:100vw;" +
  "height:100dvh;display:block;" +
  "touch-action:none;z-index:10";

document.body.appendChild(canvas);

// REMOVE OLD LOADING ELEMENTS

for (const selector of [
  "#loading",
  "#loader",
  "#loading-screen",
  ".loading",
  ".loading-screen",
  ".loader"
]) {
  document.querySelectorAll(selector).forEach(el => {
    el.remove();
  });
}

document.querySelectorAll(
  "body > div,body > p,body > h1,body > h2"
).forEach(el => {
  if (
    el.textContent?.trim() ===
    "Loading APEX Zombie Survival..."
  ) {
    el.remove();
  }
});

// GAME VARIABLES

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

// UPGRADE ATTRIBUTES

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
    u => u.key === key
  )!;

  return Math.floor(
    item.price * Math.pow(
      1.5,
      save.upgrades[key]
    )
  );
}

function buyUpgrade(key: UpgradeKey): void {
  if (
    !currentPlayer() ||
    activeSaveOwner !== currentPlayer()?.id
  ) {
    return;
  }

  const item = upgradeInfo.find(
    u => u.key === key
  )!;

  const price = upgradePrice(key);

  if (save.upgrades[key] >= item.max) return;
  if (save.coins < price) return;

  save.coins -= price;
  save.upgrades[key]++;

  persist();
}

// SCREEN RESIZING

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

  ctx.setTransform(
    ratio,
    0,
    0,
    ratio,
    0,
    0
  );

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

// JOYSTICK

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
    JOYSTICK_RADIUS / Math.max(
      1,
      distance
    )
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

// PAUSE SYSTEM

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

// KEYBOARD CONTROLS

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
  keys.delete(
    event.key.toLowerCase()
  );
});

window.addEventListener("blur", () => {
  keys.clear();
  resetJoystick();

  if (gameScreen === "playing") {
    pauseGame();
  }
});


// ==========================================
// APEX ZOMBIE SURVIVAL
// ==========================================

// TOUCH CONTROLS

canvas.addEventListener("pointerdown", event => {
  if (
    !currentPlayer() ||
    activeSaveOwner !== currentPlayer()?.id
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

      canvas.setPointerCapture(
        event.pointerId
      );
    }

    return;
  }

  const button = [...buttons]
    .reverse()
    .find(b =>
      event.clientX >= b.x &&
      event.clientX <= b.x + b.w &&
      event.clientY >= b.y &&
      event.clientY <= b.y + b.h
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
  if (
    event.pointerId === joystick.pointerId
  ) {
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

// ==========================================
// START GAME
// ==========================================

function startGame(mode: GameMode): void {
  if (
    !currentPlayer() ||
    activeSaveOwner !== currentPlayer()?.id
  ) {
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

// ==========================================
// COIN REWARD SYSTEM
// ==========================================

function awardCoins(amount: number): void {
  if (
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    return;
  }

  runCoins += Math.floor(amount);
}

function bankRunCoins(): void {
  if (
    !currentPlayer() ||
    activeSaveOwner !== currentPlayer()?.id
  ) {
    return;
  }

  save.coins += runCoins;

  persist();
}

// ==========================================
// CAMPAIGN LEVEL COMPLETION
// ==========================================

function finishCampaign(): void {
  const bonus = noDamage
    ? difficulty * 50
    : 0;

  levelReward =
    difficulty * 25 + bonus;

  awardCoins(levelReward);

  bankRunCoins();

  save.campaignLevel++;

  persist();

  gameScreen = "complete";

  resetJoystick();
}

// ==========================================
// GAME OVER
// ==========================================

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

// ==========================================
// ZOMBIE SPAWNING
// ==========================================

function spawnZombie(): void {
  const side = Math.floor(
    Math.random() * 4
  );

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
    Math.min(
      0.45,
      0.1 + difficulty * 0.02
    )
      ? 1
      : 0;

  const hp =
    1 +
    Math.floor(difficulty / 3) +
    kind;

  zombies.push({
    x,
    y,
    hp,
    maxHp: hp,
    speed:
      45 +
      difficulty * 5 -
      kind * 8,
    radius: kind ? 17 : 13,
    kind,
    phase:
      Math.random() *
      Math.PI *
      2
  });
}

// ==========================================
// GAMEPLAY UPDATE
// ==========================================

function update(dt: number): void {
  if (
    !currentPlayer() ||
    activeSaveOwner !== currentPlayer()?.id
  ) {
    return;
  }

  if (gameScreen !== "playing") {
    return;
  }

  // SURVIVAL WAVE BREAK

  if (waveBreak > 0) {
    waveBreak = Math.max(
      0,
      waveBreak - dt
    );

    if (waveBreak === 0) {
      difficulty++;
      waveTime = 0;
      spawnTimer = 0;
    }

    return;
  }

  elapsed += dt;

  // ========================================
  // ENDLESS SURVIVAL PROGRESSION
  // ========================================

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

  // ========================================
  // PLAYER MOVEMENT
  // ========================================

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

  const length = Math.hypot(
    dx,
    dy
  );

  if (length > 0) {
    const strength = Math.min(
      1,
      length
    );

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
    Math.min(
      width - player.radius,
      player.x
    )
  );

  player.y = Math.max(
    player.radius,
    Math.min(
      height - player.radius,
      player.y
    )
  );

  // ========================================
  // ZOMBIE SPAWNING TIMER
  // ========================================

  spawnTimer -= dt;

  if (spawnTimer <= 0) {
    spawnZombie();

    spawnTimer = Math.max(
      0.25,
      1.5 - difficulty * 0.075
    );
  }

  // ========================================
  // AUTOMATIC SHOOTING
  // ========================================

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

      if (
        distance < bestDistance
      ) {
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
        x:
          player.x +
          Math.cos(angle) * 19,

        y:
          player.y +
          Math.sin(angle) * 19,

        vx:
          Math.cos(angle) * 430,

        vy:
          Math.sin(angle) * 430,

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

  // ========================================
  // ZOMBIE MOVEMENT AND DAMAGE
  // ========================================

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
      Math.cos(angle) *
      zombie.speed *
      dt;

    zombie.y +=
      Math.sin(angle) *
      zombie.speed *
      dt;

    const distance = Math.hypot(
      zombie.x - player.x,
      zombie.y - player.y
    );

    if (
      distance <
        zombie.radius +
        player.radius &&
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

  // ========================================
  // BULLET MOVEMENT AND COLLISIONS
  // ========================================

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

      if (
        distance <
        zombie.radius + 4
      ) {
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

  // REMOVE DEFEATED ZOMBIES

  for (
    let i = zombies.length - 1;
    i >= 0;
    i--
  ) {
    if (zombies[i].hp <= 0) {
      zombies.splice(i, 1);
    }
  }

  // REMOVE EXPIRED BULLETS

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

  // ========================================
  // CAMPAIGN LEVEL COMPLETION
  // ========================================

  if (
    gameMode === "campaign" &&
    waveKills >= targetKills
  ) {
    finishCampaign();
  }
}

// ==========================================
// 
// ==========================================

// ==========================================
// APEX ZOMBIE SURVIVAL
// ==========================================

// DRAWING HELPERS

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

// ==========================================
// PLAYER GRAPHICS
// ==========================================

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

// ==========================================
// ZOMBIE GRAPHICS
// ==========================================

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

// ==========================================
// JOYSTICK GRAPHICS
// ==========================================

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

// ==========================================
// BUTTON DRAWING
// ==========================================

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

// ==========================================
// MAIN MENU
// ==========================================

function drawMenu(): void {
  drawPanel("APEX ZOMBIE SURVIVAL");

  drawText(
    `Wallet: ${save.coins} coins`,
    width / 2,
    110,
    17,
    "#ffffff",
    "center"
  );

  drawText(
    `Campaign Level: ${save.campaignLevel}`,
    width / 2,
    145,
    15,
    "#a5c9a5",
    "center"
  );

  drawText(
    `Best Endless Kills: ${save.bestEndless}`,
    width / 2,
    172,
    15,
    "#a5c9a5",
    "center"
  );

  const profile = currentPlayer();
  const admin = isAdministrator();

  const startY = Math.max(
    190,
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

// ==========================================
// ADMINISTRATOR DASHBOARD
// ==========================================

function drawAdminDashboard(): void {
  if (!isAdministrator()) {
    gameScreen = "menu";
    return;
  }

  drawPanel("APEX ADMIN DASHBOARD");

  const profile = currentPlayer();

  drawText(
    `Administrator: ${profile?.username ?? ""}`,
    width / 2,
    105,
    14,
    "#8ee29a",
    "center"
  );

  if (adminSection === "home") {
    drawText(
      "ACCOUNT MANAGEMENT",
      width / 2,
      145,
      15,
      "#e8c66d",
      "center"
    );

    const startY = Math.max(
      170,
      height / 2 - 145
    );

    const sections: {
      label: string;
      section: AdminSection;
    }[] = [
      {
        label: "PLAYER ACCOUNTS",
        section: "players"
      },
      {
        label: "GRANT PLAYER COINS",
        section: "coins"
      },
      {
        label: "LOCK / UNLOCK ACCOUNTS",
        section: "locks"
      },
      {
        label: "EDIT PLAYER ACCOUNTS",
        section: "accounts"
      },
      {
        label: "ADMIN ACTION HISTORY",
        section: "history"
      }
    ];

    sections.forEach((item, index) => {
      addButton(
        item.label,
        startY + index * 54,
        () => {
          if (isAdministrator()) {
            adminSection = item.section;
          }
        }
      );
    });

    addButton(
      "RETURN TO MAIN MENU",
      Math.min(
        height - 75,
        startY + sections.length * 54 + 12
      ),
      closeAdminDashboard
    );

    return;
  }

  const titles: Record<
    Exclude<AdminSection, "home">,
    string
  > = {
    players: "PLAYER ACCOUNTS",
    coins: "GRANT PLAYER COINS",
    locks: "ACCOUNT ACCESS CONTROL",
    accounts: "EDIT PLAYER ACCOUNTS",
    history: "ADMIN ACTION HISTORY"
  };

  drawText(
    titles[adminSection],
    width / 2,
    155,
    17,
    "#ffffff",
    "center"
  );

  drawText(
    "Backend integration pending",
    width / 2,
    height / 2 - 25,
    15,
    "#e8c66d",
    "center"
  );

  drawText(
    "No account changes are enabled yet.",
    width / 2,
    height / 2 + 5,
    12,
    "#b7b7b7",
    "center"
  );

  addButton(
    "BACK TO ADMIN MENU",
    Math.min(height - 85, height / 2 + 65),
    () => {
      adminSection = "home";
    }
  );
}

// ==========================================
// UPGRADE SHOP
// ==========================================

function drawShop(): void {
  drawPanel("SURVIVOR UPGRADE SHOP");

  drawText(
    `Available Coins: ${save.coins}`,
    width / 2,
    105,
    17,
    "#ffffff",
    "center"
  );

  const compact = height < 700;
  const gap = compact ? 52 : 65;
  const startY = compact ? 130 : 155;

  upgradeInfo.forEach((item, index) => {
    const rank = save.upgrades[item.key];
    const price = upgradePrice(item.key);

    const label =
      rank >= item.max
        ? `${item.name} | MAX`
        : `${item.name} Lv.${rank} | ${price} coins`;

    addButton(
      label,
      startY + index * gap,
      () => buyUpgrade(item.key)
    );
  });

  addButton(
    "BACK",
    Math.min(
      height - 65,
      startY + upgradeInfo.length * gap + 5
    ),
    () => {
      gameScreen = shopReturn;
    }
  );
}

// ==========================================
// 
// ==========================================

// ==========================================
// APEX ZOMBIE SURVIVAL
// ==========================================

// CAMPAIGN COMPLETION SCREEN

function drawComplete(): void {
  drawPanel("LEVEL COMPLETED!");

  drawText(
    `Campaign Level ${save.campaignLevel - 1}`,
    width / 2,
    120,
    19,
    "#ffffff",
    "center"
  );

  drawText(
    noDamage
      ? "PERFECT RUN BONUS!"
      : "LEVEL CLEARED",
    width / 2,
    160,
    18,
    "#8ee29a",
    "center"
  );

  drawText(
    `Completion Reward: ${levelReward}`,
    width / 2,
    200,
    16,
    "#e8c66d",
    "center"
  );

  drawText(
    `Total Earned: ${runCoins}`,
    width / 2,
    235,
    16,
    "#ffffff",
    "center"
  );

  const startY = Math.max(
    270,
    height / 2
  );

  addButton(
    "NEXT LEVEL",
    startY,
    () => startGame("campaign")
  );

  addButton(
    "UPGRADE SHOP",
    startY + 60,
    () => {
      shopReturn = "complete";
      gameScreen = "shop";
    }
  );

  addButton(
    "MAIN MENU",
    startY + 120,
    () => {
      gameScreen = "menu";
    }
  );
}

// ==========================================
// GAME OVER SCREEN
// ==========================================

function drawGameOver(): void {
  drawPanel("GAME OVER");

  drawText(
    gameMode === "endless"
      ? "ENDLESS SURVIVAL"
      : "CAMPAIGN FAILED",
    width / 2,
    125,
    19,
    "#ff7777",
    "center"
  );

  drawText(
    `Zombies Killed: ${kills}`,
    width / 2,
    170,
    17,
    "#ffffff",
    "center"
  );

  drawText(
    `Coins Earned: ${runCoins}`,
    width / 2,
    205,
    17,
    "#e8c66d",
    "center"
  );

  if (gameMode === "endless") {
    drawText(
      `Best Record: ${save.bestEndless}`,
      width / 2,
      240,
      16,
      "#ffffff",
      "center"
    );
  }

  const startY = Math.max(
    270,
    height / 2
  );

  addButton(
    "RETRY",
    startY,
    () => startGame(gameMode)
  );

  addButton(
    "MAIN MENU",
    startY + 60,
    () => {
      gameScreen = "menu";
    }
  );
}

// ==========================================
// PAUSE MENU
// ==========================================

function drawPaused(): void {
  drawGame();

  ctx.fillStyle = "rgba(0,0,0,0.84)";
  ctx.fillRect(0, 0, width, height);

  drawText(
    "GAME PAUSED",
    width / 2,
    height / 2 - 115,
    26,
    "#e8c66d",
    "center"
  );

  drawText(
    `Pending Coins: ${runCoins}`,
    width / 2,
    height / 2 - 75,
    15,
    "#ffffff",
    "center"
  );

  addButton(
    "RESUME GAME",
    height / 2 - 35,
    resumeGame
  );

  addButton(
    "EXIT TO MAIN MENU",
    height / 2 + 30,
    () => {
      gameScreen = "confirmExit";
    }
  );
}

// ==========================================
// EXIT CONFIRMATION
// ==========================================

function drawConfirmExit(): void {
  drawGame();

  ctx.fillStyle = "rgba(0,0,0,0.92)";
  ctx.fillRect(0, 0, width, height);

  drawText(
    "LEAVE CURRENT GAME?",
    width / 2,
    height / 2 - 125,
    21,
    "#ff8d7c",
    "center"
  );

  drawText(
    "Current run progress and coins",
    width / 2,
    height / 2 - 85,
    14,
    "#ffffff",
    "center"
  );

  drawText(
    "will NOT be saved.",
    width / 2,
    height / 2 - 63,
    14,
    "#ffffff",
    "center"
  );

  drawText(
    `You will lose ${runCoins} pending coins.`,
    width / 2,
    height / 2 - 28,
    14,
    "#e8c66d",
    "center"
  );

  addButton(
    "CANCEL",
    height / 2 + 5,
    () => {
      gameScreen = "paused";
    }
  );

  addButton(
    "EXIT GAME",
    height / 2 + 70,
    abandonRun
  );
}

// ==========================================
// GAMEPLAY DISPLAY
// ==========================================

function drawGame(): void {
  drawBackground();

  for (const zombie of zombies) {
    drawZombie(zombie);
  }

  ctx.fillStyle = "#ffdf74";

  for (const bullet of bullets) {
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

  // HUD BACKGROUND

  ctx.fillStyle = "rgba(8,14,10,0.84)";
  ctx.fillRect(0, 0, width, 115);

  drawText(
    "APEX SURVIVAL",
    15,
    25,
    17,
    "#e8c66d"
  );

  drawText(
    `HP ${player.hp}/${player.maxHp}`,
    15,
    47,
    13
  );

  const barWidth = Math.min(
    width - 30,
    245
  );

  ctx.fillStyle = "#502525";
  ctx.fillRect(
    15,
    57,
    barWidth,
    12
  );

  ctx.fillStyle =
    player.hp > player.maxHp * 0.3
      ? "#65cc77"
      : "#ef6b62";

  ctx.fillRect(
    15,
    57,
    barWidth *
      player.hp /
      player.maxHp,
    12
  );

  drawText(
    `Coins ${save.coins} (+${runCoins}) | Kills ${kills}`,
    15,
    90,
    13
  );

  if (gameMode === "campaign") {
    drawText(
      `LEVEL ${difficulty} | ${waveKills}/${targetKills}`,
      15,
      109,
      13,
      "#e8c66d"
    );
  } else {
    drawText(
      `ENDLESS | WAVE ${difficulty}`,
      15,
      109,
      13,
      "#e8c66d"
    );
  }

  // PAUSE BUTTON

  const pause = pauseButtonBounds();

  ctx.fillStyle = "#a78439";

  ctx.fillRect(
    pause.x,
    pause.y,
    pause.w,
    pause.h
  );

  ctx.fillStyle = "#101510";

  ctx.fillRect(
    pause.x + 14,
    pause.y + 11,
    6,
    20
  );

  ctx.fillRect(
    pause.x + 28,
    pause.y + 11,
    6,
    20
  );

  drawJoystick();

  // ENDLESS WAVE BREAK

  if (waveBreak > 0) {
    ctx.fillStyle = "rgba(0,0,0,0.7)";

    ctx.fillRect(
      0,
      height / 2 - 85,
      width,
      170
    );

    drawText(
      "WAVE BREAK",
      width / 2,
      height / 2 - 25,
      24,
      "#e8c66d",
      "center"
    );

    drawText(
      String(Math.ceil(waveBreak)),
      width / 2,
      height / 2 + 35,
      44,
      "#ffffff",
      "center"
    );
  }
}

// ==========================================
// SCREEN RENDERING
// ==========================================

function draw(): void {
  buttons = [];

  switch (gameScreen) {
    case "playing":
      drawGame();
      break;

    case "paused":
      drawPaused();
      break;

    case "confirmExit":
      drawConfirmExit();
      break;

    case "menu":
      drawMenu();
      break;

    case "shop":
      drawShop();
      break;

    case "complete":
      drawComplete();
      break;

    case "gameover":
      drawGameOver();
      break;

    case "admin":
      drawAdminDashboard();
      break;
  }
}

// ==========================================
// ERROR HANDLING
// ==========================================

function showError(error: unknown): void {
  console.error(
    "APEX Zombie Survival error:",
    error
  );

  const message = document.createElement("pre");

  message.textContent =
    `Game error: ${String(error)}`;

  message.style.cssText =
    "position:fixed;" +
    "top:20px;" +
    "left:10px;" +
    "right:10px;" +
    "padding:15px;" +
    "background:#111;" +
    "color:#ff7777;" +
    "white-space:pre-wrap;" +
    "z-index:9999;";

  document.body.appendChild(message);
}

// ==========================================
// MAIN GAME LOOP
// ==========================================

function frame(time: number): void {
  const dt = Math.min(
    (time - (lastTime || time)) / 1000,
    0.05
  );

  lastTime = time;

  try {
    update(dt);
    draw();
  } catch (error) {
    showError(error);
    return;
  }

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);

// ==========================================
// SUPABASE AUTHENTICATION INTEGRATION
// ==========================================

onProfileChange(profile => {
  const nextPlayerId = profile?.id ?? null;

  if (nextPlayerId === activeSaveOwner) {
    return;
  }

  gameScreen = "menu";
  adminSection = "home";

  resetJoystick();
  keys.clear();

  zombies.length = 0;
  bullets.length = 0;

  runCoins = 0;
  waveKills = 0;
  kills = 0;
  waveBreak = 0;
  waveTime = 0;

  lastTime = 0;

  save = defaultSave();
  activeSaveOwner = null;

  if (!profile) {
    return;
  }

  activatePlayerSave(profile);
});

// ==========================================
// INITIALIZE LOGIN SYSTEM
// ==========================================

void initializeAuth()
  .then(() => {
    startAccountLockMonitor();
  })
  .catch(showError);

// ==========================================
// APEX ZOMBIE SURVIVAL
// ==========================================
