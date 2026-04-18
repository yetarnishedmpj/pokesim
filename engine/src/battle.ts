import { getTypeMultiplier } from '@pokemon-platform/data';
import type {
  AIPersona,
  BaseStats,
  BattlePokemon,
  BattleSide,
  BattleState,
  GimmickKind,
  MoveDefinition,
  PlayerChoice,
  PokemonType,
  ResolvedTeamDefinition,
  StatName,
  StatusCondition,
} from '@pokemon-platform/shared';

const TURN_TIMER_MS = 45_000;
const STAGE_STATS: StatName[] = ['attack', 'defense', 'specialAttack', 'specialDefense', 'speed', 'accuracy', 'evasion'];

// ─── Mega Evolution ───────────────────────────────────────────────────────────
/** Species that have a Mega form (subset of popular ones) */
const MEGA_ELIGIBLE = new Set([
  'charizard','blastoise','venusaur','alakazam','gengar','machamp','golem',
  'kangaskhan','pinsir','gyarados','aerodactyl','mewtwo',
  'ampharos','scizor','heracross','houndoom','tyranitar','blaziken',
  'gardevoir','mawile','aggron','medicham','manectric','banette','absol',
  'garchomp','lucario','abomasnow','gallade','audino',
  'latias','latios','rayquaza','metagross','sceptile','swampert',
  'slowbro','steelix','pidgeot','beedrill','lopunny','altaria',
  'glalie','salamence','sableye','sharpedo','camerupt','glalie','diancie',
]);

/** Stat boosts applied on Mega (each gets +15-30% to their speciality) */
const MEGA_STAT_BOOST: Partial<Record<StatName, number>> = {
  attack: 1.20,
  specialAttack: 1.20,
  defense: 1.15,
  specialDefense: 1.15,
  speed: 1.10,
};

function applyMegaEvolution(state: MutableBattleState, side: BattleSide, pokemon: BattlePokemon) {
  if (!MEGA_ELIGIBLE.has(pokemon.speciesId) || pokemon.isMega || side.megaUsed) return false;
  // Boost stats
  for (const [stat, mult] of Object.entries(MEGA_STAT_BOOST) as [StatName, number][]) {
    if (stat in pokemon.stats) {
      (pokemon.stats as Record<string, number>)[stat] = Math.floor(
        (pokemon.stats as Record<string, number>)[stat] * mult,
      );
    }
  }
  pokemon.isMega = true;
  pokemon.name = `Mega ${pokemon.name}`;
  side.megaUsed = true;
  appendLog(state, `🌟 ${pokemon.name} — Mega Evolved!`);
  return true;
}

function applyTerastallization(state: MutableBattleState, side: BattleSide, pokemon: BattlePokemon, teraType?: PokemonType) {
  if (pokemon.isTera || side.teraUsed) return false;
  const chosenType = teraType ?? pokemon.types[0];
  pokemon.teraType = chosenType;
  pokemon.isTera = true;
  pokemon.types = [chosenType];
  side.teraUsed = true;
  appendLog(state, `💎 ${pokemon.name} Terastallized into the ${chosenType} type!`);
  return true;
}

/** Returns a Z-power multiplier for damage moves */
function zmovePowerMultiplier(): number {
  return 2.2;
}

type RandomState = { seed: number };
type MutableBattleState = BattleState;

export interface CreateBattleOptions {
  id: string;
  mode: BattleState['mode'];
  playerA: { id: string; name: string; team: ResolvedTeamDefinition };
  playerB: { id: string; name: string; team: ResolvedTeamDefinition };
  roomId?: string | null;
  seed?: number;
}

export interface DamageResult {
  damage: number;
  isCritical: boolean;
  effectiveness: number;
  stab: number;
  hit: boolean;
}

interface ActionDescriptor {
  sideIndex: 0 | 1;
  choice: PlayerChoice;
  priority: number;
  speed: number;
}

function nextRandom(state: RandomState): number {
  state.seed = (state.seed * 1664525 + 1013904223) >>> 0;
  return state.seed / 0xffffffff;
}

function randomInt(state: RandomState, min: number, max: number): number {
  return Math.floor(nextRandom(state) * (max - min + 1)) + min;
}

