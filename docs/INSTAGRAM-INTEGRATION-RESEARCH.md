# Instagram integration research

Researched on 2026-11-17 against Meta's official documentation. Initial code
review: Zora at `ae7219a`; analytics follow-up: `ad3a0fa`. This is a planning
input, not authorization to implement or provision Meta resources.
No Meta app, account, token, or live API call was inspected or tested.

## Confirmed direction

The owner clarified:

| Topic | Direction |
| --- | --- |
| Business scope | Start with our account; eventually connect other businesses |
| Meta app | Does not exist yet |
| Instagram account | Will be newly created |
| First feature | **Analytics**, not publishing |

The client-access model is still open: our team managing client accounts
inside Zora is different from clients signing in to independent workspaces.

## Recommendation

Create the Meta app and professional Instagram account, then validate
**Instagram API with Unified Login**. Meta recommends it for new integrations and
says new features ship only on this setup. The migration guide also says
newly created apps cannot set up the older Instagram Login integration.
Do not start from tutorials that use `graph.instagram.com`,
`instagram_business_*` scopes, or Facebook Page token discovery. [S1] [S14]

The proposed first product slice is **connect one Instagram account, sync
account and published-media insights, and show an analytics dashboard**.
Publish content in Instagram itself initially; Zora does not have to publish
a post to read its insights when the connected account owns the media.
Publishing, signed R2 delivery URLs, video conversion, DMs, moderation, and
ads management are not prerequisites for this analytics MVP. [S19] [S21]

Use a supported OAuth connection from the start, rather than designing the
integration around a permanently pasted personal token. Start testing with
our account, but plan the external-business approval path now. Meta's
Insights guide requires Advanced Access for accounts we do not own/manage;
the Unified Login guide requires Advanced Access and Live mode to onboard
clients without app roles. [S2] [S19]

Settle two configuration questions before implementation:

1. **Internal-business eligibility.** The general Facebook Login for Business
   guide describes Business Integration System User tokens as a Tech Provider
   arrangement with separate app-owner and client business portfolios. The
   Instagram guides support testing our own account, and the Platform overview
   supports own/managed-account apps. They do not clearly resolve a production
   Unified Login connection where the same portfolio owns both the app and
   Instagram account. Confirm the supported arrangement in the actual Dashboard
   or with Meta; do not assume it is either prohibited or supported. [S2] [S7] [S15]
2. **Minimum compatible permissions.** Analytics endpoints require
   `instagram_basic` and `instagram_manage_insights`, but the default Unified
   Login configuration always includes `instagram_manage_messages` too.
   Add insights and remove unused optional permissions. Verify whether an
   analytics-only configuration retains the **Instagram Login Compatible**
   label. Do not promise a two-permission consent screen. [S2] [S14] [S19]

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
  The get-started guide includes this prerequisite, but the reviewed field
  matrix has no general account/feed analytics-updated event. Plan polling
  for those metrics; do not assume a webhook replaces it. [S2] [S6] [S18]

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
for the planned external-business rollout. Prepare a working analytics
screencast and justify the actual permissions, not hypothetical future
publishing or messaging features. [S2] [S5] [S13] [S15]

### What the person connecting sees

They log in on Meta, choose a portfolio, choose Instagram accounts, optionally
choose other requested assets, approve permissions, and return to Zora.
Instagram login happens in the browser, not the Instagram app; Zora never
collects the Instagram password. `prompt=login` shows both login options even
when the browser already has a Facebook session. [S3]

An ad account can be skipped; account/content analytics must not depend on one.
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
| `instagram_basic` | MVP: account discovery, profile/current counts, and owned-media access. [S2] [S22] [S23] |
| `instagram_manage_insights` | MVP: account and media insights. [S19] [S20] [S21] |
| `instagram_manage_messages` | Required/always included by the default Unified Login configuration, even though not listed as an insights endpoint requirement. Validate compatible configuration options first; do not build an inbox merely to use this template. [S2] [S14] [S19] |
| `instagram_content_publish` | Defer. Analytics does not require publishing. [S8] [S19] |
| `instagram_manage_comments` | Defer moderation/mentions. Reading comment-count insights is not the same capability as reading or managing comment conversations. [S5] [S21] |
| `business_management` | Required if using the system-user token-management API; not listed as a basic insights requirement. Decide with the token-lifecycle strategy. [S5] [S7] [S19] |
| `ads_read`, `ads_management` | Defer ads reporting/management. The default configuration includes them, so inspect and reduce it rather than accepting it blindly. [S2] [S5] |

Do not copy Page-related scopes from legacy Facebook Login reference tables
into a Unified Login integration. The Insights guide and account/media
insights references have setup-specific matrices; their Unified Login
columns list `instagram_basic` and `instagram_manage_insights`. [S19] [S20] [S21]

