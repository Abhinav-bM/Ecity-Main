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
  continuous = false,
  alreadyHave,
  remaining,
}: {
  /** Called with what was read. `confident` is false for a doubtful scan. */
  onScan: (value: string, confident: boolean) => void
  label?: string
  disabled?: boolean
  /**
   * Stay open and keep reading. For booking in a delivery: twenty handsets
   * should be one camera session, not twenty open-scan-close cycles.
   */
  continuous?: boolean
  /** Codes already captured, so a second look at the same box is ignored. */
  alreadyHave?: string[]
  /** How many are still wanted, shown as a running count. */
  remaining?: number
}) {
  const [supported, setSupported] = useState(false)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reading, setReading] = useState<string | null>(null)
  const [captured, setCaptured] = useState<string[]>([])
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const frameRef = useRef<number>(0)

  /*
   * The callback lives in a ref, not in the effect's dependencies.
   *
   * Every caller passes an inline arrow, so `onScan` is a new function on
   * each parent render. As a dependency that tears the camera down and opens
   * it again mid-scan — a flicker at best, a missed read at worst.
   */
  const onScanRef = useRef(onScan)
  onScanRef.current = onScan

  const seenRef = useRef<Set<string>>(new Set())
  seenRef.current = new Set([...(alreadyHave ?? []), ...captured])

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
    setCaptured([])

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
            // Skip anything already captured: a barcode stays in frame for
            // several frames, and the same box read twice is not two handsets.
            const hit = found.find(
              (b) => b.rawValue.trim() && !seenRef.current.has(b.rawValue.trim()),
            )
            if (hit) {
              const value = hit.rawValue.trim()
              const confident = looksLikeImei(value)

              if (confident) {
                onScanRef.current(value, true)
                if (continuous) {
                  /*
                   * Stay open and keep going. Booking in a delivery is the
                   * case this exists for: closing after each handset would
                   * mean twenty open-scan-close cycles for one box of stock.
                   */
                  setCaptured((prev) => [...prev, value])
                  setReading(null)
                } else {
                  /*
                   * A good read closes straight away — the next thing wanted
                   * is the item on the bill, not to dismiss a dialog.
                   */
                  setOpen(false)
                  return
                }
              } else {
                // Doubtful: stop and show what was read rather than acting on
                // it. The serial barcode beside the IMEI is why.
                setReading(value)
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
  }, [open, continuous, stop])

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
                      onScanRef.current(reading, false)
                      if (continuous) {
                        setCaptured((prev) => [...prev, reading])
                        setReading(null)
                      } else {
                        setOpen(false)
                      }
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

              {/*
                A running count, so the person knows where they are without
                putting the phone down to look at the form behind the camera.
              */}
              {continuous ? (
                <div className="space-y-1" data-testid="scan-progress">
                  <p className="text-sm font-medium">
                    {captured.length} scanned
                    {remaining !== undefined ? ` of ${remaining + captured.length}` : ''}
                  </p>
                  {captured.length > 0 ? (
                    <p className="font-mono text-xs text-muted-foreground">
                      {captured.slice(-3).join(' · ')}
                    </p>
                  ) : null}
                  {remaining !== undefined && remaining <= 0 ? (
                    <p className="text-xs text-muted-foreground">
                      That is all of them. Close when you are ready.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          )}

          <Button
            type="button"
            variant={continuous && captured.length > 0 ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setOpen(false)}
          >
            <X className="size-4" />
            {continuous && captured.length > 0 ? `Done — ${captured.length} scanned` : 'Close'}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  )
}
