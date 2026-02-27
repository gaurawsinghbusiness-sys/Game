const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const rand = (min, max) => Math.random() * (max - min) + min;
const distance = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

function normalize(x, y) {
  const len = Math.hypot(x, y);
  if (len === 0) {
    return { x: 0, y: 0 };
  }
  return { x: x / len, y: y / len };
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const abLenSq = abx * abx + aby * aby;
  if (abLenSq === 0) {
    return { distance: Math.hypot(px - ax, py - ay), closestX: ax, closestY: ay };
  }
  const t = clamp(((px - ax) * abx + (py - ay) * aby) / abLenSq, 0, 1);
  const closestX = ax + abx * t;
  const closestY = ay + aby * t;
  return { distance: Math.hypot(px - closestX, py - closestY), closestX, closestY };
}

class ShieldPainterGame {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");

    this.width = 0;
    this.height = 0;
    this.lastFrame = performance.now();

    this.mode = "menu";
    this.score = 0;
    this.bestScore = Number(localStorage.getItem("shieldPainterBest") || 0);
    this.firstRun = localStorage.getItem("shieldPainterTutorialSeen") !== "1";

    this.player = {
      x: 0,
      y: 0,
      radius: 18,
      hp: 3,
      maxHp: 3,
      speed: 290,
      invulnerableUntil: 0
    };

    this.moveInput = {
      active: false,
      pointerId: null,
      originX: 0,
      originY: 0,
      x: 0,
      y: 0
    };

    this.shieldInput = {
      active: false,
      pointerId: null,
      startX: 0,
      startY: 0,
      x: 0,
      y: 0
    };

    this.keys = {
      ArrowUp: false,
      ArrowDown: false,
      ArrowLeft: false,
      ArrowRight: false,
      KeyW: false,
      KeyA: false,
      KeyS: false,
      KeyD: false
    };

    this.maxStickRadius = 72;
    this.maxShieldLength = 180;
    this.shieldDurationMs = 500;
    this.shieldCooldownMs = 250;
    this.lastShieldAt = -9999;

    this.shield = null;
    this.shieldDraft = null;

    this.bullets = [];
    this.spawnTimerMs = 700;
    this.elapsedMs = 0;
    this.currentSpawnIntervalMs = 900;
    this.currentBulletSpeed = 170;
    this.maxBulletSpeed = 420;
    this.minSpawnIntervalMs = 260;

    this.combo = 0;
    this.lastDeflectAt = -9999;
    this.comboExpireAt = 0;

