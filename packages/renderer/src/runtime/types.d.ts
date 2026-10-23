declare module "reveal.js" {
  type Config = Record<string, unknown>;
  type RevealStatic = {
    initialize(config?: Config): Promise<unknown>;
    on(
      event: "ready" | "slidechanged",
      cb: (e: { currentSlide: HTMLElement; previousSlide?: HTMLElement }) => void,
    ): void;
    getCurrentSlide(): HTMLElement;
    getTotalSlides(): number;
    getSlideNotes(slide?: HTMLElement): string | null;
  };
  const Reveal: RevealStatic;
  export default Reveal;
}

declare module "reveal.js/plugin/notes/notes.esm.js" {
  const RevealNotes: () => { id: string; init(deck: unknown): void };
  export default RevealNotes;
}
