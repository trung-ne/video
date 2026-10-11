/**
 * Fixed production ceilings for authored visual-treatment plans.
 *
 * A plan may tighten these values for a particular story, but it must never
 * weaken them. Keep the authoring and compiled-timeline gates on this shared
 * policy so a hand-edited timeline cannot redefine production quality.
 */
export const VISUAL_REGISTER_IDS = [
  "character_action",
  "infographic",
  "evidence",
  "photo_broll",
  "framebox",
  "visual_gag",
  "full_tableau",
] as const;

export const VISUAL_TREATMENT_MAXIMA = {
  maximumAssetUses: 10,
  maximumStageRatio: 0.05,
  maximumPoseRatio: 0.08,
  maximumConsecutiveSameStage: 2,
  maximumPhotoTreatmentRatio: 0.35,
  maximumStatRevealRatio: 0.08,
} as const;
