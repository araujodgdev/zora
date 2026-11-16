// The bindings declared in wrangler.jsonc, as far as this app uses them.
// (Not generated with `wrangler types`, which would add the whole runtime.)
declare module 'cloudflare:workers' {
  export const env: {
    /** R2 bucket for uploaded media. */
    MEDIA: import('./lib/content-assets.server').MediaBucket
  }
}
