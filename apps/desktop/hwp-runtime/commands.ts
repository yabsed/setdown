// Host-owned file commands. Studio never downloads or replaces a Setdown document.
export const fileCommands = [
  { id: 'file:save', label: '저장', shortcutLabel: 'Ctrl+S', execute: () => window.setdownHwp.action('save') },
  { id: 'file:save-as', label: '다른 이름으로 저장', shortcutLabel: 'Ctrl+Shift+S', execute: () => window.setdownHwp.action('save-as') },
];
