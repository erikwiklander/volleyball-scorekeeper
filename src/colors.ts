export const HOME_COLOR = '#173d31';
export const AWAY_COLOR = '#e6edbc';

// Choose whichever text color provides the greater WCAG contrast ratio.
export function teamButtonStyle(color: string) {
  const rgb = color
    .slice(1)
    .match(/.{2}/g)!
    .map((value) => {
      const channel = parseInt(value, 16) / 255;
      return channel <= 0.04045
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
    });
  const luminance = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  return {
    backgroundColor: color,
    color: luminance > 0.179 ? '#000000' : '#ffffff',
  };
}