function baseStageMap() {
  return {
    attack: 0,
    defense: 0,
    specialAttack: 0,
    specialDefense: 0,
    speed: 0,
    accuracy: 0,
    evasion: 0,
  };
}

const NATURE_MAP: Record<string, [StatName | null, StatName | null]> = {
  'Lonely': ['attack', 'defense'], 'Brave': ['attack', 'speed'], 'Adamant': ['attack', 'specialAttack'], 'Naughty': ['attack', 'specialDefense'],
  'Bold': ['defense', 'attack'], 'Relaxed': ['defense', 'speed'], 'Impish': ['defense', 'specialAttack'], 'Lax': ['defense', 'specialDefense'],
  'Timid': ['speed', 'attack'], 'Hasty': ['speed', 'defense'], 'Jolly': ['speed', 'specialAttack'], 'Naive': ['speed', 'specialDefense'],
  'Modest': ['specialAttack', 'attack'], 'Mild': ['specialAttack', 'defense'], 'Quiet': ['specialAttack', 'speed'], 'Rash': ['specialAttack', 'specialDefense'],
  'Calm': ['specialDefense', 'attack'], 'Gentle': ['specialDefense', 'defense'], 'Sassy': ['specialDefense', 'speed'], 'Careful': ['specialDefense', 'specialAttack'],
};

function getNatureMultiplier(nature: string, stat: StatName): number {
  const mapping = NATURE_MAP[nature] || [null, null];
  if (mapping[0] === stat) return 1.1;
  if (mapping[1] === stat) return 0.9;
  return 1.0;
}

function calcHp(base: number, iv: number, ev: number, level: number): number {
  return Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100) + level + 10;
}

function calcStat(base: number, iv: number, ev: number, level: number, natureMult: number): number {
  return Math.floor((Math.floor(((2 * base + iv + Math.floor(ev / 4)) * level) / 100) + 5) * natureMult);
}

function buildStats(member: ResolvedTeamDefinition['pokemon'][number], level: number) {
  const evs = member.evs || {};
  const ivs = member.ivs || {};
  const nature = member.nature || 'Hardy';
  const baseStats = member.baseStats;

  return {
    hp: calcHp(baseStats.hp, ivs.hp ?? 31, evs.hp ?? 0, level),
    attack: calcStat(baseStats.attack, ivs.attack ?? 31, evs.attack ?? 0, level, getNatureMultiplier(nature, 'attack')),
    defense: calcStat(baseStats.defense, ivs.defense ?? 31, evs.defense ?? 0, level, getNatureMultiplier(nature, 'defense')),
    specialAttack: calcStat(baseStats.specialAttack, ivs.specialAttack ?? 31, evs.specialAttack ?? 0, level, getNatureMultiplier(nature, 'specialAttack')),
    specialDefense: calcStat(baseStats.specialDefense, ivs.specialDefense ?? 31, evs.specialDefense ?? 0, level, getNatureMultiplier(nature, 'specialDefense')),
    speed: calcStat(baseStats.speed, ivs.speed ?? 31, evs.speed ?? 0, level, getNatureMultiplier(nature, 'speed')),
    accuracy: 100,
    evasion: 100,
  };
}

function buildPokemon(
  member: ResolvedTeamDefinition['pokemon'][number],
  level: number,
  seedLabel: string,
): BattlePokemon {
  const stats = buildStats(member, level);
  const canMega = MEGA_ELIGIBLE.has(member.speciesId);

  return {
    instanceId: `${seedLabel}-${member.speciesId}`,
    speciesId: member.speciesId,
    name: member.name,
    level,
    types: member.types,
    baseStats: member.baseStats,
    stats,
    maxHp: stats.hp,
    currentHp: stats.hp,
    moves: member.moves.slice(0, 4).map((move) => {
      return {
        id: move.id,
        definition: move,
        currentPP: move.pp,
        maxPP: move.pp,
      };
    }),
    fainted: false,
    status: null,
    sleepTurns: 0,
    freezeTurns: 0,
    stages: baseStageMap(),
    isMega: false,
    isTera: false,
    teraType: null,
    canMega,
  };
}

