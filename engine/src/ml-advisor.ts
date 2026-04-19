import { readFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BattleState, BattlePokemon, BattleSide } from '@pokemon-platform/shared';

// ─── Types ──────────────────────────────────────────────────────────────────

interface HpBucketPrefs {
  damage: number;
  status: number;
  boost: number;
}

interface AIKnowledge {
  version: string;
  trained_on_replays: number;
  switch_threshold: number;           // HP% below which AI prefers to switch
  switch_on_supereff_rate: number;    // probability of switching on super-eff hit
  aggression_near_ko: number;         // probability of attacking when opp is near KO
  turn1_distribution: { priority: number; setup: number; attack: number };
  move_prefs_by_hp: {
    high: HpBucketPrefs;     // >= 75% HP
    mid: HpBucketPrefs;      // 50–75%
    low: HpBucketPrefs;      // 25–50%
    critical: HpBucketPrefs; // < 25%
  };
  feature_importances: { hp_pct: number; early_turn: number };
}

export interface MLAdvice {
  shouldSwitch: boolean;
  preferCategory: 'damage' | 'status' | 'boost';
  switchUrgency: number;   // 0–1, higher = more urgent
  confidence: number;      // 0–1
}

// ─── Knowledge Loading ───────────────────────────────────────────────────────

