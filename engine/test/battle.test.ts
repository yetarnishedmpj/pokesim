import { describe, expect, it } from 'vitest';
import type { MoveDefinition, ResolvedTeamDefinition } from '@pokemon-platform/shared';
import { applyStatusEffects, calculateDamage, createBattleState, resolveTurn } from '../src';

function move(definition: Partial<MoveDefinition> & Pick<MoveDefinition, 'id' | 'name' | 'type' | 'category' | 'power' | 'accuracy' | 'pp' | 'description'>): MoveDefinition {
  return {
    priority: 0,
    supported: true,
    ...definition,
  };
}

function team(name: string, speciesId: string, types: ResolvedTeamDefinition['pokemon'][number]['types'], speed: number, moves: MoveDefinition[]): ResolvedTeamDefinition {
  return {
    pokemon: [{
      speciesId,
      name,
      types,
      baseStats: {
        hp: 78,
        attack: 84,
        defense: 78,
        specialAttack: 109,
        specialDefense: 85,
        speed,
      },
      moves,
      level: 100,
      gender: 'N',
      shiny: false,
      nature: 'Hardy',
    }],
  };
}

describe('battle engine', () => {
  it('calculates super effective stab damage', () => {
    const flamethrower = move({
      id: 'flamethrower',
      name: 'Flamethrower',
      type: 'fire',
      category: 'special',
      power: 90,
      accuracy: 100,
      pp: 15,
      description: 'test',
      effect: { kind: 'damage', target: 'opponent' },
    });
    const state = createBattleState({
      id: 'test-1',
      mode: 'cpu',
      playerA: { id: 'p1', name: 'Ash', team: team('Charizard', 'charizard', ['fire', 'flying'], 100, [flamethrower]) },
      playerB: { id: 'p2', name: 'Gary', team: team('Meganium', 'meganium', ['grass'], 80, [move({
        id: 'razorleaf',
        name: 'Razor Leaf',
        type: 'grass',
        category: 'physical',
        power: 55,
        accuracy: 95,
        pp: 25,
        description: 'test',
      })]) },
      seed: 1234,
    });
    const attacker = state.sides[0].team[0];
    const defender = state.sides[1].team[0];

    const result = calculateDamage(attacker, defender, flamethrower, 42);

    expect(result.hit).toBe(true);
    expect(result.damage).toBeGreaterThan(50);
    expect(result.effectiveness).toBe(2);
    expect(result.stab).toBe(1.5);
  });

  it('resolves simultaneous turns by speed', () => {
    const state = createBattleState({
      id: 'test-2',
      mode: 'cpu',
      playerA: { id: 'p1', name: 'Ash', team: team('Charizard', 'charizard', ['fire', 'flying'], 100, [move({
        id: 'flamethrower',
        name: 'Flamethrower',
        type: 'fire',
        category: 'special',
        power: 40,
        accuracy: 100,
        pp: 15,
        description: 'test',
      })]) },
      playerB: { id: 'p2', name: 'Brock', team: team('Blastoise', 'blastoise', ['water'], 78, [move({
        id: 'surf',
        name: 'Surf',
        type: 'water',
        category: 'special',
        power: 40,
        accuracy: 100,
        pp: 15,
        description: 'test',
      })]) },
      seed: 222,
    });

    const next = resolveTurn(state, {
      p1: { type: 'move', moveIndex: 0 },
      p2: { type: 'move', moveIndex: 0 },
    });

    expect(next.log.some((line) => line.includes('Charizard used Flamethrower'))).toBe(true);
    expect(next.turn).toBe(2);
  });

  it('applies poison at end of turn', () => {
    const state = createBattleState({
      id: 'test-3',
      mode: 'cpu',
      playerA: { id: 'p1', name: 'Ash', team: team('Venusaur', 'venusaur', ['grass', 'poison'], 80, [move({
        id: 'gigadrain',
        name: 'Giga Drain',
        type: 'grass',
        category: 'special',
        power: 75,
        accuracy: 100,
        pp: 10,
        description: 'test',
      })]) },
      playerB: { id: 'p2', name: 'Misty', team: team('Blastoise', 'blastoise', ['water'], 78, [move({
        id: 'surf',
        name: 'Surf',
        type: 'water',
        category: 'special',
        power: 90,
        accuracy: 100,
        pp: 15,
        description: 'test',
      })]) },
      seed: 999,
    });

    state.sides[1].team[0].status = 'poison';
    const next = applyStatusEffects(state, 999);

    expect(next.sides[1].team[0].currentHp).toBeLessThan(state.sides[1].team[0].currentHp);
    expect(next.log.at(-1)).toContain('poison');
  });
});
