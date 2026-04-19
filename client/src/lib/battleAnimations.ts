/**
 * Battle Animation Engine v2 — Pokemon-game-inspired effects
 * Beams, slashes, screen flashes, background dim, proper sprite reactions
 */

interface TypeTheme {
  primary: string; secondary: string; glow: string; trail: string;
}

const THEMES: Record<string, TypeTheme> = {
  fire:     { primary: '#FF6B00', secondary: '#FFAA00', glow: '#FF3300', trail: '#FFE066' },
  water:    { primary: '#2196F3', secondary: '#64B5F6', glow: '#0D47A1', trail: '#BBDEFB' },
  grass:    { primary: '#4CAF50', secondary: '#81C784', glow: '#1B5E20', trail: '#C8E6C9' },
  electric: { primary: '#FFD600', secondary: '#FFF176', glow: '#F9A825', trail: '#FFFFFF' },
  ice:      { primary: '#4FC3F7', secondary: '#E1F5FE', glow: '#0288D1', trail: '#FFFFFF' },
  fighting: { primary: '#E65100', secondary: '#FF8A65', glow: '#BF360C', trail: '#FFCCBC' },
  poison:   { primary: '#9C27B0', secondary: '#CE93D8', glow: '#6A1B9A', trail: '#E1BEE7' },
  ground:   { primary: '#8D6E63', secondary: '#D7CCC8', glow: '#4E342E', trail: '#BCAAA4' },
  flying:   { primary: '#90CAF9', secondary: '#E3F2FD', glow: '#42A5F5', trail: '#FFFFFF' },
  psychic:  { primary: '#EC407A', secondary: '#F48FB1', glow: '#AD1457', trail: '#FCE4EC' },
  bug:      { primary: '#8BC34A', secondary: '#DCEDC8', glow: '#558B2F', trail: '#F1F8E9' },
  rock:     { primary: '#795548', secondary: '#A1887F', glow: '#3E2723', trail: '#D7CCC8' },
  ghost:    { primary: '#7E57C2', secondary: '#B39DDB', glow: '#311B92', trail: '#D1C4E9' },
  dragon:   { primary: '#5C6BC0', secondary: '#9FA8DA', glow: '#1A237E', trail: '#C5CAE9' },
  dark:     { primary: '#455A64', secondary: '#78909C', glow: '#263238', trail: '#90A4AE' },
  steel:    { primary: '#B0BEC5', secondary: '#ECEFF1', glow: '#546E7A', trail: '#FFFFFF' },
  fairy:    { primary: '#F06292', secondary: '#F8BBD0', glow: '#C2185B', trail: '#FCE4EC' },
  normal:   { primary: '#BDBDBD', secondary: '#E0E0E0', glow: '#757575', trail: '#FAFAFA' },
  stellar:  { primary: '#FFD700', secondary: '#FFF8E1', glow: '#FF6F00', trail: '#FFFFFF' },
};

export type AnimationDirection = 'to-opponent' | 'to-player' | 'center';
export interface AnimationConfig {
  type: string; category: string; moveName: string; direction: AnimationDirection;
}

// ─── Easing ──────────────────────────────────────────────────────────────────
function easeOutCubic(t: number) { return 1 - Math.pow(1 - t, 3); }
function easeInQuad(t: number) { return t * t; }
function easeOutQuad(t: number) { return 1 - (1 - t) * (1 - t); }

// ─── Draw helpers ────────────────────────────────────────────────────────────
function hexToRgb(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return { r, g, b };
}

function rgba(hex: string, a: number) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

// ─── Phase-based animation system ────────────────────────────────────────────
// Each animation has phases: WINDUP → TRAVEL → IMPACT → FADE
// This mimics how real Pokemon games structure their move animations

interface Particle {
  x: number; y: number; vx: number; vy: number;
  size: number; life: number; maxLife: number;
  color: string; alpha: number; rotation: number; rotSpeed: number;
}

