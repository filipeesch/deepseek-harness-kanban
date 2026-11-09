declare module '*.css' {
  /** Bundled as text so a dependency stylesheet can be mounted with the plugin's own style tags. */
  const content: string;
  export default content;
}
