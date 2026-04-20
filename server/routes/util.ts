export function normalizePlayerName(name: string): string {
  if (!name) return "";
  const trimmed = name.trim();
  if (!trimmed) return "";

  let target = trimmed;
  // Handle "Last, First" format
  if (trimmed.includes(",")) {
    const parts = trimmed.split(",").map(p => p.trim());
    if (parts.length >= 2) {
      const last = parts[0];
      const first = parts.slice(1).join(" ");
      target = `${first} ${last}`;
    }
  }

  // Convert to Title Case (handles ALL CAPS names from USCF/FIDE)
  return target
    .toLowerCase()
    .replace(/\b\w/g, char => char.toUpperCase());
}
