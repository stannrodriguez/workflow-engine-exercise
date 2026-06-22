import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Workflow Engine Visualizer",
  description: "A shadcn UI playground for workflow retry and replay.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
