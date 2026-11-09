// Polyfills de Node usados por algumas dependencias do Web3Auth no navegador.
// Tem de ser o primeiro import de main.jsx.
import { Buffer } from 'buffer';

const g = globalThis;

if (typeof g.global === 'undefined') g.global = g;
if (typeof g.Buffer === 'undefined') g.Buffer = Buffer;
if (typeof g.process === 'undefined') {
  g.process = {
    env: {},
    browser: true,
    version: '',
    versions: {},
    nextTick: (fn, ...args) => queueMicrotask(() => fn(...args)),
  };
} else if (typeof g.process.env === 'undefined') {
  g.process.env = {};
}