## 4. Analytics-first MVP

### Proposed dashboard scope

These are candidate metrics supported by the current reference tables, not
claims that they have been tested with our nonexistent account:

| View | First useful data |
| --- | --- |
| Connected account | Username, current follower total (`followers_count`), media count, connection health, last successful sync. [S22] |
| Account performance | `views`, `reach`, `accounts_engaged`, `total_interactions`; likes, comments, saves, and shares where available. [S20] |
| Published-media list | Provider media ID, publication time, permalink, media type, and an optional preview. Ingest owned posts even when they were published outside Zora. [S22] [S23] |
| Media performance | Supported per-media `views`, `reach`, `likes`, `comments`, `saved`, `shares`, and `total_interactions`; filter requests by media product type. Account-level `saves` and media-level `saved` are different provider names. [S20] [S21] |
| Growth over time | Periodic observations of current follower totals. Present deltas only across observations we actually collected; do not pretend this is historic follows/unfollows data. [S22] |

Recommend 7-day and 30-day account reports, with explicitly labeled
per-post lifetime performance. Start with feed posts/carousels and reels;
defer story analytics and audience demographics until their collection and
eligibility rules are handled. Do not promise ads attribution, competitor
insights, or arbitrary businesses' private analytics.

### Read path

After the authorization/account-discovery flow:

1. `GET /<IG_ID>?fields=id,username,followers_count,media_count` for account
   metadata and current totals. [S22]
2. `GET /<IG_ID>/media` with supported media fields and pagination for
   published-media discovery. [S9] [S22] [S23]
3. `GET /<IG_ID>/insights` for account metrics, with compatible `metric`,
   `period`, `metric_type`, and explicit time ranges. [S20]
4. `GET /<MEDIA_ID>/insights` for metrics supported by that media's product
   type. [S21]

Use `graph.facebook.com` and the portfolio token for all of these in Unified
Login. The current references use v27.0; pin a supported version and test the
actual response shapes. A named metric being valid on one endpoint does not
make it valid on another endpoint or for every media type. [S19] [S20] [S21]

### New-account expectations

- **Not every metric requires 100 followers.** The current reference gates
  specific metrics, including `follower_count`, `online_followers`,
  `follows_and_unfollows`, and follower demographics. Engaged-audience
  demographics have a separate engagement threshold. Do not block the whole
  analytics feature until 100 followers. [S19] [S20]
- The profile field **`followers_count`** is a current total, distinct from
  the gated insights metric **`follower_count`**. Its field table does not
  document that same threshold. Validate its actual low-follower response;
  collect observations rather than inventing historical growth. [S20] [S22]
- Metrics can lag **up to 48 hours**. A brand-new account without content
  cannot demonstrate a populated content report. Create it as a professional
  account before initial posts and expect empty states during onboarding.
  Genuine interactions must accumulate; no synthetic metrics should be shown
  as real account performance. [S20] [S21]
- An empty insights dataset means unavailable/nonexistent data, **not zero**.
  Keep unavailable, genuine zero, threshold-limited, stale, and failed-sync
  states distinguishable. Example UI labels can be "Sem dados suficientes"
  and "Atualizado em..."; never turn an authorization error into an empty
  chart. [S19] [S20] [S21]
- The guide says account metrics are stored for **up to 90 days**; media
  insights reference **up to two years**, with metric-specific exceptions.
  There is no promise of unlimited history or complete backfill. Collect
  history proactively, with a defined retention/deletion policy before
  serving external businesses. [S19] [S21]
- Story media metrics have a **24-hour** availability window and additional
  low-viewer restrictions. A once-daily general sync is not a reliable story
  archive. The Unified Login webhook matrix lists `story_insights`, while
  older prose says Facebook Login only; verify actual delivery before
  depending on it. [S18] [S19] [S21]

### Metric semantics that the implementation must preserve

The guide's examples still use `impressions` and other old metrics. The
current account reference deprecates `impressions` in favor of `views`, and
the changelog also deprecates metrics such as `plays`, `video_views`, and
the old `profile_views` time series. Use the current metric tables and
version-specific behavior, not copied example queries. [S19] [S20] [S24]

- `views` and several account metrics use `metric_type=total_value`, not a
  native `time_series`. Daily charts may need separately queried daily
  windows; do not assume all metrics return daily arrays. [S20]
- `reach` counts unique accounts for its scope. Do not add daily reach or
  per-post reach and label the sum as unique reach for the whole period.
  Request the actual report range for that aggregate. [S20] [S21]
