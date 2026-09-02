import type { Metadata, Viewport } from 'next'
import { Toaster } from '@/components/ui/sonner'
import './globals.css'
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // The counter is used on phones and tablets; let staff zoom if they need to.
  maximumScale: 5,
  themeColor: '#1b4965',
}

export const metadata: Metadata = {
  title: 'ECITY — Mobile Shop Management',
  description: 'Multi-branch mobile shop management: inventory, billing, credit and reporting.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn("font-sans", geist.variable)}>
      <body className="min-h-screen antialiased">
        {children}
        <Toaster position="top-right" richColors />
      </body>
    </html>
  )
}
