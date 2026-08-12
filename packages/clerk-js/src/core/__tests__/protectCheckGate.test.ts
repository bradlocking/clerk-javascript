import { ClerkAPIResponseError } from '@clerk/shared/error';
import type { ProtectCheckJSON } from '@clerk/shared/types';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FapiResponseJSON } from '../fapiClient';
import type { RawResourceFetch } from '../protectCheckGate';
import {
  findPendingProtectCheck,
  PROTECT_CHECK_MODAL_CONTAINER_ID,
  PROTECT_CHECK_MODAL_WRAPPER_ID,
  ProtectCheckGate,
} from '../protectCheckGate';
import type { Clerk } from '../resources/internal';

vi.mock('@clerk/shared/internal/clerk-js/protectCheckLifecycle', async importOriginal => ({
  ...(await importOriginal<typeof import('@clerk/shared/internal/clerk-js/protectCheckLifecycle')>()),
  executeProtectCheckWithTimeout: vi.fn(),
}));

import { executeProtectCheckWithTimeout } from '@clerk/shared/internal/clerk-js/protectCheckLifecycle';

const mockExecute = vi.mocked(executeProtectCheckWithTimeout);

const checkJSON = (overrides: Partial<ProtectCheckJSON> = {}): ProtectCheckJSON => ({
  status: 'pending',
  token: 'challenge-token',
  sdk_url: 'https://protect.example.com/sdk.js',
  ...overrides,
});

const signInPayload = (protect_check: ProtectCheckJSON | null, id = 'si_1'): FapiResponseJSON<unknown> =>
  ({
    response: {
      object: 'sign_in',
      id,
      status: protect_check ? 'needs_protect_check' : 'needs_first_factor',
      protect_check,
    },
  }) as FapiResponseJSON<unknown>;

const signUpPayload = (protect_check: ProtectCheckJSON | null, id = 'su_1'): FapiResponseJSON<unknown> =>
  ({
    response: { object: 'sign_up', id, status: 'missing_requirements', protect_check },
  }) as FapiResponseJSON<unknown>;

const alreadyResolvedError = () =>
  new ClerkAPIResponseError('Already resolved', {
    data: [{ code: 'protect_check_already_resolved', message: 'Already resolved', long_message: '' }],
    status: 400,
    clerkTraceId: 'trace_123',
  });

/**
 * Fake modal host: `open` mounts the wrapper + container ids the gate queries, `close` removes
 * them — the contract the ui package's ProtectCheckModal will fulfil.
 */
const makeClerk = () => {
  const open = vi.fn(() => {
    const wrapper = document.createElement('div');
    wrapper.id = PROTECT_CHECK_MODAL_WRAPPER_ID;
    wrapper.style.visibility = 'hidden';
    const container = document.createElement('div');
    container.id = PROTECT_CHECK_MODAL_CONTAINER_ID;
    wrapper.appendChild(container);
    document.body.appendChild(wrapper);
    return Promise.resolve();
  });
  const close = vi.fn(() => {
    document.getElementById(PROTECT_CHECK_MODAL_WRAPPER_ID)?.remove();
    return Promise.resolve();
  });
  return {
    clerk: {
      __internal_openProtectCheckModal: open,
      __internal_closeProtectCheckModal: close,
    } as unknown as Clerk,
    open,
    close,
  };
};

