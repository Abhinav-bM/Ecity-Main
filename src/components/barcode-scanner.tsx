'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Camera, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Alert } from '@/components/ui/alert'

/**
 * Reading an IMEI off the box with the phone's camera.
 *
 * The counter has a laser scanner and does not need this; a salesperson on
 * the shop floor has a phone and nothing else. Both end up in the same input,
 * because a scan is only a faster way of typing.
 *
 * Two decoders, one code path. Android's Chrome has `BarcodeDetector` built
 * in — free, fast, no download. Safari does not, so a WebAssembly decoder is
 * fetched *only there*, and only when the camera is actually opened: this
 * component is imported by the busiest screen in the product, and 1 MB of
 * decoder on every page load to serve a button most tills never press would
 * be a poor trade.
 *
 * The wasm is served from our own origin (see scripts/copy-scanner-wasm.mjs).
 * The library would fetch it from a public CDN, which would put a shop's till
 * at the mercy of a third party being reachable.
 */

/** The symbologies an IMEI label actually uses. */
const FORMATS = ['code_128', 'code_39', 'ean_13', 'itf', 'qr_code', 'data_matrix'] as const

type DetectedBarcode = { rawValue: string }
type Detector = { detect: (source: CanvasImageSource) => Promise<DetectedBarcode[]> }

async function makeDetector(): Promise<Detector> {
  const native = (globalThis as { BarcodeDetector?: new (o: unknown) => Detector }).BarcodeDetector
  if (native) return new native({ formats: FORMATS })

  const { BarcodeDetector, setZXingModuleOverrides } = await import('barcode-detector/ponyfill')
  setZXingModuleOverrides({
    locateFile: (path: string, prefix: string) =>
      path.endsWith('.wasm') ? `/scanner/${path}` : prefix + path,
  })
  return new BarcodeDetector({ formats: [...FORMATS] }) as unknown as Detector
}

/**
 * Does this look like an IMEI?
 *
 * An IMEI label usually sits beside a serial number in a near-identical
 * barcode, and adding the wrong handset to a bill is worse than a slow scan.
 * IMEIs are 15 digits ending in a Luhn check digit, so a misread is almost
 * always detectable. Anything that fails this is still offered — it is put in
 * the box for a person to look at rather than acted on.
 */
export function looksLikeImei(value: string): boolean {
  /*
   * Digits, spaces and hyphens only. Stripping every non-digit instead would
   * accept a serial like `SN490154203237518X` as an IMEI, which is precisely
   * the barcode sitting next to the one they meant — found by the test that
   * tried it.
   */
  const trimmed = value.trim()
  if (!/^[0-9 -]+$/.test(trimmed)) return false

  const digits = trimmed.replace(/[ -]/g, '')
  if (digits.length !== 15) return false

  let sum = 0
  for (let i = 0; i < 15; i += 1) {
    let digit = Number(digits[i])
    // Double every second digit from the right; 15 digits means the even
    // indices from the left are the untouched ones.
    if (i % 2 === 1) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
  }
  return sum % 10 === 0
}

export function BarcodeScanner({
  onScan,
  label = 'Scan with the camera',
  disabled,
}: {
  /** Called with what was read. `confident` is false for a doubtful scan. */
  onScan: (value: string, confident: boolean) => void
  label?: string
  disabled?: boolean
}) {
  const [supported, setSupported] = useState(false)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reading, setReading] = useState<string | null>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const frameRef = useRef<number>(0)

  useEffect(() => {
    // Rendered only where there is a camera to open, so a desktop till with a
    // laser scanner is not offered a button that cannot work.
    setSupported(
      typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function',
    )
  }, [])

  const stop = useCallback(() => {
    cancelAnimationFrame(frameRef.current)
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  useEffect(() => () => stop(), [stop])

  useEffect(() => {
    if (!open) {
      stop()
      return
    }

    let cancelled = false
    setError(null)
    setReading(null)

    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          // The back camera, and a resolution high enough to resolve the thin
          // bars of a Code 128 label without being slow to decode.
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } },
        })
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        const video = videoRef.current
        if (!video) return
        video.srcObject = stream
        await video.play()

        const detector = await makeDetector()
        if (cancelled) return

        const tick = async () => {
          if (cancelled || !videoRef.current) return
          try {
            const found = await detector.detect(videoRef.current)
            const hit = found.find((b) => b.rawValue.trim())
            if (hit) {
              const value = hit.rawValue.trim()
              const confident = looksLikeImei(value)
              setReading(value)
              /*
               * A good read closes the camera straight away — the next thing
               * the person wants is the item on the bill, not to dismiss a
               * dialog. A doubtful one stays open and shows what it saw, so
               * they can move the box and try again.
               */
              if (confident) {
                onScan(value, true)
                setOpen(false)
                return
              }
            }
          } catch {
            // A frame that will not decode is the normal case, not an error.
          }
          frameRef.current = requestAnimationFrame(() => void tick())
        }
        frameRef.current = requestAnimationFrame(() => void tick())
      } catch (e) {
        const name = (e as { name?: string }).name
        setError(
          name === 'NotAllowedError'
            ? 'The camera was blocked. Allow it in the browser, then try again.'
            : name === 'NotFoundError'
              ? 'No camera on this device.'
              : 'The camera could not be opened. On a phone this needs a secure (https) address.',
        )
      }
    })()

    return () => {
      cancelled = true
      stop()
    }
  }, [open, onScan, stop])

  if (!supported) return null

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="icon"
        disabled={disabled}
        aria-label={label}
        data-testid="scan-button"
        onClick={() => setOpen(true)}
      >
        <Camera className="size-4" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Point the camera at the barcode</DialogTitle>
          </DialogHeader>

          {error ? (
            <Alert variant="destructive">{error}</Alert>
          ) : (
            <div className="space-y-3">
              <div className="relative overflow-hidden rounded-md bg-black">
                <video
                  ref={videoRef}
                  className="aspect-[4/3] w-full object-cover"
                  playsInline
                  muted
                  data-testid="scanner-video"
                />
                {/* A window to aim through: a whole-frame scan picks up the
                    serial barcode next to the one they meant. */}
                <div className="pointer-events-none absolute inset-x-6 inset-y-1/3 rounded border-2 border-white/70" />
              </div>

              {reading ? (
                <div className="space-y-2 text-sm">
                  <p className="text-muted-foreground">
                    Read <span className="font-mono">{reading}</span>, which does not look like an
                    IMEI. Use it anyway, or move the label and try again.
                  </p>
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      onScan(reading, false)
                      setOpen(false)
                    }}
                  >
                    Use {reading}
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Hold the barcode inside the frame. Good light helps more than getting close.
                </p>
              )}
            </div>
          )}

          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
            <X className="size-4" /> Close
          </Button>
        </DialogContent>
      </Dialog>
    </>
  )
}
