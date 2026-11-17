# Instagram integration research

Researched on 2026-11-17 against Meta's official documentation and Zora at
`ae7219a`. This is a planning input, not an approved implementation plan.
No Meta app, account, token, or live API call was inspected or tested.

## Recommendation

Start by validating **Instagram API with Unified Login** against our actual
Meta app and Instagram account. Meta recommends it for new integrations and
says new features ship only on this setup. The migration guide also says
newly created apps cannot set up the older Instagram Login integration.
Do not start from tutorials that use `graph.instagram.com`,
`instagram_business_*` scopes, or Facebook Page token discovery. [S1] [S14]

For Zora, the proposed first product slice is **connect one shared Instagram
account, then explicitly publish one JPEG post**. Scheduled publishing,
carousels, reels, stories, analytics, comments, and messaging can follow.
This scope is a recommendation; the owner has not chosen it yet.

Settle two configuration questions before implementation:

1. **Internal-business eligibility.** The general Facebook Login for Business
   guide describes Business Integration System User tokens as a Tech Provider
   arrangement with separate app-owner and client business portfolios. The
   Instagram guides support testing our own account, and the Platform overview
   supports own/managed-account apps. They do not clearly resolve a production
   Unified Login connection where the same portfolio owns both the app and
   Instagram account. Confirm the supported arrangement in the actual Dashboard
   or with Meta; do not assume it is either prohibited or supported. [S2] [S7] [S15]
2. **Minimum compatible permissions.** Publishing endpoints require
   `instagram_basic` and `instagram_content_publish`, but the default Unified
   Login configuration always includes `instagram_manage_messages` too.
   Verify whether a publishing-only configuration retains the **Instagram Login
   Compatible** label. Do not promise a two-permission consent screen. [S2] [S5] [S8] [S14]

## What the six requested pages establish

| Page | Finding that affects Zora |
| --- | --- |
| Overview | One login integration accepts Instagram or Facebook credentials. No Facebook Page is required; a business portfolio is. API calls use `graph.facebook.com`. [S1] |
| Get started | Create a compatible configuration, redirect for an authorization code, exchange it on the server, discover business/account IDs, and test. There is an explicit own-account tester flow. [S2] |
| Business onboarding | The user chooses a portfolio and one or more Instagram accounts. Different portfolios require separate connections/tokens. Confirm what connected and provide reconnect/disconnect actions. [S3] |
| Authentication | The token is a Business Integration System User Access Token, shown as System-user access token (SUAT) in the Dashboard. It belongs to the portfolio, not the connecting person. Expiry is configuration-dependent. [S4] |
| Permissions | Unified Login uses `instagram_*`, not `instagram_business_*`. Standard versus Advanced Access determines which users can authorize the app. [S5] |
| Eligibility and troubleshooting | Business/Creator accounts qualify; personal accounts do not. Wrong portfolio, missing permission, revoked access, and the wrong token/debugging tool are distinct failure cases. [S6] |

## 1. Prerequisites and onboarding

### Meta-side setup

- A Meta developer account and an app with the **Manage messaging & content on
  Instagram** use case, using **Facebook Login for Business**.
- The app must be owned by a business portfolio. Without that ownership, the
  **API setup with Unified login** tab does not appear.
- An app admin to configure it.
- An Instagram professional account: Business or Creator, not personal.
  The connecting person needs access to the portfolio that owns the assets.
- A configuration selected in **API setup with Unified login**. An existing
  configuration must carry the **Instagram Login Compatible** label.
- An HTTPS redirect URL controlled by Zora, matching the saved URL exactly.
- An HTTPS webhook callback that supports verification and signed events.
  The get-started guide includes this prerequisite even though the publishing
  permissions table lists no publishing webhook requirement. [S2] [S6] [S8]

### Testing versus external onboarding

The documented Development-mode path is to invite a real professional account
as an **Instagram Tester**, accept the invitation in Instagram's web settings
under **Website permissions > Apps and websites > Tester Invites**, then
generate a token. Synthetic Meta test users are not supported. The general
Business Login guide also requires the system-user-flow tester to have an app
role and full control of the client business. [S2] [S7]

