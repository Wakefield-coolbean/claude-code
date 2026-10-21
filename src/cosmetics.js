// Cosmetics: hats, visors (accessories worn over the glass), skins (outfits) and pets.
// Art is drawn in character units: feet at (0, 0), facing right, y down. The body spans
// x -0.37..0.39 and y -1.22 (top of the helmet) .. -0.24; the glass visor is centred near
// (0.26, -0.865); the backpack sits at x -0.53..-0.27, y -0.98..-0.42; legs hang from hips at
// y -0.3 (back leg x -0.16, front leg x 0.2), each 0.28 wide and 0.3 long.

export const HATS = [{ id: 'none', name: 'None' }];
export const VISORS = [{ id: 'none', name: 'None' }];
export const SKINS = [{ id: 'none', name: 'None' }];
export const PETS = [{ id: 'none', name: 'None' }];

export const PET_FRAMES = 8;

const pick = (list, id) => (list.some((it) => it.id === id) ? id : 'none');

/** A look from untrusted input: unknown ids become 'none'. */
export function cleanLook(look = {}) {
  return {
    hat: pick(HATS, look?.hat),
    visor: pick(VISORS, look?.visor),
    skin: pick(SKINS, look?.skin),
    pet: pick(PETS, look?.pet),
  };
}

/** A random look for a bot: usually a hat, sometimes a skin, visor or pet. */
export function randomLook(rng) {
  const any = (list, chance) => (list.length > 1 && rng() < chance ? list[1 + Math.floor(rng() * (list.length - 1))].id : 'none');
  return { hat: any(HATS, 0.8), visor: any(VISORS, 0.25), skin: any(SKINS, 0.4), pet: any(PETS, 0.2) };
}

/** A hat. layer 'back' is drawn behind the body, 'front' after the body and visor. */
export function drawHat(ctx, id, layer) {}

/** Outfit over the torso. ctx is clipped to the body shape; called before the body's outline. */
export function drawSkinTorso(ctx, id, color, shadow) {}

/**
 * Outfit over one leg, in leg space: hip at (0, 0), leg from x -0.14..0.14 down to y = len.
 * ctx is clipped to the leg; front = the near leg.
 */
export function drawSkinLeg(ctx, id, color, shadow, front, len) {}

/** Accessory over the glass visor; fwd and up as in drawVisor (sprites.js). */
export function drawVisorAcc(ctx, id, fwd, up) {}

/** A pet with its feet at (0, 0), facing right, about 0.6 tall. frame: 0..PET_FRAMES-1 walking, -1 idle. */
export function drawPet(ctx, id, frame) {}
