import type { Answer } from "@/lib/marking-lab/schemas";

/** A small deterministic generator, so the same Experiment always samples the same Answers. */
function seededRandom(seed: number) {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 2 ** 32;
  };
}

/** Takes Answers one Question at a time, so a Trial sees variety rather than the first few. */
export function sampleAcrossQuestions(answers: Answer[], size: number, seed: number): Answer[] {
  const random = seededRandom(seed);
  const byQuestion = new Map<string, Answer[]>();
  for (const answer of [...answers].sort((a, b) => a.id.localeCompare(b.id))) {
    byQuestion.set(answer.questionId, [...(byQuestion.get(answer.questionId) ?? []), answer]);
  }
  const queues = [...byQuestion.values()].map((group) => {
    for (let i = group.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [group[i], group[j]] = [group[j], group[i]];
    }
    return group;
  });
  const sample: Answer[] = [];
  while (sample.length < size && queues.some((q) => q.length > 0)) {
    for (const queue of queues) {
      const next = queue.shift();
      if (next && sample.length < size) sample.push(next);
    }
  }
  return sample;
}
