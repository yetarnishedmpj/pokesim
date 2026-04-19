import { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  BattlePokemon,
  BattleState,
  CatalogPayload,
  MoveDefinition,
  PlayerChoice,
  PokemonSpecies,
  PokemonType,
  TournamentState,
} from '@pokemon-platform/shared';
import { socketEvents } from '@pokemon-platform/shared';
import {
  createCpuBattle,
  fetchCatalog,
  fetchMovesForSpecies,
  hostLanBattle,
  joinLanBattle,
  nextTournamentStage,
  startTournament,
  submitBattleChoice,
} from './lib/api';
import { getSocket, subscribeToBattle } from './lib/socket';
import { parseShowdownTeam } from './lib/showdownParser';
import type { TeamMemberDefinition } from '@pokemon-platform/shared';

const POKEMON_TYPES = ['fire','water','grass','electric','ice','fighting','poison','ground','flying','psychic','bug','rock','ghost','dragon','dark','steel','fairy','normal'] as const;

const REGIONS: Record<string, [number, number]> = {
  'All': [1, 9999],
  'Kanto': [1, 151],
  'Johto': [152, 251],
  'Hoenn': [252, 386],
  'Sinnoh': [387, 493],
  'Unova': [494, 649],
  'Kalos': [650, 721],
  'Alola': [722, 809],
  'Galar': [810, 905],
  'Paldea': [906, 9999],
};

const TYPE_COLORS: Record<string, string> = {
  fire:'#f97316', water:'#3b82f6', grass:'#22c55e', electric:'#eab308',
  ice:'#67e8f9', fighting:'#b45309', poison:'#a855f7', ground:'#d97706',
  flying:'#93c5fd', psychic:'#ec4899', bug:'#84cc16', rock:'#a8a29e',
  ghost:'#7c3aed', dragon:'#6366f1', dark:'#374151', steel:'#94a3b8',
  fairy:'#f472b6', normal:'#9ca3af',
};

type Mode = 'cpu' | 'lan' | 'tournament';
type LanFlow = 'host' | 'join';

interface SessionState {
  battleId?: string;
  playerId?: string;
  roomId?: string;
  tournamentId?: string;
}

function hpPercent(pokemon: BattlePokemon) {
  return Math.max(0, Math.round((pokemon.currentHp / pokemon.maxHp) * 100));
}

function getHpColor(percent: number) {
  if (percent > 50) return '#22c55e';
  if (percent > 20) return '#facc15';
  return '#ef4444';
}

function getSpriteUrl(name: string, isBack = false) {
  const cleanName = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return `https://play.pokemonshowdown.com/sprites/ani${isBack ? '-back' : ''}/${cleanName}.gif`;
}

function activePokemon(state: BattleState | null, playerId: string | undefined) {
  if (!state || !playerId) {
    return null;
  }

  const side = state.sides.find((candidate) => candidate.id === playerId);
  const opponent = state.sides.find((candidate) => candidate.id !== playerId);
  if (!side || !opponent) {
    return null;
  }

  return {
    mine: side.team[side.activeIndex],
    mineSide: side,
    theirs: opponent.team[opponent.activeIndex],
    theirSide: opponent,
  };
}

function SpeciesCard({
  species,
  selected,
  onClick,
}: {
  species: PokemonSpecies;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`species-card ${selected ? 'selected' : ''}`} onClick={onClick} type="button">
      <div className="species-card-content">
        <img src={getSpriteUrl(species.name)} alt={species.name} className="species-sprite" loading="lazy" />
        <div className="species-details">
          <div className="species-head">
            <strong>{species.name}</strong>
            <span>{species.types.join(' / ')}</span>
          </div>
          <div className="species-stats">
            <span>HP {species.baseStats.hp}</span>
            <span>ATK {species.baseStats.attack}</span>
            <span>SPA {species.baseStats.specialAttack}</span>
            <span>SPE {species.baseStats.speed}</span>
          </div>
        </div>
      </div>
    </button>
  );
}

function PokemonPanel({ label, pokemon, isOpponent }: { label: string; pokemon: BattlePokemon; isOpponent?: boolean }) {
  const hpPct = hpPercent(pokemon);
  return (
    <section className="pokemon-panel">
      <div className="pokemon-panel__top">
        <div className="pokemon-sprite-container">
          <img src={getSpriteUrl(pokemon.name, !isOpponent)} alt={pokemon.name} className={`pokemon-sprite ${isOpponent ? 'opponent' : 'player'}`} />
        </div>
        <div className="pokemon-info-container">
          <p>{label}</p>
          <h3>{pokemon.name}</h3>
          <span>{pokemon.types.join(' / ')}</span>
        </div>
        <div className="pokemon-status">
          <span className={`status-badge ${pokemon.status ?? ''}`}>{pokemon.status ?? 'healthy'}</span>
          <strong>{pokemon.currentHp}/{pokemon.maxHp} HP</strong>
        </div>
      </div>
      <div className="hp-bar">
        <div className="hp-bar__fill" style={{ width: `${hpPct}%`, background: getHpColor(hpPct) }} />
      </div>
    </section>
  );
}

