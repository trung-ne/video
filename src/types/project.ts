export interface ProjectManifest {
  schemaVersion: 2;
  projectId: string;
  language: string;
  transcriptPath: string;
  styleProfile: string;
  characterBible?: string;
  storyboardPath: string;
  timelinePath: string;
  /** Derived long-video checkpoint plan; never an authored source. */
  chunkManifestPath?: string;
  /** Bumps when the hash-bound Route A build lineage changes. */
  buildIdentity?: string;
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
