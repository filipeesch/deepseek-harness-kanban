// Local-only CI stand-in: the test owns this directory and state file.
const { readFileSync, appendFileSync } = require('node:fs');
const state = readFileSync('.fake-ci-state', 'utf8').trim();
appendFileSync('.fake-ci-observations', state + '\n');
if (state === 'passed') process.exit(0);
if (state === 'rejected') process.exit(1);
if (state === 'pending') process.exit(2);
process.stderr.write('Unknown local fake CI state.\n');
process.exit(3);
