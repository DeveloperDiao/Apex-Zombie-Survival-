
type Zombie = {
  x: number;
  y: number;
  hp: number;
  speed: number;
  radius: number;
};

type Bullet = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
};

const canvas = document.createElement("canvas");
const context = canvas.getContext("2d");

if (!context) {
  throw new Error("Canvas 2D is not supported");
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

const player = {
  x: 0,
  y: 0,
  hp: 100,
  radius: 15
};

const zombies: Zombie[] = [];
const bullets: Bullet[] = [];

let level = 1;
let kills = 0;
let coins = 0;
let gameOver = false;

let spawnTimer = 0;
let shootTimer = 0;
let invulnerable = 0;
let lastTime = 0;

function resize() {
  width = canvas.width = window.innerWidth;
  height = canvas.height = window.innerHeight;

  player.x = Math.max(
    player.radius,
    Math.min(width - player.radius, player.x)
  );

  player.y = Math.max(
    player.radius,
    Math.min(height - player.radius, player.y)
  );
}

resize();

player.x = width / 2;
player.y = height / 2;

window.addEventListener("resize", resize);

const keys = new Set<string>();

window.addEventListener("keydown", (e) => {
  keys.add(e.key.toLowerCase());

  if (gameOver && e.key.toLowerCase() === "r") {
    restartGame();
  }
});

window.addEventListener("keyup", (e) => {
  keys.delete(e.key.toLowerCase());
});

let touchX = 0;
let touchY = 0;
let moving = false;

canvas.addEventListener("pointerdown", (e) => {
  if (gameOver) {
    restartGame();
    return;
  }

  moving = true;
  touchX = e.clientX;
  touchY = e.clientY;
});

canvas.addEventListener("pointermove", (e) => {
  if (!moving) return;

  touchX = e.clientX;
  touchY = e.clientY;
});

canvas.addEventListener("pointerup", () => {
  moving = false;
});

canvas.addEventListener("pointercancel", () => {
  moving = false;
});

function spawnZombie() {
  const side = Math.floor(Math.random() * 4);

  let x = 0;
  let y = 0;

  if (side === 0) {
    x = -25;
    y = Math.random() * height;
  } else if (side === 1) {
    x = width + 25;
    y = Math.random() * height;
  } else if (side === 2) {
    x = Math.random() * width;
    y = -25;
  } else {
    x = Math.random() * width;
    y = height + 25;
  }

  zombies.push({
    x,
    y,
    hp: 1 + Math.floor(level / 3),
    speed: 45 + level * 5,
    radius: 13
  });
}

function restartGame() {
  player.x = width / 2;
  player.y = height / 2;
  player.hp = 100;

  zombies.length = 0;
  bullets.length = 0;

  level = 1;
  kills = 0;
  coins = 0;

  gameOver = false;
  moving = false;

  spawnTimer = 0;
  shootTimer = 0;
  invulnerable = 0;
  lastTime = 0;
}

function update(dt: number) {
  if (gameOver) return;

  let dx = 0;
  let dy = 0;

  if (keys.has("a") || keys.has("arrowleft")) dx--;
  if (keys.has("d") || keys.has("arrowright")) dx++;
  if (keys.has("w") || keys.has("arrowup")) dy--;
  if (keys.has("s") || keys.has("arrowdown")) dy++;

  if (moving) {
    dx = touchX - player.x;
    dy = touchY - player.y;

    if (Math.hypot(dx, dy) < 20) {
      dx = 0;
      dy = 0;
    }
  }

  const distance = Math.hypot(dx, dy);

  if (distance > 0) {
    player.x += (dx / distance) * 190 * dt;
    player.y += (dy / distance) * 190 * dt;
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
    spawnTimer = Math.max(0.3, 1.5 - level * 0.08);
  }

  shootTimer -= dt;

  if (shootTimer <= 0 && zombies.length > 0) {
    const nearest = zombies.reduce((a, b) => {
      const distanceA = Math.hypot(
        a.x - player.x,
        a.y - player.y
      );

      const distanceB = Math.hypot(
        b.x - player.x,
        b.y - player.y
      );

      return distanceA < distanceB ? a : b;
    });

    const angle = Math.atan2(
      nearest.y - player.y,
      nearest.x - player.x
    );

    bullets.push({
      x: player.x,
      y: player.y,
      vx: Math.cos(angle) * 400,
      vy: Math.sin(angle) * 400,
      life: 1.5
    });

    shootTimer = 0.35;
  }

  invulnerable = Math.max(0, invulnerable - dt);

  for (const zombie of zombies) {
    const angle = Math.atan2(
      player.y - zombie.y,
      player.x - zombie.x
    );

    zombie.x += Math.cos(angle) * zombie.speed * dt;
    zombie.y += Math.sin(angle) * zombie.speed * dt;

    const distanceToPlayer = Math.hypot(
      zombie.x - player.x,
      zombie.y - player.y
    );

    if (
      distanceToPlayer <
        zombie.radius + player.radius &&
      invulnerable <= 0
    ) {
      player.hp -= 10;
      invulnerable = 0.7;

      if (player.hp <= 0) {
        player.hp = 0;
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
              100,
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
    if (bullets[i].life <= 0) {
      bullets.splice(i, 1);
    }
  }
}

function draw() {
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

  ctx.fillStyle =
    invulnerable > 0 ? "#ffd36b" : "#e7c35a";

  ctx.beginPath();
  ctx.arc(
    player.x,
    player.y,
    player.radius,
    0,
    Math.PI * 2
  );
  ctx.fill();

  ctx.fillStyle = "#72bf75";

  for (const zombie of zombies) {
    ctx.beginPath();
    ctx.arc(
      zombie.x,
      zombie.y,
      zombie.radius,
      0,
      Math.PI * 2
    );
    ctx.fill();
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

  ctx.textAlign = "left";
  ctx.fillStyle = "white";
  ctx.font = "bold 17px Arial";

  ctx.fillText(
    `HP: ${player.hp}   Level: ${level}`,
    15,
    32
  );

  ctx.fillText(
    `Kills: ${kills}   Coins: ${coins}`,
    15,
    58
  );

  if (gameOver) {
    ctx.fillStyle = "#000b";
    ctx.fillRect(0, 0, width, height);

    ctx.textAlign = "center";
    ctx.fillStyle = "#ff6868";
    ctx.font = "bold 36px Arial";

    ctx.fillText(
      "GAME OVER",
      width / 2,
      height / 2
    );

    ctx.font = "18px Arial";
    ctx.fillStyle = "white";

    ctx.fillText(
      `Level ${level} | ${kills} kills`,
      width / 2,
      height / 2 + 38
    );

    ctx.fillText(
      `${coins} coins earned`,
      width / 2,
      height / 2 + 68
    );

    ctx.fillText(
      "Tap anywhere to restart",
      width / 2,
      height / 2 + 105
    );

    ctx.textAlign = "left";
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

    const message = document.createElement("pre");
    message.textContent = String(error);
    message.style.cssText =
      "position:fixed;top:20px;left:10px;" +
      "right:10px;color:red;background:#111;" +
      "padding:15px;z-index:9999;white-space:pre-wrap";

    document.body.appendChild(message);
    return;
  }

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
