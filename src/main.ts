
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

type Screen =
  | "menu"
  | "playing"
  | "shop"
  | "complete"
  | "gameover";

type Mode = "campaign" | "endless";

const SAVE_KEY = "apex-zombie-survival-v2";

const defaultSave = (): SaveData => ({
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
});

function loadSave(): SaveData {
  const defaults = defaultSave();

  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return defaults;

    const saved = JSON.parse(raw);

    const valid = (v: unknown, fallback: number) =>
      typeof v === "number" &&
      Number.isFinite(v) &&
      v >= 0
        ? Math.floor(v)
        : fallback;

    const upgrades = { ...defaults.upgrades };

    for (const key of Object.keys(upgrades) as UpgradeKey[]) {
      upgrades[key] = Math.min(
        20,
        valid(saved.upgrades?.[key], 0)
      );
    }

    return {
      coins: valid(saved.coins, 0),
      campaignLevel: Math.max(
        1,
        valid(saved.campaignLevel, 1)
      ),
      bestEndless: valid(saved.bestEndless, 0),
      upgrades
    };
  } catch {
    return defaults;
  }
}

let save = loadSave();

function persist() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch (error) {
    console.warn("Save unavailable", error);
  }
}

const canvas = document.createElement("canvas");
const context = canvas.getContext("2d");

if (!context) throw new Error("Canvas unavailable");

const ctx: CanvasRenderingContext2D = context;

document.body.appendChild(canvas);
document.getElementById("loading")?.remove();

document.documentElement.style.margin = "0";
document.body.style.margin = "0";
document.body.style.overflow = "hidden";
document.body.style.background = "#101510";

canvas.style.display = "block";
canvas.style.width = "100vw";
canvas.style.height = "100dvh";
canvas.style.touchAction = "none";

let width = 0;
let height = 0;

const player = {
  x: 0,
  y: 0,
  hp: 100,
  maxHp: 100,
  radius: 15,
  angle: 0
};

const zombies: Zombie[] = [];
const bullets: Bullet[] = [];

let screen: Screen = "menu";
let mode: Mode = "campaign";
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
let endlessScore = 0;

const keys = new Set<string>();

const joystick = {
  active: false,
  pointerId: -1,
  dx: 0,
  dy: 0
};

const joystickRadius = 48;

type Button = {
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  action: () => void;
};

let buttons: Button[] = [];

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

function maxHealth() {
  return 100 + save.upgrades.health * 20;
}

function movementSpeed() {
  return 190 * (1 + save.upgrades.stamina * 0.1);
}

function bulletDamage() {
  return 1 + save.upgrades.damage;
}

function fireDelay() {
  return Math.max(
    0.1,
    0.35 * Math.pow(0.9, save.upgrades.fireRate)
  );
}

function upgradePrice(key: UpgradeKey) {
  const item = upgradeInfo.find(u => u.key === key)!;
  return Math.floor(
    item.price * Math.pow(1.5, save.upgrades[key])
  );
}

function buyUpgrade(key: UpgradeKey) {
  const item = upgradeInfo.find(u => u.key === key)!;
  const price = upgradePrice(key);

  if (save.upgrades[key] >= item.max) return;
  if (save.coins < price) return;

  save.coins -= price;
  save.upgrades[key]++;
  persist();
}

function resize() {
  width = window.innerWidth;
  height = window.innerHeight;

  const ratio = Math.min(
    window.devicePixelRatio || 1,
    2
  );

  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);

  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

  player.x = Math.max(
    15,
    Math.min(width - 15, player.x || width / 2)
  );

  player.y = Math.max(
    15,
    Math.min(height - 15, player.y || height / 2)
  );
}

window.addEventListener("resize", resize);
resize();

function resetJoystick() {
  joystick.active = false;
  joystick.pointerId = -1;
  joystick.dx = 0;
  joystick.dy = 0;
}

function joystickHome() {
  return {
    x: 83,
    y: height - 100
  };
}

function updateJoystick(x: number, y: number) {
  const home = joystickHome();
  const dx = x - home.x;
  const dy = y - home.y;
  const distance = Math.hypot(dx, dy);
  const factor = Math.min(
    1,
    joystickRadius / Math.max(1, distance)
  );

  joystick.dx = dx * factor / joystickRadius;
  joystick.dy = dy * factor / joystickRadius;

  if (distance < 8) {
    joystick.dx = 0;
    joystick.dy = 0;
  }
}

window.addEventListener("keydown", e => {
  keys.add(e.key.toLowerCase());
});

window.addEventListener("keyup", e => {
  keys.delete(e.key.toLowerCase());
});

