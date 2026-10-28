
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
};

type Debris = {
  x: number;
  y: number;
  size: number;
  angle: number;
};

const canvas = document.createElement("canvas");
const context = canvas.getContext("2d");

if (!context) {
  throw new Error("Canvas 2D is not supported");
}

const ctx: CanvasRenderingContext2D = context;

document.body.appendChild(canvas);
document.getElementById("loading")?.remove();

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
let pixelRatio = 1;

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
const debris: Debris[] = [];

let level = 1;
let kills = 0;
let coins = 0;
let gameOver = false;
let spawnTimer = 0;
let shootTimer = 0;
let invulnerable = 0;
let lastTime = 0;
let initialized = false;

function rebuildDebris() {
  debris.length = 0;

  const count = Math.max(
    18,
    Math.floor(width * height / 17000)
  );

  for (let i = 0; i < count; i++) {
    debris.push({
      x: Math.random() * width,
      y: Math.random() * height,
      size: 2 + Math.random() * 6,
      angle: Math.random() * Math.PI
    });
  }
}

function resize() {
  const oldWidth = width;
  const oldHeight = height;

  width = window.innerWidth;
  height = window.innerHeight;

  pixelRatio = Math.min(
    window.devicePixelRatio || 1,
    2
  );

  canvas.width = Math.round(width * pixelRatio);
  canvas.height = Math.round(height * pixelRatio);

  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

  if (!initialized) {
    player.x = width / 2;
    player.y = height / 2;
    initialized = true;
  } else {
    player.x = Math.max(
      player.radius,
      Math.min(
        width - player.radius,
        player.x + (width - oldWidth) / 2
      )
    );

    player.y = Math.max(
      player.radius,
      Math.min(
        height - player.radius,
        player.y + (height - oldHeight) / 2
      )
    );
  }

  rebuildDebris();
}

resize();
window.addEventListener("resize", resize);

const keys = new Set<string>();

const joystick = {
  active: false,
  pointerId: null as number | null,
  baseX: 0,
  baseY: 0,
  dx: 0,
  dy: 0
};

const JOYSTICK_RADIUS = 54;

window.addEventListener("keydown", (e) => {
  keys.add(e.key.toLowerCase());

  if (gameOver && e.key.toLowerCase() === "r") {
    restartGame();
  }
});

window.addEventListener("keyup", (e) => {
  keys.delete(e.key.toLowerCase());
});

window.addEventListener("blur", () => {
  keys.clear();
  joystick.active = false;
  joystick.pointerId = null;
  joystick.dx = 0;
  joystick.dy = 0;
});

function joystickHome() {
  return {
    x: Math.max(82, Math.min(width - 82, 94)),
    y: height - 105
  };
}

function setJoystickPosition(x: number, y: number) {
  const vx = x - joystick.baseX;
  const vy = y - joystick.baseY;

  const length = Math.hypot(vx, vy);

  const factor =
    length > JOYSTICK_RADIUS
      ? JOYSTICK_RADIUS / length
      : 1;

  joystick.dx =
    (vx * factor) / JOYSTICK_RADIUS;

  joystick.dy =
    (vy * factor) / JOYSTICK_RADIUS;

  if (Math.hypot(joystick.dx, joystick.dy) < 0.12) {
    joystick.dx = 0;
    joystick.dy = 0;
  }
}

