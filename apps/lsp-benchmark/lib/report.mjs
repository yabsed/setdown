// The run as a table a person reads, and the list of expectations that were not met.
const columns = [['clean', 'No false errors'], ['mistake', 'Marks a mistake'], ['hover', 'Hover'], ['completion', 'Completion'], ['definition', 'Go to definition'], ['faded', 'Fades left-out code'], ['own', 'Its extension\'s requests']];

/** Every unmet expectation of a run, as `case: what`. */
export function failures(run) {
  return run.outcomes.flatMap(outcome => [
    ...(outcome.start?.ok ? [] : [`${outcome.id}: ${outcome.start?.tool && outcome.start.tool !== outcome.expectedTool && !outcome.start.reason
      ? `started ${outcome.start.tool}, expected ${outcome.expectedTool}` : `did not start (${outcome.start?.reason ?? 'no result'})`}`]),
    // "No false errors" without any report from the tool is unknown, and the unmarked mistake already counts.
    ...outcome.checks.filter(check => check.ok === false).map(check => `${outcome.id}: ${check.kind}${check.kind === 'clean' || check.kind === 'mistake' ? '' : ` at ${check.what}`}`),
  ]);
}

function cell(checks) {
  if (!checks.length) return '–';
  if (checks.some(check => check.ok === null)) return 'unknown';
  const met = checks.filter(check => check.ok).length;
  if (met < checks.length) return checks.length === 1 ? 'NO' : `NO (${met} of ${checks.length})`;
  const slowest = Math.max(...checks.map(check => check.seconds));
  return `yes${checks.length > 1 ? ` (${checks.length} of ${checks.length})` : ''}, ${slowest.toFixed(1)} s`;
}

export function table(run) {
  const lines = [`# Language tools on real projects`, '', `Run ${run.date} on ${run.platform}, ${run.profile} profile${run.tool ? `, with ${run.tool} chosen in place of the supported tool` : ''}.`, '',
    `| Language | Project | Tool | Starts | ${columns.map(([, title]) => title).join(' | ')} |`, `| --- | --- | --- | --- | ${columns.map(() => '---').join(' | ')} |`];
  for (const outcome of run.outcomes) {
    const start = outcome.start;
    const starts = !start ? 'NO' : start.ok ? `yes (${start.seconds.toFixed(1)} s${start.downloaded ? ', downloaded' : ''})` : `NO: ${start.issue?.kind ?? start.reason ?? `started ${start.tool}`}`;
    lines.push(`| ${outcome.language} | ${outcome.project.split('@')[0]} | ${start?.tool ?? outcome.expectedTool ?? '?'} | ${starts} | ${columns.map(([kind]) => cell(outcome.checks.filter(check => check.kind === kind))).join(' | ')} |`);
  }
  const unmet = failures(run);
  lines.push('', unmet.length ? `${unmet.length} expectation${unmet.length === 1 ? ' was' : 's were'} not met: ${unmet.join('; ')}.` : 'Every expectation was met.',
    '', '"–" means the case does not ask that question. A time is the slowest answer of its kind, counted from the moment the tool was ready.', '', '## What each tool answered', '');
  for (const outcome of run.outcomes) {
    lines.push(`### ${outcome.language}: \`${outcome.file}\` in ${outcome.project}`, '');
    if (outcome.start && !outcome.start.ok) lines.push(`Did not start as expected: ${outcome.start.reason ?? `started ${outcome.start.tool}`}${outcome.start.issue ? ` (${JSON.stringify(outcome.start.issue)})` : ''}`, '');
    else if (outcome.start) lines.push(`${outcome.start.name ?? outcome.start.tool}, ${outcome.start.source}.`, '');
    for (const question of outcome.asked ?? [])
      lines.push(`- the tool asked: "${question.question}" (${question.choices.join(' / ')}): ${question.chose ? `answered ${question.chose}` : 'left unanswered'}`);
    for (const check of outcome.checks)
      lines.push(`- ${check.kind}${check.kind === 'clean' ? '' : ` \`${check.what}\``}${check.ok ? '' : check.ok === null ? ' (unknown)' : ` (NOT as expected${check.expected ? `: ${check.expected}` : ''})`}: ${check.observed}`);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}