window.addEventListener("blur", () => {
  keys.clear();
  resetJoystick();
});

canvas.addEventListener("pointerdown", e => {
  if (screen !== "playing") {
    for (const b of [...buttons].reverse()) {
      if (
        e.clientX >= b.x &&
        e.clientX <= b.x + b.w &&
        e.clientY >= b.y &&
        e.clientY <= b.y + b.h
      ) {
        b.action();
        return;
      }
    }
    return;
  }

  if (
    e.clientX < width * 0.55 &&
    !joystick.active
  ) {
    joystick.active = true;
    joystick.pointerId = e.pointerId;
    updateJoystick(e.clientX, e.clientY);
    canvas.setPointerCapture(e.pointerId);
  }
});

canvas.addEventListener("pointermove", e => {
  if (
    joystick.active &&
    joystick.pointerId === e.pointerId
  ) {
    updateJoystick(e.clientX, e.clientY);
  }
});

function releasePointer(e: PointerEvent) {
  if (e.pointerId === joystick.pointerId) {
    resetJoystick();
  }
}

canvas.addEventListener("pointerup", releasePointer);
canvas.addEventListener("pointercancel", releasePointer);

function startGame(selected: Mode) {
  mode = selected;
  screen = "playing";

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

  difficulty = selected === "campaign"
    ? save.campaignLevel
    : 1;

  targetKills = 10 + difficulty * 5;

  resetJoystick();
}

function awardCoins(amount: number) {
  save.coins += amount;
  runCoins += amount;
  persist();
}

function finishCampaign() {
  const bonus = noDamage ? difficulty * 50 : 0;
  levelReward = difficulty * 25 + bonus;

  awardCoins(levelReward);

  save.campaignLevel++;
  persist();

  screen = "complete";
  resetJoystick();
}

function endGame() {
  screen = "gameover";
  resetJoystick();

  if (mode === "endless") {
    endlessScore = kills;

    if (kills > save.bestEndless) {
      save.bestEndless = kills;
      persist();
    }
  }
}

function spawnZombie() {
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

  const kind = Math.random() <
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
    kind
  });
}