function buildSide(playerId: string, name: string, team: ResolvedTeamDefinition): BattleSide {
  return {
    id: playerId,
    name,
    activeIndex: 0,
    connected: true,
    megaUsed: false,
    teraUsed: false,
    zmoveUsed: false,
    team: team.pokemon.map((member, index) => buildPokemon(member, member.level ?? 50, `${playerId}-${index}`)),
  };
}

function cloneState<T>(value: T): T {
  return structuredClone(value);
}

function getSide(state: BattleState, sideIndex: 0 | 1): BattleSide {
  return state.sides[sideIndex];
}

function getOpponentIndex(sideIndex: 0 | 1): 0 | 1 {
  return sideIndex === 0 ? 1 : 0;
}

function getActivePokemon(side: BattleSide): BattlePokemon {
  return side.team[side.activeIndex];
}

function hasRemainingPokemon(side: BattleSide): boolean {
  return side.team.some((pokemon) => !pokemon.fainted);
}

function getFirstAvailableSwitch(side: BattleSide): number | null {
  const index = side.team.findIndex((pokemon, candidateIndex) => !pokemon.fainted && candidateIndex !== side.activeIndex);
  return index === -1 ? null : index;
}

function stageMultiplier(stage: number): number {
  if (stage >= 0) {
    return (2 + stage) / 2;
  }

  return 2 / (2 - stage);
}

function accuracyMultiplier(attacker: BattlePokemon, defender: BattlePokemon): number {
  const stage = attacker.stages.accuracy - defender.stages.evasion;
  return stageMultiplier(stage);
}

function getModifiedStat(pokemon: BattlePokemon, stat: 'attack' | 'defense' | 'specialAttack' | 'specialDefense' | 'speed'): number {
  let baseValue = pokemon.stats[stat];
  if (stat === 'attack' && pokemon.status === 'burn') {
    baseValue = Math.floor(baseValue / 2);
  }

  if (stat === 'speed' && pokemon.status === 'paralysis') {
    baseValue = Math.floor(baseValue / 2);
  }

  return Math.max(1, Math.floor(baseValue * stageMultiplier(pokemon.stages[stat])));
}

function shouldApplyEffect(move: MoveDefinition, random: RandomState): boolean {
  const chance = move.effect?.chance ?? 1;
  return nextRandom(random) <= chance;
}

function statusImmunity(status: StatusCondition, types: PokemonType[]): boolean {
  if (status === 'burn') {
    return types.includes('fire');
  }

  if (status === 'poison') {
    return types.includes('poison') || types.includes('steel');
  }

  if (status === 'freeze') {
    return types.includes('ice');
  }

  if (status === 'paralysis') {
    return types.includes('electric');
  }

  return false;
}

function appendLog(state: MutableBattleState, line: string) {
  state.log = [...state.log, line].slice(-160);
}

function applyDirectStatus(target: BattlePokemon, status: StatusCondition, random: RandomState): boolean {
  if (target.status || statusImmunity(status, target.types)) {
    return false;
  }

  target.status = status;
  if (status === 'sleep') {
    target.sleepTurns = randomInt(random, 1, 3);
  }

  if (status === 'freeze') {
    target.freezeTurns = 0;
  }

  return true;
}

function applyMoveEffect(
  state: MutableBattleState,
  actor: BattlePokemon,
  target: BattlePokemon,
  move: MoveDefinition,
  random: RandomState,
) {
  if (!move.effect || !shouldApplyEffect(move, random)) {
    return;
  }

  const recipient = move.effect.target === 'self' ? actor : target;

  if (move.effect.kind === 'heal' && move.effect.healRatio) {
    const healAmount = Math.max(1, Math.floor(recipient.maxHp * move.effect.healRatio));
    const previous = recipient.currentHp;
    recipient.currentHp = Math.min(recipient.maxHp, recipient.currentHp + healAmount);
    appendLog(state, `${recipient.name} recovered ${recipient.currentHp - previous} HP.`);
    return;
  }

  if (move.effect.kind === 'status' && move.effect.status) {
    if (applyDirectStatus(recipient, move.effect.status, random)) {
      appendLog(state, `${recipient.name} is now ${move.effect.status}.`);
    }
    return;
  }

  if (move.effect.kind === 'stat' && move.effect.stages) {
    for (const stat of STAGE_STATS) {
      const delta = move.effect.stages[stat];
      if (!delta) {
        continue;
      }

      recipient.stages[stat] = Math.max(-6, Math.min(6, recipient.stages[stat] + delta));
    }

    appendLog(state, `${recipient.name}'s combat stance changed.`);
  }
}

