import { randomUUID } from 'node:crypto';
import type { Server, Socket } from 'socket.io';
import { getCatalog, hydrateTeamDefinition } from '@pokemon-platform/data';
import { chooseCpuChoice, createBattleState, getDefaultChoice, queueChoice, resolveTurn } from '@pokemon-platform/engine';
import type {
  AIPersona,
  BattleState,
  CreateCpuBattleRequest,
  HostLanBattleRequest,
  JoinLanBattleRequest,
  PlayerChoice,
} from '@pokemon-platform/shared';
import { socketEvents } from '@pokemon-platform/shared';

const TURN_TIMEOUT_MS = 45_000;
const DISCONNECT_FORFEIT_MS = 20_000;

interface PendingRoom {
  roomId: string;
  hostName: string;
  hostTeam: HostLanBattleRequest['team'];
}

interface ActiveBattle {
  state: BattleState;
  aiPersona?: AIPersona;
  timer?: NodeJS.Timeout;
  disconnectTimers: Map<string, NodeJS.Timeout>;
}

interface PlayerSocketBinding {
  battleId: string;
  playerId: string;
}

export class BattleRuntime {
  private io: Server | null = null;
  private readonly pendingRooms = new Map<string, PendingRoom>();
  private readonly battles = new Map<string, ActiveBattle>();
  private readonly socketBindings = new Map<string, PlayerSocketBinding>();
  private catalogPromise: ReturnType<typeof getCatalog> | null = null;

  attachIO(io: Server) {
    this.io = io;
  }

  getCatalog() {
    if (!this.catalogPromise) {
      this.catalogPromise = getCatalog();
    }

    return this.catalogPromise;
  }

  async createCpuBattle(request: CreateCpuBattleRequest) {
    const battleId = randomUUID();
    const playerId = 'player-1';
    const cpuId = 'cpu-1';
    const randomNames = ['Youngster Joey','Lass Iris','Hiker Max','Sailor Bill','Beauty Anya','Ace Trainer Kai','Scientist Hugo','Ranger Mia'];
    const trainerNames: Record<string, string> = {
      'random-trainer': randomNames[Math.floor(Math.random() * randomNames.length)],
      'bug-catcher-timmy': 'Bug Catcher Timmy',
      'gym-leader-brock': 'Gym Leader Brock',
      'champion-lance': 'Champion Lance',
    };
    const trainerName = trainerNames[request.difficulty] ?? 'CPU';
    const playerTeam = await hydrateTeamDefinition(request.team);
    const cpuTeamIds = await this.pickCpuTeam(request.team.pokemon, request.difficulty);
    const cpuTeam = await hydrateTeamDefinition({ pokemon: cpuTeamIds });
    const battle = createBattleState({
      id: battleId,
      mode: 'cpu',
      playerA: { id: playerId, name: request.playerName, team: playerTeam },
      playerB: { id: cpuId, name: trainerName, team: cpuTeam },
      seed: Date.now(),
    });

    this.battles.set(battleId, {
      state: battle,
      aiPersona: request.difficulty,
      disconnectTimers: new Map(),
    });

    return { battleId, playerId, state: battle };
  }

  hostLanBattle(request: HostLanBattleRequest) {
    const roomId = Math.random().toString(36).slice(2, 8).toUpperCase();
    this.pendingRooms.set(roomId, {
      roomId,
      hostName: request.hostName,
      hostTeam: request.team,
    });

    return { roomId, playerId: 'player-1' };
  }

  async joinLanBattle(request: JoinLanBattleRequest) {
    const room = this.pendingRooms.get(request.roomId);
    if (!room) {
      throw new Error('Room not found.');
    }

    this.pendingRooms.delete(request.roomId);
    const battleId = randomUUID();
    const [hostTeam, guestTeam] = await Promise.all([
      hydrateTeamDefinition(room.hostTeam),
      hydrateTeamDefinition(request.team),
    ]);
    const state = createBattleState({
      id: battleId,
      roomId: room.roomId,
      mode: 'lan',
      playerA: { id: 'player-1', name: room.hostName, team: hostTeam },
      playerB: { id: 'player-2', name: request.playerName, team: guestTeam },
      seed: Date.now(),
    });

    this.battles.set(battleId, {
      state,
      disconnectTimers: new Map(),
    });
    this.armTurnTimer(battleId);
    this.io?.to(this.roomChannel(room.roomId)).emit(socketEvents.joinedRoom, {
      roomId: room.roomId,
      battleId,
      state,
      playerIds: ['player-1', 'player-2'],
    });

    return { battleId, roomId: room.roomId, playerId: 'player-2', state };
  }