Standard Access supports app-role testing. The Platform overview says Standard
Access is sufficient for own/managed professional accounts; do not assume a
three-person internal app automatically needs the external-client App Review
path. Still verify the role, account, and feature restrictions for our setup.
Zora membership is not the same thing as a Meta app/business role. [S2] [S5] [S15]

For clients without app roles, the Unified Login guide requires **Advanced
Access to every permission in the configuration** and **Live mode**. The
Platform overview requires Business Verification for Advanced Access.
App Review requires a testable app, permission-specific explanations and
screencasts, reviewer access, and basic app details including a privacy policy.
Zora's sign-up allowlist would need a deliberate reviewer-access arrangement
if we take that path. [S2] [S5] [S13] [S15]

### What the person connecting sees

They log in on Meta, choose a portfolio, choose Instagram accounts, optionally
choose other requested assets, approve permissions, and return to Zora.
Instagram login happens in the browser, not the Instagram app; Zora never
collects the Instagram password. `prompt=login` shows both login options even
when the browser already has a Facebook session. [S3]

An ad account can be skipped; publishing must not depend on providing one.
If messaging permission is requested, an **Allow access to messages** prompt
may appear for Instagram login. Facebook-login users enable that setting in
Instagram instead. This does not justify adding an inbox feature to Zora. [S3]

## 2. Authorization and token lifecycle

### Documented flow

1. Redirect to Meta's login URL with the **Meta app ID**, `config_id`,
   `redirect_uri`, and `response_type=code`; optionally use `prompt=login`.
2. Meta returns an authorization `code`, or a cancellation/error.
3. Exchange the code server-to-server at
   `https://graph.facebook.com/<version>/oauth/access_token` with the
   **Meta app ID and app secret**, not the Instagram app credentials.
4. Request `GET /me?fields=client_business_id` and store that business ID.
5. Request `GET /me/assigned_instagram_accounts?fields=id,username` with
   `instagram_basic`, following pagination if present.
6. Use each returned Instagram account ID in subsequent API request paths.
   `/me` represents the business integration system user, **not** the Instagram
   account. One token can cover multiple shared accounts in one portfolio;
   another portfolio requires another connection. [S2] [S3] [S4]

The abbreviated Unified Login code-exchange example omits `redirect_uri`,
while Meta's linked manual-flow guide marks it required. Include the same
redirect URI used to begin the flow and validate this in the connection spike.
That guide also documents `state` for CSRF protection. [S2] [S12]

**Zora security recommendation:** initiate connection only from a signed-in
session; bind an unpredictable, short-lived, single-use OAuth `state` to that
session; verify it before exchanging the code or changing a connection.
Handle denial and replay without overwriting an existing working connection.
Do not treat an OAuth callback as permission to sign up or sign in to Zora.

### Storage and expiry

Meta says to keep tokens server-side, out of logs, client code, analytics,
and URLs. Store a token with its client business ID, Instagram account IDs,
and `config_id`. Use variable-length storage without a fixed token-length
limit. The token is portfolio-associated and can keep working when the
person who authorized it leaves the business. [S4]

Do **not** implement the Instagram User token's fixed 60-day refresh flow.
Unified Login expiry depends on the configuration; the preview shows it.
Revoking the integration or moving the Instagram account to another portfolio
can invalidate access independently of expiry. Stop retrying invalid
credentials and ask for reconnection. [S4]

The Business Integration System User Access Token Management API uses
`/<CLIENT_BUSINESS_ID>/system_user_access_tokens` and requires
`business_management` plus `appsecret_proof`. Automatic token management
therefore has a permission cost; it is not free background plumbing.
Choose between that capability and a simpler reconnect-first lifecycle after
checking the actual configuration's expiration. [S5] [S7]

**Zora storage recommendation:** app secret and a dedicated token-encryption
key belong in Worker secrets. Portfolio access tokens belong encrypted in
server-only integration storage, with configuration, granted capabilities,
expiry when applicable, and connection health. No token fields should appear
in route data, Query caches, MCP/WebMCP results, or shared content records.
Secret provisioning and key rotation need an implementation plan; no secrets
are needed to read or discuss this note.