function loadKnowledge(): AIKnowledge {
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    // Walk up from engine/src to find ml/ai_knowledge.json
    const knowledgePath = resolve(__dirname, '..', '..', '..', 'ml', 'ai_knowledge.json');
    const raw = readFileSync(knowledgePath, 'utf-8');
    const data = JSON.parse(raw) as AIKnowledge;
    const isTrained = data.trained_on_replays > 0;
    console.log(`[ML] Knowledge loaded — ${isTrained ? `trained on ${data.trained_on_replays} replays` : 'using defaults (run ml/train.py to train)'}`);
    return data;
  } catch {
    console.warn('[ML] Could not load ai_knowledge.json — using built-in defaults.');
    return DEFAULT_KNOWLEDGE;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hpPct(pokemon: BattlePokemon): number {
  return pokemon.maxHp > 0 ? pokemon.currentHp / pokemon.maxHp : 0;
}

function getHpBucket(pct: number): keyof AIKnowledge['move_prefs_by_hp'] {
  if (pct >= 0.75) return 'high';
  if (pct >= 0.50) return 'mid';
  if (pct >= 0.25) return 'low';
  return 'critical';
}

function getActivePokemon(side: BattleSide): BattlePokemon {
  return side.team[side.activeIndex];
}

function hasTypeSuperEffective(attackerTypes: string[], defenderTypes: string[]): boolean {
  // Simplified super-effective detection using common matchup pairs
  const SUPER_EFF: Record<string, string[]> = {
    fire:     ['grass', 'ice', 'bug', 'steel'],
    water:    ['fire', 'rock', 'ground'],
    grass:    ['water', 'rock', 'ground'],
    electric: ['water', 'flying'],
    ice:      ['grass', 'ground', 'flying', 'dragon'],
    fighting: ['normal', 'ice', 'rock', 'dark', 'steel'],
    poison:   ['grass', 'fairy'],
    ground:   ['fire', 'electric', 'poison', 'rock', 'steel'],
    flying:   ['grass', 'fighting', 'bug'],
    psychic:  ['fighting', 'poison'],
    bug:      ['grass', 'psychic', 'dark'],
    rock:     ['fire', 'ice', 'flying', 'bug'],
    ghost:    ['psychic', 'ghost'],
    dragon:   ['dragon'],
    dark:     ['psychic', 'ghost'],
    steel:    ['ice', 'rock', 'fairy'],
    fairy:    ['fighting', 'dragon', 'dark'],
  };

  for (const atkType of attackerTypes) {
    const targets = SUPER_EFF[atkType] ?? [];
    for (const defType of defenderTypes) {
      if (targets.includes(defType)) return true;
    }
  }
  return false;
}

// ─── Core Advisory Function ───────────────────────────────────────────────────

export function getMLAdvice(
  state: BattleState,
  sideIndex: 0 | 1,
): MLAdvice {
  const knowledge = cachedKnowledge;
  const side       = state.sides[sideIndex];
  const oppSide    = state.sides[sideIndex === 0 ? 1 : 0];
  const active     = getActivePokemon(side);
  const opponent   = getActivePokemon(oppSide);

  const myHpPct    = hpPct(active);
  const oppHpPct   = hpPct(opponent);
  const turn       = state.turn;
  const isEarly    = turn <= 3;

  // ── Determine if opponent has type advantage over us
  const oppHasSuperEff = hasTypeSuperEffective(opponent.types, active.types);

  // ── Switch urgency score (0–1)
  let switchUrgency = 0;

  // HP-based urgency: normalize against learned threshold
  const threshold = knowledge.switch_threshold;
  if (myHpPct < threshold) {
    switchUrgency += (threshold - myHpPct) / threshold * 0.6;
  }

  // Super-effective matchup urgency
  if (oppHasSuperEff) {
    switchUrgency += knowledge.switch_on_supereff_rate * 0.4;
  }

  switchUrgency = Math.min(1, switchUrgency);

  // ── Should we switch?
  // Switch if urgency passes a learned dynamic threshold
  // (weighted by HP feature importance from the RF model)
  const hpWeight   = knowledge.feature_importances.hp_pct;
  const turnWeight = knowledge.feature_importances.early_turn;
  const dynamicThreshold = hpWeight * threshold + turnWeight * (isEarly ? 0.20 : 0.40);
  const shouldSwitch = switchUrgency > dynamicThreshold;

  // ── Preferred move category (based on HP bucket + learned distributions)
  const bucket = getHpBucket(myHpPct);
  const prefs  = knowledge.move_prefs_by_hp[bucket];

  // Opponent near KO → override to aggression regardless of HP bucket
  let preferCategory: 'damage' | 'status' | 'boost';
  if (oppHpPct < 0.30 && Math.random() < knowledge.aggression_near_ko) {
    preferCategory = 'damage';
  } else {
    // Sample from the learned distribution
    const r = Math.random();
    if (r < prefs.damage) {
      preferCategory = 'damage';
    } else if (r < prefs.damage + prefs.status) {
      preferCategory = 'status';
    } else {
      preferCategory = 'boost';
    }
  }

  // Turn-1 override: use priority move if it's a top play (learned ~35% of the time)
  if (turn === 1 && Math.random() < knowledge.turn1_distribution.priority) {
    preferCategory = 'damage'; // proxy for "use a priority / fast move"
  }

  // ── Confidence: based on how many replays trained this model
  const confidence = Math.min(
    0.95,
    0.50 + (knowledge.trained_on_replays / 400) * 0.45,
  );

  return { shouldSwitch, preferCategory, switchUrgency, confidence };
}

// ─── Defaults & Cache ─────────────────────────────────────────────────────────

const DEFAULT_KNOWLEDGE: AIKnowledge = {
  version: '1.0',
  trained_on_replays: 0,
  switch_threshold: 0.35,
  switch_on_supereff_rate: 0.45,
  aggression_near_ko: 0.82,
  turn1_distribution: { priority: 0.35, setup: 0.15, attack: 0.50 },
  move_prefs_by_hp: {
    high:     { damage: 0.65, status: 0.22, boost: 0.13 },
    mid:      { damage: 0.72, status: 0.17, boost: 0.11 },
    low:      { damage: 0.84, status: 0.10, boost: 0.06 },
    critical: { damage: 0.93, status: 0.04, boost: 0.03 },
  },
  feature_importances: { hp_pct: 0.65, early_turn: 0.35 },
};

// Load once at module initialisation
const cachedKnowledge: AIKnowledge = loadKnowledge();

export { cachedKnowledge as mlKnowledge };