function consumeMovePp(actor: BattlePokemon, moveIndex: number): MoveDefinition | null {
  const learnedMove = actor.moves[moveIndex];
  if (!learnedMove || learnedMove.currentPP <= 0) {
    return null;
  }

  learnedMove.currentPP -= 1;
  return learnedMove.definition;
}

function canPokemonAct(state: MutableBattleState, pokemon: BattlePokemon, random: RandomState): boolean {
  if (pokemon.fainted) {
    return false;
  }

  if (pokemon.status === 'sleep') {
    if (pokemon.sleepTurns > 0) {
      pokemon.sleepTurns -= 1;
      if (pokemon.sleepTurns > 0) {
        appendLog(state, `${pokemon.name} is asleep.`);
        return false;
      }

      pokemon.status = null;
      appendLog(state, `${pokemon.name} woke up.`);
    }
  }

  if (pokemon.status === 'freeze') {
    if (nextRandom(random) < 0.2) {
      pokemon.status = null;
      appendLog(state, `${pokemon.name} thawed out.`);
    } else {
      appendLog(state, `${pokemon.name} is frozen solid.`);
      return false;
    }
  }

  if (pokemon.status === 'paralysis' && nextRandom(random) < 0.25) {
    appendLog(state, `${pokemon.name} is paralyzed and cannot move.`);
    return false;
  }

  return true;
}

function autoSwitchIfNeeded(state: MutableBattleState, sideIndex: 0 | 1) {
  const side = getSide(state, sideIndex);
  const active = getActivePokemon(side);
  if (!active.fainted) {
    return;
  }

  const switchIndex = getFirstAvailableSwitch(side);
  if (switchIndex === null) {
    return;
  }

  side.activeIndex = switchIndex;
  appendLog(state, `${side.name} sends out ${side.team[switchIndex].name}.`);
}

function evaluateBattle(state: MutableBattleState) {
  const sideAAlive = hasRemainingPokemon(state.sides[0]);
  const sideBAlive = hasRemainingPokemon(state.sides[1]);

  if (sideAAlive && sideBAlive) {
    return;
  }

  state.phase = 'finished';
  state.pendingPlayerIds = [];
  state.timerEndsAt = null;
  if (sideAAlive && !sideBAlive) {
    state.winnerId = state.sides[0].id;
    appendLog(state, `${state.sides[0].name} wins the battle.`);
  } else if (!sideAAlive && sideBAlive) {
    state.winnerId = state.sides[1].id;
    appendLog(state, `${state.sides[1].name} wins the battle.`);
  } else {
    state.winnerId = null;
    appendLog(state, 'The battle ended in a tie.');
  }
}

function isBattleFinished(state: BattleState): boolean {
  return state.phase === 'finished';
}

export function calculateDamage(
  attacker: BattlePokemon,
  defender: BattlePokemon,
  move: MoveDefinition,
  seed: number,
): DamageResult {
  const random = { seed };
  const hitChance = move.accuracy === 100 ? 1 : Math.max(0.01, (move.accuracy / 100) * accuracyMultiplier(attacker, defender));
  const hit = nextRandom(random) <= hitChance;
  if (!hit) {
    return { damage: 0, isCritical: false, effectiveness: 1, stab: 1, hit: false };
  }

  if (move.category === 'status' || move.power <= 0) {
    return { damage: 0, isCritical: false, effectiveness: 1, stab: 1, hit: true };
  }

  const attackStat = move.category === 'physical' ? getModifiedStat(attacker, 'attack') : getModifiedStat(attacker, 'specialAttack');
  const defenseStat = move.category === 'physical' ? getModifiedStat(defender, 'defense') : getModifiedStat(defender, 'specialDefense');
  const critical = nextRandom(random) < 1 / 16;
  let effectiveness = getTypeMultiplier(move.type, defender.types);
  if (move.id === 'freezedry' && defender.types.includes('water')) {
    effectiveness *= 2;
  }

  if (effectiveness === 0) {
    return {
      damage: 0,
      isCritical: critical,
      effectiveness,
      stab: attacker.types.includes(move.type) ? 1.5 : 1,
      hit: true,
    };
  }

  const stab = attacker.types.includes(move.type) ? 1.5 : 1;
  const randomFactor = 0.85 + nextRandom(random) * 0.15;
  const criticalMultiplier = critical ? 1.5 : 1;
  const base = (((2 * attacker.level) / 5 + 2) * move.power * attackStat) / Math.max(1, defenseStat) / 50 + 2;
  const damage = Math.max(1, Math.floor(base * stab * effectiveness * criticalMultiplier * randomFactor));

  return {
    damage,
    isCritical: critical,
    effectiveness,
    stab,
    hit: true,
  };
}