- Per-media lifetime counters are cumulative observations, not daily
  increments. Repeated snapshots must not be summed. Selecting posts
  published in a date range does not make their lifetime engagement equal to
  engagement that happened within that range. [S21]
- Not every breakdown works with every metric; invalid combinations can
  fail an entire request. Group only compatible metrics and handle a partial
  sync without discarding unrelated successful results. [S20] [S21]
- Account and media metrics need not have identical paid/organic scope.
  Account metrics may include boosted content; media metrics such as likes,
  comments, and views exclude engagement on separate ads containing that
  media. Aggregated `total_*` alternatives are labeled Facebook Login-only
  in the current media reference; do not assume availability under Unified
  Login or promise parity with every native Instagram counter. [S20] [S21]
- API timestamps use UTC. Preserve returned bucket boundaries, requested
  ranges, and aggregation semantics; UTC timestamps do not justify inventing
  different reporting-day boundaries. Choose the reporting timezone
  explicitly in the implementation plan. [S19] [S20]

## 5. Fit with the current Zora code

These are repository observations and design recommendations, not Meta
requirements. Links point at the inspected baseline; line numbers may move.

### Keep Zora login and Instagram connection separate

Zora already uses [email/password and an OAuth provider for MCP](../src/lib/auth.server.ts#L34).
In the Meta integration, Zora would instead be the OAuth **client**.
Connecting Instagram must not replace team authentication, alter the sign-up
allowlist, or turn a shared connected account into a teammate's personal
login account.

The [workspace is explicitly shared and has no admin roles](PLAN.md#L18).
Start with a workspace-level connection and record the connecting member.
For external businesses, settle the access model before onboarding them:

- **Agency model:** only our team signs in; client accounts are intentionally
  visible to that team in the shared workspace.
- **Client-facing product:** clients sign in to Zora; business/workspace
  membership and server-enforced data isolation are required before real
  client data is stored or exposed. An account selector alone is not isolation.

Do not silently treat "eventually other businesses" as approval either to
share their data with all current users or to build a multi-tenant system now.

### Import published media independently from editorial items

The current [content table](../src/db/content-schema.ts#L25) represents
planned content, not a provider media catalog or metric history. Importing
Instagram posts must not require recreating them as drafts in Zora.

Recommend small, account-scoped records for:

- **Connection:** business/configuration IDs, encrypted credential, expiry,
  capabilities, health, and connecting member.
- **Instagram account:** provider account ID and username, linked to its
  connection. One connection can cover multiple accounts even if the first UI
  exposes only one.
- **Imported media:** provider media/account IDs, type, timestamp, permalink,
  optional preview, and an optional link to an editorial content item later.
- **Metric results/observations:** account and optional media ID, provider
  metric name, API version, metric type, period, requested/returned window,
  breakdown, value/availability, and observation time. Keep daily account
  buckets distinct from cumulative media and follower-total observations.

Record Meta IDs as strings. Use idempotent upserts for retried syncs and the
existing [D1 conditional-write pattern](../src/lib/content.server.ts#L120)
when claiming work, not interactive transactions or locks held across a
network request. Provider requests belong in server-only services; expose
only authorized, sanitized reporting data through the existing server
function and Query patterns.

### Sync and reporting

Recommend an initial backfill within provider-supported windows, scheduled
refreshes, and a rate-limited manual refresh. Re-fetch recent account buckets
to accommodate the documented delay instead of treating yesterday as final.
The exact cadence and lookback remain implementation choices; do not poll
on every chart render.

Persist last successful sync separately from last attempt/error, retain
valid prior results after transient failures, and show freshness. Reconnect
after invalid credentials; do not retry indefinitely. Disconnect must stop
collection, and deletion/retention semantics must be decided before external
business onboarding.

Feed/reel analytics can start without R2 changes. Provider preview URLs can
be absent, including videos with licensed/copyrighted audio. Treat previews
as optional and fall back to permalink/available thumbnails; do not copy
private media into R2 as an unrequested prerequisite. [S23]

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
but no general account/feed analytics-updated field. Do not assume a webhook
replaces metric polling or subscribe to DMs/comments for an analytics-only
feature. The setup guide requires Live mode for real-user
notifications and lists Business Verification for production access; treat a
Dashboard test payload and an actual account event as separate checks.
Confirm how those requirements apply to our initial test setup. [S17] [S18]

## 6. Proposed implementation sequence

1. **Create the Meta assets and prove analytics access.**
   Register the developer account, create the Meta app with the supported use
   case and business-portfolio ownership, and create a professional Instagram
   account. Recommend Business for the team's brand; Creator also qualifies.
   Confirm the own-account test arrangement, roles, tester invitation,
   insights-enabled compatible configuration, and token expiry. Prove account
   discovery and an insights response, including legitimate unavailable data.
   Keep tokens out of this file and chat.
2. **Connection management.**
   Add session-bound authorization, server-side token exchange/storage,
   account discovery, connection health, reconnect/disconnect, and the HTTPS
   webhook callback required by setup. Prove denial, tampered/replayed state,
   revoked-token handling, and secret redaction. No publish action or inbox.
3. **Insights ingestion and dashboard.**
   Import published feed/carousel/reel media, fetch compatible metrics, store
   account windows and cumulative observations correctly, and add sync health.
   Show the proposed 7/30-day account view and labeled per-post lifetime
   performance. Prove missing-versus-zero, low-follower, no-posts, partial
   sync, pagination, stale-data, and API-error states.
4. **Reliable refresh and history.**
   Add background refresh, idempotent writes, bounded retries, recent-window
   reconciliation, and rate-limited manual refresh. Re-read current Workers
   docs before choosing the execution mechanism. No repeated browser-driven
   collection masquerading as scheduled ingestion.
5. **External-business readiness before inviting real clients.**
   Settle agency versus client-facing access, enforce the chosen data
   boundaries, define disconnect/deletion/retention, and complete applicable
   Business Verification, Advanced Access/App Review, and Live-mode gates.
   Demonstrate the actual analytics use case for every requested permission.
6. **Later capabilities.**
   Consider demographics after eligibility, story analytics with timely
   collection, then publishing or other features only as separately scoped
   work. Analytics remains useful without implementing publication.

## 7. Remaining product decisions

The first three scope questions are answered in "Confirmed direction".
The next architectural decision is **agency-style management versus clients
signing in to their own Zora workspaces**. Do not implement external-account
authorization without deciding who may see those accounts and reports.

Other defaults to confirm in the implementation plan:

- Proposed reporting scope: account overview plus post/reel performance,
  7/30-day ranges, no story archive or demographics in the first release.
- Reporting timezone and initial refresh cadence.
- Who in the current team may connect, replace, or disconnect an account.
- Whether an imported Instagram post can later be linked to a Zora editorial
  item; no automatic duplicate draft creation.

## Appendix: deferred publishing research

These findings remain useful but are **not dependencies of analytics**:

- Publication creates a container with `POST /<IG_ID>/media`, checks its
  processing state where needed, and publishes with
  `POST /<IG_ID>/media_publish`. Container creation is not publication.
  Containers expire after 24 hours, so scheduled publishing needs its own
  execution/recovery design. [S8] [S10] [S11]
- JPEG images have an 8 MB maximum and the documented aspect-ratio limits.
  Carousels use child containers and a parent; current docs allow up to 20.
  PDFs are not directly publishable carousels. Reels and stories have
  separate video/media requirements. [S8] [S9]
- The [existing asset route](../src/routes/api/assets/$assetId.ts#L17)
  requires a browser session, so URL-based publication needs separate scoped
  media delivery. Do not make the bucket public merely to support it.
- The [status-change service](../src/lib/content.server.ts#L194) is local
  editorial tracking. Moving a card to Published, including through MCP,
  must not silently become a real publication action.
- Quota docs conflict: the publishing guide says 100 posts/24 hours, while
  its carousel section and endpoint references say 50. Query the provider's
  quota endpoint and handle actual enforcement rather than hard-coding an
  assumed settled value. [S8] [S10] [S16]
- `media_publish` can return a real published-media ID with a warning such
  as `CAPTION_NOT_ATTACHED`. Do not retry that as a failed publication.
  Ambiguous timeouts also need reconciliation before a new attempt. [S10]

## Evidence limits and implementation checks

All six requested pages were read, together with the official linked
publishing, authentication, review, migration, and webhook references below.
The analytics follow-up also read the Insights guide, account/media insights
references, account/media field references, and relevant changelog entries.
Where setup-specific and older generic tables conflict, this note favors the
Unified Login-specific material and calls out unresolved questions instead
of inferring hidden requirements.

No Dashboard eligibility, permission reduction, token management, media
fetch, webhook delivery, quota response, insights response, or real
publication was tested. No developer app or Instagram account was created.
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
[S19]: https://developers.facebook.com/documentation/instagram-platform/insights
[S20]: https://developers.facebook.com/documentation/instagram-platform/api-reference/instagram-user/insights
[S21]: https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media/insights
[S22]: https://developers.facebook.com/documentation/instagram-platform/instagram-graph-api/reference/ig-user
[S23]: https://developers.facebook.com/documentation/instagram-platform/reference/instagram-media
[S24]: https://developers.facebook.com/documentation/instagram-platform/changelog
