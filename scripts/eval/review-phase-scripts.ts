const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

export function reviewPhaseScripts(buildScript: string, runtime: string, dir: string) {
  const build = buildScript.replaceAll("transcript.jsonl", "transcript-build.jsonl").replaceAll("stderr.log", "stderr-build.log");
  const review = buildScript.replace('cd "$(dirname "$0")"', `cd ${quote(`${dir}/.bidwright-review`)}`)
    .replaceAll("prompt.txt", "review-prompt.txt").replaceAll("> transcript.jsonl", `> ${quote(`${dir}/transcript-review.jsonl`)}`)
    .replaceAll("2> stderr.log", `2> ${quote(`${dir}/stderr-review.log`)}`)
    .replace('"build_estimate"', '"qa"');
  let revise = buildScript.replaceAll("prompt.txt", "revision-prompt.txt").replaceAll("transcript.jsonl", "transcript-revise.jsonl").replaceAll("stderr.log", "stderr-revise.log");
  revise = runtime === "codex"
    ? revise.replace("codex exec --json", "codex exec resume --json").replace("--sandbox workspace-write ", "")
      .replace(" - < revision-prompt.txt", ' "$BIDWRIGHT_BUILDER_SESSION_ID" - < revision-prompt.txt')
    : revise.replace("claude -p", 'claude --resume "$BIDWRIGHT_BUILDER_SESSION_ID" -p');
  return { build, review, revise };
}
