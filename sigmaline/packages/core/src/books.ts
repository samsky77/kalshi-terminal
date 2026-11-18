/** Display names for sportsbook keys. */
const BOOKS: Record<string, string> = {
  draftkings: 'DraftKings', fanduel: 'FanDuel', betmgm: 'BetMGM', williamhill_us: 'Caesars', betrivers: 'BetRivers', espnbet: 'ESPN BET',
  fanatics: 'Fanatics', hardrockbet: 'Hard Rock', ballybet: 'Bally Bet', betparx: 'betPARX', fliff: 'Fliff', pinnacle: 'Pinnacle', bovada: 'Bovada',
  unibet: 'Unibet', betonlineag: 'BetOnline', mybookieag: 'MyBookie', lowvig: 'LowVig', betus: 'BetUS',
};
export function bookName(k: string | null | undefined): string {
  if (!k) return '\u2014';
  return BOOKS[k] ?? k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