canvas.addEventListener("pointerdown", (e) => {
  if (gameOver) {
    restartGame();
    return;
  }

  if (joystick.active) return;

  if (e.clientX > width * 0.55) return;

  joystick.active = true;
  joystick.pointerId = e.pointerId;
  joystick.baseX = e.clientX;
  joystick.baseY = e.clientY;

  setJoystickPosition(e.clientX, e.clientY);
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener("pointermove", (e) => {
  if (
    joystick.active &&
    e.pointerId === joystick.pointerId
  ) {
    setJoystickPosition(e.clientX, e.clientY);
  }
});

function releasePointer(e: PointerEvent) {
  if (e.pointerId !== joystick.pointerId) return;

  joystick.active = false;
  joystick.pointerId = null;
  joystick.dx = 0;
  joystick.dy = 0;
}

canvas.addEventListener("pointerup", releasePointer);
canvas.addEventListener("pointercancel", releasePointer);

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

  const kind =
    Math.random() <
    Math.min(0.4, 0.08 + level * 0.015)
      ? 1
      : 0;

  const hp = 1 + Math.floor(level / 3) + kind;

  zombies.push({
    x,
    y,
    hp,
    maxHp: hp,
    speed: 45 + level * 5 + (kind ? -8 : 0),
    radius: kind ? 17 : 13,
    kind
  });
}

function restartGame() {
  player.x = width / 2;
  player.y = height / 2;
  player.hp = player.maxHp;
  player.angle = -Math.PI / 2;

  zombies.length = 0;
  bullets.length = 0;

  level = 1;
  kills = 0;
  coins = 0;

  gameOver = false;
  spawnTimer = 0;
  shootTimer = 0;
  invulnerable = 0;
  lastTime = 0;

  joystick.active = false;
  joystick.pointerId = null;
  joystick.dx = 0;
  joystick.dy = 0;
}

function update(dt: number) {
  if (gameOver) return;

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

  const distance = Math.hypot(dx, dy);

  if (distance > 0) {
    const magnitude = Math.min(distance, 1);

    player.x +=
      (dx / distance) * magnitude * 190 * dt;

    player.y +=
      (dy / distance) * magnitude * 190 * dt;
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
      0.3,
      1.5 - level * 0.08
    );
  }

  shootTimer -= dt;

  if (shootTimer <= 0 && zombies.length > 0) {
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
        vx: Math.cos(angle) * 400,
        vy: Math.sin(angle) * 400,
        life: 1.5
      });

      shootTimer = 0.35;
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
      Math.cos(angle) * zombie.speed * dt;

    zombie.y +=
      Math.sin(angle) * zombie.speed * dt;

    const distanceToPlayer = Math.hypot(
      zombie.x - player.x,
      zombie.y - player.y
    );

    if (
      distanceToPlayer <
        zombie.radius + player.radius &&
      invulnerable <= 0
    ) {
      player.hp = Math.max(0, player.hp - 10);
      invulnerable = 0.7;

      if (player.hp <= 0) {
        gameOver = true;
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

      const distanceToZombie = Math.hypot(
        bullet.x - zombie.x,
        bullet.y - zombie.y
      );

      if (distanceToZombie < zombie.radius + 4) {
        zombie.hp--;
        bullet.life = 0;

        if (zombie.hp <= 0) {
          kills++;
          coins += 5;

          if (kills % 15 === 0) {
            level++;
            coins += level * 25;

            player.hp = Math.min(
              player.maxHp,
              player.hp + 20
            );
          }
        }

        break;
      }
    }
  }

  for (let i = zombies.length - 1; i >= 0; i--) {
    if (zombies[i].hp <= 0) {
      zombies.splice(i, 1);
    }
  }

  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];

    if (
      b.life <= 0 ||
      b.x < -30 ||
      b.x > width + 30 ||
      b.y < -30 ||
      b.y > height + 30
    ) {
      bullets.splice(i, 1);
    }
  }
}

function drawGround() {
  ctx.fillStyle = "#152219";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "#22362a";
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

  for (const d of debris) {
    ctx.save();
    ctx.translate(d.x, d.y);
    ctx.rotate(d.angle);

    ctx.fillStyle = "#344338";
    ctx.fillRect(
      -d.size / 2,
      -2,
      d.size,
      4
    );

    ctx.restore();
  }
}

