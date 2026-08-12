// ============================================================
// Stage anchors — where characters "sit into" each illustrated
// stage set (public/assets/scenes/*.svg).
//
// The reference video's signature is characters that BELONG to the
// scene (lying in bed, sitting on the sofa, eating at the table)
// instead of floating in front of a backdrop. Each anchor is a
// pre-composed spot: position (0..1 canvas coords) + scale tuned so
// the cat visually rests on the furniture drawn in the stage SVG.
//
// Browser-safe (pure data) — imported by sceneCompiler which also
// runs in the Remotion preview bundle. No fs access here.
// ============================================================

export interface StageAnchor {
  x: number;
  y: number;
  scale: number;
}

// Keyed by the stage's backgroundSrc (path under public/).
export const STAGE_ANCHORS: Record<string, Record<string, StageAnchor>> = {
  "assets/scenes/bedroom.svg": {
    // lying/sitting on the mattress, head by the pillow
    bed:   { x: 0.61, y: 0.57, scale: 1.5 },
    // standing on the rug beside the bed
    floor: { x: 0.28, y: 0.64, scale: 1.7 },
  },
  "assets/scenes/living_room.svg": {
    sofa_left:  { x: 0.41, y: 0.54, scale: 1.4 },
    sofa_right: { x: 0.59, y: 0.54, scale: 1.4 },
    floor_left: { x: 0.16, y: 0.66, scale: 1.6 },
  },
  "assets/scenes/dinner_table.svg": {
    // seated behind the big red table — torso above the table line
    seat_left:  { x: 0.33, y: 0.50, scale: 1.5 },
    seat_right: { x: 0.67, y: 0.50, scale: 1.5 },
    seat_center:{ x: 0.50, y: 0.48, scale: 1.55 },
  },
  "assets/scenes/office_desk.svg": {
    // seated at the desk, torso above the desk line (~y 0.72 in art)
    desk:       { x: 0.42, y: 0.48, scale: 1.7 },
    desk_right: { x: 0.58, y: 0.48, scale: 1.6 },
  },
  "assets/scenes/cafe.svg": {
    // leaning at the counter (counter top ~y 0.68)
    counter_left:  { x: 0.34, y: 0.52, scale: 1.45 },
    counter_right: { x: 0.62, y: 0.52, scale: 1.45 },
  },
  "assets/scenes/park.svg": {
    // sitting on the bench (seat ~y 0.67)
    bench_left:  { x: 0.44, y: 0.52, scale: 1.4 },
    bench_right: { x: 0.58, y: 0.52, scale: 1.4 },
    stand:       { x: 0.5,  y: 0.6,  scale: 1.6 },
  },
  "assets/scenes/classroom.svg": {
    // seated at the desk in front of the blackboard
    desk:  { x: 0.5,  y: 0.48, scale: 1.7 },
    board: { x: 0.28, y: 0.46, scale: 1.7 }, // standing to the side, presenting
  },
  "assets/scenes/street.svg": {
    // standing on the sidewalk (walk level ~y 0.62)
    sidewalk:       { x: 0.5,  y: 0.56, scale: 1.6 },
    sidewalk_left:  { x: 0.32, y: 0.56, scale: 1.5 },
    sidewalk_right: { x: 0.68, y: 0.56, scale: 1.5 },
  },
  "assets/scenes/shop_counter.svg": {
    // customer/clerk at the counter
    counter_left:  { x: 0.36, y: 0.52, scale: 1.45 },
    counter_right: { x: 0.64, y: 0.52, scale: 1.45 },
  },
  "assets/scenes/kitchen.svg": {
    counter_left:  { x: 0.4,  y: 0.52, scale: 1.5 },
    counter_right: { x: 0.62, y: 0.52, scale: 1.5 },
  },
  "assets/scenes/library.svg": {
    table:      { x: 0.5,  y: 0.48, scale: 1.65 },
    table_left: { x: 0.4,  y: 0.48, scale: 1.6 },
  },
  "assets/scenes/bank_interior.svg": {
    counter_left:  { x: 0.38, y: 0.5, scale: 1.6 },
    counter_right: { x: 0.62, y: 0.5, scale: 1.6 },
  },
  "assets/scenes/restaurant.svg": {
    seat_left:  { x: 0.34, y: 0.5, scale: 1.5 },
    seat_right: { x: 0.66, y: 0.5, scale: 1.5 },
  },
  "assets/scenes/gym.svg": {
    bench:  { x: 0.5,  y: 0.54, scale: 1.55 },
    stand:  { x: 0.3,  y: 0.58, scale: 1.6 },
  },
  "assets/scenes/hospital.svg": {
    bed:   { x: 0.5,  y: 0.5,  scale: 1.5 },
    stand: { x: 0.72, y: 0.58, scale: 1.55 },
  },
  "assets/scenes/bar.svg":            { counter_left: { x: 0.36, y: 0.5, scale: 1.55 }, counter_right: { x: 0.62, y: 0.5, scale: 1.55 } },
  "assets/scenes/subway_platform.svg":{ stand: { x: 0.5, y: 0.5, scale: 1.6 }, stand_left: { x: 0.34, y: 0.5, scale: 1.5 } },
  "assets/scenes/airport.svg":        { stand: { x: 0.5, y: 0.5, scale: 1.6 }, stand_left: { x: 0.34, y: 0.5, scale: 1.5 } },
  "assets/scenes/beach.svg":          { sit: { x: 0.5, y: 0.56, scale: 1.5 }, sit_left: { x: 0.35, y: 0.58, scale: 1.45 } },
  "assets/scenes/mountain.svg":       { bench: { x: 0.5, y: 0.5, scale: 1.5 }, stand: { x: 0.32, y: 0.56, scale: 1.6 } },
  "assets/scenes/temple.svg":         { stand: { x: 0.5, y: 0.52, scale: 1.55 }, stand_left: { x: 0.34, y: 0.52, scale: 1.5 } },
  "assets/scenes/wedding_hall.svg":   { center: { x: 0.5, y: 0.5, scale: 1.5 }, left: { x: 0.38, y: 0.5, scale: 1.45 }, right: { x: 0.62, y: 0.5, scale: 1.45 } },
  "assets/scenes/courtroom.svg":      {
    stand: { x: 0.5, y: 0.52, scale: 1.55 }, bench: { x: 0.5, y: 0.5, scale: 1.5 },
    // Dialogue needs two readable sides; the legacy center anchors remain for
    // solo shots while this pair preserves courtroom depth and the 180° line.
    stand_left: { x: 0.32, y: 0.52, scale: 1.42 }, bench_right: { x: 0.68, y: 0.50, scale: 1.42 },
  },
  "assets/scenes/factory.svg":        { stand: { x: 0.5, y: 0.52, scale: 1.6 }, stand_left: { x: 0.34, y: 0.52, scale: 1.5 } },
  "assets/scenes/construction.svg":   { stand: { x: 0.5, y: 0.52, scale: 1.6 }, stand_left: { x: 0.34, y: 0.54, scale: 1.5 } },
  "assets/scenes/farm_field.svg":     { bench: { x: 0.5, y: 0.5, scale: 1.5 }, stand: { x: 0.4, y: 0.54, scale: 1.6 } },
  "assets/scenes/supermarket.svg":    { counter: { x: 0.5, y: 0.52, scale: 1.5 }, counter_left: { x: 0.36, y: 0.52, scale: 1.45 } },
  "assets/scenes/stadium.svg":        { stand: { x: 0.5, y: 0.6, scale: 1.6 }, stand_left: { x: 0.34, y: 0.62, scale: 1.5 } },
  "assets/scenes/concert_stage.svg":  { stand: { x: 0.5, y: 0.5, scale: 1.6 }, stand_left: { x: 0.34, y: 0.5, scale: 1.5 } },
  "assets/scenes/rooftop_night.svg":  { stand: { x: 0.5, y: 0.5, scale: 1.55 }, stand_left: { x: 0.34, y: 0.5, scale: 1.5 } },
  "assets/scenes/train_interior.svg": { seat_left: { x: 0.37, y: 0.52, scale: 1.4 }, seat_right: { x: 0.62, y: 0.52, scale: 1.4 } },
  "assets/scenes/car_interior.svg":   { driver: { x: 0.5, y: 0.48, scale: 1.4 }, passenger: { x: 0.66, y: 0.48, scale: 1.35 } },
  "assets/scenes/bathroom.svg":       { stand: { x: 0.5, y: 0.52, scale: 1.55 } },
  "assets/scenes/balcony.svg":        { stand: { x: 0.5, y: 0.48, scale: 1.55 }, stand_left: { x: 0.36, y: 0.48, scale: 1.5 } },
  "assets/scenes/boardroom.svg":      { seat_left: { x: 0.34, y: 0.5, scale: 1.5 }, seat_right: { x: 0.66, y: 0.5, scale: 1.5 }, center: { x: 0.5, y: 0.48, scale: 1.5 } },
};