  getBattle(battleId: string) {
    return this.battles.get(battleId)?.state ?? null;
  }

  watchRoom(socket: Socket, roomId: string) {
    socket.join(this.roomChannel(roomId));
    const room = this.pendingRooms.get(roomId);
    if (room) {
      socket.emit(socketEvents.hostCreated, { roomId });
    }
  }

  watchBattle(socket: Socket, battleId: string, playerId?: string) {
    socket.join(this.battleChannel(battleId));
    const battle = this.battles.get(battleId);
    if (!battle) {
      return;
    }

    if (playerId) {
      this.socketBindings.set(socket.id, { battleId, playerId });
      this.markPlayerConnection(battle.state, playerId, true);
      this.clearDisconnectTimer(battleId, playerId);
    }

    socket.emit(socketEvents.battleState, battle.state);
  }

  submitChoice(battleId: string, playerId: string, choice: PlayerChoice) {
    const battle = this.battles.get(battleId);
    if (!battle || battle.state.phase === 'finished') {
      return null;
    }

    battle.state = queueChoice(battle.state, playerId, choice);
    if (battle.state.mode === 'cpu') {
      const cpuId = battle.state.sides[1].id;
      const persona = battle.aiPersona ?? 'gym-leader-brock';
      const cpuChoice = chooseCpuChoice(battle.state, cpuId, persona);
      
      if (cpuChoice.type === 'switch') {
        if (persona === 'champion-lance') {
          battle.state.log.push('Champion Lance: "You forced my hand. Return!"');
        } else if (persona === 'gym-leader-brock') {
          battle.state.log.push('Gym Leader Brock: "A solid defense requires a solid foundation."');
        }
      } else if (cpuChoice.type === 'move') {
        if (persona === 'bug-catcher-timmy' && Math.random() < 0.2) {
          battle.state.log.push('Bug Catcher Timmy: "My bugs are the strongest!"');
        }
      }

      battle.state = resolveTurn(battle.state, {
        [playerId]: choice,
        [cpuId]: cpuChoice,
      });
      this.emitBattleState(battleId);
      return battle.state;
    }

    this.emitBattleState(battleId);
    if (battle.state.pendingPlayerIds.length === 0) {
      this.resolveQueuedTurn(battleId);
    } else {
      this.armTurnTimer(battleId);
    }

    return battle.state;
  }

  handleDisconnect(socketId: string) {
    const binding = this.socketBindings.get(socketId);
    this.socketBindings.delete(socketId);
    if (!binding) {
      return;
    }

    const battle = this.battles.get(binding.battleId);
    if (!battle || battle.state.mode !== 'lan' || battle.state.phase === 'finished') {
      return;
    }

    this.markPlayerConnection(battle.state, binding.playerId, false);
    this.emitBattleState(binding.battleId);
    const timeout = setTimeout(() => {
      const current = this.battles.get(binding.battleId);
      if (!current || current.state.phase === 'finished') {
        return;
      }

      current.state.phase = 'finished';
      current.state.winnerId = current.state.sides.find((side) => side.id !== binding.playerId)?.id ?? null;
      current.state.pendingPlayerIds = [];
      current.state.timerEndsAt = null;
      current.state.log = [...current.state.log, `${binding.playerId} disconnected. Match forfeited.`];
      this.emitBattleState(binding.battleId);
    }, DISCONNECT_FORFEIT_MS);

    battle.disconnectTimers.set(binding.playerId, timeout);
  }

