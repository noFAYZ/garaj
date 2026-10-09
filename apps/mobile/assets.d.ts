/** A bundled image, as Metro resolves it: an asset id that `<Image source>` accepts. */
declare module '*.png' {
  const asset: number;
  export default asset;
}
