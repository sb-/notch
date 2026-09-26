import { expect, test } from 'bun:test';

// Other test files mock database services process-wide. This regression must
// execute the actual database/store against SQLite, so isolate its transport mock.
test('SQLite recovery, duplication, persisted navigation and atomic backup restoration', async () => {
  const run = Bun.spawn([process.execPath, 'run', 'scripts/test-data-recovery.ts'], {
    cwd: new URL('../..', import.meta.url).pathname,
    stdout: 'pipe', stderr: 'pipe',
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    run.exited, new Response(run.stdout).text(), new Response(run.stderr).text(),
  ]);
  expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: '' });
  expect(stdout.match(/^PASS /gm)).toHaveLength(10);
}, 30_000);
