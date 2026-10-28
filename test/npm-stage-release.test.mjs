import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { assertManifest, safeDiagnostic, stageReviewed, stagedArtifact } from '../scripts/npm-stage-release.mjs';

const data = Buffer.from('reviewed tarball bytes');
const id = '12345678-abcd-1234-9876-123456789abc';
const entry = { name: 'cosmemilton-acbr-printer-node', version: '0.1.1', file: 'cosmemilton-acbr-printer-node-0.1.1.tgz',
  sha256: createHash('sha256').update(data).digest('hex'), bytes: data.length,
  sourceCommit: '619d05eec71564bb7343b4cdb7f275cdd83947bb', npmAccount: 'miltoncosme', tarball: '/reviewed/package.tgz', data };
const dist = { shasum: createHash('sha1').update(data).digest('hex') };
const stage = { id, packageName: entry.name, version: entry.version, tag: 'latest', shasum: dist.shasum };
const success = stdout => ({ code: 0, stdout, stderr: '' });

test('manifest rejects another account, package and hash', () => {
  assert.equal(assertManifest(entry), entry);
  for (const patch of [{ npmAccount: 'someoneelse' }, { name: 'another-package' }, { sha256: 'bad' }]) {
    assert.throws(() => assertManifest({ ...entry, ...patch }));
  }
});

test('already public matching bytes is idempotent and does not submit', async () => {
  const commands = [];
  const result = await stageReviewed(entry, { npm: async (_cmd, args) => { commands.push(args); return success('miltoncosme\n'); }, lookup: async () => dist });
  assert.equal(result.status, 'already-published');
  assert.deepEqual(commands.map(args => args[0]), ['whoami']);
});

test('already staged matching bytes is idempotent and does not submit', async () => {
  const commands = [];
  const result = await stageReviewed(entry, { npm: async (_cmd, args) => { commands.push(args); return success('miltoncosme\n'); },
    lookup: async () => null, stageLookup: async () => ({ stageId: id, stagedBytesMatchApproved: true }) });
  assert.equal(result.status, 'awaiting-approval');
  assert.equal(result.stageId, id);
  assert.equal(commands.length, 1);
});

test('new release submits exclusively stage publish once and verifies it', async () => {
  const commands = []; let lookups = 0;
  const result = await stageReviewed(entry, { npm: async (_cmd, args) => {
    commands.push(args);
    if (args[0] === 'whoami') return success('miltoncosme\n');
    assert.deepEqual(args.slice(0, 2), ['stage', 'publish']);
    assert(args.includes('--fetch-retries=0'));
    return success(JSON.stringify({ [entry.name]: { name: entry.name, version: entry.version, size: entry.bytes,
      shasum: dist.shasum, integrity: `sha512-${createHash('sha512').update(data).digest('base64')}`, stageId: id } }));
  }, lookup: async () => null, stageLookup: async () => ++lookups === 1 ? null : { stageId: id, stagedBytesMatchApproved: true } });
  assert.equal(result.status, 'awaiting-approval');
  assert.equal(commands.filter(args => args[0] === 'stage' && args[1] === 'publish').length, 1);
  assert.equal(commands.filter(args => args[0] === 'publish').length, 0);
});

test('ambiguous failed upload is never retried automatically and secrets stay out of result', async () => {
  const commands = [];
  await assert.rejects(stageReviewed(entry, { npm: async (_cmd, args) => {
    commands.push(args);
    return args[0] === 'whoami' ? success('miltoncosme') : { code: 1, stdout: '{"error":{"code":"E413","summary":"secret-token"}}', stderr: 'secret-token' };
  }, lookup: async () => null, stageLookup: async () => null, pause: async () => {} }), error => {
    assert.equal(error.publicationResult.status, 'submission-unconfirmed');
    assert.equal(error.publicationResult.npmDiagnostic.errorCode, 'E413');
    assert(!JSON.stringify(error.publicationResult).includes('secret-token'));
    assert(!error.message.includes('secret-token'));
    return true;
  });
  assert.equal(commands.filter(args => args[0] === 'stage').length, 1);
});

test('different public bytes block before any stage command', async () => {
  const commands = [];
  await assert.rejects(stageReviewed(entry, { npm: async (_cmd, args) => { commands.push(args); return success('miltoncosme'); },
    lookup: async () => ({ shasum: 'wrong' }), stageLookup: async () => { throw Error('not reached'); } }));
  assert.equal(commands.length, 1);
});

test('stage list/view/download must agree and downloaded bytes must match', async () => {
  const npm = async (_cmd, args, options) => {
    if (args[1] === 'list') return success(JSON.stringify([stage]));
    if (args[1] === 'view') return success(JSON.stringify(stage));
    if (args[1] === 'download') {
      await writeFile(path.join(options.cwd, `${entry.name}-${entry.version}-${id}.tgz`), data);
      return success('{}');
    }
    assert.fail('unexpected command');
  };
  assert.deepEqual(await stagedArtifact(entry, { npm }), { stageId: id, stagedBytesMatchApproved: true });
  await assert.rejects(stagedArtifact(entry, { npm: async (_cmd, args, options) => {
    if (args[1] !== 'download') return npm(_cmd, args, options);
    await writeFile(path.join(options.cwd, `${entry.name}-${entry.version}-${id}.tgz`), Buffer.from('different'));
    return success('{}');
  } }));
});

test('diagnostics use closed schema even with arbitrary server output', () => {
  assert.deepEqual(safeDiagnostic({ code: 1, stdout: '{"error":{"code":"E403","message":"npm_secret"}}', stderr: 'npm_secret' }), { exitCode: 1, errorCode: 'E403' });
});

test('only explicit E404 is absent during staging preflight', async () => {
  const failure = code => async () => ({ code: 1, stdout: JSON.stringify({ error: { code, summary: 'secret-token' } }), stderr: '' });
  assert.equal(await stagedArtifact(entry, { npm: failure('E404') }), null);
  for (const code of ['E401', 'E403', 'ETIMEDOUT']) await assert.rejects(stagedArtifact(entry, { npm: failure(code) }), error => {
    assert.equal(error.npmDiagnostic.errorCode, code);
    assert(!JSON.stringify(error).includes('secret-token'));
    return true;
  });
});

test('authentication and list failure diagnostics survive sanitization', async () => {
  for (const phase of ['authentication', 'preflight']) await assert.rejects(stageReviewed(entry, {
    npm: async () => {
      if (phase === 'authentication') {
        const error = Error('secret-token'); error.npmDiagnostic = { exitCode: 1, errorCode: 'E401' }; throw error;
      }
      return success('miltoncosme');
    }, lookup: async () => null, stageLookup: async () => {
      const error = Error('secret-token'); error.npmDiagnostic = { exitCode: 1, errorCode: 'E403' }; throw error;
    },
  }), error => {
    assert.equal(error.publicationResult.phase, phase);
    assert.equal(error.publicationResult.npmDiagnostic.errorCode, phase === 'authentication' ? 'E401' : 'E403');
    assert(!JSON.stringify(error.publicationResult).includes('secret-token'));
    return true;
  });
});
