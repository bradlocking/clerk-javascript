import { PROTECT_CHECK_ELEMENT_ID } from '@clerk/shared/internal/clerk-js/constants';
import type { ProtectCheckJSON } from '@clerk/shared/types';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { FapiResponseJSON } from '../fapiClient';
import { FraudProtection } from '../fraudProtection';
import type { Clerk } from '../resources/internal';

vi.mock('@clerk/shared/internal/clerk-js/protectCheckLifecycle', async importOriginal => ({
  ...(await importOriginal<typeof import('@clerk/shared/internal/clerk-js/protectCheckLifecycle')>()),
  executeProtectCheckWithTimeout: vi.fn(),
}));

import { executeProtectCheckWithTimeout } from '@clerk/shared/internal/clerk-js/protectCheckLifecycle';

const mockExecute = vi.mocked(executeProtectCheckWithTimeout);

const gatedPayload = (): FapiResponseJSON<unknown> =>
  ({
    response: {
      object: 'sign_in',
      id: 'si_wired',
      status: 'needs_protect_check',
      protect_check: {
        status: 'pending',
        token: 'challenge-token',
        sdk_url: 'https://protect.example.com/sdk.js',
      } satisfies ProtectCheckJSON,
    },
  }) as FapiResponseJSON<unknown>;

afterEach(() => {
  document.body.innerHTML = '';
  mockExecute.mockReset();
});

describe('FraudProtection × ProtectCheckGate wiring', () => {
  it('resolves a gated payload through the gate when a raw fetch is provided', async () => {
    // Inline marker host: keeps the wiring test free of modal plumbing.
    const marker = document.createElement('div');
    marker.id = PROTECT_CHECK_ELEMENT_ID;
    document.body.appendChild(marker);

    mockExecute.mockResolvedValue('proof-wired');
    const resolved = { response: { object: 'sign_in', id: 'si_wired', status: 'complete', protect_check: null } };
    const rawFetch = vi.fn(() => Promise.resolve(resolved as FapiResponseJSON<unknown>));

    const result = await FraudProtection.getInstance().execute(
      {} as unknown as Clerk,
      () => Promise.resolve(gatedPayload()),
      rawFetch,
    );

    expect(result).toBe(resolved);
    expect(rawFetch).toHaveBeenCalledWith({
      method: 'PATCH',
      path: '/client/sign_ins/si_wired/protect_check',
      body: { proof_token: 'proof-wired' },
    });
  });

  it('returns payloads untouched when no raw fetch is provided (non-resource callers)', async () => {
    const payload = gatedPayload();
    await expect(
      FraudProtection.getInstance().execute({} as unknown as Clerk, () => Promise.resolve(payload)),
    ).resolves.toBe(payload);
    expect(mockExecute).not.toHaveBeenCalled();
  });
});
