declare namespace React {
  namespace JSX {
    interface IntrinsicElements {
      // Chessground renders pieces as <piece class="pawn white"> custom elements.
      // We reuse this in BoardEditor to get the same Cburnett SVG images.
      piece: React.HTMLAttributes<HTMLElement>
    }
  }
}
