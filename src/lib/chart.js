// Dual-axis multi-line SVG chart, lifted from the Spokane MREvent reference
// (cearra.html / kolby.html). lb series on left, % series on right.
// End-of-line value labels in series color with collision avoidance.
// Auto-snap-to-nice axis values (50s/25s for lb, 5s for %).

const NS = 'http://www.w3.org/2000/svg';

// Synthesize a realistic-looking before-to-after curve when no granular
// data points exist. Cubic ease-out shape for weight + body-fat (fast
// initial crash then plateau); near-flat with tiny jitter for lean mass.
// Deterministic noise — same transformation always renders the same curve.
function synthCurve(startDate, endDate, startVal, endVal, shape, noise, steps = 22) {
  const out = [];
  const t0 = new Date(startDate + 'T00:00:00').getTime();
  const t1 = new Date(endDate + 'T00:00:00').getTime();
  if (!isFinite(t0) || !isFinite(t1) || t1 <= t0) {
    return [[startDate, startVal], [endDate, endVal]];
  }
  const span = t1 - t0;
  for (let i = 0; i <= steps; i++) {
    const p = i / steps;
    const curve = shape === 'eased' ? 1 - Math.pow(1 - p, 3) : p;
    let val = startVal + (endVal - startVal) * curve;
    if (i > 0 && i < steps) {
      const seed = Math.sin((i + 1) * 12.9898 + startVal * 0.31) * 43758.5453;
      const rnd = seed - Math.floor(seed);
      val += (rnd - 0.5) * 2 * noise;
    }
    const date = new Date(t0 + span * p).toISOString().slice(0, 10);
    out.push([date, Math.round(val * 10) / 10]);
  }
  return out;
}

/**
 * Build the per-metric series + isEstimated flag for a transformation.
 * Used by /t/ (deep-dive page) and /event/ (audience-hub popup) so
 * both render the same chart shape from the same data.
 *
 * Returns { byMetric: { weight, bf, lean }, isEstimated }.
 * Each metric array is [[date, value], ...] or [] if not enough data.
 */
export function buildMetricSeries(transformation, points) {
  const byMetric = { weight: [], bf: [], lean: [] };
  (points || []).forEach((p) => {
    if (byMetric[p.metric]) byMetric[p.metric].push([p.date, Number(p.value)]);
  });
  const totalRealPoints = (points || []).length;
  const t = transformation;
  const haveBeforeAfterDates = !!(t.before_date && t.after_date);
  const isEstimated = totalRealPoints === 0 && haveBeforeAfterDates;
  if (isEstimated) {
    if (t.before_weight != null && t.after_weight != null) {
      byMetric.weight = synthCurve(t.before_date, t.after_date, Number(t.before_weight), Number(t.after_weight), 'eased', 0.6);
    }
    if (t.before_bf != null && t.after_bf != null) {
      byMetric.bf = synthCurve(t.before_date, t.after_date, Number(t.before_bf), Number(t.after_bf), 'eased', 0.3);
    }
    if (t.before_lean != null && t.after_lean != null) {
      byMetric.lean = synthCurve(t.before_date, t.after_date, Number(t.before_lean), Number(t.after_lean), 'flat', 0.4);
    }
  }
  return { byMetric, isEstimated };
}

/**
 * Series array shape expected by drawMultiChart, built from buildMetricSeries
 * output. Centralizes the color/suffix/axis assignments so /t/ and /event/
 * agree.
 */
export function seriesFromMetrics(byMetric) {
  const out = [];
  if (byMetric.weight.length) out.push({ name: 'Weight',   color: '#f39c12', suffix: ' lb', axis: 'left',  data: byMetric.weight });
  if (byMetric.lean.length)   out.push({ name: 'Lean',     color: '#2ecc71', suffix: ' lb', axis: 'left',  data: byMetric.lean });
  if (byMetric.bf.length)     out.push({ name: 'Body Fat', color: '#e74c3c', suffix: '%',   axis: 'right', data: byMetric.bf });
  return out;
}

function el(name, attrs) {
  const n = document.createElementNS(NS, name);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  return n;
}

/**
 * @param {SVGSVGElement} svg
 * @param {Array<{ name:string, color:string, suffix:string, axis:'left'|'right', data:Array<[string|number, number]> }>} series
 */
