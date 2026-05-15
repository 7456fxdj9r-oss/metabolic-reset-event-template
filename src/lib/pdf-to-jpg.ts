// Convert a PDF File / Blob into a JPG Blob by rasterizing the first
// page. Used by the sub-slide upload flow so the deck (and every other
// consumer) can render the slide as a normal <img> — PDF embedding
// across projector laptops / mobile browsers is too unreliable.
//
// pdfjs-dist is heavy (~1MB minified). It's dynamic-imported on first
// use so it stays out of the bundle for the 99% of edit sessions that
// never touch a PDF. The worker is also lazy-loaded by pdfjs itself.

// deno-lint-ignore no-explicit-any
let pdfjsLib: any = null;

async function loadPdfjs(): Promise<typeof pdfjsLib> {
  if (pdfjsLib) return pdfjsLib;
  // Dynamic import: Astro/Vite code-splits this into its own chunk.
  const mod = await import('pdfjs-dist');
  // pdfjs-dist ships its worker as a separate module. The Vite-friendly
  // way to point at it is to import the worker URL — `?url` suffix
  // gives back a fingerprinted path the bundler can serve.
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.mjs?url')).default;
  mod.GlobalWorkerOptions.workerSrc = workerUrl;
  pdfjsLib = mod;
  return mod;
}

// Render page 1 at `targetWidth` (preserving aspect), then encode as a
// JPG Blob at `quality` (0–1). Caller can throw if the file isn't a
// PDF, or it returns a JPG ready to upload.
export async function pdfToJpg(
  file: File | Blob,
  targetWidth = 1600,
  quality = 0.85,
): Promise<Blob> {
  const pdfjs = await loadPdfjs();
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buffer }).promise;
  if (pdf.numPages < 1) throw new Error('PDF has no pages');
  const page = await pdf.getPage(1);
  // PDF.js sizes pages in 72-DPI "viewport points"; scale to hit the
  // pixel width we want.
  const viewport = page.getViewport({ scale: 1 });
  const scale = targetWidth / viewport.width;
  const scaled = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(scaled.width);
  canvas.height = Math.floor(scaled.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');
  // White background — PDFs are normally light-themed and our deck
  // bg is dark; a transparent canvas would leak the dark background
  // through any unfilled areas.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: scaled }).promise;
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('PDF render failed'))),
      'image/jpeg',
      quality,
    );
  });
}
