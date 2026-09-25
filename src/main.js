// Entry point
import { Game } from './game/game.js';

const canvas = document.getElementById('game');
const ui = document.getElementById('ui');
const boot = document.getElementById('boot');
const bootText = document.getElementById('boot-text');
const bootBar = document.getElementById('boot-bar');

function fail(err) {
  console.error(err);
  boot.style.display = 'flex';
  bootText.textContent = `Failed to start: ${err && err.message ? err.message : err}`;
  bootBar.style.width = '0';
}

try {
  const test = document.createElement('canvas').getContext('webgl2');
  if (!test) throw new Error('This game needs WebGL2. Please use a recent Chrome, Edge, Firefox or Safari.');
  const game = new Game(canvas, ui);
  window.game = game;
  game.init((text, p) => {
    bootText.textContent = text;
    bootBar.style.width = `${Math.round(p * 100)}%`;
  }).then(() => { boot.style.display = 'none'; }, fail);
} catch (e) { fail(e); }
