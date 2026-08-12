---
'@clerk/clerk-js': minor
---

clerk-js now resolves Clerk Protect challenges (`protect_check`) automatically in apps built on custom flows: when a sign-in or sign-up call is gated, the challenge runs in a Clerk-managed modal (or inline, when a `<div id="clerk-protect-check" />` placement element is present) and the original call resolves with the post-challenge state. Prebuilt components keep their existing inline challenge experience. No action is required from applications; the behavior activates only for instances where Clerk Protect challenges are enabled.