## 3. Permissions: ask for the actual first feature

| Permission | Planning position |
| --- | --- |
| `instagram_basic` | Needed for account discovery/profile/media access and publishing. [S2] [S5] [S8] |
| `instagram_content_publish` | Needed for publishing; this is the exact Unified Login permission name. [S5] [S8] |
| `instagram_manage_messages` | Required/always included by the default Unified Login configuration, even though not listed as a publishing endpoint requirement. Validate compatible configuration options first. [S2] [S14] |
| `instagram_manage_insights` | Add only if analytics is in scope. [S5] |
| `instagram_manage_comments` | Add only for moderation/mentions features, not merely to publish. [S5] |
| `business_management` | Required if using the system-user token-management API; not listed as a basic publishing requirement. [S5] [S7] [S8] |
| `ads_read`, `ads_management` | Defer for an organic-content integration. The default configuration includes them, so inspect and reduce it rather than accepting it blindly. [S2] [S5] |

Do not copy Page-related scopes from legacy Facebook Login reference tables
into a Unified Login integration. The publishing guide has a setup-specific
requirements matrix; its Unified Login column lists only
`instagram_basic` and `instagram_content_publish`. [S8]

## 4. Publishing: what the login docs do not cover

I also read the publishing guide and endpoint references because authorization
alone is not enough to plan Zora's publishing feature.

### Workflow and operational limits

1. Validate the selected media and caption.
2. `POST /<IG_ID>/media` to create a container. Meta fetches URL-based media;
   supported videos also have a resumable-upload path.
3. Check `GET /<CONTAINER_ID>?fields=status_code` when processing is needed.
4. `POST /<IG_ID>/media_publish` with `creation_id`.
5. Persist the returned published-media ID and reconcile the result.
   Container creation is **not** publication. [S8] [S10] [S11]

Containers expire after **24 hours**. Statuses include `IN_PROGRESS`,
`FINISHED`, `ERROR`, `EXPIRED`, and `PUBLISHED`. Meta recommends checking
status once per minute for no more than five minutes. Create containers close
to execution, not when someone schedules an item weeks ahead. The latter is
a Zora design inference from the expiry, not a Meta scheduling feature.
[S8] [S9] [S11]

The documented flow does not provide a future-publication timestamp; Zora
would need to trigger publication at the intended time. The reviewed
configuration has no scheduled handler or Cron trigger today. Background
execution, bounded retries, and recovery are additional work, not something
the current `scheduledAt` field already provides. [S8]

**Quota documentation conflict:** the publishing guide says 100 API-published
posts in a rolling 24 hours, but its carousel section and the
`media_publish`/publishing-limit references say 50. Do not hard-code either
as a settled contract. Query `/<IG_ID>/content_publishing_limit` for usage
and reported quota configuration, validate the response shape, and handle
provider enforcement. A carousel counts as one published post. [S8] [S10] [S16]

The publish endpoint can return a media ID with `config_issue`, for example
`CAPTION_NOT_ATTACHED`. This is a **published post with a warning**, not a
failed publication to retry. An ambiguous timeout also needs reconciliation
before another publish attempt; the reviewed docs do not establish an
exactly-once/idempotency-key contract. [S10]

The examples currently use Graph API **v27.0**. Pin and test an explicit
supported version when implementing; do not treat an unversioned URL or the
version in this note as a permanent contract. [S2] [S8]

### Media and format implications

| Zora format | API mapping / constraint |
| --- | --- |
| Post | A single-image container is the smallest useful first slice. Images must be JPEG; the reference lists 8 MB maximum and a 4:5 to 1.91:1 aspect-ratio range. [S8] [S9] |
| Carousel | Child image/video containers plus a parent `CAROUSEL` container; current docs allow up to 20 children. Needs deliberate ordering and media selection. A PDF is not a directly publishable carousel. [S8] [S9] |
| Reel | `media_type=REELS`; validate video container, codecs, duration, and dimensions, not just the `.mp4` suffix. [S9] |
| Story | `media_type=STORIES`; separate image/video requirements. Native-app sticker features are not generally available through this publishing flow. Verify the target account's eligibility before including stories in the MVP. [S9] |
| Thread / article | No mapping in the reviewed Instagram publishing flow. Keep these usable as planning formats but reject them for Instagram publication. [S8] |

