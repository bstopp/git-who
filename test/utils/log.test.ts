import assert from 'node:assert/strict';
import { strict as esmock } from 'esmock';

describe('utils/log.ts', () => {
  let origConsoleError: typeof console.error;
  let origConsoleLog: typeof console.log;
  const stderr: string[] = [];
  const stdout: string[] = [];
  const redCalls: string[] = [];
  const yellowCalls: string[] = [];

  const chalkMock = {
    chalk: {
      default: {
        red: (msg: string) => {
          redCalls.push(msg);
          return msg;
        },
        yellow: (msg: string) => {
          yellowCalls.push(msg);
          return msg;
        },
      },
    },
  };

  const loadLog = async () => {
    return esmock('../../src/utils/log.ts', {
      ...chalkMock,
    });
  };

  beforeEach(() => {
    stderr.length = 0;
    stdout.length = 0;
    redCalls.length = 0;
    yellowCalls.length = 0;
    origConsoleError = console.error;
    origConsoleLog = console.log;
    console.error = (...args) => stderr.push(args.join(' '));
    console.log = (...args) => stdout.push(args.join(' '));
  });

  afterEach(() => {
    console.error = origConsoleError;
    console.log = origConsoleLog;
  });

  it('logs error messages correctly', async () => {
    const log = await loadLog();
    log.error('something went wrong');
    assert.deepEqual(redCalls, ['something went wrong']);
    assert.deepEqual(yellowCalls, []);
    assert.equal(stderr.length, 1);
    assert.equal(stderr[0], '\nsomething went wrong\n');
    assert.equal(stdout.length, 0);
  });

  it('logs warn messages correctly', async () => {
    const log = await loadLog();
    log.warn('heads up');
    assert.deepEqual(yellowCalls, ['heads up']);
    assert.deepEqual(redCalls, []);
    assert.equal(stderr.length, 1);
    assert.equal(stderr[0], '\nheads up\n');
    assert.equal(stdout.length, 0);
  });

  it('logs info messages correctly', async () => {
    const log = await loadLog();
    log.info('hello world');
    assert.deepEqual(redCalls, []);
    assert.deepEqual(yellowCalls, []);
    assert.equal(stderr.length, 0);
    assert.equal(stdout[0], '\nhello world\n');
  });
});
