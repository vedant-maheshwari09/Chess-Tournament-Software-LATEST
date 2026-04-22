import { calculateMatchupScore } from './server/routes/common.js';

const DummyMatches = [
  { id: 1, whitePlayerId: 10, blackPlayerId: 20, result: '1/2-1/2' },
  { id: 2, whitePlayerId: 20, blackPlayerId: 10, result: '1/2-1/2' },
  { id: 3, whitePlayerId: 10, blackPlayerId: 20, result: '1/2-1/2' },
  { id: 4, whitePlayerId: 20, blackPlayerId: 10, result: '1/2-1/2' },
  { id: 5, whitePlayerId: 10, blackPlayerId: 20, result: '1/2-1/2' },
];

console.log(calculateMatchupScore(DummyMatches));
