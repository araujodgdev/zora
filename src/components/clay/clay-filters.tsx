/**
 * SVG filters the clay styles reference by id (`filter: url(#clay-wobble)` in
 * `src/styles/clay.css`). Chrome only resolves filters in the same document,
 * so this is mounted once in the root route, hidden.
 *
 * `clay-wobble` displaces the edge of a piece by a few pixels with low
 * frequency noise, so outlines are never perfectly geometric, as with clay
 * shaped by hand. `clay-wobble-soft` is the gentler one for small pieces.
 * `clay-relief` gives drawn marks and lettering the lumps and dents of clay.
 */
export function ClayFilters() {
  return (
    <svg aria-hidden="true" width="0" height="0" focusable="false" style={{ position: 'absolute' }}>
      <filter id="clay-wobble" x="-10%" y="-20%" width="120%" height="140%">
        <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="4" result="noise" />
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="3.5" xChannelSelector="R" yChannelSelector="G" />
      </filter>
      {/* Gentler, for small pieces, where a 3.5px wobble would look jagged. */}
      <filter id="clay-wobble-soft" x="-10%" y="-20%" width="120%" height="140%">
        <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="1" seed="4" result="noise" />
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="1.6" xChannelSelector="R" yChannelSelector="G" />
      </filter>
      {/*
        Relief for drawn clay (ticks, icons, raised lettering): bends the
        outline a little, then lights a noise height field from the top left
        (as the surface relief in clay.css) and lays it over the shape, so
        rolled marks get lumps and dents too. Nothing in clay is smooth.
      */}
      <filter
        id="clay-relief"
        x="-15%"
        y="-15%"
        width="130%"
        height="130%"
        colorInterpolationFilters="sRGB"
      >
        <feTurbulence type="fractalNoise" baseFrequency="0.32" numOctaves="1" seed="9" result="noise" />
        <feDisplacementMap
          in="SourceGraphic"
          in2="noise"
          scale="0.7"
          xChannelSelector="R"
          yChannelSelector="G"
          result="shape"
        />
        <feDiffuseLighting in="noise" surfaceScale="3.2" lightingColor="white" result="light">
          <feDistantLight azimuth={225} elevation={30} />
        </feDiffuseLighting>
        <feBlend in="light" in2="shape" mode="soft-light" result="lit" />
        <feComposite in="lit" in2="shape" operator="in" />
      </filter>
      {/*
        Matte shading for rolled snakes of clay (the checkbox tick): the
        shape's own alpha, blurred, becomes a round height field; noise adds
        dents to it; diffuse light (no specular, so no shine) multiplies the
        colour. The outline is bent a little, then everything is clipped to it.
        The region is in the mark's 24-unit viewBox (userSpaceOnUse): a
        bounding-box region would clip a flat dash.
      */}
      <filter
        id="clay-roll"
        filterUnits="userSpaceOnUse"
        x="-4"
        y="-4"
        width="32"
        height="32"
        colorInterpolationFilters="sRGB"
      >
        <feTurbulence type="fractalNoise" baseFrequency="0.3" numOctaves="2" seed="12" result="noise" />
        <feDisplacementMap
          in="SourceGraphic"
          in2="noise"
          scale="0.9"
          xChannelSelector="R"
          yChannelSelector="G"
          result="shape"
        />
        <feGaussianBlur in="shape" stdDeviation="1.1" result="round" />
        <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="dents" />
        <feComposite in="round" in2="dents" operator="arithmetic" k1="0" k2="1" k3="0.35" k4="0" result="height" />
        <feDiffuseLighting in="height" surfaceScale="2.4" lightingColor="white" result="light">
          <feDistantLight azimuth={225} elevation={50} />
        </feDiffuseLighting>
        <feComposite in="light" in2="shape" operator="arithmetic" k1="0.8" k2="0" k3="0.32" k4="0" result="lit" />
        <feComposite in="lit" in2="shape" operator="in" />
      </filter>
    </svg>
  )
}