function drawSurvivor() {
  ctx.save();
  ctx.translate(player.x, player.y);
  ctx.rotate(player.angle);

  if (
    invulnerable > 0 &&
    Math.floor(invulnerable * 12) % 2 === 0
  ) {
    ctx.globalAlpha = 0.55;
  }

  ctx.fillStyle = "#0b1110";
  ctx.beginPath();
  ctx.ellipse(
    2, 5, 17, 14,
    0, 0, Math.PI * 2
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

  ctx.fillStyle = "#2b322a";
  ctx.fillRect(-7, -7, 7, 14);

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

  ctx.fillStyle =
    z.kind ? "#526d49" : "#69966a";

  ctx.beginPath();
  ctx.arc(
    0, 0,
    z.radius,
    0, Math.PI * 2
  );
  ctx.fill();

  ctx.fillStyle =
    z.kind ? "#3d503d" : "#426b48";

  ctx.fillRect(-z.radius - 4, -5, 8, 10);
  ctx.fillRect(z.radius - 4, -5, 8, 10);

  ctx.fillStyle = "#c3e3aa";
  ctx.fillRect(3, -6, 4, 3);
  ctx.fillRect(3, 3, 4, 3);

  ctx.fillStyle = "#2b372b";
  ctx.fillRect(7, -2, 4, 4);

  ctx.restore();

  if (z.maxHp > 1) {
    const w = z.radius * 2 + 6;

    ctx.fillStyle = "#251f1e";
    ctx.fillRect(
      z.x - w / 2,
      z.y - z.radius - 13,
      w,
      4
    );

    ctx.fillStyle = "#d5755d";
    ctx.fillRect(
      z.x - w / 2,
      z.y - z.radius - 13,
      w * Math.max(0, z.hp) / z.maxHp,
      4
    );
  }
}

function drawJoystick() {
  const home = joystickHome();

  const x = joystick.active
    ? joystick.baseX
    : home.x;

  const y = joystick.active
    ? joystick.baseY
    : home.y;

  ctx.fillStyle = "rgba(255,255,255,0.09)";
  ctx.strokeStyle = "rgba(255,255,255,0.32)";
  ctx.lineWidth = 2;

  ctx.beginPath();
  ctx.arc(
    x, y,
    JOYSTICK_RADIUS,
    0, Math.PI * 2
  );
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = "rgba(225,194,110,0.65)";

  ctx.beginPath();
  ctx.arc(
    x + joystick.dx * JOYSTICK_RADIUS,
    y + joystick.dy * JOYSTICK_RADIUS,
    23,
    0,
    Math.PI * 2
  );
  ctx.fill();
}

function drawHUD() {
  ctx.fillStyle = "rgba(8,14,10,0.78)";
  ctx.fillRect(0, 0, width, 110);

  ctx.textAlign = "left";
  ctx.fillStyle = "#f1e6c9";
  ctx.font = "bold 17px Arial";

  ctx.fillText("APEX SURVIVAL", 15, 28);

  ctx.font = "bold 13px Arial";
  ctx.fillStyle = "#ffffff";

  ctx.fillText(
    `HP ${player.hp}/${player.maxHp}`,
    15,
    51
  );

  const barWidth = Math.min(
    width - 30,
    250
  );

  ctx.fillStyle = "#4d2626";
  ctx.fillRect(15, 60, barWidth, 12);

  ctx.fillStyle =
    player.hp > 30
      ? "#5fcb77"
      : "#ed6b62";

  ctx.fillRect(
    15,
    60,
    barWidth * player.hp / player.maxHp,
    12
  );

  ctx.strokeStyle = "#9eada0";
  ctx.strokeRect(15, 60, barWidth, 12);

  ctx.fillStyle = "#e9e7df";
  ctx.font = "bold 14px Arial";

  ctx.fillText(
    `LEVEL ${level}   KILLS ${kills}   COINS ${coins}`,
    15,
    96
  );
}

function draw() {
  drawGround();

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

  drawSurvivor();
  drawHUD();

  if (!gameOver) {
    drawJoystick();
  }

  if (gameOver) {
    ctx.fillStyle = "rgba(0,0,0,0.76)";
    ctx.fillRect(0, 0, width, height);

    ctx.textAlign = "center";
    ctx.fillStyle = "#ff6868";

    ctx.font =
      `bold ${Math.min(36, Math.floor(width / 10))}px Arial`;

    ctx.fillText(
      "GAME OVER",
      width / 2,
      height / 2 - 35
    );

    ctx.fillStyle = "#ffffff";
    ctx.font = "18px Arial";

    ctx.fillText(
      `Level ${level} | ${kills} kills`,
      width / 2,
      height / 2 + 4
    );

    ctx.fillText(
      `${coins} coins earned`,
      width / 2,
      height / 2 + 38
    );

    ctx.fillText(
      "Tap anywhere to restart",
      width / 2,
      height / 2 + 85
    );

    ctx.textAlign = "left";
  }
}

function showError(error: unknown) {
  console.error(
    "APEX Zombie Survival error:",
    error
  );

  const pre = document.createElement("pre");

  pre.textContent =
    `Game error: ${String(error)}`;

  pre.style.cssText =
    "position:fixed;top:20px;left:10px;" +
    "right:10px;padding:15px;background:#111;" +
    "color:#ff7777;white-space:pre-wrap;" +
    "z-index:9999";

  document.body.appendChild(pre);
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
    showError(error);
    return;
  }

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
