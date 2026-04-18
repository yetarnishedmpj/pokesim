import { io, type Socket } from 'socket.io-client';
import type { BattleState } from '@pokemon-platform/shared';
import { socketEvents } from '@pokemon-platform/shared';

let socket: Socket | null = null;
const API_URL = import.meta.env.VITE_API_URL || '';

export function getSocket() {
  if (!socket) {
    socket = io(API_URL);
  }

  return socket;
}

export function subscribeToBattle(
  battleId: string,
  playerId: string | undefined,
  onState: (state: BattleState) => void,
) {
  const activeSocket = getSocket();
  const listener = (state: BattleState) => {
    if (state.id === battleId) {
      onState(state);
    }
  };

  activeSocket.emit('battle:watch', { battleId, playerId });
  activeSocket.on(socketEvents.battleState, listener);

  return () => {
    activeSocket.off(socketEvents.battleState, listener);
  };
}
