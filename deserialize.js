// Fungsi utama untuk mendeserialisasi buffer NP3
export function deserialize(buf) {
  return {
    name: readName(buf), // Membaca nama Picture Control dari file
    sharpning: readSharpning(buf), // Membaca nilai sharpening
    midRangeSharpning: readMidRangeSharpning(buf), // Membaca nilai mid-range sharpening
    clarity: readClarity(buf), // Membaca nilai clarity (kejernihan)
    contrast: readContrast(buf), // Membaca nilai kontras
    highlights: readHighlights(buf), // Membaca nilai highlight
    shadows: readShadows(buf), // Membaca nilai shadow
    whiteLevel: readWhiteLevel(buf), // Membaca nilai white level
    blackLevel: readBlackLevel(buf), // Membaca nilai black level
    saturation: readSaturation(buf), // Membaca nilai saturasi warna
    colorBlender: readColorBlender(buf), // Membaca pengaturan color blending
    colorGrading: readColorGrading(buf), // Membaca pengaturan color grading
  };
}

// Membaca nama Picture Control dari file NP3
function readName(buf) {
  return String.fromCharCode(...buf.slice(0x18, 0x18 + 19)) // Mengambil 19 byte dari offset 0x18
    .split("\0", 1)[0]; // Menghentikan pembacaan pada karakter null terminator
}

// Membaca nilai sharpening dari offset 0x52
function readSharpning(buf) {
  return (buf[0x52] - 0x80) / 4; // Mengubah nilai dari rentang penyimpanan biner ke rentang yang bisa dipahami
}

// Membaca nilai mid-range sharpening dari offset 0xF2
function readMidRangeSharpning(buf) {
  return (buf[0xf2] - 0x80) / 4;
}

// Membaca nilai clarity dari offset 0x5C
function readClarity(buf) {
  return (buf[0x5c] - 0x80) / 4;
}

// Membaca nilai kontras dari offset 0x110
function readContrast(buf) {
  return buf[0x110] - 0x80;
}

// Membaca nilai highlight dari offset 0x11A
function readHighlights(buf) {
  return buf[0x11a] - 0x80;
}

// Membaca nilai shadow dari offset 0x124
function readShadows(buf) {
  return buf[0x124] - 0x80;
}

// Membaca nilai white level dari offset 0x12E
function readWhiteLevel(buf) {
  return buf[0x12e] - 0x80;
}

// Membaca nilai black level dari offset 0x138
function readBlackLevel(buf) {
  return buf[0x138] - 0x80;
}

// Membaca nilai saturasi dari offset 0x142
function readSaturation(buf) {
  return buf[0x142] - 0x80;
}

// Membaca pengaturan color blending untuk berbagai warna
function readColorBlender(buf) {
  return {
    red: readColorBlenderValues(buf, 0x14c), // Membaca warna merah dari offset 0x14C
    orange: readColorBlenderValues(buf, 0x14f), // Membaca warna oranye dari offset 0x14F
    yellow: readColorBlenderValues(buf, 0x152), // Membaca warna kuning dari offset 0x152
    green: readColorBlenderValues(buf, 0x155), // Membaca warna hijau dari offset 0x155
    cyan: readColorBlenderValues(buf, 0x158), // Membaca warna cyan dari offset 0x158
    blue: readColorBlenderValues(buf, 0x15b), // Membaca warna biru dari offset 0x15B
    purple: readColorBlenderValues(buf, 0x15e), // Membaca warna ungu dari offset 0x15E
    magenta: readColorBlenderValues(buf, 0x161), // Membaca warna magenta dari offset 0x161
  };
}

// Fungsi pembantu untuk membaca nilai Color Blender dari offset tertentu
function readColorBlenderValues(buf, offset) {
  return {
    hue: buf[offset] - 0x80, // Membaca nilai hue (warna)
    chroma: buf[offset + 1] - 0x80, // Membaca nilai chroma (kepekatan warna)
    brightness: buf[offset + 2] - 0x80, // Membaca nilai brightness (kecerahan)
  };
}

// Membaca pengaturan Color Grading dari file NP3
function readColorGrading(buf) {
  return {
    shadows: readColorGradingValues(buf, 0x170), // Membaca color grading pada highlight dari offset 0x170
    midTone: readColorGradingValues(buf, 0x174), // Membaca color grading pada mid-tone dari offset 0x174
    highlights: readColorGradingValues(buf, 0x178), // Membaca color grading pada shadow dari offset 0x178
    blending: buf[0x180] - 0x80, // Membaca blending dari offset 0x180
    balance: buf[0x182] - 0x80, // Membaca balance dari offset 0x182
  };
}

// Fungsi pembantu untuk membaca Color Grading dari offset tertentu
function readColorGradingValues(buf, offset) {
  return {
    hue: ((buf[offset] & 0x0f) << 8) + buf[offset + 1], // Menggabungkan 2 byte untuk mendapatkan nilai hue
    chroma: buf[offset + 2] - 0x80, // Membaca chroma (kepekatan warna)
    brightness: buf[offset + 3] - 0x80, // Membaca brightness (kecerahan)
  };
}
