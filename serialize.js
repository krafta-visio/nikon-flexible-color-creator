import { base } from "./base.js";


// Fungsi untuk menulis Color Blender
function writeColorBlender(buf, colorBlender = {}) {
  writeColorBlenderValues(buf, 0x14c, colorBlender.red);
  writeColorBlenderValues(buf, 0x14f, colorBlender.orange);
  writeColorBlenderValues(buf, 0x152, colorBlender.yellow);
  writeColorBlenderValues(buf, 0x155, colorBlender.green);
  writeColorBlenderValues(buf, 0x158, colorBlender.cyan);
  writeColorBlenderValues(buf, 0x15b, colorBlender.blue);
  writeColorBlenderValues(buf, 0x15e, colorBlender.purple);
  writeColorBlenderValues(buf, 0x161, colorBlender.magenta);
}

// Fungsi bantu untuk menulis nilai Color Blender
function writeColorBlenderValues(buf, offset, color = {}) {
  const { hue = 0, chroma = 0, brightness = 0 } = color;
  buf[offset] = 0x80 + clamp(hue, -100, 100);
  buf[offset + 1] = 0x80 + clamp(chroma, -100, 100);
  buf[offset + 2] = 0x80 + clamp(brightness, -100, 100);
}


export function serialize({
  name,
  sharpning,
  midRangeSharpning,
  clarity,
  contrast,
  highlights,
  shadows,
  whiteLevel,
  blackLevel,
  saturation,
  colorBlender,
  colorGrading,
}) {
  const ret = new Uint8Array(base);
  writeName(ret, name);
  writeSharpning(ret, sharpning);
  writeMidRangeSharpning(ret, midRangeSharpning);
  writeClarity(ret, clarity);
  writeContrast(ret, contrast);
  writeHighlights(ret, highlights);
  writeShadows(ret, shadows);
  writeWhiteLevel(ret, whiteLevel);
  writeBlackLevel(ret, blackLevel);
  writeSaturation(ret, saturation);
  writeColorBlender(ret, colorBlender);
  writeColorGrading(ret, colorGrading);
  return ret;
}

function writeName(buf, name) {
  if (name.length > 19) {
    throw new Error("Name must be less than 19 characters");
  }
  for (let i = 0; i < name.length; i++) {
    buf[0x18 + i] = name.charCodeAt(i);
  }
}

function writeSharpning(buf, sharpning = 2) {
  buf[0x52] = 0x80 + clamp(sharpning, -3, 9) * 4;
}

function writeMidRangeSharpning(buf, midRangeSharpning = 1) {
  buf[0xf2] = 0x80 + clamp(midRangeSharpning, -5, 5) * 4;
}

function writeClarity(buf, clarity = 0.5) {
  buf[0x5c] = 0x80 + clamp(clarity, -5, 5) * 4;
}

function writeContrast(buf, contrast = 0) {
  buf[0x110] = 0x80 + clamp(contrast, -100, 100);
}

function writeHighlights(buf, highlights = 0) {
  buf[0x11a] = 0x80 + clamp(highlights, -100, 100);
}

function writeShadows(buf, shadows = 0) {
  buf[0x124] = 0x80 + clamp(shadows, -100, 100);
}

function writeWhiteLevel(buf, whiteLevel = 0) {
  buf[0x12e] = 0x80 + clamp(whiteLevel, -100, 100);
}

function writeBlackLevel(buf, blackLevel = 0) {
  buf[0x138] = 0x80 + clamp(blackLevel, -100, 100);
}

function writeSaturation(buf, saturation = 0) {
  buf[0x142] = 0x80 + clamp(saturation, -100, 100);
}


function writeColorGrading(buf, colorGrading = {}) {
  writeColorGradingValues(buf, 0x170, colorGrading.shadows);
  writeColorGradingValues(buf, 0x174, colorGrading.midTone);
  writeColorGradingValues(buf, 0x178, colorGrading.highlights);
  buf[0x180] = 0x80 + clamp(colorGrading.blending ?? 50, -100, 100);
  buf[0x182] = 0x80 + clamp(colorGrading.balance ?? 0, -100, 100);
}

function writeColorGradingValues(buf, offset, color = {}) {
  const { hue = 0, chroma = 0, brightness = 0 } = color;
  const normHue = roundDegree(hue);
  buf[offset] = 0x80 + (normHue >> 8);
  buf[offset + 1] = normHue & 0xff;
  buf[offset + 2] = 0x80 + clamp(chroma, -100, 100);
  buf[offset + 3] = 0x80 + clamp(brightness, -100, 100);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundDegree(value) {
  return ((value % 360) + 360) % 360;
}