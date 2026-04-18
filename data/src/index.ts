import { Dex } from '@pkmn/dex';
import { Generations, toID } from '@pkmn/data';
import type {
  CatalogPayload,
  MoveDefinition,
  MoveEffect,
  PokemonSpecies,
  PokemonType,
  ResolvedTeamDefinition,
  TeamDefinition,
  TeamMemberDefinition,
} from '@pokemon-platform/shared';

const gens = new Generations(Dex);
const gen = gens.get(9);
const supportedBoostStats = {
  atk: 'attack',
  def: 'defense',
  spa: 'specialAttack',
  spd: 'specialDefense',
  spe: 'speed',
  accuracy: 'accuracy',
  evasion: 'evasion',
} as const;
const statusMap = {
  brn: 'burn',
  psn: 'poison',
  par: 'paralysis',
  slp: 'sleep',
  frz: 'freeze',
} as const;

let catalogCache: CatalogPayload | null = null;
const recommendedMovesCache = new Map<string, string[]>();

function normalizeType(type: string): PokemonType | null {
  switch (toID(type)) {
    case 'normal':
    case 'fire':
    case 'water':
    case 'electric':
    case 'grass':
    case 'ice':
    case 'fighting':
    case 'poison':
    case 'ground':
    case 'flying':
    case 'psychic':
    case 'bug':
    case 'rock':
    case 'ghost':
    case 'dragon':
    case 'dark':
    case 'steel':
    case 'fairy':
    case 'stellar':
      return toID(type) as PokemonType;
    default:
      return null;
  }
}

function normalizeCategory(category: string): MoveDefinition['category'] {
  if (category === 'Physical') {
    return 'physical';
  }

  if (category === 'Special') {
    return 'special';
  }

  return 'status';
}

function normalizeEffect(move: {
  category: string;
  heal?: number[] | null;
  status?: string;
  boosts?: Record<string, number>;
  secondary?: { chance?: number; status?: string; boosts?: Record<string, number> } | null;
  target?: string;
}): MoveEffect | undefined {
  const target = move.target === 'self' ? 'self' : 'opponent';

  if (move.heal && move.heal.length >= 2) {
    return {
      kind: 'heal',
      target,
      healRatio: move.heal[0] / move.heal[1],
    };
  }

  const moveStatus = move.status ? statusMap[move.status as keyof typeof statusMap] : undefined;
  if (moveStatus) {
    return {
      kind: 'status',
      target,
      status: moveStatus,
    };
  }

  const secondaryStatus = move.secondary?.status ? statusMap[move.secondary.status as keyof typeof statusMap] : undefined;
  if (secondaryStatus) {
    return {
      kind: 'status',
      target,
      chance: (move.secondary?.chance ?? 100) / 100,
      status: secondaryStatus,
    };
  }

  const rawBoosts = move.boosts ?? move.secondary?.boosts;
  if (rawBoosts) {
    const stageEntries = Object.entries(rawBoosts).flatMap(([key, value]) => {
      const stat = supportedBoostStats[key as keyof typeof supportedBoostStats];
      return stat ? [[stat, value] as const] : [];
    });
    const stages = Object.fromEntries(stageEntries);

    if (Object.keys(stages).length) {
      return {
        kind: 'stat',
        target,
        chance: move.secondary?.boosts ? (move.secondary?.chance ?? 100) / 100 : undefined,
        stages,
      };
    }
  }

  return undefined;
}

function moveSupport(move: {
  category: string;
  basePower: number;
  isZ?: boolean | string;
  isMax?: boolean | string;
  selfdestruct?: string | boolean;
  sideCondition?: string;
  weather?: string;
  terrain?: string;
  pseudoWeather?: string;
  volatileStatus?: string;
  forceSwitch?: boolean;
  selfSwitch?: string | boolean;
  hasCrashDamage?: boolean;
  mindBlownRecoil?: boolean;
  stealsBoosts?: boolean;
}, effect: MoveEffect | undefined) {
  if (move.isZ || move.isMax || move.selfdestruct || move.sideCondition || move.weather || move.terrain || move.pseudoWeather) {
    return false;
  }

  if (move.forceSwitch || move.selfSwitch || move.hasCrashDamage || move.mindBlownRecoil || move.stealsBoosts) {
    return false;
  }

  if (move.category === 'Status') {
    return Boolean(effect);
  }

  return true;
}

