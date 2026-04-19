import { z } from 'zod';

export const battleModes = ['cpu', 'lan'] as const;
export const aiPersonas = ['random-trainer', 'bug-catcher-timmy', 'gym-leader-brock', 'champion-lance', 'master'] as const;
export const battlePhases = ['team-selection', 'waiting', 'in-progress', 'finished'] as const;
export const moveCategories = ['physical', 'special', 'status'] as const;
export const statusConditions = ['burn', 'poison', 'paralysis', 'sleep', 'freeze'] as const;
export const targetKinds = ['self', 'opponent'] as const;
export const gimmickKinds = ['mega', 'tera', 'zmove'] as const;
export type GimmickKind = (typeof gimmickKinds)[number];
export const statNames = [
  'attack',
  'defense',
  'specialAttack',
  'specialDefense',
  'speed',
  'accuracy',
  'evasion',
] as const;
export const pokemonTypes = [
  'normal',
  'fire',
  'water',
  'electric',
  'grass',
  'ice',
  'fighting',
  'poison',
  'ground',
  'flying',
  'psychic',
  'bug',
  'rock',
  'ghost',
  'dragon',
  'dark',
  'steel',
  'fairy',
  'stellar',
] as const;

export type BattleMode = (typeof battleModes)[number];
export type AIPersona = (typeof aiPersonas)[number];
export type BattlePhase = (typeof battlePhases)[number];
export type MoveCategory = (typeof moveCategories)[number];
export type StatusCondition = (typeof statusConditions)[number];
export type TargetKind = (typeof targetKinds)[number];
export type StatName = (typeof statNames)[number];
export type PokemonType = (typeof pokemonTypes)[number];

export const battleModeSchema = z.enum(battleModes);
export const aiPersonaSchema = z.enum(aiPersonas);
export const battlePhaseSchema = z.enum(battlePhases);
export const moveCategorySchema = z.enum(moveCategories);
export const statusConditionSchema = z.enum(statusConditions);
export const targetKindSchema = z.enum(targetKinds);
export const statNameSchema = z.enum(statNames);
export const pokemonTypeSchema = z.enum(pokemonTypes);

export const baseStatSchema = z.object({
  hp: z.number().int().positive(),
  attack: z.number().int().positive(),
  defense: z.number().int().positive(),
  specialAttack: z.number().int().positive(),
  specialDefense: z.number().int().positive(),
  speed: z.number().int().positive(),
});
export type BaseStats = z.infer<typeof baseStatSchema>;

export const evSchema = z.object({
  hp: z.number().int().min(0).max(252).optional(),
  attack: z.number().int().min(0).max(252).optional(),
  defense: z.number().int().min(0).max(252).optional(),
  specialAttack: z.number().int().min(0).max(252).optional(),
  specialDefense: z.number().int().min(0).max(252).optional(),
  speed: z.number().int().min(0).max(252).optional(),
});
export type EVMap = z.infer<typeof evSchema>;

export const ivSchema = z.object({
  hp: z.number().int().min(0).max(31).optional(),
  attack: z.number().int().min(0).max(31).optional(),
  defense: z.number().int().min(0).max(31).optional(),
  specialAttack: z.number().int().min(0).max(31).optional(),
  specialDefense: z.number().int().min(0).max(31).optional(),
  speed: z.number().int().min(0).max(31).optional(),
});
export type IVMap = z.infer<typeof ivSchema>;

export const battleStatsSchema = baseStatSchema.extend({
  accuracy: z.number().int().default(100),
  evasion: z.number().int().default(100),
});
export type BattleStats = z.infer<typeof battleStatsSchema>;

export const statStageDeltaSchema = z.object({
  attack: z.number().int().min(-2).max(2).optional(),
  defense: z.number().int().min(-2).max(2).optional(),
  specialAttack: z.number().int().min(-2).max(2).optional(),
  specialDefense: z.number().int().min(-2).max(2).optional(),
  speed: z.number().int().min(-2).max(2).optional(),
  accuracy: z.number().int().min(-2).max(2).optional(),
  evasion: z.number().int().min(-2).max(2).optional(),
});
export type StatStageDelta = z.infer<typeof statStageDeltaSchema>;

export const moveEffectSchema = z.object({
  kind: z.enum(['damage', 'status', 'heal', 'stat']),
  target: targetKindSchema.default('opponent'),
  chance: z.number().min(0).max(1).optional(),
  status: statusConditionSchema.optional(),
  healRatio: z.number().min(0).max(1).optional(),
  stages: statStageDeltaSchema.optional(),
});
export type MoveEffect = z.infer<typeof moveEffectSchema>;

