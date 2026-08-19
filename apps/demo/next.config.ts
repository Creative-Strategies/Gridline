import type { NextConfig } from "next";
import { withGridline } from "gridline-viewer/next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["127.0.0.1"],
  reactStrictMode: true,
};

export default withGridline(nextConfig);
