
type Zombie = {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  speed: number;
  radius: number;
  kind: number;
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
  | "shop"
  | "complete"
  | "gameover";

type GameMode = "campaign" | "endless";

type GameButton = {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  action: () => void;
};

const SAVE_KEY = "apex-zombie-survival-v2";

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

function loadSave(): SaveData {
  const defaults = defaultSave();

  try {
    const raw = localStorage.getItem(SAVE_KEY);

    if (!raw) return defaults;

    const saved = JSON.parse(raw);

    const validNumber = (
      value: unknown,
      fallback: number
    ): number => {
      if (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= 0
      ) {
        return Math.floor(value);
      }

      return fallback;
    };

    const upgrades = { ...defaults.upgrades };

    for (const item of upgradeInfo) {
      upgrades[item.key] = Math.min(
        item.max,
        validNumber(saved.upgrades?.[item.key], 0)
      );
    }

    return {
      coins: validNumber(saved.coins, 0),
      campaignLevel: Math.max(
        1,
        validNumber(saved.campaignLevel, 1)
      ),
      bestEndless: validNumber(saved.bestEndless, 0),
      upgrades
    };
  } catch (error) {
    console.warn("Could not load save:", error);
    return defaults;
  }
}

let save: SaveData = loadSave();

function persist(): void {
  try {
    localStorage.setItem(
      SAVE_KEY,
      JSON.stringify(save)
    );
  } catch (error) {
    console.warn("Save failed:", error);
  }
}

const canvas = document.createElement("canvas");
const context = canvas.getContext("2d");

if (!context) {
  throw new Error("Canvas 2D is unavailable");
}

const ctx: CanvasRenderingContext2D = context;

document.body.appendChild(canvas);

document.documentElement.style.margin = "0";
document.documentElement.style.overflow = "hidden";

document.body.style.margin = "0";
document.body.style.background = "#101510";
document.body.style.overflow = "hidden";

canvas.style.display = "block";
canvas.style.width = "100vw";
canvas.style.height = "100dvh";
canvas.style.touchAction = "none";

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

let buttons: GameButton[] = [];

const keys = new Set<string>();

const joystick = {
  active: false,
  pointerId: -1,
  dx: 0,
  dy: 0
};

const JOYSTICK_RADIUS = 48;

function maxHealth(): number {
  return 100 + save.upgrades.health * 20;
}

function movementSpeed(): number {
  return (
    190 *
    (1 + save.upgrades.stamina * 0.1)
  );
}

function bulletDamage(): number {
  return 1 + save.upgrades.damage;
}

function fireDelay(): number {
  return Math.max(
    0.1,
    0.35 * Math.pow(0.9, save.upgrades.fireRate)
  );
}

function upgradePrice(key: UpgradeKey): number {
  const item = upgradeInfo.find(
    upgrade => upgrade.key === key
  );

  if (!item) return Infinity;

  return Math.floor(
    item.price *
    Math.pow(1.5, save.upgrades[key])
  );
}

function buyUpgrade(key: UpgradeKey): void {
  const item = upgradeInfo.find(
    upgrade => upgrade.key === key
  );

  if (!item) return;

  if (save.upgrades[key] >= item.max) return;

  const price = upgradePrice(key);

  if (save.coins < price) return;

  save.coins -= price;
  save.upgrades[key]++;

  persist();
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
    player.x += (width - oldWidth) / 2;
    player.y += (height - oldHeight) / 2;

    player.x = Math.max(
      player.radius,
      Math.min(width - player.radius, player.x)
    );

    player.y = Math.max(
      player.radius,
      Math.min(height - player.radius, player.y)
    );
  }
}

window.addEventListener("resize", resize);
resize();

function joystickHome() {
  return {
    x: 83,
    y: height - 100
  };
}

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
    dx * factor / JOYSTICK_RADIUS;

  joystick.dy =
    dy * factor / JOYSTICK_RADIUS;

  if (distance < 8) {
    joystick.dx = 0;
    joystick.dy = 0;
  }
}

window.addEventListener("keydown", event => {
  keys.add(event.key.toLowerCase());
});

window.addEventListener("keyup", event => {
  keys.delete(event.key.toLowerCase());
});

window.addEventListener("blur", () => {
  keys.clear();
  resetJoystick();
});