export function drawMultiChart(svg, series) {
  const W = svg.clientWidth || 320;
  const H = 300;
  const pad = { top: 22, right: 64, bottom: 30, left: 42 };
  const iw = W - pad.left - pad.right;
  const ih = H - pad.top - pad.bottom;

  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const allTimes = [];
  const lbSeries = [];
  const pctSeries = [];
  series.forEach((s) => {
    const pts = s.data.map((d) => ({ t: new Date(d[0]).getTime(), v: d[1] }));
    pts.forEach((p) => allTimes.push(p.t));
    const entry = {
      name: s.name, color: s.color, suffix: s.suffix,
      pts, first: pts[0], last: pts[pts.length - 1],
    };
    (s.axis === 'right' ? pctSeries : lbSeries).push(entry);
  });

  const tMin = Math.min.apply(null, allTimes);
  const tMax = Math.max.apply(null, allTimes);

  const lbVals = [];
  lbSeries.forEach((s) => s.pts.forEach((p) => lbVals.push(p.v)));
  const rawLbMin = Math.min.apply(null, lbVals);
  const rawLbMax = Math.max.apply(null, lbVals);
  const lbStep = (rawLbMax - rawLbMin) > 120 ? 50 : 25;
  const lbMin = Math.floor(rawLbMin / lbStep) * lbStep;
  const lbMax = Math.ceil(rawLbMax / lbStep) * lbStep;
  const lbTicks = (lbMax - lbMin) / lbStep;

  const pctVals = [];
  pctSeries.forEach((s) => s.pts.forEach((p) => pctVals.push(p.v)));
  const pctMin = pctVals.length ? Math.floor(Math.min.apply(null, pctVals) / 5) * 5 : 0;
  const pctMax = pctVals.length ? Math.ceil(Math.max.apply(null, pctVals) / 5) * 5 : 100;

  const x = (t) => pad.left + ((t - tMin) / (tMax - tMin)) * iw;
  const yL = (v) => pad.top + (1 - (v - lbMin) / (lbMax - lbMin)) * ih;
  const yR = (v) => pad.top + (1 - (v - pctMin) / (pctMax - pctMin)) * ih;

  for (let i = 0; i <= lbTicks; i++) {
    const f = i / lbTicks;
    const gy = pad.top + (1 - f) * ih;
    svg.appendChild(el('line', {
      x1: pad.left, x2: W - pad.right, y1: gy, y2: gy,
      stroke: 'rgba(255,255,255,0.07)', 'stroke-width': '1',
    }));
    svg.appendChild(el('text', {
      x: pad.left - 6, y: gy + 3,
      fill: 'rgba(255,255,255,0.45)',
      'font-size': '10', 'text-anchor': 'end',
    })).textContent = String(Math.round(lbMin + (lbMax - lbMin) * f));
    if (pctSeries.length) {
      svg.appendChild(el('text', {
        x: W - 4, y: gy + 3,
        fill: 'rgba(255,255,255,0.40)',
        'font-size': '10', 'text-anchor': 'end',
      })).textContent = Math.round(pctMin + (pctMax - pctMin) * f) + '%';
    }
  }

  svg.appendChild(el('text', {
    x: pad.left - 6, y: pad.top - 6,
    fill: 'rgba(255,255,255,0.55)',
    'font-size': '10', 'font-weight': '600', 'text-anchor': 'end',
  })).textContent = 'lb';
  if (pctSeries.length) {
    svg.appendChild(el('text', {
      x: W - 4, y: pad.top - 6,
      fill: 'rgba(255,255,255,0.55)',
      'font-size': '10', 'font-weight': '600', 'text-anchor': 'end',
    })).textContent = 'BF%';
  }

  const d0 = new Date(tMin);
  const d1 = new Date(tMax);
  const fmtDate = (d) => (d.getMonth() + 1) + '/' + String(d.getFullYear()).slice(2);
  svg.appendChild(el('text', {
    x: pad.left, y: H - 10,
    fill: 'rgba(255,255,255,0.4)',
    'font-size': '11', 'text-anchor': 'start',
  })).textContent = fmtDate(d0);
  svg.appendChild(el('text', {
    x: W - pad.right, y: H - 10,
    fill: 'rgba(255,255,255,0.4)',
    'font-size': '11', 'text-anchor': 'end',
  })).textContent = fmtDate(d1);

  const endLabels = [];
  function drawSeries(s, yFn) {
    const lineD = s.pts.map((p, i) =>
      (i === 0 ? 'M ' : 'L ') + x(p.t) + ' ' + yFn(p.v)
    ).join(' ');
    svg.appendChild(el('path', {
      d: lineD, fill: 'none', stroke: s.color,
      'stroke-width': '2.6',
      'stroke-linecap': 'round', 'stroke-linejoin': 'round',
      opacity: '0.95',
    }));
    s.pts.forEach((p) => {
      svg.appendChild(el('circle', {
        cx: x(p.t), cy: yFn(p.v), r: 1.8,
        fill: s.color, opacity: '0.85',
      }));
    });
    svg.appendChild(el('circle', {
      cx: x(s.last.t), cy: yFn(s.last.v), r: 4.5,
      fill: s.color, stroke: '#1a252f', 'stroke-width': '2',
    }));
    const displayVal = (s.last.v === Math.floor(s.last.v)) ? s.last.v : s.last.v.toFixed(1);
    endLabels.push({
      x: x(s.last.t) + 6,
      y: yFn(s.last.v) + 4,
      color: s.color,
      text: displayVal + s.suffix,
    });
  }

  lbSeries.forEach((s) => drawSeries(s, yL));
  pctSeries.forEach((s) => drawSeries(s, yR));

  endLabels.sort((a, b) => a.y - b.y);
  const minGap = 14;
  for (let k = 1; k < endLabels.length; k++) {
    if (endLabels[k].y - endLabels[k - 1].y < minGap) {
      endLabels[k].y = endLabels[k - 1].y + minGap;
    }
  }
  const bottomLimit = pad.top + ih + 4;
  const overflow = endLabels.length ? endLabels[endLabels.length - 1].y - bottomLimit : 0;
  if (overflow > 0) {
    endLabels.forEach((lbl) => { lbl.y -= overflow; });
  }

  endLabels.forEach((lbl) => {
    svg.appendChild(el('text', {
      x: lbl.x, y: lbl.y,
      fill: lbl.color, 'font-size': '11', 'font-weight': '700',
      'text-anchor': 'start',
    })).textContent = lbl.text;
  });
}