function dealDamage(state: MutableBattleState, target: BattlePokemon, amount: number) {
  target.currentHp = Math.max(0, target.currentHp - amount);
  if (target.currentHp === 0) {
    target.fainted = true;
    appendLog(state, `${target.name} fainted.`);
  }
}

function resolveSwitch(state: MutableBattleState, sideIndex: 0 | 1, targetIndex: number) {
  const side = getSide(state, sideIndex);
  const candidate = side.team[targetIndex];
  if (!candidate || candidate.fainted || targetIndex === side.activeIndex) {
    return;
  }

  side.activeIndex = targetIndex;
  appendLog(state, `${side.name} switched to ${candidate.name}.`);
}

function buildActionDescriptor(state: BattleState, sideIndex: 0 | 1, choice: PlayerChoice): ActionDescriptor {
  const side = getSide(state, sideIndex);
  const active = getActivePokemon(side);
  if (choice.type === 'switch') {
    return { sideIndex, choice, priority: 10, speed: getModifiedStat(active, 'speed') };
  }

  const move = active.moves[choice.moveIndex]?.definition ?? null;
  return {
    sideIndex,
    choice,
    priority: move?.priority ?? 0,
    speed: getModifiedStat(active, 'speed'),
  };
}

function sortActions(actions: ActionDescriptor[], random: RandomState) {
  return [...actions].sort((left, right) => {
    if (right.priority !== left.priority) {
      return right.priority - left.priority;
    }

    if (right.speed !== left.speed) {
      return right.speed - left.speed;
    }

    return nextRandom(random) < 0.5 ? -1 : 1;
  });
}

function resolveMove(state: MutableBattleState, sideIndex: 0 | 1, moveIndex: number, random: RandomState, gimmick?: GimmickKind, teraType?: PokemonType) {
  const actorSide = getSide(state, sideIndex);
  const defenderSide = getSide(state, getOpponentIndex(sideIndex));
  const actor = getActivePokemon(actorSide);
  const defender = getActivePokemon(defenderSide);

  if (actor.fainted) {
    return;
  }

  // ── Resolve gimmick BEFORE the move ──
  if (gimmick === 'mega') {
    applyMegaEvolution(state, actorSide, actor);
  } else if (gimmick === 'tera') {
    applyTerastallization(state, actorSide, actor, teraType);
  }

  const move = consumeMovePp(actor, moveIndex);
  if (!move) {
    appendLog(state, `${actor.name} has no PP left for that move.`);
    return;
  }

  if (!canPokemonAct(state, actor, random)) {
    return;
  }

  // ── Z-Move check ──
  let zmoveMult = 1;
  if (gimmick === 'zmove' && !actorSide.zmoveUsed && move.power > 0 && move.category !== 'status') {
    zmoveMult = zmovePowerMultiplier();
    actorSide.zmoveUsed = true;
    appendLog(state, `⚡ ${actor.name} unleashed its Z-Move: ${move.name}!`);
  } else {
    appendLog(state, `${actor.name} used ${move.name}.`);
  }

  const outcome = calculateDamage(actor, defender, move, random.seed);
  random.seed = (random.seed + 97) >>> 0;

  if (!outcome.hit) {
    appendLog(state, `${actor.name}'s attack missed.`);
    return;
  }

  if (outcome.damage > 0) {
    const finalDamage = Math.max(1, Math.floor(outcome.damage * zmoveMult));
    dealDamage(state, defender, finalDamage);
    appendLog(state, `${defender.name} took ${finalDamage} damage.`);

    if (outcome.isCritical) {
      appendLog(state, 'A critical hit!');
    }

    if (outcome.effectiveness > 1) {
      appendLog(state, "It's super effective!");
    } else if (outcome.effectiveness > 0 && outcome.effectiveness < 1) {
      appendLog(state, "It's not very effective.");
    } else if (outcome.effectiveness === 0) {
      appendLog(state, `${defender.name} is immune.`);
    }
  }

  applyMoveEffect(state, actor, defender, move, random);
  autoSwitchIfNeeded(state, getOpponentIndex(sideIndex));
}

