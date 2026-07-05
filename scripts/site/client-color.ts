// Shared client-side color snippet emitted into the generated Pages HTML.
//
// The Pages generators (generate.ts, differences.ts, xychart-test.ts) each ship
// a tiny `hexToRgb` into the browser to drive theme-derived CSS custom
// properties. The three copies had drifted — differences.ts dropped the
// `length !== 6` guard, so a malformed 5-char hex parsed to a wrong color
// instead of returning null. This is the one canonical implementation; import
// it and interpolate `${HEX_TO_RGB_JS}` into the client `<script>` template.
//
// It stays a string (not an imported function) because it runs in the browser,
// not in the build process; the typed server-side color primitives live in
// src/shared/color-math.ts.
export const HEX_TO_RGB_JS = `function hexToRgb(hex) {
    if (!hex || typeof hex !== 'string') return null;
    var value = hex.trim();
    if (value[0] === '#') value = value.slice(1);
    if (value.length === 3) value = value[0]+value[0]+value[1]+value[1]+value[2]+value[2];
    if (value.length !== 6) return null;
    var num = parseInt(value, 16);
    if (Number.isNaN(num)) return null;
    return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
  }`
