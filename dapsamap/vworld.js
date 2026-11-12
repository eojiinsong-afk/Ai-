// 브이월드 연결 — 배경지도, 좌표→주소, 좌표→건물 윤곽.
// 브라우저에서 바로 부르면 CORS에 막히는 경우가 있어 JSONP(callback)로 부른다.
// 키가 없거나 호출이 실패하면 null을 돌려주고, 앱은 수동 모드로 계속 동작한다.

const VWorld = (() => {
  let seq = 0;

  function jsonp(url, timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
      const name = '__vw_cb_' + (++seq) + '_' + Date.now();
      const s = document.createElement('script');
      const done = (fn, v) => { clearTimeout(timer); delete window[name]; s.remove(); fn(v); };
      const timer = setTimeout(() => done(reject, new Error('브이월드 응답 없음')), timeoutMs);
      window[name] = data => done(resolve, data);
      s.onerror = () => done(reject, new Error('브이월드 요청 실패'));
      s.src = url + (url.includes('?') ? '&' : '?') + 'callback=' + name;
      document.head.appendChild(s);
    });
  }

  const qs = o => Object.entries(o).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');

  function tileLayers(key) {
    const opt = { maxZoom: 19, maxNativeZoom: 19, attribution: '© 브이월드(국토교통부)' };
    return {
      '일반': L.tileLayer(`https://api.vworld.kr/req/wmts/1.0.0/${key}/Base/{z}/{y}/{x}.png`, opt),
      '위성': L.tileLayer(`https://api.vworld.kr/req/wmts/1.0.0/${key}/Satellite/{z}/{y}/{x}.jpeg`, opt),
      '위성+지명': L.layerGroup([
        L.tileLayer(`https://api.vworld.kr/req/wmts/1.0.0/${key}/Satellite/{z}/{y}/{x}.jpeg`, opt),
        L.tileLayer(`https://api.vworld.kr/req/wmts/1.0.0/${key}/Hybrid/{z}/{y}/{x}.png`, opt)
      ])
    };
  }

  // 좌표 → 주소 (도로명 우선, 없으면 지번)
  async function address(key, [lng, lat]) {
    if (!key) return null;
    try {
      const r = await jsonp('https://api.vworld.kr/req/address?' + qs({
        service: 'address', request: 'getAddress', version: '2.0', crs: 'epsg:4326',
        point: `${lng},${lat}`, format: 'json', type: 'both', zipcode: 'false', simple: 'false',
        key, domain: location.origin
      }));
      const res = r?.response?.result;
      if (!res?.length) return null;
      const road = res.find(x => x.type === 'road') || res[0];
      return { text: road.text, structure: road.structure || null };
    } catch (e) { console.warn(e); return null; }
  }

  // 좌표 → 그 자리의 건물 윤곽과 속성
  async function buildingAt(key, layer, [lng, lat]) {
    if (!key) return null;
    try {
      const r = await jsonp('https://api.vworld.kr/req/data?' + qs({
        service: 'data', request: 'GetFeature', data: layer || 'LT_C_SPBD', key, domain: location.origin,
        geomFilter: `POINT(${lng} ${lat})`, size: 10, page: 1, crs: 'EPSG:4326',
        geometry: 'true', attribute: 'true', format: 'json'
      }));
      const feats = r?.response?.result?.featureCollection?.features;
      if (!feats?.length) return { error: r?.response?.error?.text || r?.response?.status || '건물 없음' };
      const f = feats[0];
      const p = f.properties || {};
      const pick = (...ks) => { for (const k of ks) if (p[k] != null && p[k] !== '') return p[k]; return null; };
      return {
        geometry: f.geometry,
        name: pick('buld_nm', 'bld_nm', 'bldg_nm', 'bd_nm'),
        floors: Number(pick('gro_flo_co', 'grnd_flr', 'flr_co')) || null,
        props: p   // 원본 속성은 전부 보관 — 나중에 필요한 값을 다시 꺼낼 수 있게
      };
    } catch (e) { console.warn(e); return { error: e.message }; }
  }

  return { tileLayers, address, buildingAt };
})();