export function applyStatusEffects(state: BattleState, seed?: number): BattleState {
  const nextState = cloneState(state);
  const random = { seed: seed ?? state.seed };

  for (const sideIndex of [0, 1] as const) {
    const pokemon = getActivePokemon(nextState.sides[sideIndex]);
    if (pokemon.fainted || !pokemon.status) {
      continue;
    }

    if (pokemon.status === 'burn') {
      const damage = Math.max(1, Math.floor(pokemon.maxHp / 16));
      dealDamage(nextState, pokemon, damage);
      appendLog(nextState, `${pokemon.name} is hurt by its burn.`);
    }

    if (pokemon.status === 'poison') {
      const damage = Math.max(1, Math.floor(pokemon.maxHp / 8));
      dealDamage(nextState, pokemon, damage);
      appendLog(nextState, `${pokemon.name} is hurt by poison.`);
    }

    if (pokemon.fainted) {
      autoSwitchIfNeeded(nextState, sideIndex);
    }
  }

  nextState.seed = random.seed;
  evaluateBattle(nextState);
  return nextState;
}

export function createBattleState(options: CreateBattleOptions): BattleState {
  const seed = options.seed ?? Math.floor(Math.random() * 0x7fffffff);
  const state: BattleState = {
    id: options.id,
    roomId: options.roomId ?? null,
    mode: options.mode,
    phase: 'in-progress',
    turn: 1,
    seed,
    sides: [
      buildSide(options.playerA.id, options.playerA.name, options.playerA.team),
      buildSide(options.playerB.id, options.playerB.name, options.playerB.team),
    ],
    log: [
      'Battle started.',
      `${options.playerA.name} sent out ${options.playerA.team.pokemon[0]?.name ?? 'Unknown Pokemon'}.`,
      `${options.playerB.name} sent out ${options.playerB.team.pokemon[0]?.name ?? 'Unknown Pokemon'}.`,
    ],
    winnerId: null,
    queuedChoices: {},
    pendingPlayerIds: [options.playerA.id, options.playerB.id],
    timerEndsAt: Date.now() + TURN_TIMER_MS,
  };

  return state;
}

export function getDefaultChoice(state: BattleState, playerId: string): PlayerChoice {
  const sideIndex = state.sides[0].id === playerId ? 0 : 1;
  const side = state.sides[sideIndex];
  const active = getActivePokemon(side);

  if (active.fainted) {
    const switchIndex = getFirstAvailableSwitch(side);
    return { type: 'switch', targetIndex: switchIndex ?? side.activeIndex };
  }

  const moveIndex = active.moves.findIndex((move) => move.currentPP > 0);
  return { type: 'move', moveIndex: moveIndex === -1 ? 0 : moveIndex };
}

export function queueChoice(state: BattleState, playerId: string, choice: PlayerChoice): BattleState {
  const nextState = cloneState(state);
  nextState.queuedChoices[playerId] = choice;
  nextState.pendingPlayerIds = nextState.sides
    .map((side) => side.id)
    .filter((id) => !(id in nextState.queuedChoices));
  return nextState;
}

