export const DIRECTOR_POLICY_VERSION = "reference-v2.0";

export const DIRECTOR_NEGATIVE_CONSTRAINTS = [
  "Never place two generic characters side by side without an action, relation, or contrast.",
  "Never use a character pose as a substitute for a prop, chart, map, or evidence.",
  "Never use a CSS color as the focal visual of a BEAT.",
  "Never invent evidence, sources, dates, quotes, or statistics.",
  "Never guess an asset path outside the supplied candidates.",
  "Never create a semantic visual unrelated to its exact transcript source range.",
  "Never repeat one visual register for more than two consecutive scenes.",
];

export const DIRECTOR_DECISION_ORDER = [
  "Identify the exact idea in the source range.",
  "Describe subject, action, object, relation, setting, and silent-viewer takeaway.",
  "Choose the visual register.",
  "Choose the visual grammar.",
  "Select supplied assets or emit explicit asset requests.",
  "Add beats only for verbatim words in the source range.",
];

export function renderDirectorPolicy(): string {
  return [
    "DECISION ORDER:",
    ...DIRECTOR_DECISION_ORDER.map((item, index) => `${index + 1}. ${item}`),
    "",
    "HARD NEGATIVE CONSTRAINTS:",
    ...DIRECTOR_NEGATIVE_CONSTRAINTS.map((item) => `- ${item}`),
  ].join("\n");
}
