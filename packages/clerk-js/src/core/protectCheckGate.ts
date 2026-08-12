import { waitForElement } from '@clerk/shared/dom';
import { ClerkRuntimeError } from '@clerk/shared/error';
import { ERROR_CODES, PROTECT_CHECK_ELEMENT_ID } from '@clerk/shared/internal/clerk-js/constants';
import type { ProtectCheckJSON, ProtectCheckResource } from '@clerk/shared/types';

import type { FapiResponseJSON } from './fapiClient';
import type { Clerk } from './resources/internal';

export const PROTECT_CHECK_MODAL_WRAPPER_ID = 'cl-modal-protect-check-wrapper';
export const PROTECT_CHECK_MODAL_CONTAINER_ID = 'cl-modal-protect-check-container';

/**
 * The managed modal opens invisible so a challenge that resolves without interaction never
 * flashes UI (same posture as the captcha modal). Unlike captcha, a challenge can legitimately
 * run for a while (proof-of-transfer), so a still-running check reveals the modal after this
 * delay instead of leaving the page frozen with nothing visible.
 */
const MODAL_REVEAL_DELAY_MS = 500;

/**
 * Chained challenges are an SDK-side loop (the PATCH response may carry a fresh check). A
 * server bug that chains forever must not trap the user in the modal.
 */
const MAX_CHAINED_CHALLENGES = 5;

/**
 * Rounds of await-another-session-then-replay per gated call. Replays re-enter the gate, so a
 * pathological server that re-gates every replay must not loop forever; past the cap the gated
 * payload is returned as-is, surfacing the documented `needs_protect_check` state instead of an
 * opaque failure.
 */
const MAX_GATED_ROUNDS = 3;

type ProtectFlow = 'signIn' | 'signUp';

/**
 * Raw resource fetch, provided by `BaseResource._fetch` so the gate's own PATCH/GET calls get
 * the exact semantics of any resource call (client piggyback updates, ClerkAPIResponseError on
 * 4xx) without re-entering FraudProtection.
 */
export type RawResourceFetch = (
  requestInit: { method: 'GET' | 'PATCH'; path: string; body?: unknown },
  opts?: { forceUpdateClient?: boolean },
) => Promise<FapiResponseJSON<unknown> | null>;

interface GatedInfo {
  flow: ProtectFlow;
  id: string;
  check: ProtectCheckResource;
}

interface ChallengeHost {
  container: HTMLDivElement;
  setWidgetVisible?: (visible: boolean) => Promise<void>;
  close: () => void;
}

type MaybeGatedResponse = {
  object?: string;
  id?: string;
  protect_check?: ProtectCheckJSON | null;
};

function toProtectCheckResource(json: ProtectCheckJSON): ProtectCheckResource {
  return {
    status: json.status,
    token: json.token,
    sdkUrl: json.sdk_url,
    expiresAt: json.expires_at,
    uiHints: json.ui_hints,
  };
}

/**
 * A payload gates the calling request when its direct response is a sign-in/sign-up carrying a
 * pending `protect_check`. Only the direct response is inspected: the gated call's own response
 * is the authoritative signal, and reacting to the piggybacked `client` mirror would double-handle
 * gates that belong to a different in-flight call.
 */
export function findPendingProtectCheck(payload: FapiResponseJSON<unknown> | null): GatedInfo | null {
  const response = payload?.response as MaybeGatedResponse | null | undefined;
  if (!response || typeof response !== 'object') {
    return null;
  }
  if (response.object !== 'sign_in' && response.object !== 'sign_up') {
    return null;
  }
  if (!response.id || response.protect_check?.status !== 'pending') {
    return null;
  }
  return {
    flow: response.object === 'sign_in' ? 'signIn' : 'signUp',
    id: response.id,
    check: toProtectCheckResource(response.protect_check),
  };
}

/**
 * Resolves Protect challenges (`protect_check`) automatically so custom-flow apps never see the
 * gate: when a resource call comes back gated, the challenge runs in a Clerk-owned host — the
 * `clerk-protect-check` placement marker when the page provides one, a managed modal otherwise —
 * the proof is submitted, and the post-challenge payload is returned as the original call's
 * result. Prebuilt components (and any other surface that renders challenges itself) opt out by
 * registering a host for their flow, in which case gated payloads pass through untouched.
 *
 * Mirrors `FraudProtection`'s posture for the legacy captcha: one challenge session at a time
 * (concurrent gated calls wait, then replay), and the caller's promise is held for the duration.
 */
export class ProtectCheckGate {
  private static instance: ProtectCheckGate;

  private hostCounts: Record<ProtectFlow, number> = { signIn: 0, signUp: 0 };
  private inflightSession: Promise<unknown> | null = null;

  public static getInstance(): ProtectCheckGate {
    if (!ProtectCheckGate.instance) {
      ProtectCheckGate.instance = new ProtectCheckGate();
    }
    return ProtectCheckGate.instance;
  }

  /**
   * Declares that a mounted surface (prebuilt component, inline marker component) renders
   * challenges for the given flow itself; managed handling stands down while any registration
   * is live. Returns a disposer.
   */
  public registerHost(flow: ProtectFlow): () => void {
    this.hostCounts[flow] += 1;
    let disposed = false;
    return () => {
      if (!disposed) {
        disposed = true;
        this.hostCounts[flow] -= 1;
      }
    };
  }

  public hasRegisteredHost(flow: ProtectFlow): boolean {
    return this.hostCounts[flow] > 0;
  }