const makeRawFetch = (handlers: {
  onPatch?: (path: string, body: unknown) => FapiResponseJSON<unknown> | Promise<FapiResponseJSON<unknown>>;
  onGet?: (path: string) => FapiResponseJSON<unknown> | Promise<FapiResponseJSON<unknown>>;
}) =>
  vi.fn(async (init: { method: 'GET' | 'PATCH'; path: string; body?: unknown }) => {
    if (init.method === 'PATCH') {
      if (!handlers.onPatch) {
        throw new Error(`unexpected PATCH ${init.path}`);
      }
      return handlers.onPatch(init.path, init.body);
    }
    if (!handlers.onGet) {
      throw new Error(`unexpected GET ${init.path}`);
    }
    return handlers.onGet(init.path);
  }) as unknown as RawResourceFetch & ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockExecute.mockReset();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('findPendingProtectCheck', () => {
  it('detects a pending check on a direct sign-in response', () => {
    expect(findPendingProtectCheck(signInPayload(checkJSON()))).toEqual({
      flow: 'signIn',
      id: 'si_1',
      check: {
        status: 'pending',
        token: 'challenge-token',
        sdkUrl: 'https://protect.example.com/sdk.js',
        expiresAt: undefined,
        uiHints: undefined,
      },
    });
  });

  it('detects a pending check on a direct sign-up response', () => {
    expect(findPendingProtectCheck(signUpPayload(checkJSON()))?.flow).toBe('signUp');
  });

  it.each([
    ['null payload', null],
    ['non-auth response', { response: { object: 'client', id: 'c_1' } } as FapiResponseJSON<unknown>],
    ['no protect_check', signInPayload(null)],
    ['completed protect_check', signInPayload(checkJSON({ status: 'completed' as ProtectCheckJSON['status'] }))],
    [
      'client-nested check only (belongs to another call)',
      {
        response: {
          object: 'client',
          id: 'c_1',
          sign_in: { object: 'sign_in', id: 'si_1', protect_check: checkJSON() },
        },
      } as unknown as FapiResponseJSON<unknown>,
    ],
  ])('ignores %s', (_label, payload) => {
    expect(findPendingProtectCheck(payload)).toBeNull();
  });
});

