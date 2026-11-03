/** A Line can be worth less than its Marking Points add up to (5 points worth 3 marks). */
export function lineTotal(marks: number[], lineMarks: number): number {
  return Math.min(
    marks.reduce((sum, m) => sum + m, 0),
    lineMarks,
  );
}
