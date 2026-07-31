import { VisualGrammar, VisualRegister } from "../types/storyboard";

export interface GrammarDefinition {
  id: Exclude<VisualGrammar, "FREEFORM">;
  purpose: string;
  // A slot entry may name ONE intentional alias group with "|" (e.g.
  // "stat|number"): the requirement is satisfied when any alternative is
  // filled. Aliases exist only where two names are genuinely the same concept
  // — this is the single required-slot table, so a second looser copy can no
  // longer drift away from it.
  requiredSlots: string[];
  optionalSlots: string[];
  /** Whether the focal meaning requires authored art or is rendered by a component. */
  focalSource: "asset" | "component" | "either";
  supportedRegisters: VisualRegister[];
  semanticRequirements: string[];
}

export const GRAMMAR_REGISTRY: GrammarDefinition[] = [
  {
    id: "COMPARE", purpose: "Contrast two meaningfully different concepts",
    requiredSlots: ["left", "right", "leftAsset", "rightAsset"], optionalSlots: [], focalSource: "asset",
    supportedRegisters: ["infographic", "character_action"],
    semanticRequirements: ["Both sides need distinct labels and distinct semantic assets."],
  },
  {
    id: "STAT_REVEAL", purpose: "Reveal one transcript-supported number",
    requiredSlots: ["stat|number", "anchor", "caption"], optionalSlots: ["who", "tone"], focalSource: "asset",
    supportedRegisters: ["infographic", "evidence"],
    semanticRequirements: [
      "The number must occur in the source range; anchor must visualize what the figure measures.",
      "At the panel's scale the anchor icon alone reads too small to convey that — author a short caption (e.g. \"children per woman\") stating what the number measures.",
    ],
  },
  {
    id: "POLICY_LIST", purpose: "Show two to four distinct actors or items",
    requiredSlots: ["items", "icons"], optionalSlots: [], focalSource: "asset",
    supportedRegisters: ["infographic"],
    semanticRequirements: ["Each item needs a distinct icon or character role."],
  },
  {
    id: "DIALOGUE_QA", purpose: "Show an actual question-answer relationship",
    requiredSlots: ["asker", "answerer", "askerText", "answererText"],
    optionalSlots: ["stage", "anchorA", "anchorB"], focalSource: "asset",
    supportedRegisters: ["character_action", "full_tableau"],
    semanticRequirements: ["The two characters need different roles and dialogue functions."],
  },
  {
    id: "TABLEAU", purpose: "Stage an action in a narration-relevant physical setting",
    requiredSlots: ["stage", "who", "anchorA"], optionalSlots: ["seatB", "anchorB", "lineA", "lineB", "prop"], focalSource: "asset",
    supportedRegisters: ["full_tableau", "character_action", "visual_gag"],
    semanticRequirements: ["Stage tags must match semanticVisual.setting."],
  },
  {
    id: "EVIDENCE", purpose: "Show a quote, claim, survey, or data source",
    requiredSlots: ["body"], optionalSlots: ["title", "source", "date", "choices"], focalSource: "component",
    supportedRegisters: ["evidence"],
    semanticRequirements: ["Do not invent a source, date, statistic, or quote."],
  },
  {
    id: "FRAMEBOX", purpose: "Show a photo, chart, map, or screenshot in a screen",
    requiredSlots: ["content|image"], optionalSlots: ["caption", "source"], focalSource: "asset",
    supportedRegisters: ["framebox", "photo_broll", "evidence"],
    semanticRequirements: ["Content must resolve to a real manifest asset."],
  },
  {
    id: "CHAR_PROP", purpose: "Show a character acting on or reacting to a meaningful prop",
    requiredSlots: ["who", "prop"], optionalSlots: ["label"], focalSource: "asset",
    supportedRegisters: ["character_action", "visual_gag"],
    semanticRequirements: ["The prop must express the object in semanticVisual."],
  },
  {
    id: "DIAGRAM", purpose: "Explain a directional multi-step mechanism",
    // `relations` is not read by grammarDiagram — arrows are unlabelled today.
    requiredSlots: ["items", "icons"], optionalSlots: ["relations"], focalSource: "asset",
    supportedRegisters: ["infographic"],
    semanticRequirements: ["Nodes need semantic icons and arrows need relation labels."],
  },
  {
    id: "CAUSE_EFFECT", purpose: "Explain one cause and one effect",
    requiredSlots: ["cause", "effect", "causeIcon", "effectIcon"], optionalSlots: ["relation"], focalSource: "asset",
    supportedRegisters: ["infographic"],
    semanticRequirements: ["Cause and effect need distinct resolved visual assets."],
  },
  {
    id: "QA_REVEAL", purpose: "Pose a question and reveal a concise answer",
    requiredSlots: ["question|q", "answer|a"], optionalSlots: ["answerAsset", "who"], focalSource: "component",
    supportedRegisters: ["infographic", "character_action"],
    semanticRequirements: ["The reveal must answer the question from the source range."],
  },
  {
    id: "ICON_TRIPLE", purpose: "Group exactly three related concepts",
    requiredSlots: ["items", "icons"], optionalSlots: [], focalSource: "asset",
    supportedRegisters: ["infographic"],
    semanticRequirements: ["All three icons must be resolved and semantically distinct."],
  },
  {
    id: "BEAT", purpose: "Use a real full-frame visual for a short emotional pause",
    requiredSlots: ["image"], optionalSlots: [], focalSource: "asset",
    supportedRegisters: ["photo_broll", "visual_gag"],
    semanticRequirements: ["A CSS color is not a valid BEAT image."],
  },
  {
    id: "SOLO", purpose: "Use one character for direct address with a meaningful action",
    // `action` was required but read by no grammar, so authoring it changed
    // nothing on screen while still failing the gate — a requirement nothing
    // consumes teaches authors to ignore the registry. `keyword` is what the
    // grammar actually builds its focal card from.
    requiredSlots: ["who", "keyword"], optionalSlots: ["prop"], focalSource: "asset",
    supportedRegisters: ["character_action"],
    semanticRequirements: ["A neutral pose plus keyword alone is not sufficient."],
  },
  {
    id: "MAP_FLOW", purpose: "Explain movement between real places on a map",
    requiredSlots: ["map", "items", "icons"], optionalSlots: ["relations"], focalSource: "asset",
    supportedRegisters: ["infographic", "framebox"],
    semanticRequirements: ["Places and movement must be stated or implied by the source range."],
  },
  {
    id: "DATA_CHART", purpose: "Show transcript-supported data as a large chart",
    requiredSlots: ["chart"], optionalSlots: ["caption", "source"], focalSource: "asset",
    supportedRegisters: ["infographic", "evidence", "framebox"],
    semanticRequirements: ["The chart must resolve to a real asset and may not invent values."],
  },
  {
    id: "SURVEY_CARD", purpose: "Show a survey question, options, or stated result",
    requiredSlots: ["body"], optionalSlots: ["title", "choices", "source", "date"], focalSource: "component",
    supportedRegisters: ["evidence"],
    semanticRequirements: ["Do not invent survey choices, result, source, or date."],
  },
  {
    id: "PHOTO_EVIDENCE", purpose: "Use a large real photo as evidence",
    requiredSlots: ["photo"], optionalSlots: ["caption", "source"], focalSource: "asset",
    supportedRegisters: ["photo_broll", "evidence", "framebox"],
    semanticRequirements: ["Photo must occupy the focal region and resolve to a real manifest asset."],
  },
  {
    id: "SCREEN_CAPTURE", purpose: "Show a screenshot or UI inside a device frame",
    requiredSlots: ["content"], optionalSlots: ["caption", "source"], focalSource: "asset",
    supportedRegisters: ["framebox", "evidence"],
    semanticRequirements: ["Screen content must explain the source-range idea."],
  },
  {
    id: "FULL_SCENE_ACTION", purpose: "Show a subject acting on an object in a full setting",
    requiredSlots: ["stage", "who", "anchorA", "prop"], optionalSlots: ["caption"], focalSource: "asset",
    supportedRegisters: ["full_tableau", "character_action", "visual_gag"],
    semanticRequirements: ["Subject, verb, object, and setting must all be visible."],
  },
  {
    id: "HISTORY_TIMELINE", purpose: "Explain change through ordered historical stages",
    requiredSlots: ["items", "icons"], optionalSlots: ["dates"], focalSource: "asset",
    supportedRegisters: ["infographic", "evidence"],
    semanticRequirements: ["Dates must come from the source range."],
  },
  {
    id: "VISUAL_METAPHOR", purpose: "Use a concrete setup and payoff to explain an abstract idea",
    requiredSlots: ["setup", "payoff", "leftAsset", "rightAsset"], optionalSlots: ["relation"], focalSource: "asset",
    supportedRegisters: ["visual_gag", "character_action"],
    semanticRequirements: ["The metaphor relation must be understandable in a silent frame."],
  },
];

