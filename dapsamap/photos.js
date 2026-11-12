// 사진 읽기 — EXIF(촬영 시각·GPS·방향) 읽기, 미리보기 이미지 만들기, 답사지 자동 묶기.
// 사진 원본은 저장하지 않는다. 긴 변 1600px 미리보기만 저장한다(한 장 약 200–300KB).

const Geo = {
  // 두 좌표 사이 거리(m)
  dist([lng1, lat1], [lng2, lat2]) {
    const R = 6371000, toR = Math.PI / 180;
    const dLat = (lat2 - lat1) * toR, dLng = (lng2 - lng1) * toR;
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toR) * Math.cos(lat2 * toR) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(a));
  },
  // 원점 기준 평면 좌표(m)
  local([lng, lat], [lng0, lat0]) {
    const k = 111320;
    return [(lng - lng0) * k * Math.cos(lat0 * Math.PI / 180), (lat - lat0) * 110540];
  },
  // a → b 방위각(도, 북=0, 시계방향)
  bearing(a, b) {
    const [x, y] = Geo.local(b, a);
    return (Math.atan2(x, y) * 180 / Math.PI + 360) % 360;
  },
  // 폴리곤 외곽 링들(GeoJSON Polygon/MultiPolygon) → [[lng,lat],...] 배열들
  rings(geom) {
    if (!geom) return [];
    if (geom.type === 'Polygon') return [geom.coordinates[0]];
    if (geom.type === 'MultiPolygon') return geom.coordinates.map(p => p[0]);
    return [];
  },
  centroid(geom, fallback) {
    const pts = Geo.rings(geom).flat();
    if (!pts.length) return fallback;
    const s = pts.reduce((a, p) => [a[0] + p[0], a[1] + p[1]], [0, 0]);
    return [s[0] / pts.length, s[1] / pts.length];
  },
  // 점에서 건물(윤곽 또는 점)까지 거리(m). 건물 안이면 0.
  distToBuilding(pt, b) {
    const rings = Geo.rings(b.footprint);
    if (!rings.length) return Geo.dist(pt, b.point);
    let best = Infinity;
    for (const ring of rings) {
      const P = ring.map(c => Geo.local(c, pt));
      let inside = false;
      for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
        const [xi, yi] = P[i], [xj, yj] = P[j];
        if ((yi > 0) !== (yj > 0) && 0 < (xj - xi) * (0 - yi) / (yj - yi) + xi) inside = !inside;
        const dx = xj - xi, dy = yj - yi, L2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, -(xi * dx + yi * dy) / L2));
        best = Math.min(best, Math.hypot(xi + t * dx, yi + t * dy));
      }
      if (inside) return 0;
    }
    return best;
  }
};

const Photos = (() => {
  let heicReady = null;
  function loadHeic() {
    if (window.heic2any) return Promise.resolve();
    if (heicReady) return heicReady;
    heicReady = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'vendor/heic2any.min.js';
      s.onload = res; s.onerror = () => rej(new Error('HEIC 변환기를 불러오지 못했습니다'));
      document.head.appendChild(s);
    });
    return heicReady;
  }

  const isHeic = f => /\.(heic|heif)$/i.test(f.name) || /heic|heif/i.test(f.type);
  const pad = n => String(n).padStart(2, '0');
  const localIso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

  async function readMeta(file) {
    let m = null;
    try {
      m = await exifr.parse(file, { tiff: true, exif: true, gps: true, ifd0: true, xmp: false, icc: false, iptc: false });
    } catch (e) { console.warn('EXIF 읽기 실패', file.name, e); }
    const taken = m?.DateTimeOriginal || m?.CreateDate || m?.ModifyDate;
    const takenAt = taken instanceof Date && !isNaN(taken) ? localIso(taken) : localIso(new Date(file.lastModified));
    const hasGps = Number.isFinite(m?.latitude) && Number.isFinite(m?.longitude) && !(m.latitude === 0 && m.longitude === 0);
    const heading = Number.isFinite(m?.GPSImgDirection) ? Math.round(m.GPSImgDirection) % 360 : null;
    return {
      takenAt,
      takenFromExif: !!taken,
      gps: hasGps ? [+m.longitude.toFixed(7), +m.latitude.toFixed(7)] : null,
      heading,
      altitude: Number.isFinite(m?.GPSAltitude) ? +m.GPSAltitude.toFixed(1) : null,
      camera: [m?.Make, m?.Model].filter(Boolean).join(' ') || null,
      lens: m?.LensModel || null
    };
  }

  async function decode(file) {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch (e) {
      if (!isHeic(file)) {
        // 일부 브라우저는 옵션을 모른다
        return await createImageBitmap(file);
      }
      await loadHeic();
      const out = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
      return await createImageBitmap(Array.isArray(out) ? out[0] : out);
    }
  }

  async function makeThumb(file, maxSide = 1600) {
    const bmp = await decode(file);
    const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * s), h = Math.round(bmp.height * s);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(bmp, 0, 0, w, h);
    bmp.close?.();
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.82));
    return { blob, width: w, height: h };
  }

  // 시간순으로 훑으며, 시간 간격이 gapMin분보다 크거나 600m 넘게 떨어지면 새 묶음
  function cluster(photos, gapMin) {
    const sorted = [...photos].sort((a, b) => a.takenAt.localeCompare(b.takenAt));
    const groups = [];
    let cur = null, lastT = null, lastGps = null;
    for (const p of sorted) {
      const t = new Date(p.takenAt).getTime();
      const far = p.gps && lastGps && Geo.dist(p.gps, lastGps) > 600;
      if (!cur || t - lastT > gapMin * 60000 || far) { cur = []; groups.push(cur); }
      cur.push(p);
      lastT = t;
      if (p.gps) lastGps = p.gps;
    }
    return groups;
  }

  function center(list) {
    const g = list.filter(p => p.gps);
    if (!g.length) return null;
    const s = g.reduce((a, p) => [a[0] + p.gps[0], a[1] + p.gps[1]], [0, 0]);
    return [+(s[0] / g.length).toFixed(7), +(s[1] / g.length).toFixed(7)];
  }

  return { isHeic, readMeta, makeThumb, cluster, center };
})();
