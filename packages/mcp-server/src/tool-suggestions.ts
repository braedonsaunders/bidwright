export function closestToolNames(name: string, registeredNames: Iterable<string>): string[] {
  const target = name.slice(0, 256).toLowerCase();
  const distance = (candidate: string) => {
    const row = Array.from({ length: target.length + 1 }, (_, i) => i);
    for (let i = 0; i < candidate.length; i++) {
      let diagonal = row[0];
      row[0] = i + 1;
      for (let j = 0; j < target.length; j++) {
        const previous = row[j + 1];
        row[j + 1] = Math.min(row[j + 1] + 1, row[j] + 1, diagonal + Number(candidate[i] !== target[j]));
        diagonal = previous;
      }
    }
    return row[target.length];
  };
  return [...registeredNames].filter(candidate => candidate !== "invokeTool" && candidate !== name)
    .map(candidate => ({ name: candidate, distance: distance(candidate.toLowerCase()) }))
    .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name))
    .slice(0, 3).map(candidate => candidate.name);
}
