import photoCatalog from "../../config/photo-backgrounds.json";

interface PhotoPolicyEntry {
  approved: boolean;
  license: string;
  sourcePage: string;
}

const entries = photoCatalog.entries as Record<string, PhotoPolicyEntry>;

function normalizePhotoPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "");
}

export function isApprovedNoFacePhoto(value: string): boolean {
  const entry = entries[normalizePhotoPath(value)];
  return !!entry?.approved;
}

export function approvedPhotoPaths(): string[] {
  return Object.entries(entries)
    .filter(([, entry]) => entry.approved)
    .map(([photoPath]) => photoPath)
    .sort();
}

export function photoPolicyEntry(value: string): PhotoPolicyEntry | undefined {
  return entries[normalizePhotoPath(value)];
}