describe('ProtectCheckGate.process', () => {
  it('passes non-gated payloads through untouched', async () => {
    const gate = new ProtectCheckGate();
    const { clerk, open } = makeClerk();
    const payload = signInPayload(null);
    const rawFetch = makeRawFetch({});

    await expect(gate.process(clerk, payload, () => Promise.resolve(payload), rawFetch)).resolves.toBe(payload);
    expect(open).not.toHaveBeenCalled();
    expect(rawFetch).not.toHaveBeenCalled();
  });

  it('passes gated payloads through untouched while a host is registered for the flow', async () => {
    const gate = new ProtectCheckGate();
    const { clerk, open } = makeClerk();
    const payload = signInPayload(checkJSON());
    const dispose = gate.registerHost('signIn');

    await expect(gate.process(clerk, payload, () => Promise.resolve(payload), makeRawFetch({}))).resolves.toBe(payload);
    expect(open).not.toHaveBeenCalled();

    dispose();
    dispose(); // double-dispose must not underflow
    expect(gate.hasRegisteredHost('signIn')).toBe(false);
  });

  it('a registered sign-up host does not suppress sign-in handling', async () => {
    const gate = new ProtectCheckGate();
    const { clerk, open } = makeClerk();
    gate.registerHost('signUp');
    mockExecute.mockResolvedValue('proof-1');
    const resolved = signInPayload(null);
    const rawFetch = makeRawFetch({ onPatch: () => resolved });

    await expect(
      gate.process(clerk, signInPayload(checkJSON()), () => Promise.resolve(signInPayload(null)), rawFetch),
    ).resolves.toBe(resolved);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('resolves a gated sign-in through the managed modal: execute → PATCH → post-challenge payload', async () => {
    const gate = new ProtectCheckGate();
    const { clerk, open, close } = makeClerk();
    mockExecute.mockResolvedValue('proof-1');
    const resolved = signInPayload(null);
    const rawFetch = makeRawFetch({ onPatch: () => resolved });

    const result = await gate.process(
      clerk,
      signInPayload(checkJSON()),
      () => Promise.resolve(signInPayload(null)),
      rawFetch,
    );

    expect(result).toBe(resolved);
    expect(open).toHaveBeenCalledTimes(1);
    expect(mockExecute).toHaveBeenCalledWith(
      expect.objectContaining({ token: 'challenge-token', sdkUrl: 'https://protect.example.com/sdk.js' }),
      expect.any(HTMLElement),
      expect.objectContaining({ setWidgetVisible: expect.any(Function) }),
    );
    expect((mockExecute.mock.calls[0][1] as HTMLElement).id).toBe(PROTECT_CHECK_MODAL_CONTAINER_ID);
    expect(rawFetch).toHaveBeenCalledWith({
      method: 'PATCH',
      path: '/client/sign_ins/si_1/protect_check',
      body: { proof_token: 'proof-1' },
    });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('uses the sign-up endpoints for gated sign-ups', async () => {
    const gate = new ProtectCheckGate();
    const { clerk } = makeClerk();
    mockExecute.mockResolvedValue('proof-su');
    const resolved = signUpPayload(null);
    const rawFetch = makeRawFetch({ onPatch: () => resolved });

    await gate.process(clerk, signUpPayload(checkJSON()), () => Promise.resolve(signUpPayload(null)), rawFetch);

    expect(rawFetch).toHaveBeenCalledWith({
      method: 'PATCH',
      path: '/client/sign_ups/su_1/protect_check',
      body: { proof_token: 'proof-su' },
    });
  });

  it('runs inline into the clerk-protect-check placement marker instead of the modal', async () => {
    const gate = new ProtectCheckGate();
    const { clerk, open } = makeClerk();
    const marker = document.createElement('div');
    marker.id = 'clerk-protect-check';
    document.body.appendChild(marker);
    mockExecute.mockResolvedValue('proof-1');
    const resolved = signInPayload(null);
    const rawFetch = makeRawFetch({ onPatch: () => resolved });

    await gate.process(clerk, signInPayload(checkJSON()), () => Promise.resolve(signInPayload(null)), rawFetch);

    expect(open).not.toHaveBeenCalled();
    expect(mockExecute.mock.calls[0][1]).toBe(marker);
  });

  it('loops chained challenges inside one host session', async () => {
    const gate = new ProtectCheckGate();
    const { clerk, open, close } = makeClerk();
    mockExecute.mockResolvedValueOnce('proof-1').mockResolvedValueOnce('proof-2');
    const chained = signInPayload(checkJSON({ token: 'challenge-token-2' }));
    const resolved = signInPayload(null);
    let patchCount = 0;
    const rawFetch = makeRawFetch({ onPatch: () => (++patchCount === 1 ? chained : resolved) });

    const result = await gate.process(
      clerk,
      signInPayload(checkJSON()),
      () => Promise.resolve(signInPayload(null)),
      rawFetch,
    );

    expect(result).toBe(resolved);
    expect(mockExecute).toHaveBeenCalledTimes(2);
    expect(mockExecute.mock.calls[1][0]).toEqual(expect.objectContaining({ token: 'challenge-token-2' }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('gives up on a never-ending challenge chain and closes the host', async () => {
    const gate = new ProtectCheckGate();
    const { clerk, close } = makeClerk();
    let n = 0;
    mockExecute.mockImplementation(() => Promise.resolve(`proof-${n}`));
    const rawFetch = makeRawFetch({ onPatch: () => signInPayload(checkJSON({ token: `challenge-token-${++n}` })) });

    await expect(
      gate.process(clerk, signInPayload(checkJSON()), () => Promise.resolve(signInPayload(null)), rawFetch),
    ).rejects.toMatchObject({ code: 'protect_check_execution_failed' });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('treats protect_check_already_resolved as soft success: reloads and returns the live payload', async () => {
    const gate = new ProtectCheckGate();
    const { clerk } = makeClerk();
    mockExecute.mockResolvedValue('proof-1');
    const live = signInPayload(null);
    const rawFetch = makeRawFetch({
      onPatch: () => {
        throw alreadyResolvedError();
      },
      onGet: () => live,
    });

    const result = await gate.process(
      clerk,
      signInPayload(checkJSON()),
      () => Promise.resolve(signInPayload(null)),
      rawFetch,
    );

    expect(result).toBe(live);
    expect(rawFetch).toHaveBeenCalledWith(
      { method: 'GET', path: '/client/sign_ins/si_1' },
      { forceUpdateClient: true },
    );
  });

  it('reloads an expired challenge before running and uses the re-minted check', async () => {
    const gate = new ProtectCheckGate();
    const { clerk } = makeClerk();
    mockExecute.mockResolvedValue('proof-fresh');
    const reMinted = signInPayload(checkJSON({ token: 'challenge-token-fresh', expires_at: Date.now() + 60_000 }));
    const resolved = signInPayload(null);
    const rawFetch = makeRawFetch({ onGet: () => reMinted, onPatch: () => resolved });

    const result = await gate.process(
      clerk,
      signInPayload(checkJSON({ expires_at: Date.now() - 1_000 })),
      () => Promise.resolve(signInPayload(null)),
      rawFetch,
    );

    expect(result).toBe(resolved);
    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(mockExecute.mock.calls[0][0]).toEqual(expect.objectContaining({ token: 'challenge-token-fresh' }));
  });

  it('fails with protect_check_timed_out when the server keeps returning an expired challenge', async () => {
    const gate = new ProtectCheckGate();
    const { clerk, close } = makeClerk();
    const rawFetch = makeRawFetch({ onGet: () => signInPayload(checkJSON({ expires_at: Date.now() - 1_000 })) });

    await expect(
      gate.process(
        clerk,
        signInPayload(checkJSON({ expires_at: Date.now() - 1_000 })),
        () => Promise.resolve(signInPayload(null)),
        rawFetch,
      ),
    ).rejects.toMatchObject({ code: 'protect_check_timed_out' });
    expect(mockExecute).not.toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('propagates challenge failures and closes the host', async () => {
    const gate = new ProtectCheckGate();
    const { clerk, close } = makeClerk();
    mockExecute.mockRejectedValue(
      Object.assign(new Error('load failed'), { code: 'protect_check_script_load_failed' }),
    );

    await expect(
      gate.process(clerk, signInPayload(checkJSON()), () => Promise.resolve(signInPayload(null)), makeRawFetch({})),
    ).rejects.toMatchObject({ code: 'protect_check_script_load_failed' });
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('single-flights concurrent gated calls: second waits, then replays instead of opening a second host', async () => {
    const gate = new ProtectCheckGate();
    const { clerk, open } = makeClerk();
    let resolveProof: (token: string) => void = () => undefined;
    mockExecute.mockImplementationOnce(
      () =>
        new Promise<string>(resolve => {
          resolveProof = resolve;
        }),
    );
    const resolved = signInPayload(null);
    const rawFetch = makeRawFetch({ onPatch: () => resolved });

    const first = gate.process(clerk, signInPayload(checkJSON()), () => Promise.resolve(signInPayload(null)), rawFetch);
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1));

    const replaidPayload = signInPayload(null, 'si_2');
    const replay = vi.fn(() => Promise.resolve(replaidPayload));
    const second = gate.process(clerk, signInPayload(checkJSON(), 'si_2'), replay, rawFetch);

    resolveProof('proof-1');
    await expect(first).resolves.toBe(resolved);
    await expect(second).resolves.toBe(replaidPayload);
    expect(replay).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('flips the modal wrapper visible when the script announces its widget', async () => {
    const gate = new ProtectCheckGate();
    const { clerk } = makeClerk();
    let capturedSetWidgetVisible: ((visible: boolean) => Promise<void>) | undefined;
    mockExecute.mockImplementation(async (_check, _container, opts) => {
      capturedSetWidgetVisible = opts?.setWidgetVisible;
      await opts?.setWidgetVisible?.(true);
      return 'proof-1';
    });
    const resolved = signInPayload(null);
    const rawFetch = makeRawFetch({
      onPatch: () => {
        // Wrapper must already be visible by the time the proof is submitted.
        expect(document.getElementById(PROTECT_CHECK_MODAL_WRAPPER_ID)?.style.visibility).toBe('visible');
        return resolved;
      },
    });

    await gate.process(clerk, signInPayload(checkJSON()), () => Promise.resolve(signInPayload(null)), rawFetch);
    expect(capturedSetWidgetVisible).toBeDefined();
  });

  it('reveals a still-running modal after the delay so long solves are not an invisible frozen page', async () => {
    vi.useFakeTimers();
    try {
      const gate = new ProtectCheckGate();
      const { clerk } = makeClerk();
      let resolveProof: (token: string) => void = () => undefined;
      mockExecute.mockImplementationOnce(
        () =>
          new Promise<string>(resolve => {
            resolveProof = resolve;
          }),
      );
      const resolved = signInPayload(null);
      const rawFetch = makeRawFetch({ onPatch: () => resolved });

      const run = gate.process(clerk, signInPayload(checkJSON()), () => Promise.resolve(signInPayload(null)), rawFetch);
      await vi.waitFor(() => expect(mockExecute).toHaveBeenCalled());
      expect(document.getElementById(PROTECT_CHECK_MODAL_WRAPPER_ID)?.style.visibility).toBe('hidden');

      await vi.advanceTimersByTimeAsync(500);
      expect(document.getElementById(PROTECT_CHECK_MODAL_WRAPPER_ID)?.style.visibility).toBe('visible');

      resolveProof('proof-1');
      await expect(run).resolves.toBe(resolved);
    } finally {
      vi.useRealTimers();
    }
  });
});
