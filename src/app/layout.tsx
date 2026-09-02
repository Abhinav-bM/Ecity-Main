import type { Metadata, Viewport } from 'next'
import { Toaster } from '@/components/ui/sonner'
import './globals.css'
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import { THEMES, resolveColorScheme, resolveTheme } from "@/lib/theme";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export function generateViewport(): Viewport {
  return {
    width: 'device-width',
    initialScale: 1,
    // The counter is used on phones and tablets; let staff zoom if they need to.
    maximumScale: 5,
    themeColor: THEMES[resolveTheme()].browserChrome,
  }
}

export const metadata: Metadata = {
  title: 'ECITY — Mobile Shop Management',
  description: 'Multi-branch mobile shop management: inventory, billing, credit and reporting.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Brand comes from APP_THEME, so re-skinning for a client is a config
  // change and a redeploy - never a code change. See src/lib/theme.ts.
  const theme = resolveTheme()
  const scheme = resolveColorScheme()

  return (
    <html
      lang="en"
      data-theme={theme}
      className={cn("font-sans", geist.variable, scheme === "dark" && "dark")}
      suppressHydrationWarning
    >
      <body className="min-h-screen antialiased">
        {children}
        <Toaster position="top-right" richColors />
      </body>
    </html>
  )
}
