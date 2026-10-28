
type Zombie = { x: number; y: number; hp: number; speed: number; radius: number };
type Bullet = { x: number; y: number; vx: number; vy: number; life: number };

const canvas = document.createElement("canvas");
const ctx = canvas.getContext("2d")!;
document.body.appendChild(canvas);

document.body.style.margin = "0";
document.body.style.background = "#101510";
document.body.style.overflow = "hidden";
canvas.style.display = "block";
canvas.style.touchAction = "none";

let width = 0;
let height = 0;

function resize() {
  width = canvas.width = window.innerWidth;
  height = canvas.height = window.innerHeight;
}
window.addEventListener("resize", resize);
resize();

const player = { x: width / 2, y: height / 2, hp: 100, radius: 15 };
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

const keys = new Set<string>();
window.addEventListener("keydown", e => keys.add(e.key.toLowerCase()));
window.addEventListener("keyup", e => keys.delete(e.key.toLowerCase()));

let touchX = 0;
let touchY = 0;
let moving = false;

canvas.addEventListener("pointerdown", e => {
  moving = true;
  touchX = e.clientX;
  touchY = e.clientY;
});
canvas.addEventListener("pointermove", e => {
  if (moving) {
    touchX = e.clientX;
    touchY = e.clientY;
  }
});
canvas.addEventListener("pointerup", () => moving = false);
canvas.addEventListener("pointercancel", () => moving = false);

function spawnZombie() {
  const side = Math.floor(Math.random() * 4);
  const x = side === 0 ? -20 : side === 1 ? width + 20 : Math.random() * width;
  const y = side === 2 ? -20 : side === 3 ? height + 20 : Math.random() * height;
  zombies.push({ x, y, hp: 1 + Math.floor(level / 3), speed: 45 + level * 5, radius: 13 });
}

function update(dt: number) {
  if (gameOver) return;

  let dx = 0, dy = 0;
  if (keys.has("a") || keys.has("arrowleft")) dx--;
  if (keys.has("d") || keys.has("arrowright")) dx++;
  if (keys.has("w") || keys.has("arrowup")) dy--;
  if (keys.has("s") || keys.has("arrowdown")) dy++;

  if (moving) {
    dx = touchX - player.x;
    dy = touchY - player.y;
    if (Math.hypot(dx, dy) < 20) dx = dy = 0;
  }

  const distance = Math.hypot(dx, dy);
  if (distance > 0) {
    player.x += dx / distance * 190 * dt;
    player.y += dy / distance * 190 * dt;
  }

  player.x = Math.max(15, Math.min(width - 15, player.x));
  player.y = Math.max(15, Math.min(height - 15, player.y));

  spawnTimer -= dt;
  if (spawnTimer <= 0) {
    spawnZombie();
    spawnTimer = Math.max(0.3, 1.5 - level * 0.08);
  }

  shootTimer -= dt;
  if (shootTimer <= 0 && zombies.length) {
    const nearest = zombies.reduce((a, b) =>
      Math.hypot(a.x - player.x, a.y - player.y) <
      Math.hypot(b.x - player.x, b.y - player.y) ? a : b
    );
    const angle = Math.atan2(nearest.y - player.y, nearest.x - player.x);
    bullets.push({
      x: player.x, y: player.y,
      vx: Math.cos(angle) * 400,
      vy: Math.sin(angle) * 400,
      life: 1.5
    });
    shootTimer = 0.35;
  }

  invulnerable = Math.max(0, invulnerable - dt);

  for (const zombie of zombies) {
    const angle = Math.atan2(player.y - zombie.y, player.x - zombie.x);
    zombie.x += Math.cos(angle) * zombie.speed * dt;
    zombie.y += Math.sin(angle) * zombie.speed * dt;

    if (Math.hypot(zombie.x - player.x, zombie.y - player.y) < 26 && invulnerable <= 0) {
      player.hp -= 10;
      invulnerable = 0.7;
      if (player.hp <= 0) gameOver = true;
    }
  }

  for (const bullet of bullets) {
    bullet.x += bullet.vx * dt;
    bullet.y += bullet.vy * dt;
    bullet.life -= dt;

    for (const zombie of zombies) {
      if (bullet.life <= 0) break;
      if (Math.hypot(bullet.x - zombie.x, bullet.y - zombie.y) < zombie.radius + 4) {
        zombie.hp--;
        bullet.life = 0;
        if (zombie.hp <= 0) {
          kills++;
          coins += 5;
          if (kills % 15 === 0) {
            level++;
            coins += level * 25;
            player.hp = Math.min(100, player.hp + 20);
          }
        }
      }
    }
  }

  for (let i = zombies.length - 1; i >= 0; i--)
    if (zombies[i].hp <= 0) zombies.splice(i, 1);

  for (let i = bullets.length - 1; i >= 0; i--)
    if (bullets[i].life <= 0) bullets.splice(i, 1);
}

function draw() {
  ctx.fillStyle = "#152219";
  ctx.fillRect(0, 0, width, height);

  ctx.strokeStyle = "#23382a";
  ctx.lineWidth = 1;
  for (let x = 0; x < width; x += 40) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
  }
  for (let y = 0; y < height; y += 40) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
  }

  ctx.fillStyle = invulnerable > 0 ? "#ffd36b" : "#e7c35a";
  ctx.beginPath();
  ctx.arc(player.x, player.y, player.radius, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = "#72bf75";
  for (const zombie of zombies) {
    ctx.beginPath();
    ctx.arc(zombie.x, zombie.y, zombie.radius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "#ffdf74";
  for (const bullet of bullets) {
    ctx.beginPath();
    ctx.arc(bullet.x, bullet.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.fillStyle = "white";
  ctx.font = "bold 17px Arial";
  ctx.fillText(`HP: ${Math.max(0, player.hp)}   Level: ${level}`, 15, 32);
  ctx.fillText(`Kills: ${kills}   Coins: ${coins}`, 15, 58);

  if (gameOver) {
    ctx.fillStyle = "#000b";
    ctx.fillRect(0, 0, width, height);
    ctx.textAlign = "center";
    ctx.fillStyle = "#ff6868";
    ctx.font = "bold 36px Arial";
    ctx.fillText("GAME OVER", width / 2, height / 2);
    ctx.font = "18px Arial";
    ctx.fillStyle = "white";
    ctx.fillText(`Level ${level} | ${kills} kills | ${coins} coins`, width / 2, height / 2 + 38);
    ctx.fillText("Refresh to restart", width / 2, height / 2 + 75);
    ctx.textAlign = "left";
  }
}

function frame(time: number) {
  const dt = Math.min((time - (lastTime || time)) / 1000, 0.05);
  lastTime = time;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