    this.setupEvents();
    this.resize();
    this.resetPlayerPosition();
    this.loop(this.lastFrame);
  }

  setupEvents() {
    window.addEventListener("resize", () => this.resize());
    window.addEventListener("keydown", (event) => {
      if (this.keys[event.code] !== undefined) {
        this.keys[event.code] = true;
      }
      if ((this.mode === "menu" || this.mode === "gameover") && event.code === "Space") {
        this.startGame();
      }
    });
    window.addEventListener("keyup", (event) => {
      if (this.keys[event.code] !== undefined) {
        this.keys[event.code] = false;
      }
    });

    this.canvas.addEventListener("pointerdown", (event) => this.onPointerDown(event));
    this.canvas.addEventListener("pointermove", (event) => this.onPointerMove(event));
    this.canvas.addEventListener("pointerup", (event) => this.onPointerUp(event));
    this.canvas.addEventListener("pointercancel", (event) => this.onPointerUp(event));
  }

  resize() {
    const ratio = window.devicePixelRatio || 1;
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = Math.floor(this.width * ratio);
    this.canvas.height = Math.floor(this.height * ratio);
    this.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    this.ctx.imageSmoothingEnabled = true;

    this.maxShieldLength = this.width * 0.3;
    this.maxStickRadius = clamp(this.width * 0.17, 56, 90);

    if (this.mode !== "playing") {
      this.resetPlayerPosition();
    }
  }

  resetPlayerPosition() {
    this.player.x = this.width * 0.5;
    this.player.y = this.height * 0.72;
  }

  toPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  onPointerDown(event) {
    const point = this.toPoint(event);

    if (this.mode === "menu" || this.mode === "gameover") {
      this.startGame();
      return;
    }
    if (this.mode !== "playing") {
      return;
    }

    if (!this.moveInput.active && point.x < this.width * 0.56) {
      this.moveInput.active = true;
      this.moveInput.pointerId = event.pointerId;
      this.moveInput.originX = point.x;
      this.moveInput.originY = point.y;
      this.moveInput.x = point.x;
      this.moveInput.y = point.y;
      return;
    }

    if (!this.shieldInput.active) {
      this.shieldInput.active = true;
      this.shieldInput.pointerId = event.pointerId;
      this.shieldInput.startX = point.x;
      this.shieldInput.startY = point.y;
      this.shieldInput.x = point.x;
      this.shieldInput.y = point.y;
      this.shieldDraft = {
        ax: point.x,
        ay: point.y,
        bx: point.x,
        by: point.y
      };
    }
  }

  onPointerMove(event) {
    if (this.mode !== "playing") {
      return;
    }

    const point = this.toPoint(event);

    if (this.moveInput.active && event.pointerId === this.moveInput.pointerId) {
      this.moveInput.x = point.x;
      this.moveInput.y = point.y;
      return;
    }

    if (this.shieldInput.active && event.pointerId === this.shieldInput.pointerId) {
      this.shieldInput.x = point.x;
      this.shieldInput.y = point.y;
      this.shieldDraft = this.makeShieldSegment(
        this.shieldInput.startX,
        this.shieldInput.startY,
        this.shieldInput.x,
        this.shieldInput.y
      );
    }
  }

  onPointerUp(event) {
    if (this.mode !== "playing") {
      return;
    }

    if (this.moveInput.active && event.pointerId === this.moveInput.pointerId) {
      this.moveInput.active = false;
      this.moveInput.pointerId = null;
    }

    if (this.shieldInput.active && event.pointerId === this.shieldInput.pointerId) {
      this.deployShield(this.lastFrame);
      this.shieldInput.active = false;
      this.shieldInput.pointerId = null;
      this.shieldDraft = null;
    }
  }

  makeShieldSegment(ax, ay, bx, by) {
    let dx = bx - ax;
    let dy = by - ay;
    let len = Math.hypot(dx, dy);

    if (len < 12) {
      dx = this.maxShieldLength * 0.7;
      dy = 0;
      len = Math.hypot(dx, dy);
    }

    const scale = len > this.maxShieldLength ? this.maxShieldLength / len : 1;
    const endX = ax + dx * scale;
    const endY = ay + dy * scale;

    return {
      ax: clamp(ax, 10, this.width - 10),
      ay: clamp(ay, 10, this.height - 10),
      bx: clamp(endX, 10, this.width - 10),
      by: clamp(endY, 10, this.height - 10)
    };
  }

  deployShield(nowMs) {
    if (nowMs - this.lastShieldAt < this.shieldCooldownMs) {
      return;
    }

    const segment = this.makeShieldSegment(
      this.shieldInput.startX,
      this.shieldInput.startY,
      this.shieldInput.x,
      this.shieldInput.y
    );

    this.shield = {
      ...segment,
      expiresAt: nowMs + this.shieldDurationMs
    };
    this.lastShieldAt = nowMs;
  }

  startGame() {
    this.mode = "playing";
    this.firstRun = false;
    localStorage.setItem("shieldPainterTutorialSeen", "1");

    this.score = 0;
    this.combo = 0;
    this.comboExpireAt = 0;
    this.lastDeflectAt = -9999;

    this.player.hp = this.player.maxHp;
    this.player.invulnerableUntil = 0;
    this.resetPlayerPosition();

    this.bullets.length = 0;
    this.shield = null;
    this.shieldDraft = null;
    this.spawnTimerMs = 700;
    this.elapsedMs = 0;
  }

  endGame() {
    this.mode = "gameover";
    if (this.score > this.bestScore) {
      this.bestScore = this.score;
      localStorage.setItem("shieldPainterBest", String(this.bestScore));
    }
    this.moveInput.active = false;
    this.shieldInput.active = false;
    this.shieldDraft = null;
  }

  spawnBullet() {
    const side = Math.floor(Math.random() * 4);
    const margin = 32;
    let x = 0;
    let y = 0;

    if (side === 0) {
      x = rand(0, this.width);
      y = -margin;
    } else if (side === 1) {
      x = this.width + margin;
      y = rand(0, this.height);
    } else if (side === 2) {
      x = rand(0, this.width);
      y = this.height + margin;
    } else {
      x = -margin;
      y = rand(0, this.height);
    }

    const tx = this.player.x + rand(-60, 60);
    const ty = this.player.y + rand(-60, 60);
    const direction = normalize(tx - x, ty - y);
    const speed = this.currentBulletSpeed * rand(0.95, 1.15);

    this.bullets.push({
      x,
      y,
      vx: direction.x * speed,
      vy: direction.y * speed,
      radius: 7,
      friendly: false,
      nearMissAwarded: false,
      lastBounceAt: -9999
    });
  }

  registerDeflect(nowMs) {
    if (nowMs - this.lastDeflectAt < 1200) {
      this.combo = clamp(this.combo + 1, 1, 12);
    } else {
      this.combo = 1;
    }
    this.lastDeflectAt = nowMs;
    this.comboExpireAt = nowMs + 1500;
    this.score += this.combo;
  }

  reflectIfNeeded(bullet, nowMs) {
    if (!this.shield || bullet.friendly || nowMs - bullet.lastBounceAt < 70) {
      return false;
    }

    const hit = distanceToSegment(
      bullet.x,
      bullet.y,
      this.shield.ax,
      this.shield.ay,
      this.shield.bx,
      this.shield.by
    );
    const threshold = bullet.radius + 5;
    if (hit.distance > threshold) {
      return false;
    }

    const sx = this.shield.bx - this.shield.ax;
    const sy = this.shield.by - this.shield.ay;
    let nx = -sy;
    let ny = sx;
    const nlen = Math.hypot(nx, ny);
    if (nlen === 0) {
      return false;
    }
    nx /= nlen;
    ny /= nlen;

    const towardNormal = bullet.vx * nx + bullet.vy * ny;
    if (towardNormal > 0) {
      nx *= -1;
      ny *= -1;
    }

    const velocityDotNormal = bullet.vx * nx + bullet.vy * ny;
    if (velocityDotNormal >= 0) {
      return false;
    }

    bullet.vx = bullet.vx - 2 * velocityDotNormal * nx;
    bullet.vy = bullet.vy - 2 * velocityDotNormal * ny;

    const baseSpeed = Math.hypot(bullet.vx, bullet.vy) * 1.08;
    const speed = Math.min(baseSpeed, this.currentBulletSpeed * 1.8);
    const nextDirection = normalize(bullet.vx, bullet.vy);
    bullet.vx = nextDirection.x * speed;
    bullet.vy = nextDirection.y * speed;
    bullet.x = hit.closestX + nx * (threshold + 2);
    bullet.y = hit.closestY + ny * (threshold + 2);
    bullet.friendly = true;
    bullet.lastBounceAt = nowMs;

    this.registerDeflect(nowMs);
    return true;
  }

  updateMovement(dt) {
    let dx = 0;
    let dy = 0;
    let intensity = 0;

    if (this.moveInput.active) {
      dx = this.moveInput.x - this.moveInput.originX;
      dy = this.moveInput.y - this.moveInput.originY;
      const len = Math.hypot(dx, dy);
      if (len > this.maxStickRadius) {
        const scale = this.maxStickRadius / len;
        dx *= scale;
        dy *= scale;
      }
      intensity = clamp(Math.hypot(dx, dy) / this.maxStickRadius, 0, 1);
    } else {
      const horizontal = (this.keys.ArrowRight || this.keys.KeyD ? 1 : 0) - (this.keys.ArrowLeft || this.keys.KeyA ? 1 : 0);
      const vertical = (this.keys.ArrowDown || this.keys.KeyS ? 1 : 0) - (this.keys.ArrowUp || this.keys.KeyW ? 1 : 0);
      if (horizontal !== 0 || vertical !== 0) {
        const normalized = normalize(horizontal, vertical);
        dx = normalized.x;
        dy = normalized.y;
        intensity = 1;
      }
    }

    if (intensity > 0) {
      const direction = normalize(dx, dy);
      this.player.x += direction.x * this.player.speed * intensity * dt;
      this.player.y += direction.y * this.player.speed * intensity * dt;
    }

    const margin = this.player.radius + 8;
    this.player.x = clamp(this.player.x, margin, this.width - margin);
    this.player.y = clamp(this.player.y, margin, this.height - margin);
  }

  updateGame(dt, nowMs) {
    this.elapsedMs += dt * 1000;
    const difficulty = clamp(this.elapsedMs / 90000, 0, 1);
    this.currentSpawnIntervalMs = this.minSpawnIntervalMs + (1 - difficulty) * (900 - this.minSpawnIntervalMs);
    this.currentBulletSpeed = 170 + difficulty * (this.maxBulletSpeed - 170);

    this.updateMovement(dt);

    if (this.shield && nowMs > this.shield.expiresAt) {
      this.shield = null;
    }
    if (this.combo > 0 && nowMs > this.comboExpireAt) {
      this.combo = 0;
    }

    this.spawnTimerMs -= dt * 1000;
    while (this.spawnTimerMs <= 0) {
      this.spawnBullet();
      this.spawnTimerMs += this.currentSpawnIntervalMs;
      if (Math.random() < difficulty * 0.35) {
        this.spawnBullet();
      }
    }

    const nextBullets = [];
    for (const bullet of this.bullets) {
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;

      this.reflectIfNeeded(bullet, nowMs);

      if (!bullet.friendly) {
        const playerDistance = distance(bullet.x, bullet.y, this.player.x, this.player.y);
        if (
          !bullet.nearMissAwarded &&
          playerDistance < this.player.radius + 34 &&
          playerDistance > this.player.radius + bullet.radius + 2
        ) {
          bullet.nearMissAwarded = true;
          this.score += 2;
        }

        if (
          playerDistance < this.player.radius + bullet.radius &&
          nowMs > this.player.invulnerableUntil
        ) {
          this.player.hp -= 1;
          this.player.invulnerableUntil = nowMs + 850;
          this.combo = 0;
          this.comboExpireAt = 0;
          if (this.player.hp <= 0) {
            this.endGame();
            return;
          }
          continue;
        }
      }

      const outOfBounds =
        bullet.x < -140 ||
        bullet.x > this.width + 140 ||
        bullet.y < -140 ||
        bullet.y > this.height + 140;
      if (!outOfBounds) {
        nextBullets.push(bullet);
      }
    }
    this.bullets = nextBullets;
  }

  drawBackground(nowMs) {
    const pulse = 0.06 + Math.sin(nowMs * 0.0012) * 0.04;
    const gradient = this.ctx.createLinearGradient(0, 0, 0, this.height);
    gradient.addColorStop(0, `rgba(18, 29, 52, ${0.95 + pulse})`);
    gradient.addColorStop(1, "rgba(6, 9, 18, 1)");
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, 0, this.width, this.height);

    this.ctx.strokeStyle = "rgba(120, 160, 210, 0.12)";
    this.ctx.lineWidth = 1;
    const spacing = 42;
    for (let x = 0; x < this.width; x += spacing) {
      this.ctx.beginPath();
      this.ctx.moveTo(x + 0.5, 0);
      this.ctx.lineTo(x + 0.5, this.height);
      this.ctx.stroke();
    }
    for (let y = 0; y < this.height; y += spacing) {
      this.ctx.beginPath();
      this.ctx.moveTo(0, y + 0.5);
      this.ctx.lineTo(this.width, y + 0.5);
      this.ctx.stroke();
    }
  }

  drawShield() {
    if (this.shield) {
      this.ctx.strokeStyle = "rgba(92, 243, 255, 0.95)";
      this.ctx.lineWidth = 8;
      this.ctx.lineCap = "round";
      this.ctx.shadowBlur = 18;
      this.ctx.shadowColor = "rgba(92, 243, 255, 0.85)";
      this.ctx.beginPath();
      this.ctx.moveTo(this.shield.ax, this.shield.ay);
      this.ctx.lineTo(this.shield.bx, this.shield.by);
      this.ctx.stroke();
      this.ctx.shadowBlur = 0;
    }

    if (this.shieldDraft) {
      this.ctx.strokeStyle = "rgba(255, 236, 165, 0.75)";
      this.ctx.lineWidth = 4;
      this.ctx.setLineDash([8, 8]);
      this.ctx.lineCap = "round";
      this.ctx.beginPath();
      this.ctx.moveTo(this.shieldDraft.ax, this.shieldDraft.ay);
      this.ctx.lineTo(this.shieldDraft.bx, this.shieldDraft.by);
      this.ctx.stroke();
      this.ctx.setLineDash([]);
    }
  }

  drawPlayer(nowMs) {
    const invulnerable = nowMs < this.player.invulnerableUntil;
    if (invulnerable && Math.floor(nowMs / 80) % 2 === 0) {
      return;
    }
    this.ctx.fillStyle = "#ffffff";
    this.ctx.beginPath();
    this.ctx.arc(this.player.x, this.player.y, this.player.radius, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.strokeStyle = "rgba(57, 225, 247, 0.95)";
    this.ctx.lineWidth = 4;
    this.ctx.beginPath();
    this.ctx.arc(this.player.x, this.player.y, this.player.radius + 6, 0, Math.PI * 2);
    this.ctx.stroke();
  }

  drawBullets() {
    for (const bullet of this.bullets) {
      this.ctx.fillStyle = bullet.friendly ? "#59f6ff" : "#ff5f73";
      this.ctx.beginPath();
      this.ctx.arc(bullet.x, bullet.y, bullet.radius, 0, Math.PI * 2);
      this.ctx.fill();
    }
  }

  drawControls() {
    if (!this.moveInput.active) {
      return;
    }

    const dx = this.moveInput.x - this.moveInput.originX;
    const dy = this.moveInput.y - this.moveInput.originY;
    const len = Math.hypot(dx, dy);
    const scale = len > this.maxStickRadius ? this.maxStickRadius / len : 1;
    const knobX = this.moveInput.originX + dx * scale;
    const knobY = this.moveInput.originY + dy * scale;

    this.ctx.strokeStyle = "rgba(255,255,255,0.35)";
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.arc(this.moveInput.originX, this.moveInput.originY, this.maxStickRadius, 0, Math.PI * 2);
    this.ctx.stroke();

    this.ctx.fillStyle = "rgba(255,255,255,0.2)";
    this.ctx.beginPath();
    this.ctx.arc(knobX, knobY, 22, 0, Math.PI * 2);
    this.ctx.fill();
  }

  drawHud(nowMs) {
    this.ctx.fillStyle = "rgba(8, 14, 26, 0.7)";
    this.ctx.fillRect(12, 12, this.width - 24, 56);

    this.ctx.fillStyle = "#ecf6ff";
    this.ctx.font = "bold 22px 'Trebuchet MS', sans-serif";
    this.ctx.textAlign = "left";
    this.ctx.fillText(`Score ${this.score}`, 24, 46);

    this.ctx.textAlign = "right";
    this.ctx.fillText(`Best ${this.bestScore}`, this.width - 24, 46);

    this.ctx.fillStyle = "#ffd76d";
    this.ctx.font = "bold 18px 'Trebuchet MS', sans-serif";
    this.ctx.textAlign = "left";
    this.ctx.fillText(`Combo x${Math.max(1, this.combo)}`, 24, 86);

    this.ctx.fillStyle = "#ff7f8d";
    this.ctx.textAlign = "right";
    this.ctx.fillText(`HP ${this.player.hp}`, this.width - 24, 86);

    const cooldownProgress = clamp(
      (nowMs - this.lastShieldAt) / this.shieldCooldownMs,
      0,
      1
    );
    const barWidth = this.width - 24;
    const barY = this.height - 22;
    this.ctx.fillStyle = "rgba(255,255,255,0.12)";
    this.ctx.fillRect(12, barY, barWidth, 10);
    this.ctx.fillStyle = "rgba(92, 243, 255, 0.9)";
    this.ctx.fillRect(12, barY, barWidth * cooldownProgress, 10);
  }

  drawMenu() {
    this.ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
    this.ctx.fillRect(0, 0, this.width, this.height);

    this.ctx.fillStyle = "#eff7ff";
    this.ctx.textAlign = "center";
    this.ctx.font = "bold 52px 'Trebuchet MS', sans-serif";
    this.ctx.fillText("Shield Painter", this.width * 0.5, this.height * 0.3);

    this.ctx.font = "bold 22px 'Trebuchet MS', sans-serif";
    this.ctx.fillStyle = "#77efff";
    this.ctx.fillText("Deflect. Survive. Chain combos.", this.width * 0.5, this.height * 0.36);

    this.ctx.font = "20px 'Trebuchet MS', sans-serif";
    this.ctx.fillStyle = "#f6fbff";
    this.ctx.fillText("Left thumb: move", this.width * 0.5, this.height * 0.46);
    this.ctx.fillText("Right thumb: draw a shield line", this.width * 0.5, this.height * 0.51);
    this.ctx.fillText("Shield lasts 0.5s, cooldown 0.25s", this.width * 0.5, this.height * 0.56);

    if (this.firstRun) {
      this.ctx.fillStyle = "#ffe08f";
      this.ctx.fillText("Tip: near misses give bonus points", this.width * 0.5, this.height * 0.64);
    }

    this.ctx.fillStyle = "#9be8ff";
    this.ctx.font = "bold 24px 'Trebuchet MS', sans-serif";
    this.ctx.fillText("Tap to start", this.width * 0.5, this.height * 0.76);
  }

  drawGameOver() {
    this.ctx.fillStyle = "rgba(0, 0, 0, 0.48)";
    this.ctx.fillRect(0, 0, this.width, this.height);

    this.ctx.textAlign = "center";
    this.ctx.fillStyle = "#ffffff";
    this.ctx.font = "bold 56px 'Trebuchet MS', sans-serif";
    this.ctx.fillText("Game Over", this.width * 0.5, this.height * 0.38);

    this.ctx.font = "bold 30px 'Trebuchet MS', sans-serif";
    this.ctx.fillStyle = "#89f4ff";
    this.ctx.fillText(`Score ${this.score}`, this.width * 0.5, this.height * 0.47);
    this.ctx.fillText(`Best ${this.bestScore}`, this.width * 0.5, this.height * 0.53);

    this.ctx.font = "bold 22px 'Trebuchet MS', sans-serif";
    this.ctx.fillStyle = "#ffd877";
    this.ctx.fillText("Tap to retry", this.width * 0.5, this.height * 0.66);
  }

  render(nowMs) {
    this.drawBackground(nowMs);
    this.drawShield();
    this.drawBullets();
    this.drawPlayer(nowMs);
    this.drawControls();

    if (this.mode === "playing") {
      this.drawHud(nowMs);
    } else if (this.mode === "menu") {
      this.drawMenu();
    } else if (this.mode === "gameover") {
      this.drawGameOver();
    }
  }

  loop(nowMs) {
    const dtMs = clamp(nowMs - this.lastFrame, 0, 34);
    const dt = dtMs / 1000;
    this.lastFrame = nowMs;

    if (this.mode === "playing") {
      this.updateGame(dt, nowMs);
    }

    this.render(nowMs);
    requestAnimationFrame((time) => this.loop(time));
  }
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    return;
  }
  const localhost = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  if (!localhost && location.protocol !== "https:") {
    return;
  }

  window.addEventListener("load", async () => {
    try {
      await navigator.serviceWorker.register("/sw.js");
    } catch (error) {
      console.error("Service worker registration failed:", error);
    }
  });
}

const canvas = document.querySelector("#gameCanvas");
new ShieldPainterGame(canvas);
registerServiceWorker();
