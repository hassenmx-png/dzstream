import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'org.dzstream.app',
  appName: 'DZ Stream',
  webDir: 'dist/public',
  server: {
    // L'app charge le site déployé : mêmes données, mêmes sessions, zéro duplication
    url: 'https://dzstream.duckdns.org',
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