export const moveDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  type: pokemonTypeSchema,
  category: moveCategorySchema,
  power: z.number().int().min(0),
  accuracy: z.number().int().min(0).max(100),
  pp: z.number().int().positive(),
  priority: z.number().int().default(0),
  supported: z.boolean().default(true),
  hasRecharge: z.boolean().default(false),
  hasRecoil: z.boolean().default(false),
  effect: moveEffectSchema.optional(),
  description: z.string().min(1),
});
export type MoveDefinition = z.infer<typeof moveDefinitionSchema>;

export const pokemonSpeciesSchema = z.object({
  id: z.string().min(1),
  num: z.number().int(),
  name: z.string().min(1),
  types: z.array(pokemonTypeSchema).min(1).max(2),
  baseStats: baseStatSchema,
  moves: z.array(z.string().min(1)).max(4).default([]),
  abilities: z.array(z.string()).default([]),
});
export type PokemonSpecies = z.infer<typeof pokemonSpeciesSchema>;

export const teamMemberSchema = z.object({
  speciesId: z.string().min(1),
  moves: z.array(z.string().min(1)).min(1).max(4).optional(),
  level: z.number().int().min(1).max(100).optional(),
  gender: z.enum(['M', 'F', 'N']).optional(),
  shiny: z.boolean().optional(),
  ability: z.string().optional(),
  item: z.string().optional(),
  nature: z.string().optional(),
  evs: evSchema.optional(),
  ivs: ivSchema.optional(),
});
export type TeamMemberDefinition = z.infer<typeof teamMemberSchema>;

export const learnedMoveSchema = z.object({
  id: z.string().min(1),
  definition: moveDefinitionSchema,
  currentPP: z.number().int().min(0),
  maxPP: z.number().int().positive(),
});
export type LearnedMove = z.infer<typeof learnedMoveSchema>;

export const resolvedTeamMemberSchema = z.object({
  speciesId: z.string().min(1),
  name: z.string().min(1),
  types: z.array(pokemonTypeSchema).min(1).max(2),
  baseStats: baseStatSchema,
  moves: z.array(moveDefinitionSchema).min(1).max(4),
  level: z.number().int().min(1).max(100).default(100),
  gender: z.enum(['M', 'F', 'N']).default('N'),
  shiny: z.boolean().default(false),
  ability: z.string().optional(),
  item: z.string().optional(),
  nature: z.string().default('Hardy'),
  evs: evSchema.optional(),
  ivs: ivSchema.optional(),
});
export type ResolvedTeamMember = z.infer<typeof resolvedTeamMemberSchema>;

export const statStageSchema = z.object({
  attack: z.number().int().min(-6).max(6),
  defense: z.number().int().min(-6).max(6),
  specialAttack: z.number().int().min(-6).max(6),
  specialDefense: z.number().int().min(-6).max(6),
  speed: z.number().int().min(-6).max(6),
  accuracy: z.number().int().min(-6).max(6),
  evasion: z.number().int().min(-6).max(6),
});
export type StatStageMap = z.infer<typeof statStageSchema>;

export const battlePokemonSchema = z.object({
  instanceId: z.string().min(1),
  speciesId: z.string().min(1),
  name: z.string().min(1),
  level: z.number().int().min(1).max(100),
  types: z.array(pokemonTypeSchema).min(1).max(2),
  baseStats: baseStatSchema,
  stats: battleStatsSchema,
  maxHp: z.number().int().positive(),
  currentHp: z.number().int().min(0),
  moves: z.array(learnedMoveSchema).min(1).max(4),
  fainted: z.boolean(),
  status: statusConditionSchema.nullable(),
  sleepTurns: z.number().int().min(0).default(0),
  freezeTurns: z.number().int().min(0).default(0),
  stages: statStageSchema,
  // Gimmick state
  isMega: z.boolean().default(false),
  isTera: z.boolean().default(false),
  teraType: pokemonTypeSchema.nullable().default(null),
  canMega: z.boolean().default(false),   // has a mega stone
  ability: z.string().optional(),
});
export type BattlePokemon = z.infer<typeof battlePokemonSchema>;

