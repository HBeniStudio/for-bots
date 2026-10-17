/** `import.meta.glob` is how the content loader inlines JSON into the single-file build. */
interface ImportMeta {
  glob(
    pattern: string,
    options: { eager: true; import: 'default' },
  ): Record<string, unknown>;
}
