import type {
  BattleState,
  CatalogPayload,
  CreateCpuBattleRequest,
  HostLanBattleRequest,
  JoinLanBattleRequest,
  MoveDefinition,
  PlayerChoice,
  StartTournamentRequest,
  TournamentState,
} from '@pokemon-platform/shared';

const API_URL = import.meta.env.VITE_API_URL || '';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
    },
    ...init,
  });

  if (!response.ok) {
    const error = (await response.json().catch(() => ({ message: 'Request failed.' }))) as { message?: string };
    throw new Error(error.message ?? 'Request failed.');
  }

  return response.json() as Promise<T>;
}

export function fetchCatalog() {
  return request<CatalogPayload>('/api/catalog');
}

export function fetchMovesForSpecies(speciesId: string) {
  return request<{ moves: MoveDefinition[] }>(`/api/pokemon/${speciesId}/moves`);
}

export function createCpuBattle(payload: CreateCpuBattleRequest) {
  return request<{ battleId: string; playerId: string; state: BattleState }>('/api/battles/cpu', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function hostLanBattle(payload: HostLanBattleRequest) {
  return request<{ roomId: string; playerId: string }>('/api/lan/host', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function joinLanBattle(payload: JoinLanBattleRequest) {
  return request<{ battleId: string; roomId: string; playerId: string; state: BattleState }>('/api/lan/join', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function submitBattleChoice(battleId: string, playerId: string, choice: PlayerChoice) {
  return request<{ state: BattleState }>(`/api/battles/${battleId}/choice`, {
    method: 'POST',
    body: JSON.stringify({ playerId, choice }),
  });
}

export function startTournament(payload: StartTournamentRequest) {
  return request<{ tournament: TournamentState; battle: { battleId: string; playerId: string; state: BattleState } }>('/api/tournament/start', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function nextTournamentStage(tournamentId: string) {
  return request<{ tournament: TournamentState; battle: { battleId: string; playerId: string; state: BattleState } }>(`/api/tournament/${tournamentId}/next`, {
    method: 'POST',
  });
}
