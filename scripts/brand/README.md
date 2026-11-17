# Brand artwork

Zora's brand is claymation, after clay.com: a lime plasticine Z with a cream
clay cat asleep on its top bar. The pictures and loops are generated with
fal.ai, not drawn in CSS. This file records how each one was made, so a
variant can be produced in the same style.

| File | What it is | Used by |
| --- | --- | --- |
| `src/assets/brand/zora-mark.webp` | the Z and the cat, transparent, 256 px tall | `ZoraMark` / `ZoraLogo` (`@/components/brand`) |
| `src/assets/brand/auth-hero.{webm,mp4,webp}` | the diorama loop (about 16 s, 960×1280: the cat plays, climbs the Z, naps, comes down) and its first frame | `AuthLayout` |
| `src/assets/brand/cat-yarn-alpha.mp4` | the cat with the yarn ball, cut out (4 s, 320×242): colour on top, matte below | `CatLoader` (router pending page) via `AlphaLoop` |
| `src/assets/brand/cat-yarn-still.webp` | its first frame, with alpha | `AlphaLoop` still (before playback, reduced motion) |
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
     lifting off. Open sky in the upper third.
   - *Loader* (1:1): the cat on its side on plain cream (`#F2EDE4`) batting
     a lime yarn ball.
   - *App icon* (1:1): the Z and the cat centred on a full-bleed slab of
     charcoal plasticine, then a second edit that zooms out (the pair at
     about 52% of the width) so it fits the maskable safe zone.
4. **The loader loop** (`alibaba/wan-3.0-prime/image-to-video`, 4 s, 720p):
   "seamless looping claymation, locked-off static camera, no zoom, no pan",
   the cat bats the ball, "the last frame matches the first frame exactly".
5. **The scene loop** (about 16 s): a little story told in two clips that
   meet at two keyframes, so it loops without a seam.
   - Keyframes (`nano-banana-2.1/edit` from the auth scene): *asleep*, the
     scene with a lime yarn ball and a grey clay toy mouse added on the
     ground in front of the Z; *ground*, the same picture with the cat moved
     off the Z, crouched by the yarn ball with a paw on it.
   - Clips (`alibaba/wan-3.0-prime/image-to-video`, `start_image_url` and
     `end_image_url`, 8 s, 1080p, 3:4, no audio, locked-off camera):
     ground → asleep (bats the yarn, nudges the heart sign, sniffs the
     calendar, climbs the Z, curls up asleep) and asleep → ground (sleeps,
     yawns, stretches, hops down, swats the mouse, back to the yarn). Two
     seeds each; the pick was by contact sheets, and the seams match at
     about 40 dB PSNR.
   - ffmpeg drops the duplicated frame at each seam, concatenates, scales to
     960×1280 and encodes H.264 (CRF 30, `+faststart`) and VP9 (CRF 42); the
     poster is the ground keyframe as WebP. The loop starts on the ground.
6. **Encoding the loader, cut out** so the cat sits on the app's own background:
   `fal-ai/birefnet/v2/video` (model `Matting`, `output_mask: true`) on the
   loader loop gives a matte video. ffmpeg crops both to the cat's bounding
   box over all frames (`cropdetect` on the matte; 740×560 at 176,230),
   scales to 320×242 and stacks colour over matte (`vstack`) into one H.264
   MP4 (CRF 24); the still is the first frame with the matte merged
   (`alphamerge`) as WebP. `AlphaLoop` combines the halves in a canvas.
   VP9 alpha is not decoded by Safari, and an animated WebP of the same clip
   was about 800 KB, ten times the stacked MP4.

Keep the files small: they are bundled assets (the scene is under 400 KB,
the loader under 90 KB).

## Rules

- The artwork is the same in both themes. Text over it uses fixed ink
  (`text-neutral-950`), not theme tokens.
- Loops play only while on screen and never under `prefers-reduced-motion`
  (the poster stays); `ClayLoop` handles both, and `AlphaLoop` (for clips
  with transparency) skips playback under reduced motion. Do not autoplay a
  loop without them.
- A new picture of the cat or the Z must start from the base render as the
  edit reference, or the character drifts.