function scoreMove(move: MoveDefinition, species: PokemonSpecies): number {
  let score = move.power;

  if (move.supported) {
    score += 15;
  }

  if (move.effect?.kind === 'status') {
    score += 20;
  }

  if (move.effect?.kind === 'heal') {
    score += 25;
  }

  if (move.effect?.kind === 'stat') {
    score += 18;
  }

  if ((move.priority ?? 0) > 0) {
    score += 12;
  }

  if (species.types.includes(move.type)) {
    score += 10;
  }

  if (move.accuracy < 100) {
    score -= 8;
  }

  return score;
}

function buildMoveDefinition(moveId: string): MoveDefinition | null {
  const move = gen.moves.get(moveId);
  if (!move || !move.exists || move.isNonstandard) {
    return null;
  }

  const type = normalizeType(move.type);
  if (!type) {
    return null;
  }

  const effect = normalizeEffect(move);
  return {
    id: move.id,
    name: move.name,
    type,
    category: normalizeCategory(move.category),
    power: move.basePower,
    accuracy: typeof move.accuracy === 'number' ? move.accuracy : 100,
    pp: move.pp,
    priority: move.priority ?? 0,
    supported: moveSupport(move, effect),
    effect,
    description: move.shortDesc || move.desc || move.name,
  };
}

function buildSpeciesDefinition(speciesId: string): PokemonSpecies | null {
  const species = gen.species.get(speciesId);
  if (!species || !species.exists || species.isNonstandard || species.isCosmeticForme) {
    return null;
  }

  const types = species.types.map((type) => normalizeType(type)).filter((type): type is PokemonType => Boolean(type));
  if (!types.length) {
    return null;
  }

  const abilities = Object.values(species.abilities).filter((a): a is string => Boolean(a));

  return {
    id: species.id,
    num: species.num,
    name: species.name,
    types,
    baseStats: {
      hp: species.baseStats.hp,
      attack: species.baseStats.atk,
      defense: species.baseStats.def,
      specialAttack: species.baseStats.spa,
      specialDefense: species.baseStats.spd,
      speed: species.baseStats.spe,
    },
    moves: [],
    abilities,
  };
}

async function ensureCatalog() {
  if (catalogCache) {
    return catalogCache;
  }

  const pokemon = [...gen.species]
    .map((species) => buildSpeciesDefinition(species.id))
    .filter((species): species is PokemonSpecies => Boolean(species))
    .sort((left, right) => left.num - right.num);

  const moves = [...gen.moves]
    .map((move) => buildMoveDefinition(move.id))
    .filter((move): move is MoveDefinition => Boolean(move))
    .sort((left, right) => left.name.localeCompare(right.name));

  const catalog: CatalogPayload = { pokemon, moves };
  catalogCache = catalog;
  return catalog;
}

async function getSpeciesDefinition(speciesId: string) {
  const catalog = await ensureCatalog();
  return catalog.pokemon.find((species) => species.id === toID(speciesId));
}

async function getMoveDefinition(moveId: string) {
  const catalog = await ensureCatalog();
  return catalog.moves.find((move) => move.id === toID(moveId));
}

export async function listPokemon() {
  const catalog = await ensureCatalog();
  return catalog.pokemon;
}

export async function listMoves() {
  const catalog = await ensureCatalog();
  return catalog.moves;
}

export async function getCatalog() {
  return ensureCatalog();
}

