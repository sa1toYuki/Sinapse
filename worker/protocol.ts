import type { Letter } from '../src/data/questions';
import { choices } from '../src/data/choices';
import { normalizeName, validPin } from '../src/rooms/identity';
import type { PhaseAction } from './rules';

export { choices, validPin };
export const letters = choices.map(({ letter }) => letter);
const validId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(value);
const validToken = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const validChoice = (value: unknown): value is Letter => letters.some(letter => letter === value);
const encoder = new TextEncoder();

type Request = { requestId: string };
type Command = Request & { commandId: string };
export type Message =
  | (Request & { type: 'player.join'; pin: string; name: string; nameKey: string })
  | (Request & { type: 'player.check_name'; pin: string; name: string; nameKey: string })
  | (Request & { type: 'player.resume'; pin: string; playerId: string; reconnectToken: string })
  | (Request & { type: 'master.resume'; pin: string; masterToken: string })
  | (Request & { type: 'player.answer'; questionId: number; choice: Letter })
  | (Request & { type: 'room.sync' })
  | (Command & { type: Exclude<PhaseAction, 'close'> })
  | (Command & { type: 'master.kick'; playerId: string });

export function parseMessage(raw: string | ArrayBuffer): { message?: Message; requestId?: string; code?: 'INVALID_PIN' | 'BAD_TOKEN' | 'INVALID_PAYLOAD' } {
  if (typeof raw !== 'string' || raw.length > 2048 || encoder.encode(raw).byteLength > 2048) return {};
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return {}; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const { v, type, requestId, ...data } = value as Record<string, unknown>;
  if (!validId(requestId)) return {};
  const invalid = { requestId };
  if (v !== 1) return invalid;
  const exact = (...keys: string[]) => Object.keys(data).length === keys.length && keys.every(key => Object.hasOwn(data, key));
  const { pin, playerId, reconnectToken, masterToken, questionId, choice, commandId } = data;
  switch (type) {
    case 'player.join': case 'player.check_name': {
      if (!exact('pin', 'name')) return invalid;
      if (!validPin(pin)) return { requestId, code: 'INVALID_PIN' };
      const name = normalizeName(data.name);
      return name ? { message: { type, requestId, pin, ...name } } : invalid;
    }
    case 'player.resume':
      if (!exact('pin', 'playerId', 'reconnectToken') || !validId(playerId)) return invalid;
      if (!validPin(pin)) return { requestId, code: 'INVALID_PIN' };
      if (!validToken(reconnectToken)) return { requestId, code: 'BAD_TOKEN' };
      return { message: { type, requestId, pin, playerId, reconnectToken } };
    case 'master.resume':
      if (!exact('pin', 'masterToken')) return invalid;
      if (!validPin(pin)) return { requestId, code: 'INVALID_PIN' };
      if (!validToken(masterToken)) return { requestId, code: 'BAD_TOKEN' };
      return { message: { type, requestId, pin, masterToken } };
    case 'player.answer':
      if (!exact('questionId', 'choice') || typeof questionId !== 'number' || !Number.isSafeInteger(questionId) || questionId < 1 || !validChoice(choice)) return invalid;
      return { message: { type, requestId, questionId, choice } };
    case 'room.sync':
      return exact() ? { message: { type, requestId } } : invalid;
    case 'master.kick':
      if (!exact('playerId', 'commandId') || !validId(playerId) || !validId(commandId)) return invalid;
      return { message: { type, requestId, commandId, playerId } };
    case 'master.start': case 'master.end_question': case 'master.show_leaderboard': case 'master.next':
      return exact('commandId') && validId(commandId) ? { message: { type, requestId, commandId } } : invalid;
    default:
      return invalid;
  }
}

export const hex = (bytes: Uint8Array) => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
export const newToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));
export async function tokenHash(token: string) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(token))));
}

export function sameHash(a: string, b: string) {
  let difference = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return difference === 0;
}
