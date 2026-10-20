// Registry of every minigame, keyed by id.
import wiring from './wiring.js';
import swipe from './swipe.js';
import fuel from './fuel.js';
import sample from './sample.js';
import simon from './simon.js';
import scan from './scan.js';
import data from './data.js';
import asteroids from './asteroids.js';
import align from './align.js';
import distributor from './distributor.js';
import chart from './chart.js';
import filter from './filter.js';
import divert from './divert.js';
import shields from './shields.js';
import steering from './steering.js';
import manifolds from './manifolds.js';
import garbage from './garbage.js';
import lights from './lights.js';
import reactor from './reactor.js';
import o2 from './o2.js';
import comms from './comms.js';

export const MINIGAMES = Object.fromEntries(
  [
    wiring,
    swipe,
    fuel,
    sample,
    simon,
    scan,
    data,
    asteroids,
    align,
    distributor,
    chart,
    filter,
    divert,
    shields,
    steering,
    manifolds,
    garbage,
    lights,
    reactor,
    o2,
    comms,
  ].map((m) => [m.id, m]),
);