  public async process<T>(clerk: Clerk, payload: T, replay: () => Promise<T>, rawFetch: RawResourceFetch): Promise<T> {
    let current = payload;
    let rounds = 0;

    for (;;) {
      const gated = findPendingProtectCheck(current as FapiResponseJSON<unknown> | null);
      if (!gated || this.hasRegisteredHost(gated.flow)) {
        return current;
      }
      if (rounds >= MAX_GATED_ROUNDS) {
        return current;
      }
      rounds += 1;

      if (this.inflightSession) {
        // Another gated call owns the challenge UI. Wait it out (its failure is its caller's to
        // surface), then replay: the stored proof on the attempt lets the replay pass without a
        // second challenge.
        await this.inflightSession.catch(() => undefined);
        current = await replay();
        continue;
      }

      const session = this.resolveGated(clerk, gated, rawFetch);
      this.inflightSession = session.catch(() => undefined);
      try {
        current = (await session) as T;
      } finally {
        this.inflightSession = null;
      }
    }
  }

  private async resolveGated(
    clerk: Clerk,
    gated: GatedInfo,
    rawFetch: RawResourceFetch,
  ): Promise<FapiResponseJSON<unknown> | null> {
    // Fail closed where the challenge cannot run: the gate requires a remote `import(sdk_url)`
    // that no-RHC builds must not perform, and a DOM to host the widget. The guard lives here
    // (not in the shared lifecycle module) because @clerk/shared compiles with the flag
    // hard-coded `false`.
    if (__BUILD_DISABLE_RHC__ || typeof document === 'undefined') {
      throw new ClerkRuntimeError('Protect verification is not supported in this environment', {
        code: ERROR_CODES.PROTECT_CHECK_UNSUPPORTED_ENVIRONMENT,
      });
    }

    const lifecycle = await import('@clerk/shared/internal/clerk-js/protectCheckLifecycle');
    const host = await this.acquireHost(clerk);

    const basePath = gated.flow === 'signIn' ? '/client/sign_ins' : '/client/sign_ups';
    const reload = () => rawFetch({ method: 'GET', path: `${basePath}/${gated.id}` }, { forceUpdateClient: true });
    const submit = (proofToken: string) =>
      rawFetch({ method: 'PATCH', path: `${basePath}/${gated.id}/protect_check`, body: { proof_token: proofToken } });

    try {
      let latest: FapiResponseJSON<unknown> | null = null;
      let check: ProtectCheckResource | null = gated.check;
      let expiredReloads = 0;
      let challengesRun = 0;

      while (check) {
        if (lifecycle.isProtectCheckExpired(check)) {
          if (expiredReloads >= lifecycle.MAX_EXPIRED_RELOADS) {
            throw new ClerkRuntimeError('Protect verification expired', {
              code: ERROR_CODES.PROTECT_CHECK_TIMED_OUT,
            });
          }
          expiredReloads += 1;
          latest = await reload();
          check = findPendingProtectCheck(latest)?.check ?? null;
          continue;
        }

        if (challengesRun >= MAX_CHAINED_CHALLENGES) {
          throw new ClerkRuntimeError('Protect check chained challenge limit exceeded', {
            code: 'protect_check_execution_failed',
          });
        }
        challengesRun += 1;

        const proofToken = await lifecycle.executeProtectCheckWithTimeout(check, host.container, {
          setWidgetVisible: host.setWidgetVisible,
        });

        const result = await lifecycle.submitProtectCheckProof<FapiResponseJSON<unknown> | null>({
          proofToken,
          submitProtectCheck: ({ proofToken: token }) => submit(token),
          reload: async () => {
            latest = await reload();
          },
          getResource: () => latest,
        });
        if (result.status === 'cancelled') {
          break;
        }
        latest = result.resource;
        check = findPendingProtectCheck(latest)?.check ?? null;
      }

      return latest;
    } finally {
      host.close();
    }
  }

  private async acquireHost(clerk: Clerk): Promise<ChallengeHost> {
    const marker = document.getElementById(PROTECT_CHECK_ELEMENT_ID);
    if (marker) {
      return { container: marker as HTMLDivElement, close: () => undefined };
    }

    try {
      await clerk.__internal_openProtectCheckModal();
    } catch {
      // Mirrors the captcha modal's components-not-ready race, but Protect cannot fail open —
      // the server enforces the gate — so surface a runtime error instead of skipping.
      throw new ClerkRuntimeError('Protect check UI failed to open', {
        code: 'protect_check_execution_failed',
      });
    }

    const container = await waitForElement(`#${PROTECT_CHECK_MODAL_CONTAINER_ID}`);
    if (!container) {
      void clerk.__internal_closeProtectCheckModal();
      throw new ClerkRuntimeError('Protect check UI failed to open', {
        code: 'protect_check_execution_failed',
      });
    }

    const setWrapperVisible = (visible: boolean) => {
      const wrapper = document.getElementById(PROTECT_CHECK_MODAL_WRAPPER_ID);
      wrapper?.style.setProperty('visibility', visible ? 'visible' : 'hidden');
      wrapper?.style.setProperty('pointer-events', visible ? 'all' : 'none');
    };

    // Reveal on the first of: the script announcing a visible widget, or the delay elapsing for
    // a still-running (e.g. proof-of-transfer) check. A `false` counter-signal is ignored — the
    // modal closes moments later on resolution, and re-hiding a revealed modal mid-submit reads
    // as a glitch.
    let revealed = false;
    const reveal = () => {
      if (!revealed) {
        revealed = true;
        setWrapperVisible(true);
      }
    };
    const revealTimer = setTimeout(reveal, MODAL_REVEAL_DELAY_MS);

    return {
      container: container as HTMLDivElement,
      setWidgetVisible: (visible: boolean) => {
        if (visible) {
          clearTimeout(revealTimer);
          reveal();
        }
        return Promise.resolve();
      },
      close: () => {
        clearTimeout(revealTimer);
        void clerk.__internal_closeProtectCheckModal();
      },
    };
  }
}