// Gimmick-aware choice: player can attach a gimmick trigger to a move choice
export const playerChoiceSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('move'),
    moveIndex: z.number().int().min(0).max(3),
    gimmick: z.enum(gimmickKinds).optional(), // 'mega' | 'tera' | 'zmove'
    teraType: pokemonTypeSchema.optional(),   // only for tera
    megaVariant: z.enum(['x', 'y']).optional(),
  }),
  z.object({
    type: z.literal('switch'),
    targetIndex: z.number().int().min(0).max(5),
  }),
]);
export type PlayerChoice = z.infer<typeof playerChoiceSchema>;

export const battleSideSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  activeIndex: z.number().int().min(0).max(5),
  team: z.array(battlePokemonSchema).min(1).max(6),
  connected: z.boolean().default(true),
  // Gimmick charges — each can only be used once per battle
  megaUsed: z.boolean().default(false),
  teraUsed: z.boolean().default(false),
  zmoveUsed: z.boolean().default(false),
});
export type BattleSide = z.infer<typeof battleSideSchema>;

export const battleStateSchema = z.object({
  id: z.string().min(1),
  roomId: z.string().nullable(),
  mode: battleModeSchema,
  phase: battlePhaseSchema,
  turn: z.number().int().min(0),
  seed: z.number().int(),
  sides: z.tuple([battleSideSchema, battleSideSchema]),
  log: z.array(z.string()).default([]),
  winnerId: z.string().nullable(),
  queuedChoices: z.record(z.string(), playerChoiceSchema).default({}),
  pendingPlayerIds: z.array(z.string()).default([]),
  timerEndsAt: z.number().int().nullable(),
});
export type BattleState = z.infer<typeof battleStateSchema>;

export const teamSchema = z.object({
  pokemon: z.array(z.union([z.string().min(1), teamMemberSchema])).min(1).max(6),
});
export type TeamDefinition = z.infer<typeof teamSchema>;

export const resolvedTeamSchema = z.object({
  pokemon: z.array(resolvedTeamMemberSchema).min(1).max(6),
});
export type ResolvedTeamDefinition = z.infer<typeof resolvedTeamSchema>;

export const createCpuBattleSchema = z.object({
  playerName: z.string().min(1),
  team: teamSchema,
  difficulty: aiPersonaSchema.default('random-trainer'),
});
export type CreateCpuBattleRequest = z.infer<typeof createCpuBattleSchema>;

export const hostLanBattleSchema = z.object({
  hostName: z.string().min(1),
  team: teamSchema,
});
export type HostLanBattleRequest = z.infer<typeof hostLanBattleSchema>;

export const joinLanBattleSchema = z.object({
  roomId: z.string().min(1),
  playerName: z.string().min(1),
  team: teamSchema,
});
export type JoinLanBattleRequest = z.infer<typeof joinLanBattleSchema>;

export const submitChoiceSchema = z.object({
  battleId: z.string().min(1),
  playerId: z.string().min(1),
  choice: playerChoiceSchema,
});
export type SubmitChoiceRequest = z.infer<typeof submitChoiceSchema>;

export const catalogPayloadSchema = z.object({
  pokemon: z.array(pokemonSpeciesSchema),
  moves: z.array(moveDefinitionSchema),
});
export type CatalogPayload = z.infer<typeof catalogPayloadSchema>;

export const socketEvents = {
  battleState: 'battle:state',
  battleChoice: 'battle:choice',
  battleLog: 'battle:log',
  battleError: 'battle:error',
  hostCreated: 'lan:host-created',
  joinedRoom: 'lan:joined-room',
  roomClosed: 'lan:room-closed',
  playerDisconnected: 'lan:player-disconnected',
} as const;

// ─────────────────────────────────────────
// Tournament Types
// ─────────────────────────────────────────

export const tournamentStatus = ['active', 'won', 'lost'] as const;
export type TournamentStatus = (typeof tournamentStatus)[number];

export const tournamentStateSchema = z.object({
  id: z.string().min(1),
  stage: z.number().int().min(1),
  maxStages: z.number().int().default(10),
  wins: z.number().int().min(0),
  status: z.enum(tournamentStatus).default('active'),
  currentBattleId: z.string().nullable(),
  team: teamSchema,
});
export type TournamentState = z.infer<typeof tournamentStateSchema>;

export const startTournamentRequestSchema = z.object({
  playerName: z.string().min(1),
  team: teamSchema.optional(),
});
export type StartTournamentRequest = z.infer<typeof startTournamentRequestSchema>;

