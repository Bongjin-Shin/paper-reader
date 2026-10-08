// Backing-store limits only; PDF/CSS coordinates and text stay at the requested zoom.
export const MAX_CANVAS_PIXELS = 16 * 1024 * 1024;
export function canvasSize(width: number, height: number, dpr: number) {
  const ratio = Math.min(dpr || 1, 2, Math.sqrt(MAX_CANVAS_PIXELS / (width * height)), 8192 / width, 8192 / height);
  return { ratio, width: Math.max(1, Math.floor(width * ratio)), height: Math.max(1, Math.floor(height * ratio)) };
}

type Job = { run: () => Promise<void>; priority: () => number; reject: (error: unknown) => void; started: boolean; cancelled: boolean };
export class RenderQueue {
  private waiting: Job[] = [];
  private running = 0;
  private scheduled = false;
  constructor(private readonly concurrency = 2, private readonly schedule: (run: () => void) => void = queueMicrotask) {}
  enqueue(run: () => Promise<void>, priority: () => number = () => 0) {
    let job: Job;
    const promise = new Promise<void>((resolve, reject) => {
      job = { run: async () => { await run(); resolve(); }, priority, reject, started: false, cancelled: false };
      this.waiting.push(job);
      this.refresh();
    });
    return { promise, cancel: () => {
      job.cancelled = true;
      if (!job.started) {
        this.waiting = this.waiting.filter(item => item !== job);
        job.reject(new DOMException('Page rendering cancelled', 'AbortError'));
      }
    } };
  }
  refresh() {
    if (this.scheduled) return;
    this.scheduled = true;
    this.schedule(() => { this.scheduled = false; this.pump(); });
  }
  private pump() {
    while (this.running < this.concurrency && this.waiting.length) {
      this.waiting.sort((a, b) => a.priority() - b.priority());
      if (!Number.isFinite(this.waiting[0].priority())) break;
      const job = this.waiting.shift()!;
      if (job.cancelled) continue;
      job.started = true;
      this.running++;
      void job.run().catch(job.reject).finally(() => { this.running--; this.refresh(); });
    }
  }
}

interface CachedPage {
  host: HTMLElement;
  nearby: boolean;
  visible: boolean;
  visibleArea: number;
  bounds?: { top: number; left: number; width: number; height: number };
  resident: boolean;
  ready: boolean;
  pixels: number;
  used: number;
  update: (resident: boolean) => void;
}

/** Shared visibility observers and a bounded set of live Canvas/Text Layers per document. */
export class PageRenderCache {
  // PDF.js draws on the main thread: two canvases in one frame compete with scrolling.
  // Coalesce observer/React notifications until the next frame, then recheck the
  // latest scroll position before allocating a canvas for a page already passed.
  readonly queue = new RenderQueue(1, run => requestAnimationFrame(run));
  private observer: IntersectionObserver | null = null;
  private visibleObserver: IntersectionObserver | null = null;
  private reader: HTMLElement | null = null;
  private scrolling = false;
  private viewportWidth = 0;
  private viewportHeight = 0;
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  private pages = new Map<HTMLElement, CachedPage>();
  private clock = 0;
  // 8 ordinary DPR=2 pages cost about 92 MiB. Visible/selected pages are never evicted.
  constructor(private readonly maxPages = 8, private readonly maxPixels = 24 * 1024 * 1024) {}

