// <aq-globe> — revolving dot-matrix globe (real Natural Earth geometry).
// White sphere, dark land dots, UAE flag pinned at Dubai, great-circle routes
// firing one at a time. Canvas-drawn; pauses off-screen and under reduced motion.
(function () {
  const HOME = [55.2708, 25.2048]; // Dubai
  const DESTS = [
    [46.6753, 24.7136],   // Riyadh
    [31.2357, 30.0444],   // Cairo
    [-7.5898, 33.5731],   // Casablanca
    [36.8219, -1.2921],   // Nairobi
    [3.3792, 6.5244],     // Lagos
    [67.0011, 24.8607],   // Karachi
    [103.8198, 1.3521],   // Singapore
    [9.1900, 45.4642],    // Milan
    [-0.1276, 51.5072]    // London
  ];

  const waitFor = test => new Promise(res => {
    const tick = () => (test() ? res() : setTimeout(tick, 60));
    tick();
  });

  class AqGlobe extends HTMLElement {
    connectedCallback() {
      if (this.canvas) return;
      this.style.cssText = 'display:block;position:relative;width:100%;height:100%';
      this.canvas = document.createElement('canvas');
      this.canvas.style.cssText = 'display:block;width:100%;height:100%';
      this.appendChild(this.canvas);
      this.lambda = -20;
      this.t0 = performance.now();
      this.last = this.t0;
      // Lazy: the globe only boots once its section is near the viewport.
      if ('IntersectionObserver' in window) {
        this.io = new IntersectionObserver((es) => {
          if (!es.some((e) => e.isIntersecting)) return;
          // Before first layout the element can report a zero-sized rect at the
          // top of the document and appear to intersect; confirm against a real
          // measured box so the heavy build only starts when genuinely near.
          const r = this.getBoundingClientRect();
          const vh = window.innerHeight || 1;
          if (!r.height || r.top > vh + 300 || r.bottom < -300) return;
          this.io.disconnect();
          this.io = null;
          this.boot();
        }, { rootMargin: '300px 0px' });
        this.io.observe(this);
      } else {
        this.boot();
      }
    }

    disconnectedCallback() {
      if (this.raf) cancelAnimationFrame(this.raf);
      if (this._onWinResize) {
        window.removeEventListener('resize', this._onWinResize);
        window.removeEventListener('orientationchange', this._onWinResize);
      }
      if (this.io) this.io.disconnect();
    }

    async boot() {
      await waitFor(() => window.d3 && window.__AQ_GLOBE_DOT_DELTAS);
      const d3 = window.d3;
      // Rebuild the lattice (trivial arithmetic) and select the land points from
      // the precomputed index list, so coordinates are bit-identical to the
      // original scan. That scan tested every lattice point with d3.geoContains
      // against all 177 countries — 19.6s of synchronous work measured
      // end-to-end in Node — and blocked the page before the globe ever drew.
      const STEP = 2.1;
      const lattice = [];
      for (let lat = -84; lat <= 84; lat += STEP) {
        const k = Math.max(0.12, Math.cos((lat * Math.PI) / 180));
        const lonStep = STEP / k;
        for (let lon = -180; lon < 180; lon += lonStep) lattice.push([lon, lat]);
      }
      const deltas = window.__AQ_GLOBE_DOT_DELTAS;
      const dots = new Array(deltas.length);
      for (let n = 0, at = -1; n < deltas.length; n++) {
        at += deltas[n];
        dots[n] = lattice[at];
      }
      this.dots = dots;

      this.proj = d3.geoOrthographic().rotate([-this.lambda, -16]);
      this.path = d3.geoPath(this.proj, this.canvas.getContext('2d'));
      this.routes = DESTS.map(d => ({ interp: d3.geoInterpolate(HOME, d), dest: d }));

      this.ready = true;
      this.resize();
      // Deliberately NOT a ResizeObserver on this element: sizing the canvas
      // re-triggered the observer in an unbounded loop that locked up the
      // renderer (verified by A/B — disabling the observer restored it). The
      // globe is sized by the viewport, so window resize is the real signal.
      this._onWinResize = () => {
        if (this._roQueued) return;
        this._roQueued = true;
        requestAnimationFrame(() => { this._roQueued = false; this.resize(); });
      };
      window.addEventListener('resize', this._onWinResize, { passive: true });
      window.addEventListener('orientationchange', this._onWinResize, { passive: true });
      const loop = () => { this.raf = requestAnimationFrame(loop); this.frame(); };
      this.raf = requestAnimationFrame(loop);
    }

    resize() {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const r = this.getBoundingClientRect();
      if (!r.width || !r.height) return;
      // Writing canvas.width/height feeds back into the ResizeObserver that
      // called us; without this guard the observer re-fired continuously and
      // each pass redrew 2,681 dots, which locked up the renderer. Bail out
      // when the measured box has not actually changed.
      const rw = Math.round(r.width), rh = Math.round(r.height);
      if (rw === this._rw && rh === this._rh && dpr === this._dpr) return;
      this._rw = rw; this._rh = rh; this._dpr = dpr;
      this.w = r.width; this.h = r.height;
      this.canvas.width = Math.round(r.width * dpr);
      this.canvas.height = Math.round(r.height * dpr);
      const ctx = this.canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.R = Math.min(this.w, this.h) / 2 - 2;
      this.proj.translate([this.w / 2, this.h / 2]).scale(this.R);
      if (this.ready) this.draw((performance.now() - this.t0) / 1000, false);
    }

    visible(pt) {
      const rot = this.proj.rotate();
      return window.d3.geoDistance(pt, [-rot[0], -rot[1]]) < Math.PI / 2 - 0.02;
    }

    frame() {
      if (!this.proj) return;
      const box = this.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const now = performance.now();
      const dt = Math.min(0.05, (now - this.last) / 1000);
      this.last = now;
      if (box.bottom < -80 || box.top > vh + 80) return;
      const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const t = (now - this.t0) / 1000;
      this.lambda = still ? 94 : 94 + 22 * Math.sin(t * 0.14);
      this.proj.rotate([-this.lambda, -16]);
      this.draw(t, still);
    }

    draw(t, still) {
      if (!isFinite(this.R) || this.R <= 0) return; // zero-sized canvas
      const d3 = window.d3;
      const ctx = this.canvas.getContext('2d');
      const path = this.path;
      const cx = this.w / 2, cy = this.h / 2, R = this.R;
      ctx.clearRect(0, 0, this.w, this.h);

      // sphere: bright white body with a soft rim glow
      ctx.save();
      ctx.shadowColor = 'rgba(255,255,255,.45)';
      ctx.shadowBlur = R * 0.28;
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2);
      const body = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.3, R * 0.1, cx, cy, R);
      body.addColorStop(0, '#ffffff');
      body.addColorStop(0.62, '#f4f3f0');
      body.addColorStop(1, '#d9d7d1');
      ctx.fillStyle = body; ctx.fill();
      ctx.restore();

      // land as a dot matrix (cached; the lattice only needs refreshing
      // every few frames, the routes are drawn live on top)
      this.dotTick = (this.dotTick || 0) + 1;
      if (!this.dotLayer || this.dotTick % 3 === 1) this.paintDots();
      if (this.dotLayer) ctx.drawImage(this.dotLayer, 0, 0, this.w, this.h);

      this.drawRoutes(ctx, path, t, still);
    }

    paintDots() {
      const d3 = window.d3;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (!this.dotLayer) this.dotLayer = document.createElement('canvas');
      const lc = this.dotLayer;
      if (lc.width !== this.canvas.width || lc.height !== this.canvas.height) {
        lc.width = this.canvas.width; lc.height = this.canvas.height;
      }
      const ctx = lc.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, this.w, this.h);
      const R = this.R;
      const rot = this.proj.rotate();
      const centre = [-rot[0], -rot[1]];
      for (let i = 0; i < this.dots.length; i++) {
        const p = this.dots[i];
        const gd = d3.geoDistance(p, centre);
        if (gd > Math.PI / 2 - 0.03) continue;
        const q = this.proj(p);
        if (!q) continue;
        const k = Math.cos(gd);
        ctx.globalAlpha = 0.2 + 0.72 * k;
        ctx.fillStyle = '#0a0b0d';
        const s = Math.max(0.9, R * 0.0075 * (0.45 + 0.55 * k));
        ctx.fillRect(q[0] - s / 2, q[1] - s / 2, s, s);
      }
      ctx.globalAlpha = 1;
    }

    drawRoutes(ctx, path, t, still) {
      const R = this.R;
      // routes, one at a time; finished legs linger
      const LEG = 1.9, HOLD = 0.5, STEP = LEG + HOLD;
      const cycle = this.routes.length * STEP + 1.6;
      const tc = t % cycle;
      const active = Math.floor(tc / STEP);
      const localP = Math.min(1, (tc - active * STEP) / LEG);

      const leg = (r, grow, alpha, width) => {
        const N = 56, coords = [];
        for (let i = 0; i <= N; i++) coords.push(r.interp((i / N) * grow));
        ctx.beginPath(); path({ type: 'LineString', coordinates: coords });
        ctx.lineWidth = width;
        ctx.strokeStyle = 'rgba(10,11,13,' + alpha.toFixed(3) + ')';
        ctx.stroke();
      };
      const dot = (pt, radius, fill, ring) => {
        if (!this.visible(pt)) return;
        const q = this.proj(pt);
        ctx.beginPath(); ctx.arc(q[0], q[1], radius, 0, Math.PI * 2);
        ctx.fillStyle = fill; ctx.fill();
        if (ring) { ctx.lineWidth = 1.2; ctx.strokeStyle = ring; ctx.stroke(); }
      };

      this.routes.forEach((r, i) => {
        if (still) { leg(r, 1, 0.5, 1.2); dot(r.dest, 3, '#ffd200', '#0a0b0d'); return; }
        if (i < active) { leg(r, 1, 0.26, 1); dot(r.dest, 2.6, 'rgba(255,210,0,.85)', 'rgba(10,11,13,.7)'); }
        else if (i === active) {
          const g = Math.max(0.012, localP);
          leg(r, g, 0.62, 1.5);
          dot(r.interp(g), 3.6, '#ffd200', '#0a0b0d');
        }
      });

      // Dubai: pulsing origin + UAE flag pin
      if (this.visible(HOME)) {
        const q = this.proj(HOME);
        const pulse = 1 + 0.3 * Math.sin(t * 2.3);
        ctx.beginPath(); ctx.arc(q[0], q[1], 10 * pulse, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,210,0,.28)'; ctx.fill();
        ctx.beginPath(); ctx.arc(q[0], q[1], 4, 0, Math.PI * 2);
        ctx.fillStyle = '#ffd200'; ctx.fill();
        ctx.lineWidth = 1.4; ctx.strokeStyle = '#0a0b0d'; ctx.stroke();

        const fw = Math.max(26, R * 0.075), fh = fw * 0.66;
        const flip = q[0] + 12 + fw + 20 > this.w;
        const fx = flip ? q[0] - 12 - fw : q[0] + 12;
        const fy = q[1] - fh - 12;
        ctx.fillStyle = '#00732f'; ctx.fillRect(fx, fy, fw, fh / 3 + 0.4);
        ctx.fillStyle = '#f7f6f3'; ctx.fillRect(fx, fy + fh / 3, fw, fh / 3 + 0.4);
        ctx.fillStyle = '#0a0b0d'; ctx.fillRect(fx, fy + (fh * 2) / 3, fw, fh / 3);
        ctx.fillStyle = '#c8102e'; ctx.fillRect(fx, fy, fw * 0.3, fh);
        ctx.lineWidth = 1; ctx.strokeStyle = '#0a0b0d'; ctx.strokeRect(fx, fy, fw, fh);
        ctx.font = '600 10.5px ui-monospace, "JetBrains Mono", monospace';
        ctx.fillStyle = '#0a0b0d';
        ctx.fillText('DUBAI', fx, fy - 7);
      }
    }
  }

  if (!window.customElements.get('aq-globe')) window.customElements.define('aq-globe', AqGlobe);
})();
