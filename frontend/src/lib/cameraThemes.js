// Camera Themes ("Chủ đề máy ảnh") — Locket Gold customization matching native iOS Locket carousel.
// Themes skin the Camera screen shell, ambient glow, shutter ring, and optional 2x2 Photobooth frame!

export const CAMERA_THEMES = [
  {
    id: 'classic',
    name: 'Đen Cổ Điển',
    subtitle: 'Giao diện Locket nguyên bản với vòng chụp vàng',
    free: true,
    shellBg: '#0d0d0f',
    shellGrad: 'radial-gradient(120% 80% at 50% 0%, #1d1d22 0%, #0b0b0d 72%)',
    shutterRing: '#ffc629',
    accent: '#ffc629',
    pillBg: 'rgba(44, 44, 48, 0.72)',
    pillText: '#ffffff',
    framePreset: null,
  },
  {
    id: 'olive',
    name: 'Đêm Olive',
    subtitle: 'Ánh sáng xanh rêu ấm dịu mắt ban đêm',
    shellBg: '#1c2116',
    shellGrad: 'linear-gradient(180deg, #171915 0%, #2d3421 54%, #4f5530 100%)',
    shutterRing: '#ffd447',
    accent: '#ffd447',
    pillBg: 'rgba(32, 36, 24, 0.72)',
    pillText: '#f7f8f0',
    framePreset: null,
  },
  {
    id: 'sand',
    name: 'Cát Vàng Champagne',
    subtitle: 'Vỏ máy ảnh vàng cát sang trọng & ấm áp',
    shellBg: '#a98e57',
    shellGrad: 'linear-gradient(180deg, #baa06a 0%, #d2ba86 48%, #917744 100%)',
    shutterRing: '#ffe066',
    accent: '#ffe066',
    pillBg: 'rgba(38, 30, 16, 0.56)',
    pillText: '#fffbeb',
    framePreset: {
      layout: 'grid4',
      frameColor: '#f6eedc',
      caption: 'GOLDEN HOUR ✦',
    },
  },
  {
    id: 'coquette',
    name: 'Hồng Coquette',
    subtitle: 'Tông hồng đất ngọt ngào kèm khung ghép nơ & gấu bông',
    shellBg: '#9f4a45',
    shellGrad: 'linear-gradient(180deg, #b85d56 0%, #cf746d 48%, #8f3e39 100%)',
    shutterRing: '#ffb3ab',
    accent: '#ffb3ab',
    pillBg: 'rgba(62, 20, 18, 0.54)',
    pillText: '#fff5f5',
    badge: '🎀 Khung Coquette 2×2',
    framePreset: {
      layout: 'grid4',
      frameColor: '#fff7ef',
      caption: '🎀 sweet moments 🧸',
    },
  },
  {
    id: 'berry',
    name: 'Locket Edition Berry',
    subtitle: 'Đỏ rượu vang cá tính, vòng chụp hồng neon & khung ngày tháng',
    shellBg: '#6e1433',
    shellGrad: 'linear-gradient(180deg, #8b1c41 0%, #a92652 50%, #580e27 100%)',
    shutterRing: '#ff4d94',
    accent: '#ff4d94',
    pillBg: 'rgba(45, 6, 20, 0.58)',
    pillText: '#ffeef5',
    badge: '📸 LOCKET EDITION 2×2',
    framePreset: {
      layout: 'grid4',
      frameColor: '#18181b',
      caption: 'LOCKET EDITION ♥',
    },
  },
  {
    id: 'sage',
    name: 'Xanh Sage Mờ Sương',
    subtitle: 'Xanh ngọc trầm thanh lịch với vòng chụp bạc hà',
    shellBg: '#233633',
    shellGrad: 'linear-gradient(180deg, #2d4540 0%, #3f6059 50%, #1c2b28 100%)',
    shutterRing: '#8ce9c9',
    accent: '#8ce9c9',
    pillBg: 'rgba(18, 32, 29, 0.62)',
    pillText: '#ecfdf5',
    framePreset: null,
  },
];

export function getCameraTheme(themeId = 'classic', hasGold = false) {
  if (!hasGold) return CAMERA_THEMES[0];
  return CAMERA_THEMES.find((t) => t.id === themeId) || CAMERA_THEMES[0];
}
