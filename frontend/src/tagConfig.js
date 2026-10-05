// Palette des couleurs de rôles Discord
export const DEFAULT_TAG_COLOR = '#99aab5';

export const TAG_COLORS = [
  '#1abc9c', '#2ecc71', '#3498db', '#9b59b6', '#e91e63',
  '#f1c40f', '#e67e22', '#e74c3c', '#95a5a6', '#607d8b',
  '#11806a', '#1f8b4c', '#206694', '#71368a', '#ad1457',
  '#c27c0e', '#a84300', '#992d22', '#979c9f', '#546e7a',
];

export const EMOJI_CHOICES = [
  '🏎️', '🏁', '🔧', '🔩', '⚙️', '🛠️', '🪛', '🧰',
  '⚡', '🔋', '🔌', '💻', '🧠', '📐', '🧪', '🧲',
  '🛞', '🏗️', '🎨', '📸', '🎥', '📣', '🤝', '💰',
  '📊', '📦', '📝', '🎓', '🌍', '✈️', '🏆', '🥇',
  '⭐', '🔥', '🚀', '👑', '💡', '❤️',
];

// Texte noir ou blanc selon la luminosité du fond
export function readableTextColor(hex = DEFAULT_TAG_COLOR) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? '#1e1f22' : '#ffffff';
}