function update(dt: number) {
  if (screen !== "playing") return;

  elapsed += dt;

  if (mode === "endless") {
    difficulty = 1 + Math.floor(elapsed / 35);

    const milestone = Math.floor(elapsed / 30);

    if (milestone > lastMilestone) {
      lastMilestone = milestone;
      awardCoins(20 + milestone * 10);
    }
  }

  let dx = 0;
  let dy = 0;

  if (keys.has("a") || keys.has("arrowleft")) dx--;
  if (keys.has("d") || keys.has("arrowright")) dx++;
  if (keys.has("w") || keys.has("arrowup")) dy--;
  if (keys.has("s") || keys.has("arrowdown")) dy++;

  if (joystick.active) {
    dx = joystick.dx;
    dy = joystick.dy;
  }

  const length = Math.hypot(dx, dy);

  if (length > 0) {
    const strength = Math.min(1, length);

    player.x +=
      dx / length * movementSpeed() * strength * dt;

    player.y +=
      dy / length * movementSpeed() * strength * dt;
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

  if (shootTimer <= 0 && zombies.length) {
    let nearest: Zombie | null = null;
    let best = Infinity;

    for (const z of zombies) {
      if (z.hp <= 0) continue;

      const d =
        (z.x - player.x) ** 2 +
        (z.y - player.y) ** 2;

      if (d < best) {
        best = d;
        nearest = z;
      }
    }

    if (nearest) {
      const angle = Math.atan2(
        nearest.y - player.y,
        nearest.x - player.x
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

  for (const z of zombies) {
    if (z.hp <= 0) continue;

    const angle = Math.atan2(
      player.y - z.y,
      player.x - z.x
    );

    z.x += Math.cos(angle) * z.speed * dt;
    z.y += Math.sin(angle) * z.speed * dt;

    if (
      Math.hypot(
        z.x - player.x,
        z.y - player.y
      ) < z.radius + player.radius &&
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

  for (const b of bullets) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;

    if (b.life <= 0) continue;

    for (const z of zombies) {
      if (z.hp <= 0) continue;

      if (
        Math.hypot(b.x - z.x, b.y - z.y) <
        z.radius + 4
      ) {
        z.hp -= b.damage;
        b.life = 0;

        if (z.hp <= 0) {
          kills++;
          waveKills++;
          awardCoins(z.kind ? 10 : 5);
        }

        break;
      }
    }
  }

  for (let i = zombies.length - 1; i >= 0; i--) {
    if (zombies[i].hp <= 0) zombies.splice(i, 1);
  }

  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];

    if (
      b.life <= 0 ||
      b.x < -40 ||
      b.x > width + 40 ||
      b.y < -40 ||
      b.y > height + 40
    ) {
      bullets.splice(i, 1);
    }
  }

  if (
    mode === "campaign" &&
    waveKills >= targetKills
  ) {
    finishCampaign();
  }
}

function text(
  value: string,
  x: number,
  y: number,
  size = 16,
  color = "#ffffff",
  align: CanvasTextAlign = "left"
) {
  ctx.fillStyle = color;
  ctx.font = `bold ${size}px Arial`;
  ctx.textAlign = align;
  ctx.fillText(value, x, y);
}

function background() {
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

function drawPlayer() {
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
  ctx.ellipse(2, 5, 18, 14, 0, 0, Math.PI * 2);
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

function drawZombie(z: Zombie) {
  ctx.save();
  ctx.translate(z.x, z.y);

  const angle = Math.atan2(
    player.y - z.y,
    player.x - z.x
  );

  ctx.rotate(angle);

  ctx.fillStyle = "#0a100d";
  ctx.beginPath();
  ctx.ellipse(
    2, 4,
    z.radius + 3,
    z.radius,
    0, 0, Math.PI * 2
  );
  ctx.fill();

  ctx.fillStyle = z.kind ? "#526d49" : "#69966a";
  ctx.beginPath();
  ctx.arc(0, 0, z.radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#c3e3aa";
  ctx.fillRect(3, -6, 4, 3);
  ctx.fillRect(3, 3, 4, 3);

  ctx.fillStyle = "#2b372b";
  ctx.fillRect(7, -2, 4, 4);

  ctx.restore();

  if (z.maxHp > 1) {
    const w = z.radius * 2 + 6;

    ctx.fillStyle = "#382626";
    ctx.fillRect(
      z.x - w / 2,
      z.y - z.radius - 13,
      w,
      5
    );

    ctx.fillStyle = "#e07560";
    ctx.fillRect(
      z.x - w / 2,
      z.y - z.radius - 13,
      w * Math.max(0, z.hp) / z.maxHp,
      5
    );
  }
}

function drawJoystick() {
  const home = joystickHome();

  ctx.fillStyle = "rgba(255,255,255,0.1)";
  ctx.strokeStyle = "rgba(255,255,255,0.4)";
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.arc(
    home.x,
    home.y,
    joystickRadius,
    0,
    Math.PI * 2
  );
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "rgba(225,194,110,0.8)";
  ctx.beginPath();
  ctx.arc(
    home.x + joystick.dx * joystickRadius,
    home.y + joystick.dy * joystickRadius,
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
) {
  const w = Math.min(width - 40, 300);
  const h = 46;
  const x = (width - w) / 2;

  ctx.fillStyle = "#a78439";
  ctx.fillRect(x, y, w, h);

  ctx.strokeStyle = "#e7c76c";
  ctx.lineWidth = 2;
  ctx.strokeRect(x, y, w, h);

  text(
    label,
    width / 2,
    y + 29,
    15,
    "#101510",
    "center"
  );

  buttons.push({
    x, y, w, h,
    text: label,
    action
  });
}

function panel(title: string) {
  ctx.fillStyle = "rgba(5,12,8,0.94)";
  ctx.fillRect(0, 0, width, height);

  text(
    title,
    width / 2,
    65,
    Math.min(25, width / 15),
    "#e8c66d",
    "center"
  );
}

function drawMenu() {
  panel("APEX ZOMBIE SURVIVAL");

  text(
    `Wallet: ${save.coins} coins`,
    width / 2,
    110,
    17,
    "#ffffff",
    "center"
  );

  text(
    `Campaign Level: ${save.campaignLevel}`,
    width / 2,
    145,
    15,
    "#a5c9a5",
    "center"
  );

  text(
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
      screen = "shop";
    }
  );
}

function drawShop() {
  panel("SURVIVOR UPGRADE SHOP");

  text(
    `Available Coins: ${save.coins}`,
    width / 2,
    105,
    17,
    "#ffffff",
    "center"
  );

  const compact = height < 700;
  const gap = compact ? 52 : 65;
  const start = compact ? 130 : 155;

  upgradeInfo.forEach((item, i) => {
    const rank = save.upgrades[item.key];
    const price = upgradePrice(item.key);

    const label = rank >= item.max
      ? `${item.name} | MAX`
      : `${item.name} Lv.${rank} | ${price} coins`;

    addButton(
      label,
      start + i * gap,
      () => buyUpgrade(item.key)
    );
  });

  addButton(
    "BACK",
    Math.min(
      height - 65,
      start + upgradeInfo.length * gap + 5
    ),
    () => {
      screen = shopReturn;
    }
  );
}

function drawComplete() {
  panel("LEVEL COMPLETED!");

  text(
    `Campaign Level ${save.campaignLevel - 1}`,
    width / 2,
    120,
    19,
    "#ffffff",
    "center"
  );

  text(
    noDamage ? "PERFECT RUN BONUS!" : "LEVEL CLEARED",
    width / 2,
    160,
    18,
    "#8ee29a",
    "center"
  );

  text(
    `Completion Reward: ${levelReward}`,
    width / 2,
    200,
    16,
    "#e8c66d",
    "center"
  );

  text(
    `Total Earned: ${runCoins}`,
    width / 2,
    235,
    16,
    "#ffffff",
    "center"
  );

  const y = Math.max(270, height / 2);

  addButton(
    "NEXT LEVEL",
    y,
    () => startGame("campaign")
  );

  addButton(
    "UPGRADE SHOP",
    y + 60,
    () => {
      shopReturn = "complete";
      screen = "shop";
    }
  );

  addButton(
    "MAIN MENU",
    y + 120,
    () => {
      screen = "menu";
    }
  );
}

function drawGameOver() {
  panel("GAME OVER");

  text(
    mode === "endless"
      ? "ENDLESS SURVIVAL"
      : "CAMPAIGN FAILED",
    width / 2,
    125,
    19,
    "#ff7777",
    "center"
  );

  text(
    `Zombies Killed: ${kills}`,
    width / 2,
    170,
    17,
    "#ffffff",
    "center"
  );

  text(
    `Coins Earned: ${runCoins}`,
    width / 2,
    205,
    17,
    "#e8c66d",
    "center"
  );

  if (mode === "endless") {
    text(
      `Best Record: ${save.bestEndless}`,
      width / 2,
      240,
      16,
      "#ffffff",
      "center"
    );
  }

  const y = Math.max(270, height / 2);

  addButton(
    "RETRY",
    y,
    () => startGame(mode)
  );

  addButton(
    "MAIN MENU",
    y + 60,
    () => {
      screen = "menu";
    }
  );
}

function drawGame() {
  background();

  for (const z of zombies) {
    drawZombie(z);
  }

  ctx.fillStyle = "#ffdf74";

  for (const b of bullets) {
    ctx.beginPath();
    ctx.arc(b.x, b.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  drawPlayer();

  ctx.fillStyle = "rgba(8,14,10,0.84)";
  ctx.fillRect(0, 0, width, 115);

  text("APEX SURVIVAL", 15, 25, 17, "#e8c66d");

  text(
    `HP ${player.hp}/${player.maxHp}`,
    15,
    47,
    13
  );

  const barWidth = Math.min(width - 30, 245);

  ctx.fillStyle = "#502525";
  ctx.fillRect(15, 57, barWidth, 12);

  ctx.fillStyle = player.hp > player.maxHp * 0.3
    ? "#65cc77"
    : "#ef6b62";

  ctx.fillRect(
    15,
    57,
    barWidth * player.hp / player.maxHp,
    12
  );

  text(
    `Coins ${save.coins} | Kills ${kills}`,
    15,
    90,
    14
  );

  if (mode === "campaign") {
    text(
      `LEVEL ${difficulty} | ${waveKills}/${targetKills}`,
      15,
      109,
      13,
      "#e8c66d"
    );
  } else {
    text(
      `ENDLESS | WAVE ${difficulty}`,
      15,
      109,
      13,
      "#e8c66d"
    );
  }

  drawJoystick();
}

function draw() {
  buttons = [];

  if (screen === "playing") {
    drawGame();
  } else if (screen === "menu") {
    drawMenu();
  } else if (screen === "shop") {
    drawShop();
  } else if (screen === "complete") {
    drawComplete();
  } else {
    drawGameOver();
  }
}

function frame(time: number) {
  const dt = Math.min(
    (time - (lastTime || time)) / 1000,
    0.05
  );

  lastTime = time;

  try {
    update(dt);
    draw();
  } catch (error) {
    console.error("Game error:", error);

    const pre = document.createElement("pre");
    pre.textContent = String(error);
    pre.style.cssText =
      "position:fixed;top:15px;left:10px;" +
      "right:10px;background:#111;color:#ff7777;" +
      "padding:15px;z-index:9999";

    document.body.appendChild(pre);
    return;
  }

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
