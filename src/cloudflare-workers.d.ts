// The bindings declared in wrangler.jsonc, as far as this app uses them.
// (Not generated with `wrangler types`: its runtime types clash with the DOM
// types the client code needs.)
declare module 'cloudflare:workers' {
  export const env: {
    /** D1 database. Typed loosely by drizzle-orm when Workers types are absent. */
    DB: import('drizzle-orm/d1').AnyD1Database
    /** R2 bucket for uploaded media. */
    MEDIA: import('./lib/content-assets.server').MediaBucket
  }
}

