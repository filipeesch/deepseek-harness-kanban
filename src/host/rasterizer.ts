/** The outcome of asking an optional rasterizer for pixels. */
export interface RasterizerResult {
  readonly png?: Uint8Array;
  /** Why no raster was produced, when none was. */
  readonly reason?: string;
}

/** Turns one SVG drawing into a raster image when this installation can. */
export interface Rasterizer {
  render(svg: string): Promise<RasterizerResult>;
}

/**
 * The optional SVG-to-PNG rasterizer.
 *
 * The dependency is optional: the plugin is installed from a repository URL, so
 * a machine that cannot resolve the native binary must still get the drawing as
 * SVG instead of a failed tool call. The import is dynamic and by name so a
 * build never requires the package to be installed.
 */
export function createRasterizer(): Rasterizer {
  return {
    async render(svg) {
      const specifier = '@resvg/resvg-js';
      let module: unknown;
      try {
        module = await import(specifier);
      } catch {
        return { reason: 'No SVG rasterizer is installed; the drawing is available as an SVG file.' };
      }
      const Resvg = (module as { Resvg?: new (value: string) => { render(): { asPng(): Uint8Array } } }).Resvg;
      if (typeof Resvg !== 'function') return { reason: 'The installed rasterizer does not expose an SVG renderer; the drawing is available as an SVG file.' };
      try {
        return { png: new Resvg(svg).render().asPng() };
      } catch (error) {
        return { reason: 'The rasterizer could not render the drawing: ' + (error instanceof Error ? error.message : String(error)) };
      }
    },
  };
}