export function resolveTurn(state: BattleState, choices: Record<string, PlayerChoice>): BattleState {
  const nextState = cloneState(state);
  if (nextState.phase === 'finished') {
    return nextState;
  }

  const random = { seed: nextState.seed };
  const actionEntries: ActionDescriptor[] = [
    buildActionDescriptor(nextState, 0, choices[nextState.sides[0].id] ?? getDefaultChoice(nextState, nextState.sides[0].id)),
    buildActionDescriptor(nextState, 1, choices[nextState.sides[1].id] ?? getDefaultChoice(nextState, nextState.sides[1].id)),
  ];

  appendLog(nextState, `Turn ${nextState.turn}`);
  for (const action of sortActions(actionEntries, random)) {
    if (isBattleFinished(nextState)) {
      break;
    }

    if (action.choice.type === 'switch') {
      resolveSwitch(nextState, action.sideIndex, action.choice.targetIndex);
    } else {
      const gimmick = action.choice.type === 'move' ? action.choice.gimmick : undefined;
      const teraType = action.choice.type === 'move' ? action.choice.teraType : undefined;
      resolveMove(nextState, action.sideIndex, action.choice.moveIndex, random, gimmick, teraType);
    }

    evaluateBattle(nextState);
  }

  const afterStatus = applyStatusEffects(nextState, random.seed);
  afterStatus.seed = random.seed;
  afterStatus.queuedChoices = {};
  afterStatus.pendingPlayerIds = afterStatus.phase === 'finished' ? [] : afterStatus.sides.map((side) => side.id);
  afterStatus.timerEndsAt = afterStatus.phase === 'finished' ? null : Date.now() + TURN_TIMER_MS;
  if (afterStatus.phase !== 'finished') {
    afterStatus.turn += 1;
  }

  return afterStatus;
}

function scoreMove(state: BattleState, sideIndex: 0 | 1, moveIndex: number): number {
  const side = state.sides[sideIndex];
  const opponent = state.sides[getOpponentIndex(sideIndex)];
  const attacker = getActivePokemon(side);
  const defender = getActivePokemon(opponent);
  const learned = attacker.moves[moveIndex];
  if (!learned || learned.currentPP <= 0) {
    return -Infinity;
  }

  const move = learned.definition;
  const preview = calculateDamage(attacker, defender, move, state.seed + moveIndex + sideIndex);
  let score = preview.damage;

  if (move.effect?.kind === 'status' && !defender.status) {
    score += 30;
  }

  if (move.effect?.kind === 'heal' && attacker.currentHp < attacker.maxHp / 2) {
    score += 45;
  }

  if (move.effect?.kind === 'stat') {
    score += 20;
  }

  if (preview.effectiveness > 1) {
    score += 20;
  }

  return score;
}

function scoreSwitchTarget(state: BattleState, sideIndex: 0 | 1, targetIndex: number): number {
  const side = state.sides[sideIndex];
  const candidate = side.team[targetIndex];
  if (!candidate || candidate.fainted || targetIndex === side.activeIndex) {
    return -Infinity;
  }

  const defender = getActivePokemon(state.sides[getOpponentIndex(sideIndex)]);
  return candidate.currentHp + candidate.types.reduce((bonus, type) => bonus + getTypeMultiplier(type, defender.types) * 10, 0);
}

export function chooseCpuChoice(state: BattleState, playerId: string, persona: AIPersona): PlayerChoice {
  const sideIndex = state.sides[0].id === playerId ? 0 : 1;
  const side = state.sides[sideIndex];
  const active = getActivePokemon(side);
  const random = { seed: state.seed + sideIndex * 17 };

  if (active.fainted) {
    return getDefaultChoice(state, playerId);
  }

  const moveOptions = active.moves
    .map((_, moveIndex) => ({ moveIndex, score: scoreMove(state, sideIndex, moveIndex) }))
    .filter((entry) => Number.isFinite(entry.score));

  if (persona === 'bug-catcher-timmy' || persona === 'random-trainer') {
    const choice = moveOptions[Math.floor(nextRandom(random) * moveOptions.length)] ?? { moveIndex: 0 };
    return { type: 'move', moveIndex: choice.moveIndex };
  }

  const bestMove = [...moveOptions].sort((left, right) => right.score - left.score)[0] ?? { moveIndex: 0, score: 0 };
  const switchOptions = side.team
    .map((_, targetIndex) => ({ targetIndex, score: scoreSwitchTarget(state, sideIndex, targetIndex) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((left, right) => right.score - left.score);

  const shouldSwitch =
    persona === 'champion-lance' &&
    active.currentHp < active.maxHp * 0.35 &&
    switchOptions[0] &&
    switchOptions[0].score > bestMove.score + 25;

  if (shouldSwitch) {
    return { type: 'switch', targetIndex: switchOptions[0].targetIndex };
  }

  return { type: 'move', moveIndex: bestMove.moveIndex };
}
