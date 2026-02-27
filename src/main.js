const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const rand = (min, max) => Math.random() * (max - min) + min;
const distance = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const lerp = (from, to, t) => from + (to - from) * t;

function normalize(x, y) {
  const length = Math.hypot(x, y);
  if (!length) {
    return { x: 0, y: 0 };
  }
  return { x: x / length, y: y / length };
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const abLenSq = abx * abx + aby * aby;
  if (abLenSq === 0) {
    return { distance: Math.hypot(px - ax, py - ay), closestX: ax, closestY: ay, t: 0 };
  }
  const t = clamp(((px - ax) * abx + (py - ay) * aby) / abLenSq, 0, 1);
  const closestX = ax + abx * t;
  const closestY = ay + aby * t;
  return { distance: Math.hypot(px - closestX, py - closestY), closestX, closestY, t };
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
      vx: 0,
      vy: 0,
      radius: 17,
      hp: 3,
      maxHp: 3,
      maxSpeed: 340,
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
    this.shieldCooldownMs = 240;
    this.lastShieldAt = -9999;

    this.shield = null;
    this.shieldDraft = null;

    this.bullets = [];
    this.turrets = [];
    this.particles = [];
    this.floatingTexts = [];

    this.wave = 1;
    this.kills = 0;
    this.elapsedMs = 0;
    this.nextWaveAtMs = 18000;
    this.turretRespawnTimerMs = 0;
    this.edgeVolleyTimerMs = 2600;

    this.combo = 0;
    this.lastDeflectAt = -9999;
    this.comboExpireAt = 0;

    this.screenShakeMs = 0;
    this.screenShakePower = 0;

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

    this.maxShieldLength = clamp(this.width * 0.32, 130, 240);
    this.maxStickRadius = clamp(this.width * 0.18, 56, 94);

    if (this.mode !== "playing") {
      this.resetPlayerPosition();
    }
  }

  resetPlayerPosition() {
    this.player.x = this.width * 0.5;
    this.player.y = this.height * 0.72;
    this.player.vx = 0;
    this.player.vy = 0;
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

    if (!this.moveInput.active && point.x < this.width * 0.55) {
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
      this.shieldDraft = { ax: point.x, ay: point.y, bx: point.x, by: point.y };
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

  startGame() {
    this.mode = "playing";
    this.firstRun = false;
    localStorage.setItem("shieldPainterTutorialSeen", "1");

    this.score = 0;
    this.kills = 0;
    this.wave = 1;
    this.elapsedMs = 0;
    this.nextWaveAtMs = 18000;
    this.edgeVolleyTimerMs = 2400;
    this.turretRespawnTimerMs = 0;
    this.combo = 0;
    this.comboExpireAt = 0;
    this.lastDeflectAt = -9999;

    this.player.hp = this.player.maxHp;
    this.player.invulnerableUntil = 0;
    this.resetPlayerPosition();

    this.shield = null;
    this.shieldDraft = null;
    this.lastShieldAt = -9999;
    this.screenShakeMs = 0;
    this.screenShakePower = 0;

    this.bullets.length = 0;
    this.turrets.length = 0;
    this.particles.length = 0;
    this.floatingTexts.length = 0;

    this.spawnTurret();
    this.spawnTurret();
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

  makeShieldSegment(ax, ay, bx, by) {
    let dx = bx - ax;
    let dy = by - ay;
    let length = Math.hypot(dx, dy);

    if (length < 12) {
      dx = this.maxShieldLength * 0.8;
      dy = 0;
      length = Math.hypot(dx, dy);
    }

    const scale = length > this.maxShieldLength ? this.maxShieldLength / length : 1;
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
      bornAt: nowMs,
      expiresAt: nowMs + this.shieldDurationMs
    };
    this.lastShieldAt = nowMs;
  }

  spawnTurret() {
    const margin = 52;
    const safeDistance = 160;
    let x = this.width * 0.5;
    let y = 90;

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const side = Math.floor(Math.random() * 4);
      if (side === 0) {
        x = rand(margin, this.width - margin);
        y = rand(margin, this.height * 0.22);
      } else if (side === 1) {
        x = rand(this.width * 0.75, this.width - margin);
        y = rand(margin, this.height - margin);
      } else if (side === 2) {
        x = rand(margin, this.width - margin);
        y = rand(this.height * 0.78, this.height - margin);
      } else {
        x = rand(margin, this.width * 0.25);
        y = rand(margin, this.height - margin);
      }

      if (distance(x, y, this.player.x, this.player.y) > safeDistance) {
        break;
      }
    }

    const baseHp = 2 + Math.floor((this.wave - 1) / 3);
    const baseFireMs = clamp(1450 - this.wave * 85 + rand(-120, 120), 530, 1450);
    this.turrets.push({
      x,
      y,
      radius: 21,
      hp: baseHp,
      maxHp: baseHp,
      fireTimerMs: rand(380, 930),
      baseFireMs,
      pulse: rand(0, Math.PI * 2),
      dead: false
    });
  }

  spawnEdgeVolley(difficulty) {
    const side = Math.floor(Math.random() * 4);
    const margin = 36;
    let x = 0;
    let y = 0;

    if (side === 0) {
      x = rand(24, this.width - 24);
      y = -margin;
    } else if (side === 1) {
      x = this.width + margin;
      y = rand(24, this.height - 24);
    } else if (side === 2) {
      x = rand(24, this.width - 24);
      y = this.height + margin;
    } else {
      x = -margin;
      y = rand(24, this.height - 24);
    }

    const lead = 0.22 + difficulty * 0.22;
    const targetX = this.player.x + this.player.vx * lead;
    const targetY = this.player.y + this.player.vy * lead;
    const speed = 188 + difficulty * 160;
    this.spawnBullet(x, y, targetX, targetY, speed, false);
  }

  spawnBullet(x, y, targetX, targetY, speed, friendly) {
    const direction = normalize(targetX - x, targetY - y);
    this.bullets.push({
      x,
      y,
      vx: direction.x * speed,
      vy: direction.y * speed,
      radius: friendly ? 6 : 7,
      friendly,
      nearMissAwarded: false,
      lastBounceAt: -9999,
      lifeMs: friendly ? 3000 : 7000
    });
  }

  addFloatingText(x, y, text, color = "#9cf7ff", size = 18) {
    this.floatingTexts.push({
      x,
      y,
      text,
      color,
      size,
      ttlMs: 900
    });
  }

  addParticleBurst(x, y, color, count, minSpeed, maxSpeed, lifeMs) {
    for (let index = 0; index < count; index += 1) {
      const angle = rand(0, Math.PI * 2);
      const speed = rand(minSpeed, maxSpeed);
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: rand(1.6, 3.8),
        ttlMs: lifeMs,
        maxTtlMs: lifeMs,
        color
      });
    }
  }

  pulseVibration(pattern) {
    if (!navigator.vibrate) {
      return;
    }
    navigator.vibrate(pattern);
  }

  shake(power, durationMs) {
    this.screenShakePower = Math.max(this.screenShakePower, power);
    this.screenShakeMs = Math.max(this.screenShakeMs, durationMs);
  }

  registerDeflect(nowMs, hitOnCenter) {
    if (nowMs - this.lastDeflectAt < 1250) {
      this.combo = clamp(this.combo + 1, 1, 12);
    } else {
      this.combo = 1;
    }
    this.lastDeflectAt = nowMs;
    this.comboExpireAt = nowMs + 1500;

    const baseGain = hitOnCenter ? 3 : 2;
    this.score += baseGain + this.combo;
    if (hitOnCenter) {
      this.addFloatingText(this.player.x, this.player.y - 44, "Perfect Deflect", "#ffd878", 15);
    }
  }

  reflectIfNeeded(bullet, nowMs) {
    if (!this.shield || bullet.friendly || nowMs - bullet.lastBounceAt < 80) {
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
    const normalLength = Math.hypot(nx, ny);
    if (!normalLength) {
      return false;
    }
    nx /= normalLength;
    ny /= normalLength;

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

    const speed = Math.min(Math.hypot(bullet.vx, bullet.vy) * 1.15, 530);
    const reflected = normalize(bullet.vx, bullet.vy);
    bullet.vx = reflected.x * speed;
    bullet.vy = reflected.y * speed;
    bullet.x = hit.closestX + nx * (threshold + 2);
    bullet.y = hit.closestY + ny * (threshold + 2);
    bullet.friendly = true;
    bullet.radius = 6;
    bullet.lifeMs = 2800;
    bullet.lastBounceAt = nowMs;

    const centeredHit = Math.abs(hit.t - 0.5) < 0.18;
    this.registerDeflect(nowMs, centeredHit);
    this.addParticleBurst(bullet.x, bullet.y, "#72f6ff", 9, 55, 190, 350);
    this.shake(4, 80);
    return true;
  }

  hitPlayer(nowMs) {
    if (nowMs <= this.player.invulnerableUntil) {
      return;
    }
    this.player.hp -= 1;
    this.player.invulnerableUntil = nowMs + 900;
    this.combo = 0;
    this.comboExpireAt = 0;
    this.shake(10, 160);
    this.pulseVibration([20, 35, 20]);
    this.addParticleBurst(this.player.x, this.player.y, "#ff617f", 16, 70, 260, 420);

    if (this.player.hp <= 0) {
      this.endGame();
    }
  }

  getMovementVector() {
    if (this.moveInput.active) {
      let dx = this.moveInput.x - this.moveInput.originX;
      let dy = this.moveInput.y - this.moveInput.originY;
      const length = Math.hypot(dx, dy);
      if (length > this.maxStickRadius) {
        const scale = this.maxStickRadius / length;
        dx *= scale;
        dy *= scale;
      }
      const intensity = clamp(Math.hypot(dx, dy) / this.maxStickRadius, 0, 1);
      const direction = normalize(dx, dy);
      return { x: direction.x, y: direction.y, intensity };
    }

    const horizontal =
      (this.keys.ArrowRight || this.keys.KeyD ? 1 : 0) -
      (this.keys.ArrowLeft || this.keys.KeyA ? 1 : 0);
    const vertical =
      (this.keys.ArrowDown || this.keys.KeyS ? 1 : 0) -
      (this.keys.ArrowUp || this.keys.KeyW ? 1 : 0);
    if (!horizontal && !vertical) {
      return { x: 0, y: 0, intensity: 0 };
    }
    const direction = normalize(horizontal, vertical);
    return { x: direction.x, y: direction.y, intensity: 1 };
  }

  updateMovement(dt) {
    const move = this.getMovementVector();
    const targetVx = move.x * this.player.maxSpeed * move.intensity;
    const targetVy = move.y * this.player.maxSpeed * move.intensity;
    const response = clamp(12 * dt, 0, 1);

    this.player.vx = lerp(this.player.vx, targetVx, response);
    this.player.vy = lerp(this.player.vy, targetVy, response);

    if (move.intensity < 0.02) {
      const drag = Math.pow(0.82, dt * 60);
      this.player.vx *= drag;
      this.player.vy *= drag;
    }

    this.player.x += this.player.vx * dt;
    this.player.y += this.player.vy * dt;

    const margin = this.player.radius + 8;
    this.player.x = clamp(this.player.x, margin, this.width - margin);
    this.player.y = clamp(this.player.y, margin, this.height - margin);
  }

  updateTurrets(dt, difficulty) {
    const targetCount = clamp(2 + Math.floor(this.wave * 0.9), 2, 7);
    this.turretRespawnTimerMs -= dt * 1000;
    if (this.turrets.length < targetCount && this.turretRespawnTimerMs <= 0) {
      this.spawnTurret();
      this.turretRespawnTimerMs = clamp(1900 - this.wave * 110, 700, 1900);
    }

    for (const turret of this.turrets) {
      turret.pulse += dt * 4.2;
      turret.fireTimerMs -= dt * 1000;
      if (turret.fireTimerMs > 0) {
        continue;
      }

      const lead = 0.2 + difficulty * 0.25;
      const targetX = this.player.x + this.player.vx * lead;
      const targetY = this.player.y + this.player.vy * lead;
      const bulletSpeed = 180 + difficulty * 190;
      this.spawnBullet(turret.x, turret.y, targetX, targetY, bulletSpeed, false);
      turret.fireTimerMs = clamp(turret.baseFireMs + rand(-90, 90), 520, 1700);
    }
  }

  updateBullets(dt, nowMs) {
    const remainingBullets = [];

    for (const bullet of this.bullets) {
      bullet.lifeMs -= dt * 1000;
      bullet.x += bullet.vx * dt;
      bullet.y += bullet.vy * dt;

      this.reflectIfNeeded(bullet, nowMs);

      if (!bullet.friendly) {
        const playerDistance = distance(bullet.x, bullet.y, this.player.x, this.player.y);
        if (
          !bullet.nearMissAwarded &&
          playerDistance < this.player.radius + 32 &&
          playerDistance > this.player.radius + bullet.radius + 2
        ) {
          bullet.nearMissAwarded = true;
          this.score += 1;
          this.addFloatingText(this.player.x, this.player.y - 34, "+1 Near", "#ffc982", 14);
        }

        if (playerDistance < this.player.radius + bullet.radius) {
          this.hitPlayer(nowMs);
          if (this.mode !== "playing") {
            return;
          }
          continue;
        }
      } else {
        let turretHit = null;
        for (const turret of this.turrets) {
          if (turret.dead) {
            continue;
          }
          if (distance(bullet.x, bullet.y, turret.x, turret.y) < turret.radius + bullet.radius + 1) {
            turretHit = turret;
            break;
          }
        }

        if (turretHit) {
          turretHit.hp -= 1;
          const damageScore = 6 + Math.floor(this.combo * 0.5);
          this.score += damageScore;
          this.addParticleBurst(bullet.x, bullet.y, "#88f7ff", 10, 70, 210, 380);
          this.addFloatingText(turretHit.x, turretHit.y - 26, `+${damageScore}`, "#9ff8ff", 14);
          this.shake(4, 80);

          if (turretHit.hp <= 0) {
            turretHit.dead = true;
            this.kills += 1;
            const killScore = 20 + this.wave * 3;
            this.score += killScore;
            this.addFloatingText(turretHit.x, turretHit.y - 44, `CORE DOWN +${killScore}`, "#ffd875", 16);
            this.addParticleBurst(turretHit.x, turretHit.y, "#ff607d", 18, 80, 280, 520);
            this.addParticleBurst(turretHit.x, turretHit.y, "#6cf7ff", 12, 60, 240, 520);
            this.shake(10, 150);
            this.pulseVibration([12, 20, 12]);
          }
          continue;
        }
      }

      const outOfBounds =
        bullet.x < -160 ||
        bullet.x > this.width + 160 ||
        bullet.y < -160 ||
        bullet.y > this.height + 160;
      if (!outOfBounds && bullet.lifeMs > 0) {
        remainingBullets.push(bullet);
      }
    }

    this.bullets = remainingBullets;
    this.turrets = this.turrets.filter((turret) => !turret.dead);
  }

  updateParticles(dt) {
    const nextParticles = [];
    for (const particle of this.particles) {
      particle.ttlMs -= dt * 1000;
      if (particle.ttlMs <= 0) {
        continue;
      }
      const drag = Math.pow(0.9, dt * 60);
      particle.vx *= drag;
      particle.vy *= drag;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      nextParticles.push(particle);
    }
    this.particles = nextParticles;
  }

  updateFloatingTexts(dt) {
    const nextTexts = [];
    for (const text of this.floatingTexts) {
      text.ttlMs -= dt * 1000;
      if (text.ttlMs <= 0) {
        continue;
      }
      text.y -= 30 * dt;
      nextTexts.push(text);
    }
    this.floatingTexts = nextTexts;
  }

  updateGame(dt, nowMs) {
    this.elapsedMs += dt * 1000;

    if (this.elapsedMs >= this.nextWaveAtMs) {
      this.wave += 1;
      this.nextWaveAtMs += 18000;
      this.addFloatingText(this.width * 0.5, this.height * 0.28, `Wave ${this.wave}`, "#8cf4ff", 26);
      this.shake(6, 120);
    }

    if (this.combo > 0 && nowMs > this.comboExpireAt) {
      this.combo = 0;
    }
    if (this.shield && nowMs > this.shield.expiresAt) {
      this.shield = null;
    }

    const difficulty = clamp(this.elapsedMs / 110000, 0, 1.15);
    this.edgeVolleyTimerMs -= dt * 1000;
    if (this.edgeVolleyTimerMs <= 0) {
      this.spawnEdgeVolley(difficulty);
      this.edgeVolleyTimerMs = clamp(2700 - this.wave * 160, 900, 2600);
    }

    if (this.screenShakeMs > 0) {
      this.screenShakeMs = Math.max(0, this.screenShakeMs - dt * 1000);
      if (this.screenShakeMs === 0) {
        this.screenShakePower = 0;
      }
    }

    this.updateMovement(dt);
    this.updateTurrets(dt, difficulty);
    this.updateBullets(dt, nowMs);
    if (this.mode !== "playing") {
      return;
    }
    this.updateParticles(dt);
    this.updateFloatingTexts(dt);
  }

  drawBackground(nowMs) {
    const pulse = 0.055 + Math.sin(nowMs * 0.0014) * 0.045;
    const gradient = this.ctx.createLinearGradient(0, 0, 0, this.height);
    gradient.addColorStop(0, `rgba(18, 31, 56, ${0.94 + pulse})`);
    gradient.addColorStop(1, "rgba(4, 8, 18, 1)");
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, 0, this.width, this.height);

    this.ctx.strokeStyle = "rgba(110, 156, 214, 0.1)";
    this.ctx.lineWidth = 1;
    const spacing = 44;
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

  drawTurrets() {
    for (const turret of this.turrets) {
      const pulseScale = 1 + Math.sin(turret.pulse) * 0.08;
      const radius = turret.radius * pulseScale;

      this.ctx.fillStyle = "rgba(255, 95, 122, 0.22)";
      this.ctx.beginPath();
      this.ctx.arc(turret.x, turret.y, radius + 8, 0, Math.PI * 2);
      this.ctx.fill();

      this.ctx.fillStyle = "#132137";
      this.ctx.beginPath();
      this.ctx.arc(turret.x, turret.y, radius, 0, Math.PI * 2);
      this.ctx.fill();

      this.ctx.strokeStyle = "#ff5f7a";
      this.ctx.lineWidth = 4;
      this.ctx.beginPath();
      this.ctx.arc(turret.x, turret.y, radius, 0, Math.PI * 2);
      this.ctx.stroke();

      this.ctx.fillStyle = "#ff7a91";
      this.ctx.beginPath();
      this.ctx.arc(turret.x, turret.y, 6, 0, Math.PI * 2);
      this.ctx.fill();

      const hpRatio = clamp(turret.hp / turret.maxHp, 0, 1);
      const barWidth = radius * 2;
      this.ctx.fillStyle = "rgba(255,255,255,0.2)";
      this.ctx.fillRect(turret.x - barWidth * 0.5, turret.y + radius + 10, barWidth, 4);
      this.ctx.fillStyle = "#ff7f95";
      this.ctx.fillRect(turret.x - barWidth * 0.5, turret.y + radius + 10, barWidth * hpRatio, 4);
    }
  }

  drawShield(nowMs) {
    if (this.shield) {
      const shieldPulse = 0.7 + Math.sin((nowMs - this.shield.bornAt) * 0.03) * 0.3;
      this.ctx.strokeStyle = `rgba(92, 243, 255, ${0.85 + shieldPulse * 0.15})`;
      this.ctx.lineWidth = 8;
      this.ctx.lineCap = "round";
      this.ctx.shadowBlur = 16;
      this.ctx.shadowColor = "rgba(92, 243, 255, 0.8)";
      this.ctx.beginPath();
      this.ctx.moveTo(this.shield.ax, this.shield.ay);
      this.ctx.lineTo(this.shield.bx, this.shield.by);
      this.ctx.stroke();
      this.ctx.shadowBlur = 0;
    }

    if (this.shieldDraft) {
      this.ctx.strokeStyle = "rgba(255, 236, 165, 0.78)";
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

  drawBullets() {
    for (const bullet of this.bullets) {
      if (bullet.friendly) {
        this.ctx.fillStyle = "#73f8ff";
        this.ctx.shadowBlur = 12;
        this.ctx.shadowColor = "rgba(115, 248, 255, 0.8)";
      } else {
        this.ctx.fillStyle = "#ff6079";
        this.ctx.shadowBlur = 8;
        this.ctx.shadowColor = "rgba(255, 96, 121, 0.6)";
      }

      this.ctx.beginPath();
      this.ctx.arc(bullet.x, bullet.y, bullet.radius, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.shadowBlur = 0;
    }
  }

  drawParticles() {
    for (const particle of this.particles) {
      const alpha = clamp(particle.ttlMs / particle.maxTtlMs, 0, 1);
      this.ctx.globalAlpha = alpha;
      this.ctx.fillStyle = particle.color;
      this.ctx.beginPath();
      this.ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2);
      this.ctx.fill();
    }
    this.ctx.globalAlpha = 1;
  }

  drawPlayer(nowMs) {
    const invulnerable = nowMs < this.player.invulnerableUntil;
    if (invulnerable && Math.floor(nowMs / 80) % 2 === 0) {
      return;
    }

    this.ctx.fillStyle = "#f9fcff";
    this.ctx.beginPath();
    this.ctx.arc(this.player.x, this.player.y, this.player.radius, 0, Math.PI * 2);
    this.ctx.fill();

    this.ctx.strokeStyle = "rgba(57, 225, 247, 0.96)";
    this.ctx.lineWidth = 4;
    this.ctx.beginPath();
    this.ctx.arc(this.player.x, this.player.y, this.player.radius + 6, 0, Math.PI * 2);
    this.ctx.stroke();
  }

  drawControls() {
    if (!this.moveInput.active) {
      return;
    }

    const dx = this.moveInput.x - this.moveInput.originX;
    const dy = this.moveInput.y - this.moveInput.originY;
    const length = Math.hypot(dx, dy);
    const scale = length > this.maxStickRadius ? this.maxStickRadius / length : 1;
    const knobX = this.moveInput.originX + dx * scale;
    const knobY = this.moveInput.originY + dy * scale;

    this.ctx.strokeStyle = "rgba(255,255,255,0.34)";
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();
    this.ctx.arc(this.moveInput.originX, this.moveInput.originY, this.maxStickRadius, 0, Math.PI * 2);
    this.ctx.stroke();

    this.ctx.fillStyle = "rgba(255,255,255,0.2)";
    this.ctx.beginPath();
    this.ctx.arc(knobX, knobY, 22, 0, Math.PI * 2);
    this.ctx.fill();
  }

  drawFloatingTexts() {
    this.ctx.textAlign = "center";
    for (const text of this.floatingTexts) {
      const alpha = clamp(text.ttlMs / 900, 0, 1);
      this.ctx.fillStyle = text.color;
      this.ctx.globalAlpha = alpha;
      this.ctx.font = `bold ${text.size}px 'Trebuchet MS', sans-serif`;
      this.ctx.fillText(text.text, text.x, text.y);
    }
    this.ctx.globalAlpha = 1;
  }

  drawHud(nowMs) {
    this.ctx.fillStyle = "rgba(8, 14, 26, 0.72)";
    this.ctx.fillRect(12, 12, this.width - 24, 58);

    this.ctx.fillStyle = "#ecf6ff";
    this.ctx.font = "bold 21px 'Trebuchet MS', sans-serif";
    this.ctx.textAlign = "left";
    this.ctx.fillText(`Score ${this.score}`, 24, 46);

    this.ctx.textAlign = "right";
    this.ctx.fillText(`Best ${this.bestScore}`, this.width - 24, 46);

    this.ctx.font = "bold 17px 'Trebuchet MS', sans-serif";
    this.ctx.fillStyle = "#8df5ff";
    this.ctx.textAlign = "left";
    this.ctx.fillText(`Wave ${this.wave}`, 24, 84);
    this.ctx.fillStyle = "#ffd76d";
    this.ctx.fillText(`Combo x${Math.max(1, this.combo)}`, 130, 84);

    this.ctx.fillStyle = "#ff7f8d";
    this.ctx.textAlign = "right";
    this.ctx.fillText(`HP ${this.player.hp}`, this.width - 24, 84);

    this.ctx.fillStyle = "#9cefff";
    this.ctx.fillText(`Cores ${this.kills}`, this.width - 130, 84);

    const cooldownProgress = clamp(
      (nowMs - this.lastShieldAt) / this.shieldCooldownMs,
      0,
      1
    );
    const barWidth = this.width - 24;
    const barY = this.height - 22;
    this.ctx.fillStyle = "rgba(255,255,255,0.12)";
    this.ctx.fillRect(12, barY, barWidth, 10);
    this.ctx.fillStyle = "rgba(92, 243, 255, 0.92)";
    this.ctx.fillRect(12, barY, barWidth * cooldownProgress, 10);
  }

  drawMenu() {
    this.ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
    this.ctx.fillRect(0, 0, this.width, this.height);

    this.ctx.fillStyle = "#eff7ff";
    this.ctx.textAlign = "center";
    this.ctx.font = "bold 50px 'Trebuchet MS', sans-serif";
    this.ctx.fillText("Shield Painter", this.width * 0.5, this.height * 0.29);

    this.ctx.font = "bold 21px 'Trebuchet MS', sans-serif";
    this.ctx.fillStyle = "#77efff";
    this.ctx.fillText("Reflect bullets into enemy cores.", this.width * 0.5, this.height * 0.35);

    this.ctx.font = "19px 'Trebuchet MS', sans-serif";
    this.ctx.fillStyle = "#f6fbff";
    this.ctx.fillText("Left thumb: move", this.width * 0.5, this.height * 0.45);
    this.ctx.fillText("Right thumb: draw shield line", this.width * 0.5, this.height * 0.50);
    this.ctx.fillText("Perfect deflects build score fast", this.width * 0.5, this.height * 0.55);

    if (this.firstRun) {
      this.ctx.fillStyle = "#ffe08f";
      this.ctx.fillText("Goal: break cores with reflected shots", this.width * 0.5, this.height * 0.63);
    }

    this.ctx.fillStyle = "#9be8ff";
    this.ctx.font = "bold 24px 'Trebuchet MS', sans-serif";
    this.ctx.fillText("Tap to start", this.width * 0.5, this.height * 0.76);
  }

  drawGameOver() {
    this.ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    this.ctx.fillRect(0, 0, this.width, this.height);

    this.ctx.textAlign = "center";
    this.ctx.fillStyle = "#ffffff";
    this.ctx.font = "bold 54px 'Trebuchet MS', sans-serif";
    this.ctx.fillText("Game Over", this.width * 0.5, this.height * 0.36);

    this.ctx.font = "bold 29px 'Trebuchet MS', sans-serif";
    this.ctx.fillStyle = "#89f4ff";
    this.ctx.fillText(`Score ${this.score}`, this.width * 0.5, this.height * 0.45);
    this.ctx.fillText(`Best ${this.bestScore}`, this.width * 0.5, this.height * 0.51);

    this.ctx.fillStyle = "#ffd874";
    this.ctx.font = "bold 21px 'Trebuchet MS', sans-serif";
    this.ctx.fillText(`Cores destroyed ${this.kills}`, this.width * 0.5, this.height * 0.59);

    this.ctx.font = "bold 23px 'Trebuchet MS', sans-serif";
    this.ctx.fillStyle = "#ffd877";
    this.ctx.fillText("Tap to retry", this.width * 0.5, this.height * 0.69);
  }

  render(nowMs) {
    this.drawBackground(nowMs);

    this.ctx.save();
    if (this.screenShakeMs > 0) {
      const intensity = (this.screenShakeMs / 180) * this.screenShakePower;
      const shakeX = rand(-intensity, intensity);
      const shakeY = rand(-intensity, intensity);
      this.ctx.translate(shakeX, shakeY);
    }

    this.drawTurrets();
    this.drawShield(nowMs);
    this.drawBullets();
    this.drawParticles();
    this.drawPlayer(nowMs);
    this.drawControls();
    this.drawFloatingTexts();
    this.ctx.restore();

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
    } else {
      this.updateParticles(dt);
      this.updateFloatingTexts(dt);
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
      await navigator.serviceWorker.register("./sw.js");
    } catch (error) {
      console.error("Service worker registration failed:", error);
    }
  });
}

const canvas = document.querySelector("#gameCanvas");
new ShieldPainterGame(canvas);
registerServiceWorker();