// Is this backgroundSrc an illustrated stage set (vs a real photo)?
// Stages get NO blur/scrim and characters are allowed center-stage —
// the V4.1 photo rules (corner-shove, scrim) must not apply to them.
export function isStageBackground(src: string | undefined): boolean {
  return !!src && canonicalStagePath(src).startsWith("assets/scenes/");
}

/** Style-locked stage paths retain their authored anchor contract. */
export function canonicalStagePath(src: string): string {
  const unstyled = src.replace(/^styles\/[cdf]\//, "");
  if (unstyled.startsWith("generated-backgrounds/")) {
    const name = unstyled.slice("generated-backgrounds/".length).replace(/\.png$/i, "").replace(/-/g, "_");
    return `assets/scenes/${name}.svg`;
  }
  if (unstyled.startsWith("generated-assets/scenes/")) {
    const name = unstyled.slice("generated-assets/scenes/".length).replace(/\.png$/i, "").replace(/-/g, "_");
    return `assets/scenes/${name}.svg`;
  }
  return unstyled;
}

export function resolveStageAnchor(
  backgroundSrc: string | undefined,
  anchor: string | undefined
): StageAnchor | undefined {
  if (!backgroundSrc || !anchor) return undefined;
  return STAGE_ANCHORS[canonicalStagePath(backgroundSrc)]?.[anchor];
}
