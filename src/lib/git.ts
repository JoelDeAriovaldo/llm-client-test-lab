import { execFileSync } from "node:child_process";

export type CodeState = { commit: string; dirty: boolean };

/** The app's own commit, which Marking Lab requires on every Run. */
export function getCodeState(cwd: string = process.cwd()): CodeState {
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  let commit: string;
  try {
    commit = git("rev-parse", "--short", "HEAD");
  } catch {
    throw new Error("This project has no git commit yet, and Marking Lab refuses a Run without one.");
  }
  return { commit, dirty: git("status", "--porcelain") !== "" };
}