function isSpeciesInTeam(team: (string | TeamMemberDefinition)[], speciesId: string) {
  return team.some(member => typeof member === 'string' ? member === speciesId : member.speciesId === speciesId);
}

function TypeBadge({ type }: { type: string }) {
  const color = TYPE_COLORS[type] ?? '#9ca3af';
  return (
    <span className="type-badge" style={{ background: color + '33', color, border: `1px solid ${color}66` }}>
      {type}
    </span>
  );
}

function MovePicker({
  species,
  onConfirm,
  onClose,
}: {
  species: PokemonSpecies;
  onConfirm: (member: TeamMemberDefinition) => void;
  onClose: () => void;
}) {
  const [moves, setMoves] = useState<MoveDefinition[]>([]);
  const [selectedMoves, setSelectedMoves] = useState<string[]>([]);
  const [moveSearch, setMoveSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetchMovesForSpecies(species.id)
      .then(({ moves: m }) => { setMoves(m); setLoading(false); })
      .catch(() => setLoading(false));
  }, [species.id]);

  const filtered = useMemo(() => {
    const q = moveSearch.toLowerCase();
    return moves.filter(m =>
      !q || m.name.toLowerCase().includes(q) || m.type.includes(q) || m.category.includes(q)
    );
  }, [moves, moveSearch]);

  const toggleMove = (id: string) => {
    setSelectedMoves(prev =>
      prev.includes(id) ? prev.filter(m => m !== id) : prev.length < 4 ? [...prev, id] : prev
    );
  };

  const handleConfirm = () => {
    onConfirm({
      speciesId: species.id,
      moves: selectedMoves.length > 0 ? selectedMoves : undefined,
    });
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-box" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title-group">
            <img src={getSpriteUrl(species.name)} alt={species.name} className="modal-sprite" />
            <div>
              <h3 className="modal-pokemon-name">#{species.num} {species.name}</h3>
              <div className="modal-types">
                {species.types.map(t => <TypeBadge key={t} type={t} />)}
              </div>
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-move-header">
          <span>Select up to 4 moves <em className="muted">({selectedMoves.length}/4 selected)</em></span>
          <input
            className="modal-search"
            placeholder="Search moves…"
            value={moveSearch}
            onChange={e => setMoveSearch(e.target.value)}
          />
        </div>
        <div className="modal-selected-moves">
          {selectedMoves.map(id => {
            const m = moves.find(mv => mv.id === id);
            return m ? (
              <span key={id} className="selected-move-chip" style={{ borderColor: TYPE_COLORS[m.type] ?? '#666' }}>
                {m.name}
                <button onClick={() => toggleMove(id)}>✕</button>
              </span>
            ) : null;
          })}
          {selectedMoves.length === 0 && <span className="muted" style={{fontSize:'0.75rem'}}>Auto-selected if none chosen</span>}
        </div>
        <div className="modal-move-list">
          {loading ? <div className="muted" style={{padding:'16px'}}>Loading moves…</div> : filtered.map(move => (
            <button
              key={move.id}
              className={`move-row ${selectedMoves.includes(move.id) ? 'move-row--selected' : ''} ${!move.supported ? 'move-row--unsupported' : ''}`}
              onClick={() => toggleMove(move.id)}
              disabled={!selectedMoves.includes(move.id) && selectedMoves.length >= 4}
            >
              <div className="move-main-col">
                <span className="move-name">{move.name}</span>
                {move.description && <span className="move-desc">{move.description}</span>}
              </div>
              <TypeBadge type={move.type} />
              <span className="move-cat">{move.category}</span>
              <span className="move-stat">{move.power > 0 ? `${move.power} PWR` : '—'}</span>
              <span className="move-stat">{move.accuracy < 100 ? `${move.accuracy}%` : '∞'}</span>
              <span className="move-stat">{move.pp} PP</span>
            </button>
          ))}
        </div>
        <div className="modal-footer">
          <button className="secondary-button" style={{marginTop:0, width:'auto', padding:'10px 20px'}} onClick={onClose}>Cancel</button>
          <button className="primary-button" style={{marginTop:0, width:'auto', padding:'10px 24px'}} onClick={handleConfirm}>
            Add to Team
          </button>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [catalog, setCatalog] = useState<CatalogPayload | null>(null);
  const [mode, setMode] = useState<Mode>('cpu');
  const [lanFlow, setLanFlow] = useState<LanFlow>('host');
  const [selectedTeam, setSelectedTeam] = useState<(string | TeamMemberDefinition)[]>(['charizard', 'pikachu', 'lucario']);
  const [showdownText, setShowdownText] = useState('');
  const [speciesQuery, setSpeciesQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [regionFilter, setRegionFilter] = useState<string>('All');
  const [movePickerSpecies, setMovePickerSpecies] = useState<PokemonSpecies | null>(null);
  const [playerName, setPlayerName] = useState('Player One');
  const [roomIdInput, setRoomIdInput] = useState('');
  const [difficulty, setDifficulty] = useState<'random-trainer' | 'bug-catcher-timmy' | 'gym-leader-brock' | 'champion-lance'>('random-trainer');
  const [battleState, setBattleState] = useState<BattleState | null>(null);
  const [session, setSession] = useState<SessionState>({});
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [waitingForOpponent, setWaitingForOpponent] = useState(false);
  // Gimmick UI state
  const [activeGimmick, setActiveGimmick] = useState<'mega' | 'tera' | 'zmove' | null>(null);
  const [pendingTeraType, setPendingTeraType] = useState<PokemonType | null>(null);
  // Tournament state
  const [tournament, setTournament] = useState<TournamentState | null>(null);
  const [tournamentTeamType, setTournamentTeamType] = useState<'random' | 'custom'>('random');

  useEffect(() => {
    fetchCatalog().then(setCatalog).catch((reason) => setError(reason instanceof Error ? reason.message : 'Unable to load catalog.'));
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!session.battleId) {
      return;
    }

    return subscribeToBattle(session.battleId, session.playerId, (state) => {
      setBattleState(state);
      setWaitingForOpponent(false);
    });
  }, [session.battleId, session.playerId]);

  useEffect(() => {
    const socket = getSocket();
    const handleRoomReady = (payload: { roomId: string; battleId: string; state: BattleState }) => {
      setSession((current) => ({ ...current, battleId: payload.battleId, roomId: payload.roomId }));
      setBattleState(payload.state);
      setWaitingForOpponent(false);
      socket.emit('battle:watch', { battleId: payload.battleId, playerId: 'player-1' });
    };

    socket.on(socketEvents.joinedRoom, handleRoomReady);
    return () => {
      socket.off(socketEvents.joinedRoom, handleRoomReady);
    };
  }, []);

  const battleView = useMemo(() => activePokemon(battleState, session.playerId), [battleState, session.playerId]);
  const filteredSpecies = useMemo(() => {
    const allSpecies = catalog?.pokemon ?? [];
    const query = speciesQuery.trim().toLowerCase();
    const [rMin, rMax] = REGIONS[regionFilter] ?? [1, 9999];

    return allSpecies.filter((species) => {
      if (species.num < rMin || species.num > rMax) return false;
      if (typeFilter && !species.types.includes(typeFilter as any)) return false;
      if (query) {
        const hay = `${species.name} ${species.id} ${species.types.join(' ')}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });
  }, [catalog, speciesQuery, typeFilter, regionFilter]);
  const canAct = Boolean(session.playerId && battleState?.phase === 'in-progress' && battleState.pendingPlayerIds.includes(session.playerId));
  const timerSeconds = battleState?.timerEndsAt ? Math.max(0, Math.ceil((battleState.timerEndsAt - now) / 1000)) : 0;

  const toggleSpecies = (speciesId: string) => {
    setSelectedTeam((current) => {
      if (isSpeciesInTeam(current, speciesId)) {
        return current.filter((member) => (typeof member === 'string' ? member : member.speciesId) !== speciesId);
      }

      if (current.length >= 6) {
        return current;
      }

      return [...current, speciesId];
    });
  };

  const handleImportShowdown = () => {
    if (!catalog) return;
    try {
      const parsed = parseShowdownTeam(showdownText, catalog.pokemon);
      if (parsed.pokemon.length > 0) {
        setSelectedTeam(parsed.pokemon);
        setShowdownText('');
      } else {
        setError('No valid Pokemon found in the Showdown text.');
      }
    } catch (err) {
      setError('Failed to parse Showdown team.');
    }
  };

  const handleMovePickerConfirm = useCallback((member: TeamMemberDefinition) => {
    setSelectedTeam(prev => {
      if (isSpeciesInTeam(prev, member.speciesId)) {
        // replace existing entry
        return prev.map(m => (typeof m === 'string' ? m : m.speciesId) === member.speciesId ? member : m);
      }
      if (prev.length >= 6) return prev;
      return [...prev, member];
    });
    setMovePickerSpecies(null);
  }, []);

  const handleRandomiseTeam = () => {
    if (!catalog) return;
    const shuffled = [...catalog.pokemon].sort(() => Math.random() - 0.5);
    const randomTeam = shuffled.slice(0, 6).map(species => ({ speciesId: species.id }));
    setSelectedTeam(randomTeam);
  };

  const beginCpuBattle = async () => {
    try {
      setError(null);
      const payload = await createCpuBattle({
        playerName,
        team: { pokemon: selectedTeam },
        difficulty,
      });
      setSession({ battleId: payload.battleId, playerId: payload.playerId });
      setBattleState(payload.state);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to start CPU battle.');
    }
  };

  const beginHostBattle = async () => {
    try {
      setError(null);
      const payload = await hostLanBattle({
        hostName: playerName,
        team: { pokemon: selectedTeam },
      });
      setSession({ roomId: payload.roomId, playerId: payload.playerId });
      setWaitingForOpponent(true);
      getSocket().emit('lan:watch-room', { roomId: payload.roomId });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to host LAN room.');
    }
  };

  const beginJoinBattle = async () => {
    try {
      setError(null);
      const payload = await joinLanBattle({
        roomId: roomIdInput.trim().toUpperCase(),
        playerName,
        team: { pokemon: selectedTeam },
      });
      setSession({ roomId: payload.roomId, battleId: payload.battleId, playerId: payload.playerId });
      setBattleState(payload.state);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to join LAN room.');
    }
  };

  const sendChoice = async (choice: PlayerChoice) => {
    if (!session.battleId || !session.playerId) {
      return;
    }
    // Reset gimmick state after each move
    setActiveGimmick(null);
    setPendingTeraType(null);

    if (battleState?.mode === 'cpu') {
      const response = await submitBattleChoice(session.battleId, session.playerId, choice);
      setBattleState(response.state);
      
      // If tournament battle finished, we might need to update local tournament state
      if (mode === 'tournament' && response.state.phase === 'finished' && tournament) {
          const isWinner = response.state.winnerId === 'player-1';
          setTournament(prev => prev ? {
              ...prev,
              wins: isWinner ? prev.wins + 1 : prev.wins,
              status: isWinner ? (prev.stage >= prev.maxStages ? 'won' : 'active') : 'lost',
              stage: isWinner && prev.stage < prev.maxStages ? prev.stage + 1 : prev.stage
          } : null);
      }
      return;
    }

    getSocket().emit(socketEvents.battleChoice, {
      battleId: session.battleId,
      playerId: session.playerId,
      choice,
    });
  };

  const handleStartTournament = async () => {
      try {
          const payload: any = { playerName };
          if (tournamentTeamType === 'custom') {
              payload.team = { pokemon: selectedTeam };
          }
          const data = await startTournament(payload);
          setSession({
              battleId: data.battle.battleId,
              playerId: data.battle.playerId,
              tournamentId: data.tournament.id
          });
          setTournament(data.tournament);
          setBattleState(data.battle.state);
          setMode('tournament');
      } catch (err) {
          setError(err instanceof Error ? err.message : 'Tournament start failed');
      }
  };

  const handleNextTournamentMatch = async () => {
      if (!tournament) return;
      try {
          const data = await nextTournamentStage(tournament.id);
          setSession(prev => ({
              ...prev,
              battleId: data.battle.battleId,
              playerId: data.battle.playerId
          }));
          setTournament(data.tournament);
          setBattleState(data.battle.state);
      } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to load next match');
      }
  };

  return (
    <main className="app-shell">
      <section className="hero">
        <div className="hero-pokeball-row" aria-hidden="true">
          <span className="hero-pokeball">⬤</span>
          <span className="hero-divider" />
          <span className="hero-pokeball">⬤</span>
          <span className="hero-divider" />
          <span className="hero-pokeball">⬤</span>
        </div>
        <h1 className="hero-title">PokéSim</h1>
        <p className="hero-eyebrow">— Battle Simulator —</p>
        <p className="hero-copy">
          Build your dream team from the full National Dex, challenge unique CPU trainers, or host LAN PvP battles with friends.
        </p>
      </section>

      {error ? <div className="error-banner">{error}</div> : null}

      {!battleState ? (
        <section className="setup-grid">
          <article className="control-card">
            <h2>1. Battle mode</h2>
            <div className="pill-row">
              <button className={mode === 'cpu' ? 'pill active' : 'pill'} onClick={() => setMode('cpu')} type="button">CPU</button>
              <button className={mode === 'tournament' ? 'pill active' : 'pill'} onClick={() => setMode('tournament')} type="button">Tournament</button>
              <button className={mode === 'lan' ? 'pill active' : 'pill'} onClick={() => setMode('lan')} type="button">LAN PvP</button>
            </div>

            <label>
              Trainer name
              <input value={playerName} onChange={(event) => setPlayerName(event.target.value)} />
            </label>

            {mode === 'tournament' ? (
                <div className="tournament-info-card" style={{ marginTop: '12px', padding: '12px', background: 'rgba(0,0,0,0.2)', borderRadius: '8px', border: '1px solid rgba(255,203,5,0.3)' }}>
                    <h3 style={{ fontSize: '0.8rem', color: '#ffcb05', marginBottom: '8px' }}>🏆 Tournament Mode</h3>
                    <ul style={{ fontSize: '0.7rem', color: '#94a3b8', paddingLeft: '16px', margin: 0 }}>
                        <li>10 stages, random tiered teams.</li>
                        <li>AI difficulty scales each stage.</li>
                        <li>One loss and you're eliminated!</li>
                    </ul>
                    <div className="form-group" style={{ marginTop: '12px' }}>
                        <label style={{ fontSize: '0.75rem', color: '#ffcb05' }}>Team Selection</label>
                        <div className="pill-row" style={{ marginTop: '4px' }}>
                            <button 
                                className={tournamentTeamType === 'random' ? 'pill active' : 'pill'} 
                                onClick={() => setTournamentTeamType('random')} 
                                type="button"
                                style={{ fontSize: '0.65rem', padding: '4px 8px' }}
                            >🎲 Random Team</button>
                            <button 
                                className={tournamentTeamType === 'custom' ? 'pill active' : 'pill'} 
                                onClick={() => setTournamentTeamType('custom')} 
                                type="button"
                                style={{ fontSize: '0.65rem', padding: '4px 8px' }}
                            >🛠️ Custom Team</button>
                        </div>
                        {tournamentTeamType === 'custom' && selectedTeam.length === 0 && (
                            <p style={{ color: '#ef4444', fontSize: '0.6rem', marginTop: '4px' }}>⚠ No Pokémon selected below!</p>
                        )}
                    </div>
                </div>
            ) : mode === 'cpu' ? (
              <label>
                CPU opponent
                <select value={difficulty} onChange={(event) => setDifficulty(event.target.value as typeof difficulty)}>
                  <option value="random-trainer">🎲 Random Trainer (surprise me!)</option>
                  <option value="bug-catcher-timmy">🐛 Bug Catcher Timmy</option>
                  <option value="gym-leader-brock">🪨 Gym Leader Brock</option>
                  <option value="champion-lance">🐉 Champion Lance</option>
                  <option value="master">👑 Master (Elite AI + Gimmicks)</option>
                </select>
              </label>
            ) : (
              <>
                <div className="pill-row">
                  <button className={lanFlow === 'host' ? 'pill active' : 'pill'} onClick={() => setLanFlow('host')} type="button">Host</button>
                  <button className={lanFlow === 'join' ? 'pill active' : 'pill'} onClick={() => setLanFlow('join')} type="button">Join</button>
                </div>
                {lanFlow === 'join' ? (
                  <label>
                    Room code
                    <input value={roomIdInput} onChange={(event) => setRoomIdInput(event.target.value)} placeholder="Enter host room code" />
                  </label>
                ) : null}
              </>
            )}

            <button
              className="primary-button"
              onClick={mode === 'tournament' ? handleStartTournament : mode === 'cpu' ? beginCpuBattle : lanFlow === 'host' ? beginHostBattle : beginJoinBattle}
              type="button"
              disabled={(mode !== 'tournament' && selectedTeam.length === 0) || (mode === 'tournament' && tournamentTeamType === 'custom' && selectedTeam.length === 0)}
            >
              {mode === 'tournament' ? 'Start Tournament 🏆' : mode === 'cpu' ? 'Start CPU Battle' : lanFlow === 'host' ? 'Create LAN Room' : 'Join LAN Room'}
            </button>

            {waitingForOpponent && session.roomId ? (
              <div className="waiting-card">
                <span className="eyebrow" style={{ color: '#fbbf24' }}>WAITING FOR OPPONENT...</span>
                <p>Tell your friend to join this room code:</p>
                <div style={{
                  background: 'rgba(0,0,0,0.4)', 
                  border: '2px dashed rgba(251, 191, 36, 0.5)',
                  padding: '16px', 
                  borderRadius: '12px',
                  textAlign: 'center',
                  margin: '12px 0',
                  cursor: 'pointer'
                }} onClick={() => navigator.clipboard.writeText(session.roomId!)}>
                  <span style={{ fontSize: '2.5rem', fontWeight: 900, letterSpacing: '0.15em', color: '#fbbf24' }}>
                    {session.roomId}
                  </span>
                  <div style={{ fontSize: '0.75rem', opacity: 0.7, marginTop: '4px' }}>(click to copy)</div>
                </div>
              </div>
            ) : null}
          </article>

          <article className="control-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2>2. Team selection</h2>
              <button 
                className="secondary-button" 
                style={{ margin: 0, padding: '6px 12px', fontSize: '0.8rem', width: 'auto' }}
                onClick={handleRandomiseTeam}
              >
                🎲 Randomise Team
              </button>
            </div>
            <p className="muted">Click a Pokémon to pick its moves, then add it. Up to 6 slots.</p>

            {/* Search + Region */}
            <div className="filter-row">
              <input
                className="filter-search"
                value={speciesQuery}
                onChange={e => setSpeciesQuery(e.target.value)}
                placeholder="Search name, type…"
              />
              <select
                className="region-select"
                value={regionFilter}
                onChange={e => setRegionFilter(e.target.value)}
              >
                {Object.keys(REGIONS).map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>

            {/* Type filter chips */}
            <div className="type-filter-row">
              <button
                className={`type-chip ${typeFilter === null ? 'type-chip--active' : ''}`}
                onClick={() => setTypeFilter(null)}
              >All</button>
              {POKEMON_TYPES.map(t => (
                <button
                  key={t}
                  className={`type-chip ${typeFilter === t ? 'type-chip--active' : ''}`}
                  style={typeFilter === t ? { background: (TYPE_COLORS[t] ?? '#666') + '44', borderColor: TYPE_COLORS[t] } : {}}
                  onClick={() => setTypeFilter(prev => prev === t ? null : t)}
                >{t}</button>
              ))}
            </div>

            {/* Selected team chips */}
            <div className="team-chips">
              {selectedTeam.length === 0 && <span className="muted" style={{fontSize:'0.75rem'}}>No Pokémon selected</span>}
              {selectedTeam.map((member, i) => {
                const id = typeof member === 'string' ? member : member.speciesId;
                const moves = typeof member === 'string' ? [] : (member.moves ?? []);
                return (
                  <span className="team-chip" key={`${id}-${i}`}>
                    <img src={getSpriteUrl(id)} alt={id} style={{width:24,height:24,imageRendering:'pixelated',verticalAlign:'middle'}} />
                    {' '}{id}
                    {moves.length > 0 && <em style={{fontSize:'0.65rem',opacity:0.7}}> ({moves.length}mv)</em>}
                    <button
                      className="chip-remove"
                      onClick={() => setSelectedTeam(prev => prev.filter((_, idx) => idx !== i))}
                    >✕</button>
                  </span>
                );
              })}
            </div>

            {/* Showdown import */}
            <div className="showdown-import">
              <label>
                Import from Showdown
                <textarea
                  rows={3}
                  placeholder="Paste Showdown format here…"
                  value={showdownText}
                  onChange={e => setShowdownText(e.target.value)}
                  className="showdown-textarea"
                />
              </label>
              <button
                className="secondary-button"
                style={{ marginTop: '8px', padding: '8px 12px' }}
                onClick={handleImportShowdown}
                type="button"
                disabled={!showdownText.trim()}
              >Import Team</button>
            </div>

            {/* Pokédex grid */}
            <p className="muted" style={{fontSize:'0.75rem',margin:'8px 0 4px'}}>
              {filteredSpecies.length} Pokémon — click to choose moves
            </p>
            <div className="species-grid">
              {filteredSpecies.map(species => (
                <SpeciesCard
                  key={species.id}
                  species={species}
                  selected={isSpeciesInTeam(selectedTeam, species.id)}
                  onClick={() => {
                    if (isSpeciesInTeam(selectedTeam, species.id)) {
                      setSelectedTeam(prev => prev.filter(m => (typeof m === 'string' ? m : m.speciesId) !== species.id));
                    } else if (selectedTeam.length < 6) {
                      setMovePickerSpecies(species);
                    }
                  }}
                />
              ))}
            </div>
          </article>
        </section>
      ) : null}

      {/* Tournament Post-Match Hub */}
      {!waitingForOpponent && battleState && battleState.phase === 'finished' && mode === 'tournament' && tournament && (
          <section className="setup-grid" style={{ justifyContent: 'center' }}>
              <article className="control-card" style={{ maxWidth: '500px' }}>
                  <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                      <span style={{ fontSize: '3rem' }}>
                          {tournament.status === 'won' ? '👑' : tournament.status === 'lost' ? '💀' : '🏁'}
                      </span>
                      <h2 style={{ fontSize: '1.5rem', marginTop: '12px' }}>
                          {tournament.status === 'won' ? 'Tournament Champion!' : 
                           tournament.status === 'lost' ? 'Eliminated!' : 
                           `Stage ${tournament.stage - 1} Clear!`}
                      </h2>
                  </div>

                  <div className="tournament-progress-box" style={{ background: 'rgba(0,0,0,0.3)', padding: '20px', borderRadius: '12px', border: '1px solid rgba(255,203,5,0.2)' }}>
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginBottom: '20px' }}>
                          {Array.from({ length: tournament.maxStages }).map((_, i) => (
                              <div key={i} style={{
                                  width: '12px', height: '12px', borderRadius: '50%',
                                  background: i < tournament.wins ? '#22c55e' : i === tournament.wins && tournament.status === 'active' ? '#eab308' : '#374151',
                                  boxShadow: i === tournament.wins && tournament.status === 'active' ? '0 0 10px #eab308' : 'none'
                              }} />
                          ))}
                      </div>

                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px', fontSize: '0.85rem' }}>
                          <span>Current Wins:</span>
                          <strong>{tournament.wins} / {tournament.maxStages}</strong>
                      </div>

                      {tournament.status === 'active' && (
                          <div style={{ textAlign: 'center', marginTop: '16px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '16px' }}>
                              <p className="muted" style={{ fontSize: '0.75rem', marginBottom: '12px' }}>Next opponent power level:</p>
                              <div style={{ display: 'inline-block', padding: '4px 12px', borderRadius: '4px', background: '#3b82f6', color: '#fff', fontSize: '0.7rem', fontWeight: 800 }}>
                                  {tournament.stage >= 9 ? 'MASTER AI' : tournament.stage >= 7 ? 'ELITE TRAINER' : tournament.stage >= 4 ? 'VETERAN' : 'BEGINNER'}
                              </div>
                          </div>
                      )}
                  </div>

                  <div style={{ marginTop: '24px', display: 'flex', gap: '12px' }}>
                      {tournament.status === 'active' ? (
                          <button className="primary-button" style={{ margin: 0 }} onClick={handleNextTournamentMatch}>
                              Next Battle ⚔️
                          </button>
                      ) : (
                          <button className="primary-button" style={{ margin: 0 }} onClick={() => { setBattleState(null); setTournament(null); }}>
                              Back to Hub
                          </button>
                      )}
                  </div>
              </article>
          </section>
      )}

      {battleState ? (
        <section className="battle-layout">
          <article className="battle-stage">
            <div className="battle-topbar">
              <div>
                <span className="eyebrow">Battle {battleState.id.slice(0, 8)}</span>
                <h2>{battleState.mode === 'cpu' ? 'CPU Battle' : `LAN Room ${battleState.roomId}`}</h2>
              </div>
              <div className="battle-meta">
                <span>Turn {battleState.turn}</span>
                <span>{battleState.phase}</span>
                <span>{battleState.phase === 'in-progress' ? `${timerSeconds}s` : 'ended'}</span>
              </div>
            </div>

            {battleView ? (
              <>
                <PokemonPanel label="Opponent" pokemon={battleView.theirs} isOpponent={true} />
                <PokemonPanel label="You" pokemon={battleView.mine} isOpponent={false} />

                {/* ── Gimmick Bar ── */}
                {canAct && (
                  <div className="gimmick-bar">
                    <span className="gimmick-bar__label">GIMMICK</span>

                    {/* Mega Evolution */}
                    <button
                      type="button"
                      className={`gimmick-btn mega ${activeGimmick === 'mega' ? 'active' : ''} ${battleView.mineSide.megaUsed ? 'used' : ''}`}
                      disabled={battleView.mineSide.megaUsed || !battleView.mine.canMega}
                      onClick={() => setActiveGimmick(prev => prev === 'mega' ? null : 'mega')}
                      title={battleView.mine.canMega ? 'Mega Evolve this turn' : 'No Mega Stone'}
                    >
                      🌟 Mega
                      {battleView.mineSide.megaUsed && <span className="gimmick-used-tag">USED</span>}
                    </button>

                    {/* Terastallization */}
                    <button
                      type="button"
                      className={`gimmick-btn tera ${activeGimmick === 'tera' ? 'active' : ''} ${battleView.mineSide.teraUsed ? 'used' : ''}`}
                      disabled={battleView.mineSide.teraUsed}
                      onClick={() => setActiveGimmick(prev => prev === 'tera' ? null : 'tera')}
                      title="Terastallize this turn"
                    >
                      💎 Tera
                      {battleView.mineSide.teraUsed && <span className="gimmick-used-tag">USED</span>}
                    </button>

                    {/* Z-Move */}
                    <button
                      type="button"
                      className={`gimmick-btn zmove ${activeGimmick === 'zmove' ? 'active' : ''} ${battleView.mineSide.zmoveUsed ? 'used' : ''}`}
                      disabled={battleView.mineSide.zmoveUsed}
                      onClick={() => setActiveGimmick(prev => prev === 'zmove' ? null : 'zmove')}
                      title="Unleash a Z-Move this turn (2.2× power)"
                    >
                      ⚡ Z-Move
                      {battleView.mineSide.zmoveUsed && <span className="gimmick-used-tag">USED</span>}
                    </button>

                    {activeGimmick && (
                      <span className="gimmick-bar__hint">
                        {activeGimmick === 'mega' && '🌟 Select a move to Mega Evolve!'}
                        {activeGimmick === 'tera' && !pendingTeraType && '💎 Pick a Tera type below, then select a move'}
                        {activeGimmick === 'tera' && pendingTeraType && `💎 Tera Type: ${pendingTeraType} — now pick a move`}
                        {activeGimmick === 'zmove' && '⚡ Select a move to Z-Power!'}
                      </span>
                    )}
                  </div>
                )}

                {/* Tera type picker — shown only when tera gimmick active and not yet confirmed */}
                {canAct && activeGimmick === 'tera' && !pendingTeraType && (
                  <div className="tera-type-picker">
                    <span className="tera-picker-label">Choose Tera Type:</span>
                    {(['normal','fire','water','grass','electric','ice','fighting','poison','ground','flying','psychic','bug','rock','ghost','dragon','dark','steel','fairy'] as PokemonType[]).map(t => (
                      <button
                        key={t}
                        type="button"
                        className="tera-type-chip"
                        style={{ background: (TYPE_COLORS[t] ?? '#666') + '33', borderColor: TYPE_COLORS[t] ?? '#666', color: TYPE_COLORS[t] ?? '#fff' }}
                        onClick={() => setPendingTeraType(t)}
                      >{t}</button>
                    ))}
                  </div>
                )}

                <div className="command-grid">
                  <section className="command-panel">
                    <h3>Moves {activeGimmick && <span className="gimmick-active-badge">{activeGimmick.toUpperCase()} READY</span>}</h3>
                    <div className="button-grid">
                      {battleView.mine.moves.map((move, moveIndex) => (
                        <button
                          key={move.id}
                          className={`command-button ${activeGimmick ? `gimmick-move-${activeGimmick}` : ''}`}
                          disabled={!canAct || move.currentPP <= 0}
                          onClick={() => {
                            const choice: PlayerChoice = {
                              type: 'move',
                              moveIndex,
                              gimmick: activeGimmick ?? undefined,
                              teraType: activeGimmick === 'tera' ? (pendingTeraType ?? battleView.mine.types[0]) : undefined,
                            };
                            sendChoice(choice);
                          }}
                          type="button"
                        >
                          <strong>{move.definition.name}</strong>
                          <span>PP {move.currentPP}/{move.maxPP}</span>
                          {activeGimmick === 'zmove' && move.definition.power > 0 && (
                            <span className="zmove-power-tag">⚡ {Math.floor(move.definition.power * 2.2)} PWR</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </section>

                  <section className="command-panel">
                    <h3>Switch</h3>
                    <div className="button-grid">
                      {battleView.mineSide.team.map((pokemon, targetIndex) => (
                        <button
                          key={pokemon.instanceId}
                          className="command-button secondary"
                          disabled={!canAct || pokemon.fainted || targetIndex === battleView.mineSide.activeIndex}
                          onClick={() => sendChoice({ type: 'switch', targetIndex })}
                          type="button"
                        >
                          <strong>{pokemon.name}</strong>
                          <span>{hpPercent(pokemon)}% HP</span>
                        </button>
                      ))}
                    </div>
                  </section>
                </div>
              </>
            ) : null}
          </article>

          <article className="log-panel">
            <h3>Battle log</h3>
            <div className="log-lines">
              {[...(battleState.log ?? [])].reverse().map((line, index) => (
                <p key={`${line}-${index}`}>{line}</p>
              ))}
            </div>
            <button
              className="secondary-button"
              onClick={() => {
                setBattleState(null);
                setSession({});
                setWaitingForOpponent(false);
              }}
              type="button"
            >
              Return to lobby
            </button>
          </article>
        </section>
      ) : null}

      {/* Move picker modal */}
      {movePickerSpecies && (
        <MovePicker
          species={movePickerSpecies}
          onConfirm={handleMovePickerConfirm}
          onClose={() => setMovePickerSpecies(null)}
        />
      )}
    </main>
  );
}

export default App;
