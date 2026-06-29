import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.andres.blur',
  appName: 'Blur',
  webDir: 'dist',
  android: {
    backgroundColor: '#05060f',
    // Keep the WebView opaque for the GL canvas; allow mixed content off.
    allowMixedContent: false,
  },
  server: {
    androidScheme: 'https',
  },
};

export default config;
