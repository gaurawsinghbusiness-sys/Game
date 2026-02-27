import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.shieldpainter.game",
  appName: "Shield Painter",
  webDir: "dist",
  bundledWebRuntime: false,
  server: {
    androidScheme: "https"
  }
};

export default config;

