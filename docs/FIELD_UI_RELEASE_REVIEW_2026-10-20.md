# FIELD reviewed POS release — awaiting owner approval

Status: **conditionally ready** for the bounded UI release after exact release-head CI passes and the owner explicitly authorizes production deployment. This document and the release marker are preparation; a draft PR does not deploy.

## Target and scope

- Repository: Thanatsuklue-21/field-pos; production branch main.
- Vercel project field-pos (`prj_SpG865dkP2ihpEecuEKpqghA7uvI`), team `team_cmWz4z3PyGM0o95pKFAgNFBr` / metaraksuklue-1269.
- Production URL: https://field-pos.vercel.app.
- Reviewed source main: 50e4ab7da42ce5e479b18f30b5d1de1dc1a96041.
- Included: #473 pending-payment focus containment and clear busy guidance; #474 satang-preserving POS money labels.
- Deliberate exclusions: master/price/recipe changes, financial calculations, provider changes, database migrations, dependency upgrades and production test transactions.
- Release trigger: existing `.vercel-release` gate. This PR changes the marker and this review only; no application changes.

## Evidence and conditions

| Criterion | Evidence / status | Owner / next action |
| --- | --- | --- |
| Bounded code review | UI labels/focus only; request identity, APIs and recovery contracts preserved | FIELD maintainer |
| #473 | 846 tests/build, 14 browser suites, exact-head and merged-main CI passed | Complete |
| #474 | 848 tests/build; satang browser at 320/390/1024; existing touch/cashier/PromptPay passed locally; feature CI 39462439737 passed; main CI must pass before activation | Verify exact final CI before release |
| Release candidate | This PR's exact-head CI must pass all 15 browser suites, tests and build | Required before merge |
| Existing production | Health identifies main/production `2dbbd92490bbc60f8c68cf721250810aef40c95f`, Turso, deployment `dpl_2qnig3KjeiRjcmcnJyj4BiHTE1Bj`; Vercel reports READY | Recheck immediately before release |
| Rollback compatibility | No schema/API/request-body changes. Prior production deployment above is the known-good baseline | Authorized release operator; preserve all business data |
| Actual operating acceptance | Android/PWA keyboard/storage, real provider sandbox, physical cash handling, timed restore and human learning measurements were not certified by Chromium mocks | Owner/operator: complete or explicitly accept existing operating limits |
| Production authorization | Not yet given for this release | Owner must explicitly authorize deployment |

## After approval

1. Fetch latest main; recheck this PR's exact head and CI. If application code advanced beyond reviewed 50e4ab7da42ce5e479b18f30b5d1de1dc1a96041, review and validate those changes before activating the release.
2. Mark the release PR ready and merge only with matching expected head SHA and passing repository checks. Do not bypass protection. Merge activates the existing Git/Vercel production gate.
3. Wait for a READY production deployment for the **release merge SHA**, not just a green Vercel commit status or the source_main marker value. Verify project/team, alias and deployment ID.
4. Read-only smoke: health release SHA/environment/branch/storage and timing/security headers; operator page routes; unauthenticated protected API denial. Use no real sale/payment/expense/stock/restore writes for smoke.
5. Inspect deployment-scoped runtime errors. Record actual deployment identity and smoke evidence. If checks fail, stop rollout and use the reviewed prior deployment under the authorized rollback plan; never alter business ledgers to recover deployment state.

Do not describe the entire shop as fully certified based only on automated tests. Production release approval is separate from the named manual acceptance gaps.
