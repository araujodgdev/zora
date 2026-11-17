# Brand artwork

Zora's brand is claymation, after clay.com: a lime plasticine Z with a cream
clay cat asleep on its top bar. The pictures and loops are generated with
fal.ai, not drawn in CSS. This file records how each one was made, so a
variant can be produced in the same style.

| File | What it is | Used by |
| --- | --- | --- |
| `src/assets/brand/zora-mark.webp` | the Z and the cat, transparent, 256 px tall | `ZoraMark` / `ZoraLogo` (`@/components/brand`) |
| `src/assets/brand/auth-hero.{webm,mp4,webp}` | the diorama loop (6 s, 960×1280) and its first frame | `AuthLayout` |
| `src/assets/brand/cat-yarn.{webm,mp4,webp}` | the cat with the yarn ball (4 s, 320×320) and its first frame | `CatLoader` (router pending page) |
| `scripts/brand/app-icon.png` | 1024 px icon master on charcoal clay | `scripts/app-icon.html` -> `node scripts/generate-icons.mjs` |

## How they were made

All prompts ask for "premium claymation, clay.com style, matte plasticine
with subtle fingerprints, fine film grain" and no text other than the Z.

1. **Base render** (`fal-ai/nano-banana-2.1`, 1:1, 2K): a chunky geometric Z
   in lime plasticine (`#A7F175`, the app's primary) with a small cream cat
   (`#EFE9DE`) lying along its top bar, chin on its paws, one paw and the
   tail hanging over the edge, on solid black.
2. **Mark**: the base render cut out with `fal-ai/birefnet/v2`, trimmed and
   resized to 256 px tall WebP (sharp, quality 88).
3. **Every other image** is `fal-ai/nano-banana-2.1/edit` with the base render
   as the reference, so the Z and the cat stay the same character:
   - *Auth scene* (3:4): a diorama of pastel green hills under a sky-blue
     clay sky with puffy clouds; the Z stands on the hill with the cat
     asleep on top; around it a calendar page with a day circled in lime,
     three social-post cards (yellow, blue, pink) and a coral rocket
     lifting off. Open sky in the upper third, for the headline.
   - *Loader* (1:1): the cat on its side on plain cream (`#F2EDE4`) batting
     a lime yarn ball.
   - *App icon* (1:1): the Z and the cat centred on a full-bleed slab of
     charcoal plasticine, then a second edit that zooms out (the pair at
     about 52% of the width) so it fits the maskable safe zone.
4. **Loops** (`fal-ai/wan-3-prime/image-to-video`, from the scene and the
   loader images): "seamless looping claymation, locked-off static camera,
   no zoom, no pan", only small motions (the cat breathes, the tail sways,
   the rocket bobs; in the loader the cat bats the ball), "the last frame
   matches the first frame exactly". 6 s at 1080p for the scene, 4 s at
   720p for the loader.
5. **Encoding** (ffmpeg): scaled to 960×1280 and 320×320, no audio, VP9
   WebM and H.264 MP4 (`yuv420p`, `+faststart`); the poster is the first
   frame as WebP. Keep the files small: they are bundled assets (the scene
   is under 300 KB, the loader under 40 KB).

## Rules

- The artwork is the same in both themes. Text over it uses fixed ink
  (`text-neutral-950`), not theme tokens.
- Loops play only while on screen and never under `prefers-reduced-motion`
  (the poster stays); `ClayLoop` handles both. Do not autoplay a loop
  without it.
- A new picture of the cat or the Z must start from the base render as the
  edit reference, or the character drifts.
