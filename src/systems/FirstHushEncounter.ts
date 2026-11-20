import type { GameSession } from '../core/GameSession';

export const FIRST_HUSH_ENCOUNTER_FLAG = 'first_hush_death_seen';
export const FIRST_HUSH_ENCOUNTER_DOOR = 'd_research';

/** Claims the one-time scripted encounter so a restarted session cannot replay it. */
export function claimFirstHushEncounter(session: GameSession, doorId: string): boolean {
  if (doorId !== FIRST_HUSH_ENCOUNTER_DOOR || session.flags.has(FIRST_HUSH_ENCOUNTER_FLAG)) return false;
  session.setFlag(FIRST_HUSH_ENCOUNTER_FLAG);
  return true;
}