canvas.addEventListener("pointerdown", event => {
  if (gameScreen !== "playing") {
    const clickedButton = [...buttons]
      .reverse()
      .find(button =>
        event.clientX >= button.x &&
        event.clientX <= button.x + button.w &&
        event.clientY >= button.y &&
        event.clientY <= button.y + button.h
      );

    if (clickedButton) {
      clickedButton.action();
    }

    return;
  }

  if (
    event.clientX < width * 0.55 &&
    !joystick.active
  ) {
    joystick.active = true;
    joystick.pointerId = event.pointerId;

    updateJoystick(
      event.clientX,
      event.clientY
    );

    canvas.setPointerCapture(event.pointerId);
  }
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

function releasePointer(event: PointerEvent): void {
  if (event.pointerId === joystick.pointerId) {
    resetJoystick();
  }
}

canvas.addEventListener("pointerup", releasePointer);
canvas.addEventListener("pointercancel", releasePointer);

function startGame(selectedMode: GameMode): void {
  gameMode = selectedMode;
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

  spawnTimer = 0;
  shootTimer = 0;
  invulnerable = 0;
  lastMilestone = 0;

  noDamage = true;

  difficulty =
    selectedMode === "campaign"
      ? save.campaignLevel
      : 1;

  targetKills = 10 + difficulty * 5;

  resetJoystick();
}

function awardCoins(amount: number): void {
  save.coins += amount;
  runCoins += amount;

  persist();
}

function finishCampaign(): void {
  const bonus = noDamage
    ? difficulty * 50
    : 0;

  levelReward = difficulty * 25 + bonus;

  awardCoins(levelReward);

  save.campaignLevel++;

  persist();

  gameScreen = "complete";
  resetJoystick();
}

function endGame(): void {
  gameScreen = "gameover";
  resetJoystick();

  if (
    gameMode === "endless" &&
    kills > save.bestEndless
  ) {
    save.bestEndless = kills;
    persist();
  }
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
    1 +
    Math.floor(difficulty / 3) +
    kind;

  zombies.push({
    x,
    y,
    hp,
    maxHp: hp,
    speed: 45 + difficulty * 5 - kind * 8,
    radius: kind ? 17 : 13,
    kind
  });
}

function update(dt: number): void {
  if (gameScreen !== "playing") return;

  elapsed += dt;

  if (gameMode === "endless") {
    difficulty =
      1 + Math.floor(elapsed / 35);

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
  ) dx--;

  if (
    keys.has("d") ||
    keys.has("arrowright")
  ) dx++;

  if (
    keys.has("w") ||
    keys.has("arrowup")
  ) dy--;

  if (
    keys.has("s") ||
    keys.has("arrowdown")
  ) dy++;

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
      if (zombie.hp <= 0) continue;

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
        x:
          player.x +
          Math.cos(angle) * 19,
        y:
          player.y +
          Math.sin(angle) * 19,
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
    if (zombie.hp <= 0) continue;

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

    const distanceToPlayer = Math.hypot(
      zombie.x - player.x,
      zombie.y - player.y
    );

    if (
      distanceToPlayer <
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

    if (bullet.life <= 0) continue;

    for (const zombie of zombies) {
      if (zombie.hp <= 0) continue;

      const distance = Math.hypot(
        bullet.x - zombie.x,
        bullet.y - zombie.y
      );

      if (
        distance < zombie.radius + 4
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

  ctx.fillStyle = "#0a110c";

  ctx.beginPath();
  ctx.ellipse(
    2,
    5,
    18,
    14,
    0,
    0,
    Math.PI * 2
  );
  ctx.fill();

  ctx.fillStyle = "#b89248";
  ctx.fillRect(-12, -10, 24, 20);

  ctx.fillStyle = "#e2c17b";
  ctx.beginPath();
  ctx.arc(2, 0, 9, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#4b5b45";
  ctx.fillRect(8, -6, 15, 12);

  ctx.fillStyle = "#222a2c";
  ctx.fillRect(15, -4, 20, 8);

  ctx.fillStyle = "#a9b2ae";
  ctx.fillRect(30, -2, 7, 4);

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

  ctx.fillStyle = "#0a100d";
  ctx.beginPath();

  ctx.ellipse(
    2,
    4,
    zombie.radius + 3,
    zombie.radius,
    0,
    0,
    Math.PI * 2
  );

  ctx.fill();

  ctx.fillStyle = zombie.kind
    ? "#526d49"
    : "#69966a";

  ctx.beginPath();
  ctx.arc(
    0,
    0,
    zombie.radius,
    0,
    Math.PI * 2
  );
  ctx.fill();

  ctx.fillStyle = "#c3e3aa";
  ctx.fillRect(3, -6, 4, 3);
  ctx.fillRect(3, 3, 4, 3);

  ctx.fillStyle = "#2b372b";
  ctx.fillRect(7, -2, 4, 4);

  ctx.restore();

  if (zombie.maxHp > 1) {
    const barWidth =
      zombie.radius * 2 + 6;

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

  ctx.fillStyle =
    "rgba(255,255,255,0.1)";

  ctx.strokeStyle =
    "rgba(255,255,255,0.4)";

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

  ctx.fillStyle =
    "rgba(225,194,110,0.8)";

  ctx.beginPath();

  ctx.arc(
    home.x +
      joystick.dx * JOYSTICK_RADIUS,
    home.y +
      joystick.dy * JOYSTICK_RADIUS,
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
  const buttonWidth = Math.min(
    width - 40,
    300
  );

  const buttonHeight = 46;
  const x = (width - buttonWidth) / 2;

  ctx.fillStyle = "#a78439";

  ctx.fillRect(
    x,
    y,
    buttonWidth,
    buttonHeight
  );

  ctx.strokeStyle = "#e7c76c";
  ctx.lineWidth = 2;

  ctx.strokeRect(
    x,
    y,
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
    label,
    action
  });
}

function drawPanel(title: string): void {
  ctx.fillStyle =
    "rgba(5,12,8,0.94)";

  ctx.fillRect(
    0,
    0,
    width,
    height
  );

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

  const startY = Math.max(
    195,
    height / 2 - 50
  );

  addButton(
    "CAMPAIGN MODE",
    startY,
    () => startGame("campaign")
  );

  addButton(
    "ENDLESS SURVIVAL",
    startY + 60,
    () => startGame("endless")
  );

  addButton(
    "UPGRADE SHOP",
    startY + 120,
    () => {
      shopReturn = "menu";
      gameScreen = "shop";
    }
  );
}

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
      startY +
        upgradeInfo.length * gap +
        5
    ),
    () => {
      gameScreen = shopReturn;
    }
  );
}

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

  ctx.fillStyle =
    "rgba(8,14,10,0.84)";

  ctx.fillRect(
    0,
    0,
    width,
    115
  );

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
  ctx.fillRect(15, 57, barWidth, 12);

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
    `Coins ${save.coins} | Kills ${kills}`,
    15,
    90,
    14
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

  drawJoystick();
}

function draw(): void {
  buttons = [];

  switch (gameScreen) {
    case "playing":
      drawGame();
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
  }
}

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