  observe(host: HTMLElement, update: CachedPage['update']) {
    if (!this.observer) {
      this.reader = host.closest('.reader');
      this.reader?.addEventListener('scroll', this.onScroll, { passive: true });
      this.reader?.addEventListener('readerzoom', this.onZoom);
      this.visibleObserver = new IntersectionObserver(entries => {
        for (const entry of entries) {
          const page = this.pages.get(entry.target as HTMLElement);
          if (!page) continue;
          if (entry.rootBounds) {
            this.viewportWidth = entry.rootBounds.width;
            this.viewportHeight = entry.rootBounds.height;
            // Document offsets stay stable during scrolling. Observer rectangles can
            // predate a scrollbar jump, so never combine them with a newer scrollTop.
            page.bounds = { top: page.host.offsetTop, left: page.host.offsetLeft,
              width: page.host.offsetWidth, height: page.host.offsetHeight };
          }
          page.visibleArea = entry.intersectionRect.width * entry.intersectionRect.height;
          page.visible = page.visibleArea > 0;
          // Onscreen text must be materialized for native word hit-testing, even
          // when automatic containment is still transitioning after a scroll.
          page.host.dataset.pageVisible = String(page.visible);
          if (page.visible) this.activate(page);
          else if (this.scrolling && !page.ready && !this.selected(page)) this.evict(page);
        }
        this.queue.refresh();
      }, { root: this.reader, threshold: [0, .25, .5, .75, 1] });
      this.observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          const page = this.pages.get(entry.target as HTMLElement);
          if (!page) continue;
          page.nearby = entry.isIntersecting;
          if (page.nearby) {
            if (!this.scrolling || page.visible) this.activate(page);
          } else if (!page.ready && !this.selected(page)) this.evict(page);
        }
        this.trim();
        this.queue.refresh();
      }, { root: this.reader, rootMargin: '900px 0px' });
    }
    this.pages.set(host, { host, update, nearby: false, visible: false, visibleArea: 0, resident: false, ready: false, pixels: 0, used: 0 });
    this.observer.observe(host);
    this.visibleObserver!.observe(host);
    return () => {
      this.observer?.unobserve(host);
      this.visibleObserver?.unobserve(host);
      this.pages.delete(host);
      if (!this.pages.size) {
        this.observer?.disconnect(); this.observer = null;
        this.visibleObserver?.disconnect(); this.visibleObserver = null;
        this.reader?.removeEventListener('scroll', this.onScroll);
        this.reader?.removeEventListener('readerzoom', this.onZoom); this.reader = null;
        clearTimeout(this.settleTimer); this.scrolling = false;
      }
    };
  }

  priority(host: HTMLElement) {
    const page = this.pages.get(host);
    if (!page?.resident) return Infinity;
    const area = this.visibleArea(page);
    if (area > 0) return -area;
    if (this.selected(page)) return 0;
    return page.nearby && !this.scrolling ? 1 : Infinity;
  }

  // PDF.js calls onContinue before each canvas slice. A fling can move past a page
  // between observer delivery and that slice; don't paint it using stale visibility.
  continueRendering(host: HTMLElement) {
    const page = this.pages.get(host);
    if (!page?.resident) return false;
    if (this.scrolling && !this.visibleArea(page) && !this.selected(page)) {
      this.evict(page);
      return false;
    }
    return true;
  }

  private visibleArea(page: CachedPage) {
    const b = page.bounds;
    if (!b) return page.visibleArea;
    const top = this.reader?.scrollTop ?? 0, left = this.reader?.scrollLeft ?? 0;
    return Math.max(0, Math.min(b.top + b.height, top + this.viewportHeight) - Math.max(b.top, top)) *
      Math.max(0, Math.min(b.left + b.width, left + this.viewportWidth) - Math.max(b.left, left));
  }

  // No React update or geometry read for each scroll event. Only prefetch waits for quiet;
  // newly visible pages are scheduled immediately by the viewport observer.
  private onScroll = () => {
    this.scrolling = true;
    clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.scrolling = false;
      for (const page of this.pages.values()) if (page.nearby) this.activate(page);
      this.trim(); this.queue.refresh();
    }, 100);
  };

  private activate(page: CachedPage) {
    page.used = ++this.clock;
    if (!page.resident) { page.resident = true; page.update(true); }
  }

  rendered(host: HTMLElement, pixels: number) {
    const page = this.pages.get(host);
    if (!page?.resident) return;
    page.ready = true;
    page.pixels = pixels;
    this.trim();
  }

  rendering(host: HTMLElement) {
    const page = this.pages.get(host);
    if (page) page.ready = false;
  }

  prepareZoom() {
    for (const page of this.pages.values()) {
      page.bounds = undefined;
      if (!page.nearby && !this.selected(page)) this.evict(page);
      // CSS zoom keeps completed surfaces available until their replacements finish.
    }
  }

  private onZoom = () => {
    // CSS preview changes document offsets without re-rendering React pages.
    this.prepareZoom();
  };

  private selected(page: CachedPage) {
    const selection = window.getSelection();
    // Preserve even a collapsed drag anchor, plus all pages in a multi-page range.
    return !!selection?.rangeCount && selection.getRangeAt(0).intersectsNode(page.host);
  }
  private evict(page: CachedPage) {
    if (!page.resident) return;
    page.resident = false; page.ready = false; page.pixels = 0;
    page.update(false);
  }
  private trim() {
    const resident = [...this.pages.values()].filter(page => page.resident);
    let count = resident.length;
    let pixels = resident.reduce((sum, page) => sum + page.pixels, 0);
    for (const page of resident.sort((a, b) => a.used - b.used)) {
      if (count <= this.maxPages && pixels <= this.maxPixels) break;
      if (page.nearby || this.selected(page)) continue;
      pixels -= page.pixels; count--;
      this.evict(page);
    }
  }
}
