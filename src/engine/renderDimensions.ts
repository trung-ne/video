export const DEFAULT_PROXY_SCALE = 0.5;

export function getScaledDimensions(
  width: number,
  height: number,
  scale: number,
): { width: number; height: number } {
  const scaledWidth = width * scale;
  const scaledHeight = height * scale;
  if (!Number.isInteger(scaledWidth) || !Number.isInteger(scaledHeight)) {
    throw new Error(
      `Render scale ${scale} produces non-integer dimensions ` +
      `${scaledWidth}x${scaledHeight} from ${width}x${height}.`,
    );
  }
  return { width: scaledWidth, height: scaledHeight };
}
