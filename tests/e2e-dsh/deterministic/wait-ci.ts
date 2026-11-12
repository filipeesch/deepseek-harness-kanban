const deadline = Date.parse(input.startedAt) + 60_000;
while (Date.now() < deadline) {
  const check = await tools.bash({ command: 'node fake-ci.cjs', timeoutMs: 5_000 });
  if (check.exitCode === 0) return { exit: 'passed', message: 'Local CI passed.' };
  if (check.exitCode === 1) return { exit: 'rejected', message: 'Local CI rejected the change.' };
  if (check.exitCode !== 2) throw new Error('Local CI checker failed.');
  await tools.bash({ command: 'sleep 0.02', timeoutMs: 1_000 });
}
throw new Error('Local CI business deadline expired.');
