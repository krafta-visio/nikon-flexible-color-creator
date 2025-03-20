// Definisi nilai dasar untuk ColorBlenderValues
export const ColorBlenderValues = {
  /** Rentang nilai hue: -100 hingga 100 */
  hue: undefined,
  /** Rentang nilai chroma: -100 hingga 100 */
  chroma: undefined,
  /** Rentang nilai brightness: -100 hingga 100 */
  brightness: undefined,
};

// Definisi objek ColorBlender yang berisi warna-warna utama
export const ColorBlender = {
  red: { ...ColorBlenderValues }, // Parameter pengaturan warna merah
  orange: { ...ColorBlenderValues }, // Parameter pengaturan warna oranye
  yellow: { ...ColorBlenderValues }, // Parameter pengaturan warna kuning
  green: { ...ColorBlenderValues }, // Parameter pengaturan warna hijau
  cyan: { ...ColorBlenderValues }, // Parameter pengaturan warna cyan
  blue: { ...ColorBlenderValues }, // Parameter pengaturan warna biru
  purple: { ...ColorBlenderValues }, // Parameter pengaturan warna ungu
  magenta: { ...ColorBlenderValues }, // Parameter pengaturan warna magenta
};

// Definisi nilai dasar untuk ColorGradingValues
export const ColorGradingValues = {
  /** Rentang nilai hue: 0 hingga 360 derajat */
  hue: undefined,
  /** Rentang nilai chroma: -100 hingga 100 */
  chroma: undefined,
  /** Rentang nilai brightness: -100 hingga 100 */
  brightness: undefined,
};

// Definisi objek ColorGrading untuk pengaturan gradasi warna
export const ColorGrading = {
  highlights: { ...ColorGradingValues }, // Pengaturan color grading untuk highlights
  midTone: { ...ColorGradingValues }, // Pengaturan color grading untuk mid-tones
  shadows: { ...ColorGradingValues }, // Pengaturan color grading untuk shadows
  /** Rentang nilai blending: 0 hingga 100 */
  blending: undefined,
  /** Rentang nilai balance: -100 hingga 100 */
  balance: undefined,
};

// Definisi objek utama untuk Flexible Color Picture Control
export const FlexibleColorPictureControlOptions = {
  /** Nama Picture Control (1-19 karakter alfanumerik) */
  name: "",
  /** Rentang nilai sharpening: -3.0 hingga 9.0 */
  sharpning: undefined,
  /** Rentang nilai mid-range sharpening: -5.0 hingga 5.0 */
  midRangeSharpning: undefined,
  /** Rentang nilai clarity: -5.0 hingga 5.0 */
  clarity: undefined,
  /** Rentang nilai contrast: -100 hingga 100 */
  contrast: undefined,
  /** Rentang nilai highlights: -100 hingga 100 */
  highlights: undefined,
  /** Rentang nilai shadows: -100 hingga 100 */
  shadows: undefined,
  /** Rentang nilai white level: -100 hingga 100 */
  whiteLevel: undefined,
  /** Rentang nilai black level: -100 hingga 100 */
  blackLevel: undefined,
  /** Rentang nilai saturation: -100 hingga 100 */
  saturation: undefined,

  /** Pengaturan Color Blender (meliputi red, orange, yellow, dll.) */
  colorBlender: { ...ColorBlender },

  /** Pengaturan Color Grading (meliputi highlights, midTone, shadows, dll.) */
  colorGrading: { ...ColorGrading },
};