export function getGrammarDefinition(grammar: VisualGrammar): GrammarDefinition | undefined {
  return GRAMMAR_REGISTRY.find((definition) => definition.id === grammar);
}

export function isKnownGrammar(grammar: unknown): boolean {
  return grammar === "FREEFORM" || GRAMMAR_REGISTRY.some((d) => d.id === grammar);
}

export function knownGrammarIds(): string[] {
  return [...GRAMMAR_REGISTRY.map((d) => d.id), "FREEFORM"];
}

/** The alternatives of one required-slot entry ("stat|number" → ["stat","number"]). */
export function slotAlternatives(slotEntry: string): string[] {
  return slotEntry.split("|").map((s) => s.trim()).filter(Boolean);
}

/**
 * Required slot entries the given slots object does not satisfy. An entry is
 * satisfied when ANY of its alternatives holds a non-blank value. Returns the
 * raw entries (e.g. "stat|number") so callers can report the alias group.
 */
export function missingRequiredSlots(
  definition: GrammarDefinition,
  slots: Record<string, unknown> | undefined,
): string[] {
  return definition.requiredSlots.filter((entry) =>
    !slotAlternatives(entry).some((key) => String(slots?.[key] ?? "").trim().length > 0)
  );
}

export function grammarPromptTable(): string {
  const lines = GRAMMAR_REGISTRY.map((definition) => {
    const required = definition.requiredSlots.join(", ");
    return `| ${definition.id} | ${definition.purpose} | ${required} | ${definition.supportedRegisters.join(", ")} |`;
  });
  return [
    "| grammar | purpose | required slots | registers |",
    "|---|---|---|---|",
    ...lines,
  ].join("\n");
}
