import photoCatalog from "../../config/photo-backgrounds.json";

interface PhotoPolicyEntry {
  approved: boolean;
  license: string;
  sourcePage: string;
  creator?: string;
  sha256?: string;
  semanticTags?: string[];
  treatments?: string[];
  safeCrop?: { x: number; y: number; width: number; height: number };
  faceReviewed?: boolean;
}

const entries = photoCatalog.entries as Record<string, PhotoPolicyEntry>;

function normalizePhotoPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "");
}

export function isApprovedNoFacePhoto(value: string): boolean {
  const entry = entries[normalizePhotoPath(value)];
  return !!entry?.approved && entry.faceReviewed === true && /^https:\/\//.test(entry.sourcePage);
}

export function approvedPhotoPaths(): string[] {
  return Object.entries(entries)
    .filter(([, entry]) => entry.approved && entry.faceReviewed === true && /^https:\/\//.test(entry.sourcePage))
    .map(([photoPath]) => photoPath)
    .sort();
}

export function photoPolicyEntry(value: string): PhotoPolicyEntry | undefined {
  return entries[normalizePhotoPath(value)];
}
