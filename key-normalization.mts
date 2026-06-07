export function normalizeKey(key: string): string {
  // valkey uses {} to cluster keys.
  // we do not use this feature and removing them makes keys easier to read and search.
  // valkey uses : to namespace keys.
  // we remove them so that it does not conflict with our own namespace delimiters.
  return key.replace(/[{}:]/g, "_");
}
