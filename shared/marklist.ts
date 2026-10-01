export function rankMarklistRows<T extends { fullName: string; average: number | null }>(rows: T[]) {
  const sorted = [...rows].sort((a, b) => (b.average ?? -1) - (a.average ?? -1) || a.fullName.localeCompare(b.fullName));
  let priorAverage: number | null = null;
  let priorPosition = 0;
  let hasPriorScore = false;
  return sorted.map((row, index) => {
    if (row.average === null) return { ...row, position: null as number | null };
    const position = hasPriorScore && row.average === priorAverage ? priorPosition : index + 1;
    priorAverage = row.average;
    priorPosition = position;
    hasPriorScore = true;
    return { ...row, position };
  });
}