  private async pickCpuTeam(playerTeam: HostLanBattleRequest['team']['pokemon'], persona: AIPersona) {
    const catalog = await this.getCatalog();
    const playerIds = new Set(
      playerTeam.map((entry) => (typeof entry === 'string' ? entry : entry.speciesId)),
    );

    const teamSize = Math.max(3, Math.min(6, playerTeam.length));

    // Random trainer: pick from the full dex, not biased by player's team at all
    if (persona === 'random-trainer') {
      const shuffled = [...catalog.pokemon].sort(() => Math.random() - 0.5);
      return shuffled.slice(0, teamSize).map(p => p.id);
    }

    // Score species by total base stats (power) and exclude player's picks
    const pool = catalog.pokemon
      .filter((species) => !playerIds.has(species.id))
      .map((species) => ({
        id: species.id,
        types: species.types,
        bst: Object.values(species.baseStats).reduce((a, b) => a + b, 0),
      }));

    // Sort by power tier depending on persona
    if (persona === 'bug-catcher-timmy') {
      pool.sort((a, b) => {
        const aBug = a.types.includes('bug') ? -200 : 0;
        const bBug = b.types.includes('bug') ? -200 : 0;
        return (a.bst + aBug) - (b.bst + bBug);
      });
    } else if (persona === 'champion-lance') {
      pool.sort((a, b) => {
        const aDragon = a.types.includes('dragon') ? 100 : 0;
        const bDragon = b.types.includes('dragon') ? 100 : 0;
        return (b.bst + bDragon) - (a.bst + aDragon);
      });
    } else {
      pool.sort((a, b) => b.bst - a.bst);
    }

    // Pick with type diversity
    const selected: string[] = [];
    const usedTypes = new Set<string>();

    for (const candidate of pool) {
      if (selected.length >= teamSize) break;
      const hasNewType = candidate.types.some((t) => !usedTypes.has(t));
      if (hasNewType || selected.length < 2) {
        selected.push(candidate.id);
        candidate.types.forEach((t) => usedTypes.add(t));
      }
    }

    for (const candidate of pool) {
      if (selected.length >= teamSize) break;
      if (!selected.includes(candidate.id)) selected.push(candidate.id);
    }

    return selected;
  }

  private resolveQueuedTurn(battleId: string) {
    const battle = this.battles.get(battleId);
    if (!battle) {
      return;
    }

    this.clearTimer(battle);
    battle.state = resolveTurn(battle.state, battle.state.queuedChoices);
    this.emitBattleState(battleId);
    if (battle.state.phase !== 'finished') {
      this.armTurnTimer(battleId);
    }
  }

  private armTurnTimer(battleId: string) {
    const battle = this.battles.get(battleId);
    if (!battle || battle.state.phase === 'finished') {
      return;
    }

    this.clearTimer(battle);
    battle.state.timerEndsAt = Date.now() + TURN_TIMEOUT_MS;
    battle.timer = setTimeout(() => {
      const current = this.battles.get(battleId);
      if (!current || current.state.phase === 'finished') {
        return;
      }

      const choices = Object.fromEntries(
        current.state.sides.map((side) => [side.id, current.state.queuedChoices[side.id] ?? getDefaultChoice(current.state, side.id)]),
      );
      current.state = resolveTurn(current.state, choices);
      this.emitBattleState(battleId);
      if (current.state.phase !== 'finished') {
        this.armTurnTimer(battleId);
      }
    }, TURN_TIMEOUT_MS);
  }

  private emitBattleState(battleId: string) {
    const battle = this.battles.get(battleId);
    if (!battle) {
      return;
    }

    this.io?.to(this.battleChannel(battleId)).emit(socketEvents.battleState, battle.state);
  }

  private clearTimer(battle: ActiveBattle) {
    if (battle.timer) {
      clearTimeout(battle.timer);
      battle.timer = undefined;
    }
  }

  private clearDisconnectTimer(battleId: string, playerId: string) {
    const battle = this.battles.get(battleId);
    const timeout = battle?.disconnectTimers.get(playerId);
    if (timeout) {
      clearTimeout(timeout);
      battle?.disconnectTimers.delete(playerId);
    }
  }

  private markPlayerConnection(state: BattleState, playerId: string, connected: boolean) {
    const side = state.sides.find((candidate) => candidate.id === playerId);
    if (side) {
      side.connected = connected;
    }
  }

  private roomChannel(roomId: string) {
    return `room:${roomId}`;
  }

  private battleChannel(battleId: string) {
    return `battle:${battleId}`;
  }
}