export async function getRecommendedMoves(speciesId: string, limit = 4) {
  const normalizedSpecies = toID(speciesId);
  const cached = recommendedMovesCache.get(normalizedSpecies);
  if (cached) {
    return cached.slice(0, limit);
  }

  const species = await getSpeciesDefinition(normalizedSpecies);
  if (!species) {
    throw new Error(`Unknown species: ${speciesId}`);
  }

  const learnable = await gen.learnsets.learnable(normalizedSpecies);
  const ranked = Object.keys(learnable ?? {})
    .map((moveId) => buildMoveDefinition(moveId))
    .filter((move): move is MoveDefinition => Boolean(move))
    .sort((left, right) => scoreMove(right, species) - scoreMove(left, species));

  const selected: string[] = [];
  const seenTypes = new Set<string>();
  let hasStatusMove = false;

  for (const move of ranked) {
    if (selected.length >= limit) {
      break;
    }

    if (move.category === 'status') {
      if (hasStatusMove || !move.supported) {
        continue;
      }

      hasStatusMove = true;
      selected.push(move.id);
      continue;
    }

    if (seenTypes.has(move.type) && selected.length < limit - 1) {
      continue;
    }

    seenTypes.add(move.type);
    selected.push(move.id);
  }

  if (selected.length < limit) {
    for (const move of ranked) {
      if (selected.length >= limit) {
        break;
      }

      if (!selected.includes(move.id)) {
        selected.push(move.id);
      }
    }
  }

  const finalSelection = selected.slice(0, limit);
  recommendedMovesCache.set(normalizedSpecies, finalSelection);
  return finalSelection;
}

export async function hydrateTeamDefinition(team: TeamDefinition) {
  const hydratedMembers: ResolvedTeamDefinition['pokemon'] = await Promise.all(
    team.pokemon.map(async (entry) => {
      const member: TeamMemberDefinition =
        typeof entry === 'string'
          ? { speciesId: entry }
          : { ...entry };

      const species = await getSpecies(member.speciesId);
      const moves = member.moves?.length ? member.moves.map((move) => toID(move)) : await getRecommendedMoves(member.speciesId);
      const moveDefinitions = await Promise.all(moves.slice(0, 4).map((moveId) => getMove(moveId)));

      // Pick first available ability if not specified
      const ability = member.ability ?? (species.abilities?.[0] ?? undefined);

      return {
        speciesId: species.id,
        name: species.name,
        types: species.types,
        baseStats: species.baseStats,
        moves: moveDefinitions,
        level: member.level ?? 100,
        gender: member.gender ?? 'N',
        shiny: member.shiny ?? false,
        ability,
        item: member.item,
        nature: member.nature ?? 'Hardy',
        evs: member.evs,
        ivs: member.ivs,
      };
    }),
  );

  return {
    pokemon: hydratedMembers,
  };
}

export async function getSpecies(speciesId: string) {
  const species = await getSpeciesDefinition(speciesId);
  if (!species) {
    throw new Error(`Unknown species: ${speciesId}`);
  }

  return species;
}

export async function getLearnsetForSpecies(speciesId: string) {
  const species = await getSpeciesDefinition(toID(speciesId));
  if (!species) throw new Error(`Unknown species: ${speciesId}`);

  const learnable = await gen.learnsets.learnable(toID(speciesId));
  const moves = Object.keys(learnable ?? {})
    .map((moveId) => buildMoveDefinition(moveId))
    .filter((move): move is MoveDefinition => Boolean(move))
    .sort((a, b) => a.name.localeCompare(b.name));

  return moves;
}

export async function getMove(moveId: string) {
  const move = await getMoveDefinition(moveId);
  if (!move) {
    throw new Error(`Unknown move: ${moveId}`);
  }

  return move;
}

export function getTypeMultiplier(moveType: PokemonType, defenderTypes: PokemonType[]) {
  const sourceType = moveType === 'stellar' ? 'Stellar' : `${moveType.charAt(0).toUpperCase()}${moveType.slice(1)}`;
  if (!Dex.getImmunity(sourceType, defenderTypes)) {
    return 0;
  }

  return 2 ** Dex.getEffectiveness(sourceType, defenderTypes);
}
