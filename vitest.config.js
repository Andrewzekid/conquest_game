import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.js'],
      exclude: ['src/renderer.js', 'src/sound.js', 'src/menus.js'],
      reporter: ['text', 'html'],
    },
  },
});