The media reference lists a 2,200-character caption maximum, 30 hashtags,
and 20 mentions. Apply provider-specific checks at publication readiness;
do not restrict all Zora drafts/channels to Instagram's limits. [S9]

## 5. Fit with the current Zora code

These are repository observations and design recommendations, not Meta
requirements. Links point at the inspected baseline; line numbers may move.

### Keep Zora login and Instagram connection separate

Zora already uses [email/password and an OAuth provider for MCP](../src/lib/auth.server.ts#L34).
In the Meta integration, Zora would instead be the OAuth **client**.
Connecting Instagram must not replace team authentication, alter the sign-up
allowlist, or turn a shared publishing identity into a teammate's personal
login account.

The [workspace is explicitly shared and has no admin roles](PLAN.md#L18).
Recommend a workspace-level connection that all signed-in members can use,
with the connecting member recorded for audit. Decide who may disconnect or
replace it; do not quietly introduce a new role system.

### Separate editorial status from provider execution

The current [content table](../src/db/content-schema.ts#L25) has channel,
format, body, scheduled/published dates, and a published URL, but no connected
account, provider media/container ID, or publication execution record.

The existing [status-change service](../src/lib/content.server.ts#L194) only
updates local state; [normalization](../src/lib/content.ts#L106) fills a
missing publication time. Dragging a card to Published must **not** silently
start an external publish. Keep the manual tracking path and add an explicit,
confirmed publishing action.

Recommend small separate records for:

- **Connection:** business/configuration IDs, encrypted credential, expiry,
  capabilities, health, and connecting member.
- **Instagram account:** provider account ID and username, linked to its
  connection. One connection can cover multiple accounts even if the first UI
  exposes only one.
- **Publication:** content/account target, frozen caption and ordered asset
  selection, execution state, container/media IDs, attempts, and sanitized
  error/warning details.

Record Meta IDs as strings. Enforce a single active publication attempt per
content/account target. Persist progress and reconcile ambiguous outcomes
before retrying. Use the existing
[D1 conditional-write pattern](../src/lib/content.server.ts#L120), not an
interactive transaction or a database lock held across a network request.
Also decide what edits, rescheduling, disconnects, and deletion do to pending
or in-flight publication work.

### Private media cannot be handed directly to Meta

The [asset route requires a Zora session](../src/routes/api/assets/$assetId.ts#L17).
Meta cannot fetch that URL with a teammate's cookie. The
[upload allowlist](../src/lib/content-assets.ts#L10) also accepts PNG, GIF,
WebP, AVIF, PDFs, and videos that are not automatically publishable.
Uploaded attachments are not synonymous with selected, valid Instagram media.

For the JPEG slice, recommend a separate, expiring, signed read URL scoped to
the exact selected asset/publication. Keep the bucket and normal asset route
private. The URL must remain fetchable long enough for Meta ingestion/retries;
test that lifetime rather than assuming an extremely short expiry works.
This signed delivery URL is a scoped media capability, **not** a Meta access
token in a URL. Redact it from routine logs.

Reject unsupported files with a useful error first. Conversion/transcoding,
PDF-to-carousel rendering, asset ordering, and a video upload strategy are
separate features. The current 100 MB upload ceiling can remain for the MVP;
it is a Zora limit, not the provider's universal video limit.

### Webhooks need a separate security boundary

Meta's setup guide documents GET verification with `hub.verify_token` and
`hub.challenge`, POST authenticity via `X-Hub-Signature-256`, and retries
that can produce duplicates. Select app-level fields, then subscribe each
connected IG account through
`POST /<IG_ID>/subscribed_apps` using the portfolio token. [S17]

Recommend checking the signature against the raw request bytes before parsing
or storing the event, acknowledging promptly after durable acceptance, and
deduplicating processing. This endpoint cannot require a browser session.
The verify token is not a replacement for the app-secret signature.

The field matrix lists comments, messaging, mentions, and story insights,
but no general publishing-completed field. Do not assume a webhook replaces
container-status polling. The setup guide requires Live mode for real-user
notifications and lists Business Verification for production access; treat a
Dashboard test payload and an actual account event as separate checks.
Confirm how those requirements apply to our internal-only setup. [S17] [S18]

## 6. Proposed implementation sequence

1. **Eligibility/configuration spike, before app implementation.**
   Confirm app and account ownership, supported same/separate-portfolio
   arrangement, professional account type, app roles, compatible permissions,
   token expiry, and Standard/Advanced Access requirements. Use the documented
   tester path for read-only identity/account discovery. Keep tokens out of
   this file and chat.
2. **Connection management.**
   Add session-bound authorization, server-side token exchange/storage,
   account discovery, connection health, reconnect/disconnect, and verified
   webhook plumbing. Prove denial, tampered/replayed state, and revoked-token
   handling. No publication side effect merely from connecting.
3. **Explicit JPEG publishing.**
   Choose the connected account and an eligible asset, preview/validate the
   caption, confirm Publish, serve signed media, persist execution, and
   reconcile success/warnings/failure. Test with a designated account and
   explicit authorization to publish the test content.
4. **Scheduled execution.**
   After manual publishing works, select background execution appropriate
   to Workers. Define due-job claims, reschedule/cancel rules, bounded retries,
   stale-job recovery, duplicate prevention, and handling of ambiguous Meta
   responses. Re-read the current Workers docs before choosing this mechanism.
5. **Additional formats and readback features.**
   Add carousels/reels/stories in the order the team needs; analytics,
   moderation, DMs, and ads need their own scope and permission decisions.

This is intentionally not a proposal for a generic multi-network platform
or a new multi-tenant product. Reuse Zora's existing content services,
validation, authenticated server functions, and Query patterns.

## 7. Questions to settle with the owner

1. Is this only for Instagram accounts our team owns/manages, or will Zora
   connect other businesses later?
2. Is the first useful outcome account connection, **Publish now**,
   scheduled auto-publishing, or analytics? Recommended: connection followed
   by Publish now, then scheduling.
3. Which account(s) are involved, are they Business or Creator, and do we
   control the relevant Meta business portfolio and already have a Meta app?
   Do not provide passwords, app secrets, or tokens in the answer.
4. Which media formats must work first? Recommended initial constraint:
   already-valid JPEGs, no conversion pipeline.
5. Should every team member be able to connect/disconnect accounts and approve
   real publication? Should agents ever publish, or only prepare drafts?
   Existing MCP/WebMCP status changes must not acquire publication side effects.

## Evidence limits and implementation checks

All six requested pages were read, together with the official linked
publishing, authentication, review, migration, and webhook references below.
Where setup-specific and older generic tables conflict, this note favors the
Unified Login-specific material and calls out unresolved questions instead
of inferring hidden requirements.

No Dashboard eligibility, permission reduction, token management, media
fetch, webhook delivery, quota response, or real publication was tested.
Those are acceptance checks for the spike/implementation, not completed
validation. No application source, schema, configuration, or dependencies
were changed by this research.

## Sources

All sources are Meta's official documentation, read on 2026-11-17.

[S1]: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login
[S2]: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/get-started
[S3]: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/business-onboarding
[S4]: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/authentication
[S5]: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/permissions
[S6]: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/eligibility-and-troubleshooting
[S7]: https://developers.facebook.com/documentation/facebook-login/facebook-login-for-business
[S8]: https://developers.facebook.com/documentation/instagram-platform/content-publishing
[S9]: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media
[S10]: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/media_publish
[S11]: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-container
[S12]: https://developers.facebook.com/documentation/facebook-login/guides/advanced/manual-flow
[S13]: https://developers.facebook.com/documentation/instagram-platform/app-review
[S14]: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/migration-guide
[S15]: https://developers.facebook.com/documentation/instagram-platform/overview
[S16]: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user/content_publishing_limit
[S17]: https://developers.facebook.com/documentation/instagram-platform/webhooks/setup
[S18]: https://developers.facebook.com/documentation/instagram-platform/webhooks/fields