function spawnBurst(cx: number, cy: number, count: number, theme: TypeTheme, speed: number): Particle[] {
  const particles: Particle[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
    const spd = speed * (0.5 + Math.random() * 0.8);
    const colors = [theme.primary, theme.secondary, theme.trail, theme.glow];
    particles.push({
      x: cx + (Math.random() - 0.5) * 12,
      y: cy + (Math.random() - 0.5) * 12,
      vx: Math.cos(angle) * spd,
      vy: Math.sin(angle) * spd,
      size: 2 + Math.random() * 6,
      life: 18 + Math.random() * 14,
      maxLife: 32,
      color: colors[Math.floor(Math.random() * colors.length)],
      alpha: 1,
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.2,
    });
  }
  return particles;
}

// ─── Screen flash (white flash like real games) ──────────────────────────────
function drawScreenFlash(ctx: CanvasRenderingContext2D, w: number, h: number, intensity: number, color: string) {
  if (intensity <= 0) return;
  ctx.save();
  ctx.globalAlpha = intensity;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

// ─── Background dim ──────────────────────────────────────────────────────────
function drawBackgroundDim(ctx: CanvasRenderingContext2D, w: number, h: number, intensity: number) {
  if (intensity <= 0) return;
  ctx.save();
  ctx.globalAlpha = intensity * 0.4;
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

// ─── Beam/projectile effect ──────────────────────────────────────────────────
function drawBeam(
  ctx: CanvasRenderingContext2D,
  sx: number, sy: number, ex: number, ey: number,
  progress: number, theme: TypeTheme, width: number
) {
  const len = Math.sqrt((ex - sx) ** 2 + (ey - sy) ** 2);
  const headProgress = Math.min(1, progress * 1.4);
  const tailProgress = Math.max(0, progress * 1.4 - 0.4);
  const hx = sx + (ex - sx) * easeOutCubic(headProgress);
  const hy = sy + (ey - sy) * easeOutCubic(headProgress);
  const tx = sx + (ex - sx) * easeOutQuad(tailProgress);
  const ty = sy + (ey - sy) * easeOutQuad(tailProgress);

  // Outer glow
  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.strokeStyle = theme.glow;
  ctx.lineWidth = width * 3;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke();
  // Core beam
  ctx.globalAlpha = 0.7;
  ctx.strokeStyle = theme.primary;
  ctx.lineWidth = width * 1.5;
  ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke();
  // Bright center
  ctx.globalAlpha = 0.95;
  ctx.strokeStyle = theme.trail;
  ctx.lineWidth = width * 0.6;
  ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(hx, hy); ctx.stroke();
  // Head glow
  const grad = ctx.createRadialGradient(hx, hy, 0, hx, hy, width * 4);
  grad.addColorStop(0, rgba(theme.trail, 0.9));
  grad.addColorStop(0.3, rgba(theme.primary, 0.5));
  grad.addColorStop(1, rgba(theme.glow, 0));
  ctx.globalAlpha = 1;
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(hx, hy, width * 4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// ─── Physical slash effect ───────────────────────────────────────────────────
function drawSlashMark(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  progress: number, theme: TypeTheme, count: number
) {
  ctx.save();
  const slashProgress = easeOutCubic(Math.min(1, progress * 2));
  const fadeAlpha = progress > 0.5 ? 1 - (progress - 0.5) * 2 : 1;
  ctx.globalAlpha = fadeAlpha;
  ctx.translate(cx, cy);
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI + Math.PI * 0.25;
    const len = 50 + Math.random() * 30;
    ctx.save();
    ctx.rotate(angle);
    // Slash glow
    ctx.strokeStyle = rgba(theme.glow, 0.4);
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-len * (1 - slashProgress), 0);
    ctx.lineTo(len * slashProgress, 0);
    ctx.stroke();
    // Slash core (white)
    ctx.strokeStyle = rgba(theme.trail, 0.9);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-len * (1 - slashProgress), 0);
    ctx.lineTo(len * slashProgress, 0);
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

// ─── Impact explosion ────────────────────────────────────────────────────────
function drawImpactExplosion(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  progress: number, theme: TypeTheme
) {
  if (progress <= 0) return;
  ctx.save();
  const expandProgress = easeOutCubic(progress);
  const alpha = 1 - easeInQuad(progress);
  // Ring
  const ringRadius = 20 + expandProgress * 80;
  ctx.globalAlpha = alpha * 0.6;
  ctx.strokeStyle = theme.primary;
  ctx.lineWidth = 4 * (1 - expandProgress);
  ctx.beginPath(); ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2); ctx.stroke();
  // Inner flash
  const flashRadius = expandProgress * 50;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, flashRadius);
  grad.addColorStop(0, rgba(theme.trail, alpha * 0.8));
  grad.addColorStop(0.4, rgba(theme.primary, alpha * 0.4));
  grad.addColorStop(1, rgba(theme.glow, 0));
  ctx.globalAlpha = 1;
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(cx, cy, flashRadius, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// ─── Status aura effect ──────────────────────────────────────────────────────
function drawStatusAura(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  progress: number, theme: TypeTheme
) {
  ctx.save();
  const pulseCount = 3;
  for (let i = 0; i < pulseCount; i++) {
    const offset = i / pulseCount;
    const p = (progress + offset) % 1;
    const radius = 15 + p * 70;
    const alpha = (1 - p) * 0.5;
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = theme.primary;
    ctx.lineWidth = 3 * (1 - p);
    ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.stroke();
  }
  // Sparkles
  const sparkleCount = 8;
  for (let i = 0; i < sparkleCount; i++) {
    const angle = (i / sparkleCount) * Math.PI * 2 + progress * Math.PI;
    const dist = 30 + Math.sin(progress * Math.PI * 4 + i) * 20;
    const sx = cx + Math.cos(angle) * dist;
    const sy = cy + Math.sin(angle) * dist;
    const size = 2 + Math.sin(progress * Math.PI * 6 + i * 2) * 2;
    ctx.globalAlpha = 0.6 + Math.sin(progress * Math.PI * 3 + i) * 0.4;
    ctx.fillStyle = theme.trail;
    ctx.beginPath(); ctx.arc(sx, sy, Math.max(0.5, size), 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

// ─── Main animation player ──────────────────────────────────────────────────
export function playBattleAnimation(
  canvas: HTMLCanvasElement,
  config: AnimationConfig,
  onComplete: () => void,
): () => void {
  const ctx = canvas.getContext('2d');
  if (!ctx) { onComplete(); return () => {}; }

  const theme = THEMES[config.type] ?? THEMES.normal;
  const isPhysical = config.category === 'physical';
  const isStatus = config.category === 'status';
  const durationMs = isStatus ? 900 : 1100;

  const w = canvas.width;
  const h = canvas.height;

  // Positions
  const playerPos = { x: w * 0.22, y: h * 0.72 };
  const opponentPos = { x: w * 0.75, y: h * 0.28 };
  const attackerPos = config.direction === 'to-opponent' ? playerPos : opponentPos;
  const defenderPos = config.direction === 'to-opponent' ? opponentPos : playerPos;

  let particles: Particle[] = [];
  let startTime = 0;
  let animFrame = 0;
  let cancelled = false;
  let impactFired = false;

  const render = (timestamp: number) => {
    if (cancelled) return;
    if (!startTime) startTime = timestamp;
    const elapsed = timestamp - startTime;
    const progress = Math.min(1, elapsed / durationMs);

    ctx.clearRect(0, 0, w, h);

    // Phase timing
    const windupEnd = 0.15;
    const travelEnd = 0.55;
    const impactEnd = 0.75;

    // ── Background dim during animation ──
    const dimIntensity = progress < windupEnd
      ? progress / windupEnd
      : progress > impactEnd
        ? 1 - (progress - impactEnd) / (1 - impactEnd)
        : 1;
    drawBackgroundDim(ctx, w, h, dimIntensity * 0.6);

    if (isStatus) {
      // ── STATUS: pulsing aura on target ──
      drawStatusAura(ctx, defenderPos.x, defenderPos.y, progress, theme);
      // Screen tint
      if (progress > 0.3 && progress < 0.7) {
        const tintP = (progress - 0.3) / 0.4;
        const tintAlpha = Math.sin(tintP * Math.PI) * 0.15;
        drawScreenFlash(ctx, w, h, tintAlpha, theme.primary);
      }
    } else if (isPhysical) {
      // ── PHYSICAL: slash marks at defender ──
      if (progress > windupEnd && progress < impactEnd) {
        const slashP = (progress - windupEnd) / (impactEnd - windupEnd);
        drawSlashMark(ctx, defenderPos.x, defenderPos.y, slashP, theme, 3);
      }
      // Contact flash
      if (progress > travelEnd - 0.05 && progress < travelEnd + 0.15) {
        const flashP = (progress - (travelEnd - 0.05)) / 0.2;
        drawScreenFlash(ctx, w, h, Math.sin(flashP * Math.PI) * 0.7, '#FFFFFF');
      }
      // Impact explosion
      if (progress > travelEnd) {
        const impP = (progress - travelEnd) / (1 - travelEnd);
        drawImpactExplosion(ctx, defenderPos.x, defenderPos.y, impP, theme);
        if (!impactFired) {
          impactFired = true;
          particles.push(...spawnBurst(defenderPos.x, defenderPos.y, 25, theme, 6));
        }
      }
    } else {
      // ── SPECIAL: beam/projectile effect ──
      if (progress > windupEnd && progress < travelEnd + 0.15) {
        const beamP = (progress - windupEnd) / (travelEnd - windupEnd + 0.15);
        drawBeam(ctx, attackerPos.x, attackerPos.y, defenderPos.x, defenderPos.y, beamP, theme, 6);
        // Trail particles along beam path
        if (Math.random() < 0.7) {
          const tp = Math.random() * Math.min(1, beamP);
          const px = attackerPos.x + (defenderPos.x - attackerPos.x) * tp;
          const py = attackerPos.y + (defenderPos.y - attackerPos.y) * tp;
          particles.push(...spawnBurst(px, py, 1, theme, 1.5));
        }
      }
      // Screen flash on impact
      if (progress > travelEnd - 0.02 && progress < travelEnd + 0.12) {
        const flashP = (progress - (travelEnd - 0.02)) / 0.14;
        drawScreenFlash(ctx, w, h, Math.sin(flashP * Math.PI) * 0.55, '#FFFFFF');
      }
      // Impact explosion at defender
      if (progress > travelEnd) {
        const impP = (progress - travelEnd) / (1 - travelEnd);
        drawImpactExplosion(ctx, defenderPos.x, defenderPos.y, impP, theme);
        if (!impactFired) {
          impactFired = true;
          particles.push(...spawnBurst(defenderPos.x, defenderPos.y, 30, theme, 5));
        }
      }
    }

    // ── Windup charge glow at attacker ──
    if (progress < windupEnd + 0.05 && !isStatus) {
      const chargeP = progress / (windupEnd + 0.05);
      const chargeR = 8 + chargeP * 25;
      const grad = ctx.createRadialGradient(
        attackerPos.x, attackerPos.y, 0,
        attackerPos.x, attackerPos.y, chargeR
      );
      grad.addColorStop(0, rgba(theme.trail, 0.8 * chargeP));
      grad.addColorStop(0.5, rgba(theme.primary, 0.4 * chargeP));
      grad.addColorStop(1, rgba(theme.glow, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(attackerPos.x, attackerPos.y, chargeR, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── Update and render particles ──
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life--;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.x += p.vx;
      p.y += p.vy;
      p.vx *= 0.94;
      p.vy *= 0.94;
      p.vy += 0.08;
      p.rotation += p.rotSpeed;
      const lifeRatio = p.life / p.maxLife;
      p.alpha = lifeRatio;
      const sz = p.size * (0.5 + lifeRatio * 0.5);
      // Glow
      ctx.save();
      ctx.globalAlpha = p.alpha * 0.3;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, sz * 2.5, 0, Math.PI * 2); ctx.fill();
      // Core
      ctx.globalAlpha = p.alpha;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, sz, 0, Math.PI * 2); ctx.fill();
      // Bright center
      ctx.globalAlpha = p.alpha * 0.7;
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath(); ctx.arc(p.x, p.y, sz * 0.4, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    if (progress >= 1 && particles.length === 0) {
      ctx.clearRect(0, 0, w, h);
      onComplete();
      return;
    }
    animFrame = requestAnimationFrame(render);
  };

  animFrame = requestAnimationFrame(render);
  return () => { cancelled = true; cancelAnimationFrame(animFrame); ctx.clearRect(0, 0, w, h); };
}
