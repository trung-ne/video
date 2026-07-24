import { STAGE_ANCHORS } from "./stageAnchors";

export interface StageDefinition {
  path: string;
  anchors: string[];
  settings: string[];
  mood: string[];
}

const SETTING_ALIASES: Record<string, string[]> = {
  office: ["office", "work", "company", "corporate", "job", "boardroom"],
  home: ["home", "house", "family", "living", "bedroom", "kitchen", "balcony"],
  school: ["school", "classroom", "student", "teacher", "education", "library"],
  city: ["city", "street", "urban", "subway", "rooftop", "apartment"],
  finance: ["bank", "trading", "market", "money", "finance"],
  travel: ["airport", "train", "car", "beach", "mountain"],
  public: ["court", "hospital", "temple", "stadium", "concert", "supermarket"],
  labor: ["factory", "construction", "farm", "worker"],
};

function tokens(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2);
}

export const STAGE_REGISTRY: StageDefinition[] = Object.entries(STAGE_ANCHORS).map(([stagePath, anchors]) => {
  const pathTokens = tokens(stagePath);
  const settings = new Set(pathTokens);
  for (const [setting, aliases] of Object.entries(SETTING_ALIASES)) {
    if (aliases.some((alias) => pathTokens.includes(alias))) {
      settings.add(setting);
      aliases.forEach((alias) => settings.add(alias));
    }
  }
  return {
    path: stagePath,
    anchors: Object.keys(anchors),
    settings: [...settings],
    mood: [],
  };
});

export function getStageDefinition(stagePath: string): StageDefinition | undefined {
  return STAGE_REGISTRY.find((stage) => stage.path === stagePath);
}

export function stageMatchesSetting(stagePath: string, setting: string | undefined): boolean {
  if (!setting?.trim()) return true;
  const stage = getStageDefinition(stagePath);
  if (!stage) return false;
  const settingTokens = tokens(setting);
  if (settingTokens.length === 0) return true;
  return settingTokens.some((token) =>
    stage.settings.some((candidate) => candidate.includes(token) || token.includes(candidate))
  );
}
