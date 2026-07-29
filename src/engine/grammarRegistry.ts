import { VisualGrammar, VisualRegister } from "../types/storyboard";

export interface GrammarDefinition {
  id: Exclude<VisualGrammar, "FREEFORM">;
  purpose: string;
  requiredSlots: string[];
  optionalSlots: string[];
  supportedRegisters: VisualRegister[];
  semanticRequirements: string[];
}

export const GRAMMAR_REGISTRY: GrammarDefinition[] = [
  {
    id: "COMPARE", purpose: "Contrast two meaningfully different concepts",
    requiredSlots: ["left", "right", "leftAsset", "rightAsset"], optionalSlots: [],
    supportedRegisters: ["infographic", "character_action"],
    semanticRequirements: ["Both sides need distinct labels and distinct semantic assets."],
  },
  {
    id: "STAT_REVEAL", purpose: "Reveal one transcript-supported number",
    requiredSlots: ["stat", "anchor"], optionalSlots: ["who"],
    supportedRegisters: ["infographic", "evidence"],
    semanticRequirements: ["The number must occur in the source range; anchor must visualize what the figure measures."],
  },
  {
    id: "POLICY_LIST", purpose: "Show two to four distinct actors or items",
    requiredSlots: ["items", "icons"], optionalSlots: [],
    supportedRegisters: ["infographic"],
    semanticRequirements: ["Each item needs a distinct icon or character role."],
  },
  {
    id: "DIALOGUE_QA", purpose: "Show an actual question-answer relationship",
    requiredSlots: ["asker", "answerer", "askerText", "answererText"], optionalSlots: ["stage"],
    supportedRegisters: ["character_action", "full_tableau"],
    semanticRequirements: ["The two characters need different roles and dialogue functions."],
  },
  {
    id: "TABLEAU", purpose: "Stage an action in a narration-relevant physical setting",
    requiredSlots: ["stage", "who", "anchorA"], optionalSlots: ["seatB", "anchorB", "lineA", "lineB", "prop"],
    supportedRegisters: ["full_tableau", "character_action", "visual_gag"],
    semanticRequirements: ["Stage tags must match semanticVisual.setting."],
  },
  {
    id: "EVIDENCE", purpose: "Show a quote, claim, survey, or data source",
    requiredSlots: ["body"], optionalSlots: ["title", "source", "date", "choices"],
    supportedRegisters: ["evidence"],
    semanticRequirements: ["Do not invent a source, date, statistic, or quote."],
  },
  {
    id: "FRAMEBOX", purpose: "Show a photo, chart, map, or screenshot in a screen",
    requiredSlots: ["content"], optionalSlots: ["caption", "source"],
    supportedRegisters: ["framebox", "photo_broll", "evidence"],
    semanticRequirements: ["Content must resolve to a real manifest asset."],
  },
  {
    id: "CHAR_PROP", purpose: "Show a character acting on or reacting to a meaningful prop",
    requiredSlots: ["who", "prop"], optionalSlots: ["label"],
    supportedRegisters: ["character_action", "visual_gag"],
    semanticRequirements: ["The prop must express the object in semanticVisual."],
  },
  {
    id: "DIAGRAM", purpose: "Explain a directional multi-step mechanism",
    // `relations` is not read by grammarDiagram — arrows are unlabelled today.
    requiredSlots: ["items", "icons"], optionalSlots: ["relations"],
    supportedRegisters: ["infographic"],
    semanticRequirements: ["Nodes need semantic icons and arrows need relation labels."],
  },
  {
    id: "CAUSE_EFFECT", purpose: "Explain one cause and one effect",
    requiredSlots: ["cause", "effect", "causeIcon", "effectIcon"], optionalSlots: ["relation"],
    supportedRegisters: ["infographic"],
    semanticRequirements: ["Cause and effect need distinct resolved visual assets."],
  },
  {
    id: "QA_REVEAL", purpose: "Pose a question and reveal a concise answer",
    requiredSlots: ["question", "answer"], optionalSlots: ["answerAsset"],
    supportedRegisters: ["infographic", "character_action"],
    semanticRequirements: ["The reveal must answer the question from the source range."],
  },
  {
    id: "ICON_TRIPLE", purpose: "Group exactly three related concepts",
    requiredSlots: ["items", "icons"], optionalSlots: [],
    supportedRegisters: ["infographic"],
    semanticRequirements: ["All three icons must be resolved and semantically distinct."],
  },
  {
    id: "BEAT", purpose: "Use a real full-frame visual for a short emotional pause",
    requiredSlots: ["image"], optionalSlots: [],
    supportedRegisters: ["photo_broll", "visual_gag"],
    semanticRequirements: ["A CSS color is not a valid BEAT image."],
  },
  {
    id: "SOLO", purpose: "Use one character for direct address with a meaningful action",
    // `action` was required but read by no grammar, so authoring it changed
    // nothing on screen while still failing the gate — a requirement nothing
    // consumes teaches authors to ignore the registry. `keyword` is what the
    // grammar actually builds its focal card from.
    requiredSlots: ["who", "keyword"], optionalSlots: ["prop"],
    supportedRegisters: ["character_action"],
    semanticRequirements: ["A neutral pose plus keyword alone is not sufficient."],
  },
  {
    id: "MAP_FLOW", purpose: "Explain movement between real places on a map",
    requiredSlots: ["map", "items", "icons"], optionalSlots: ["relations"],
    supportedRegisters: ["infographic", "framebox"],
    semanticRequirements: ["Places and movement must be stated or implied by the source range."],
  },
  {
    id: "DATA_CHART", purpose: "Show transcript-supported data as a large chart",
    requiredSlots: ["chart"], optionalSlots: ["caption", "source"],
    supportedRegisters: ["infographic", "evidence", "framebox"],
    semanticRequirements: ["The chart must resolve to a real asset and may not invent values."],
  },
  {
    id: "SURVEY_CARD", purpose: "Show a survey question, options, or stated result",
    requiredSlots: ["body"], optionalSlots: ["title", "choices", "source", "date"],
    supportedRegisters: ["evidence"],
    semanticRequirements: ["Do not invent survey choices, result, source, or date."],
  },
  {
    id: "PHOTO_EVIDENCE", purpose: "Use a large real photo as evidence",
    requiredSlots: ["photo"], optionalSlots: ["caption", "source"],
    supportedRegisters: ["photo_broll", "evidence", "framebox"],
    semanticRequirements: ["Photo must occupy the focal region and resolve to a real manifest asset."],
  },
  {
    id: "SCREEN_CAPTURE", purpose: "Show a screenshot or UI inside a device frame",
    requiredSlots: ["content"], optionalSlots: ["caption", "source"],
    supportedRegisters: ["framebox", "evidence"],
    semanticRequirements: ["Screen content must explain the source-range idea."],
  },
  {
    id: "FULL_SCENE_ACTION", purpose: "Show a subject acting on an object in a full setting",
    requiredSlots: ["stage", "who", "anchorA", "prop"], optionalSlots: ["caption"],
    supportedRegisters: ["full_tableau", "character_action", "visual_gag"],
    semanticRequirements: ["Subject, verb, object, and setting must all be visible."],
  },
  {
    id: "HISTORY_TIMELINE", purpose: "Explain change through ordered historical stages",
    requiredSlots: ["items", "icons"], optionalSlots: ["dates"],
    supportedRegisters: ["infographic", "evidence"],
    semanticRequirements: ["Dates must come from the source range."],
  },
  {
    id: "VISUAL_METAPHOR", purpose: "Use a concrete setup and payoff to explain an abstract idea",
    requiredSlots: ["setup", "payoff", "leftAsset", "rightAsset"], optionalSlots: ["relation"],
    supportedRegisters: ["visual_gag", "character_action"],
    semanticRequirements: ["The metaphor relation must be understandable in a silent frame."],
  },
];

export function getGrammarDefinition(grammar: VisualGrammar): GrammarDefinition | undefined {
  return GRAMMAR_REGISTRY.find((definition) => definition.id === grammar);
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
