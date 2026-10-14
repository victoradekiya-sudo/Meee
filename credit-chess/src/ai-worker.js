// Runs the computer player off the main thread so the board stays responsive.
import { chooseMove } from './ai.js';

self.onmessage = ({ data: { id, game, level } }) => {
  self.postMessage({ id, move: chooseMove(game, level) });
};
