export interface ProjectManifest {
  schemaVersion: 2;
  projectId: string;
  language: string;
  transcriptPath: string;
  styleProfile: string;
  characterBible?: string;
  storyboardPath: string;
  timelinePath: string;
  audioPath?: string;
  wordsPath?: string;
  qualityProfile: string;
}

export function createDefaultProjectManifest(projectId: string, language = "en"): ProjectManifest {
  return {
    schemaVersion: 2,
    projectId,
    language,
    transcriptPath: "transcript.txt",
    styleProfile: "../../config/style-profile.json",
    storyboardPath: "storyboard.json",
    timelinePath: "timeline.json",
    audioPath: "voice.wav",
    wordsPath: "words.json",
    qualityProfile: "../../config/reference-quality.json",
  };
}
