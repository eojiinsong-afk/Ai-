/* ============================================================
   PPTX 내보내기 — 진짜 .pptx 파일 만들기

   pptx 는 OOXML 문서 몇 개를 담은 ZIP 이다. 외부 라이브러리를 쓸 수 없으므로
   (Artifact 는 외부 스크립트를 불러오지 못한다) 압축 없는 ZIP(store) 을 직접 쓴다.
   압축을 하지 않아도 규격상 완전히 유효하고, 내용의 대부분이 이미 압축된
   JPEG 이라 파일 크기 손해도 거의 없다.

   좌표는 1280×720 픽셀 화면을 설계 단위로 쓰고 EMU 로 환산한다(1px = 9525EMU).
   글자 크기도 같은 기준이라 24px 제목 = 18pt 가 된다.
   ============================================================ */
/* XML 은 제어문자를 담을 수 없다. 붙여넣기로 섞여 들어온 문자 하나가
   파일 전체를 못 열게 만드는 일을 막는다. */
const xt = v => esc(String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''));

const PX = 9525;                 // 1 design px → EMU
const SW = 1280, SH = 720;       // 16:9 설계 캔버스
const emu = v => Math.round(v * PX);
const pt = px => Math.round(px * 75);   // design px → 1/100 pt

/* ---------- ZIP (store, 무압축) ---------- */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function zipStore(files) {
  const enc = new TextEncoder();
  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xFFFF;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xFFFF;
  const local = [], central = [];
  let off = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, 0, true); lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    local.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true);
    ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
    ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
    ch.setUint16(28, name.length, true); ch.setUint16(30, 0, true); ch.setUint16(32, 0, true);
    ch.setUint16(34, 0, true); ch.setUint16(36, 0, true); ch.setUint32(38, 0, true);
    ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), name);
    off += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const eo = new DataView(new ArrayBuffer(22));
  eo.setUint32(0, 0x06054b50, true); eo.setUint16(4, 0, true); eo.setUint16(6, 0, true);
  eo.setUint16(8, files.length, true); eo.setUint16(10, files.length, true);
  eo.setUint32(12, cdSize, true); eo.setUint32(16, off, true); eo.setUint16(20, 0, true);
  return new Blob(local.concat(central, [new Uint8Array(eo.buffer)]), {
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  });
}

/* ---------- 슬라이드 도형 ---------- */
const XMLNS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const FONT = '맑은 고딕';
function runProps(o) {
  const c = (o.color || '14171A').replace('#', '');
  return `<a:rPr lang="ko-KR" altLang="en-US" sz="${pt(o.size || 16)}" b="${o.bold ? 1 : 0}" spc="${o.spc || 0}" dirty="0">` +
    `<a:solidFill><a:srgbClr val="${c}"/></a:solidFill>` +
    `<a:latin typeface="${FONT}"/><a:ea typeface="${FONT}"/><a:cs typeface="${FONT}"/></a:rPr>`;
}
/** 여러 줄 텍스트 상자 */
function tx(id, x, y, w, h, lines, o) {
  o = o || {};
  const ps = (Array.isArray(lines) ? lines : [lines]).map(t => {
    if (t === '') return `<a:p><a:endParaRPr lang="ko-KR" sz="${pt(o.size || 16)}"/></a:p>`;
    return `<a:p><a:pPr algn="${o.align || 'l'}"><a:lnSpc><a:spcPct val="${o.lnSpc || 130000}"/></a:lnSpc></a:pPr>` +
      `<a:r>${runProps(o)}<a:t>${xt(t)}</a:t></a:r></a:p>`;
  }).join('');
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="t${id}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>
<p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="${o.anchor || 't'}"><a:normAutofit/></a:bodyPr><a:lstStyle/>${ps}</p:txBody></p:sp>`;
}
function rect(id, x, y, w, h, color, opts) {
  const o = opts || {};
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="r${id}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
<a:solidFill><a:srgbClr val="${color.replace('#', '')}"${o.alpha ? `><a:alpha val="${o.alpha}"/></a:srgbClr` : ''}/></a:solidFill>
<a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p/></p:txBody></p:sp>`;
}
function pic(id, rid, x, y, w, h) {
  return `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="p${id}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>
<p:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr><a:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(h)}"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}
/** 표. 첫 행을 머리행으로 칠한다. */
function table(id, x, y, w, colW, rows, o) {
  o = o || {};
  const rowH = o.rowH || 26;
  const cell = (t, r, c) => {
    const head = o.head && r === 0;
    const fill = head ? 'E3E9F0' : (r % 2 ? 'FFFFFF' : 'F6F8FA');
    return `<a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="${c > 0 && o.numAlign ? 'r' : 'l'}"/>` +
      `<a:r>${runProps({ size: o.size || 12, bold: head || (o.labelBold && c === 0), color: head ? '14477D' : '333B44' })}<a:t>${xt(t)}</a:t></a:r></a:p></a:txBody>` +
      `<a:tcPr marL="60000" marR="60000" marT="30000" marB="30000" anchor="ctr">` +
      `<a:lnL w="6350"><a:solidFill><a:srgbClr val="D2D7DD"/></a:solidFill></a:lnL>` +
      `<a:lnR w="6350"><a:solidFill><a:srgbClr val="D2D7DD"/></a:solidFill></a:lnR>` +
      `<a:lnT w="6350"><a:solidFill><a:srgbClr val="D2D7DD"/></a:solidFill></a:lnT>` +
      `<a:lnB w="6350"><a:solidFill><a:srgbClr val="D2D7DD"/></a:solidFill></a:lnB>` +
      `<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill></a:tcPr></a:tc>`;
  };
  const trs = rows.map((r, ri) => `<a:tr h="${emu(rowH)}">${r.map((c, ci) => cell(c, ri, ci)).join('')}</a:tr>`).join('');
  return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${id}" name="tbl${id}"/>
<p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>
<p:xfrm><a:off x="${emu(x)}" y="${emu(y)}"/><a:ext cx="${emu(w)}" cy="${emu(rowH * rows.length)}"/></p:xfrm>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
<a:tbl><a:tblPr firstRow="${o.head ? 1 : 0}" bandRow="0"/><a:tblGrid>${colW.map(c => `<a:gridCol w="${emu(c)}"/>`).join('')}</a:tblGrid>
${trs}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
}

/* ---------- 문서 뼈대 ---------- */
const RT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const rels = list => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${list.map(r => `<Relationship Id="${r.id}" Type="${r.type}" Target="${r.target}"/>`).join('')}</Relationships>`;
const THEME = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Archive">
<a:themeElements><a:clrScheme name="Archive"><a:dk1><a:srgbClr val="14171A"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="333B44"/></a:dk2><a:lt2><a:srgbClr val="F1F3F5"/></a:lt2>
<a:accent1><a:srgbClr val="14477D"/></a:accent1><a:accent2><a:srgbClr val="C2472C"/></a:accent2>
<a:accent3><a:srgbClr val="2E7157"/></a:accent3><a:accent4><a:srgbClr val="6D4C86"/></a:accent4>
<a:accent5><a:srgbClr val="1F6E78"/></a:accent5><a:accent6><a:srgbClr val="9C6510"/></a:accent6>
<a:hlink><a:srgbClr val="14477D"/></a:hlink><a:folHlink><a:srgbClr val="6D4C86"/></a:folHlink></a:clrScheme>
<a:fontScheme name="Archive"><a:majorFont><a:latin typeface="${FONT}"/><a:ea typeface="${FONT}"/><a:cs typeface=""/></a:majorFont>
<a:minorFont><a:latin typeface="${FONT}"/><a:ea typeface="${FONT}"/><a:cs typeface=""/></a:minorFont></a:fontScheme>
<a:fmtScheme name="Archive">
<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
</a:fmtScheme></a:themeElements></a:theme>`;
const EMPTY_TREE = `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree>`;
const CLRMAP = 'bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"';
const SLIDE_MASTER = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster ${XMLNS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>${EMPTY_TREE}</p:cSld>
<p:clrMap ${CLRMAP}/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`;
const SLIDE_LAYOUT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout ${XMLNS} type="blank" preserve="1"><p:cSld name="빈 화면">${EMPTY_TREE}</p:cSld><p:clrMapOvr><a:overrideClrMapping ${CLRMAP}/></p:clrMapOvr></p:sldLayout>`;

/**
 * 슬라이드 목록을 실제 pptx Blob 으로 굽는다.
 * @param {Array} slides  [{shapes:'<p:sp>…', images:[{rid,name,data:Uint8Array}]}]
 */
function buildPptx(slides, meta) {
  const files = [];
  const n = slides.length;
  files.push({
    name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="jpeg" ContentType="image/jpeg"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
${slides.map((s, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('')}
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`
  });
  files.push({
    name: '_rels/.rels', data: rels([
      { id: 'rId1', type: RT + '/officeDocument', target: 'ppt/presentation.xml' },
      { id: 'rId2', type: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', target: 'docProps/core.xml' },
      { id: 'rId3', type: RT + '/extended-properties', target: 'docProps/app.xml' }
    ])
  });
  const title = (meta && meta.title) || '시장아파트 답사 보고';
  files.push({
    name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>${xt(title)}</dc:title><dc:creator>시장아파트 답사 아카이브</dc:creator>
<cp:lastModifiedBy>시장아파트 답사 아카이브</cp:lastModifiedBy>
<dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
<dcterms:modified xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:modified></cp:coreProperties>`
  });
  files.push({
    name: 'docProps/app.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
<Application>시장아파트 답사 아카이브</Application><Slides>${n}</Slides><PresentationFormat>와이드스크린</PresentationFormat></Properties>`
  });
  files.push({
    name: 'ppt/presentation.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation ${XMLNS} saveSubsetFonts="1">
<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
<p:sldIdLst>${slides.map((s, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('')}</p:sldIdLst>
<p:sldSz cx="${emu(SW)}" cy="${emu(SH)}"/><p:notesSz cx="${emu(SH)}" cy="${emu(SW)}"/></p:presentation>`
  });
  files.push({
    name: 'ppt/_rels/presentation.xml.rels', data: rels(
      [{ id: 'rId1', type: RT + '/slideMaster', target: 'slideMasters/slideMaster1.xml' }]
        .concat(slides.map((s, i) => ({ id: 'rId' + (i + 2), type: RT + '/slide', target: `slides/slide${i + 1}.xml` })))
        .concat([{ id: 'rId' + (n + 2), type: RT + '/theme', target: 'theme/theme1.xml' }])
    )
  });
  files.push({ name: 'ppt/theme/theme1.xml', data: THEME });
  files.push({ name: 'ppt/slideMasters/slideMaster1.xml', data: SLIDE_MASTER });
  files.push({
    name: 'ppt/slideMasters/_rels/slideMaster1.xml.rels', data: rels([
      { id: 'rId1', type: RT + '/slideLayout', target: '../slideLayouts/slideLayout1.xml' },
      { id: 'rId2', type: RT + '/theme', target: '../theme/theme1.xml' }
    ])
  });
  files.push({ name: 'ppt/slideLayouts/slideLayout1.xml', data: SLIDE_LAYOUT });
  files.push({
    name: 'ppt/slideLayouts/_rels/slideLayout1.xml.rels',
    data: rels([{ id: 'rId1', type: RT + '/slideMaster', target: '../slideMasters/slideMaster1.xml' }])
  });
  slides.forEach((s, i) => {
    files.push({
      name: `ppt/slides/slide${i + 1}.xml`, data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld ${XMLNS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>
<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
${s.shapes}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`
    });
    files.push({
      name: `ppt/slides/_rels/slide${i + 1}.xml.rels`, data: rels(
        [{ id: 'rIdL', type: RT + '/slideLayout', target: '../slideLayouts/slideLayout1.xml' }]
          .concat((s.images || []).map(im => ({ id: im.rid, type: RT + '/image', target: '../media/' + im.name })))
      )
    });
    for (const im of (s.images || [])) files.push({ name: 'ppt/media/' + im.name, data: im.data });
  });
  return zipStore(files);
}
function jpegBytes(dataUrl) {
  const b = atob(dataUrl.split(',')[1]);
  const a = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i);
  return a;
}

/* ============================================================
   발표자료 구성 — 어떤 슬라이드를 넣을지는 연구자가 고른다
   ============================================================ */
const DECK_SECTIONS = [
  { k: 'cover', label: '표지', scope: 'once', on: 1 },
  { k: 'intro', label: '연구 개요', scope: 'once', on: 1 },
  { k: 'distmap', label: '전국 분포 지도', scope: 'once', on: 1 },
  { k: 'selmap', label: '선택한 프로젝트의 위치', scope: 'once', on: 1 },
  { k: 'info', label: '프로젝트 기본 정보', scope: 'each', on: 1 },
  { k: 'photos', label: '시장아파트 사진', scope: 'each', on: 1 },
  { k: 'elev', label: '입면 사진', scope: 'each', on: 1 },
  { k: 'notes', label: '답사 기록', scope: 'each', on: 1 },
  { k: 'arch', label: '건축적 특징', scope: 'each', on: 1 },
  { k: 'urban', label: '도시적 특징', scope: 'each', on: 0 },
  { k: 'transit', label: '주변 교통시설', scope: 'each', on: 1 },
  { k: 'compare', label: '프로젝트 간 비교', scope: 'once', on: 1 },
  { k: 'memo', label: '연구자 분석 메모', scope: 'once', on: 0 },
  { k: 'conclusion', label: '결론 · 연구 가설', scope: 'once', on: 1 }
];
const C = { ink: '14171A', ink2: '333B44', muted: '6A737D', accent: '14477D', signal: 'C2472C', line: 'D2D7DD', soft: 'F1F3F5' };
const M = 64;

/** 슬라이드 한 장을 조립하는 작은 도우미 */
function slideBuilder() {
  const sh = []; const images = []; let id = 10, img = 0;
  return {
    shapes: sh, images,
    head(title, sub) {
      sh.push(rect(id++, M, 56, 40, 4, C.signal));
      sh.push(tx(id++, M, 70, SW - M * 2, 40, title, { size: 27, bold: true, color: C.ink }));
      if (sub) sh.push(tx(id++, M, 108, SW - M * 2, 22, sub, { size: 14, color: C.muted }));
      return this;
    },
    text(x, y, w, h, lines, o) { sh.push(tx(id++, x, y, w, h, lines, o)); return this; },
    rect(x, y, w, h, c, o) { sh.push(rect(id++, x, y, w, h, c, o)); return this; },
    table(x, y, w, colW, rows, o) { sh.push(table(id++, x, y, w, colW, rows, o)); return this; },
    /** dataURL 이미지를 넣고, 지정한 상자 안에 비율을 유지해 맞춘다 */
    image(dataUrl, x, y, w, h, natural) {
      if (!dataUrl) return this;
      const rid = 'rIm' + (++img);
      images.push({ rid, name: `s${images.length}_${Date.now().toString(36)}${img}.jpeg`, data: jpegBytes(dataUrl) });
      let dw = w, dh = h;
      if (natural && natural[0] && natural[1]) {
        const r = Math.min(w / natural[0], h / natural[1]);
        dw = natural[0] * r; dh = natural[1] * r;
      }
      sh.push(pic(id++, rid, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh));
      return this;
    },
    foot(t) { sh.push(tx(id++, M, SH - 42, SW - M * 2, 18, t, { size: 11, color: C.muted })); return this; },
    done() { return { shapes: sh.join('\n'), images }; }
  };
}
function facRows(near) {
  return [
    ['현재 기차역', near.station ? (near.station.f.name || '—') : '등록된 지점 없음', fmtKm(near.station && near.station.d)],
    ['과거 기차역', near.oldstation ? (near.oldstation.f.name || '—') : '등록된 지점 없음', fmtKm(near.oldstation && near.oldstation.d)],
    ['버스터미널', near.terminal ? (near.terminal.f.name || '—') : '등록된 지점 없음', fmtKm(near.terminal && near.terminal.d)],
    ['시장', near.market ? (near.market.f.name || '—') : '등록된 지점 없음', fmtKm(near.market && near.market.d)],
    ['현재 철도 노선', near.rail ? (near.rail.f.name || '—') : '등록된 노선 없음', fmtKm(near.rail && near.rail.d)],
    ['과거 철도 노선', near.oldrail ? (near.oldrail.f.name || '—') : '등록된 노선 없음', fmtKm(near.oldrail && near.oldrail.d)]
  ];
}
function wrapKo(t, per, max) {
  const s = String(t || '').replace(/\s+/g, ' ').trim();
  const out = [];
  for (let i = 0; i < s.length && out.length < max; i += per) out.push(s.slice(i, i + per));
  if (s.length > per * max) out[out.length - 1] = out[out.length - 1].slice(0, per - 1) + '…';
  return out;
}
/** 사진의 원본 dataURL (없으면 썸네일) */
async function photoData(ph) {
  try { const f = await S.store.get('photofull', ph.id); if (f && f.data) return f.data; } catch (e) { }
  return ph.thumb;
}

async function composeDeck(ps, picked) {
  const on = k => picked.includes(k);
  const data = await collect(ps);
  const slides = [];
  const bySido = {}; ps.forEach(p => { const k = p.sido || '미상'; bySido[k] = (bySido[k] || 0) + 1; });
  const big = ['서울특별시', '부산광역시', '대구광역시', '인천광역시', '광주광역시', '대전광역시', '울산광역시'];
  const metro = ps.filter(p => big.includes(p.sido)).length;

  if (on('cover')) {
    const b = slideBuilder();
    b.rect(0, 0, SW, 6, C.signal);
    b.text(M, 250, SW - M * 2, 26, 'MARKET–HOUSING COMPLEX / FIELD SURVEY', { size: 13, color: C.muted, spc: 240 });
    b.text(M, 286, SW - M * 2, 70, '시장아파트 답사 보고', { size: 52, bold: true, color: C.ink });
    b.text(M, 372, SW - M * 2, 26, `${ps.length}개 사례 · ${Object.keys(bySido).length}개 시·도 · ${today()}`, { size: 17, color: C.ink2 });
    b.rect(M, 424, 120, 2, C.line);
    b.text(M, 444, SW - M * 2, 24, '건축학과 논문 연구 — 시장과 주거가 결합된 복합건축물의 입지와 형태', { size: 13, color: C.muted });
    slides.push(b.done());
  }
  if (on('intro')) {
    const b = slideBuilder();
    b.head('연구 개요', '무엇을 왜 기록하는가');
    b.text(M, 168, 620, 220, [
      '시장과 주거가 하나의 건축물로 결합된 시장아파트를 전국 단위로 답사·기록하고,',
      '입지(철도역·버스터미널·시장과의 거리), 도시적 배치, 시장–주거의 결합 방식,',
      '규모, 현재 상태를 같은 기준으로 비교한다.',
      '',
      '특히 서울·부산·대구 같은 대도시 사례에 편중되지 않도록',
      '중소도시와 지방의 사례를 함께 수집하는 것을 연구 방향으로 삼는다.'
    ], { size: 16, color: C.ink2, lnSpc: 165000 });
    b.table(730, 168, 486, [300, 186], [['지역', '사례 수']].concat(
      Object.entries(bySido).sort((a, b2) => b2[1] - a[1]).slice(0, 12).map(r => [r[0], String(r[1])])
    ), { head: true, size: 13, numAlign: true });
    b.foot(`대도시 ${metro}건 · 그 외 지역 ${ps.length - metro}건`);
    slides.push(b.done());
  }
  if (on('distmap')) {
    const b = slideBuilder();
    b.head('전국 분포', '기록된 시장아파트의 위치');
    const url = await mapImage({ all: S.projects, items: [], whole: true, W: 640, H: 470 });
    b.image(url, M, 156, 470, 470, [640, 470]);
    b.text(M + 500, 168, SW - M - (M + 500) + M, 60, `전국 ${S.projects.length}건`, { size: 30, bold: true, color: C.ink });
    b.table(M + 500, 226, 652, [400, 252], [['지역', '사례 수']].concat(
      Object.entries(S.projects.reduce((a, p) => { const k = p.sido || '미상'; a[k] = (a[k] || 0) + 1; return a; }, {}))
        .sort((a, b2) => b2[1] - a[1]).slice(0, 13).map(r => [r[0], String(r[1])])
    ), { head: true, size: 13, numAlign: true, rowH: 24 });
    b.foot('붉은 점 = 기록된 시장아파트. 답사가 진행될수록 분포가 채워진다.');
    slides.push(b.done());
  }
  if (on('selmap')) {
    const b = slideBuilder();
    b.head('선택한 프로젝트의 위치', `${ps.length}개 사례`);
    const url = await mapImage({ all: S.projects, items: ps, labels: true, W: 1100, H: 480 });
    b.image(url, M, 156, SW - M * 2, 480, [1100, 480]);
    b.foot('네모 = 이번 발표에서 다루는 사례 · 옅은 점 = 그 밖에 기록된 사례');
    slides.push(b.done());
  }

  for (const d of data) {
    const p = d.p, near = d.near;
    if (on('info')) {
      const b = slideBuilder();
      b.head(projName(p), [p.sido, p.sgg, p.address].filter(Boolean).join(' '));
      b.table(M, 156, 620, [200, 420], [
        ['항목', '내용'],
        ['시장 / 시장아파트', [p.marketName, p.aptName].filter(Boolean).join(' / ') || '—'],
        ['답사일', p.surveyDate || '—'],
        ['건축연도', p.builtYear == null ? '—' : String(p.builtYear)],
        ['리모델링·증축', p.remodel || '—'],
        ['층 구성', floorText(p)],
        ['주차장', (p.parking ? '있음' : '없음') + (p.parkingType ? ' · ' + p.parkingType : '')],
        ['시장–주거 관계', p.relation || '—'],
        ['현재 상태', p.status || '—'],
        ['좌표', p.lat != null ? p.lat.toFixed(5) + ', ' + p.lng.toFixed(5) : '—']
      ], { head: true, size: 13, labelBold: true, rowH: 30 });
      if (p.lat != null) {
        const url = await mapImage({ items: [p], all: S.projects, W: 520, H: 380 });
        b.image(url, 720, 156, 496, 330, [520, 380]);
        b.text(720, 500, 496, 20, '반경 약 2km 범위 · 사각형이 대상 건물', { size: 11, color: C.muted });
      }
      const custom = S.fields.map(f => [f.label, (p.custom || {})[f.id]]).filter(r => r[1] != null && r[1] !== '');
      if (custom.length) b.text(M, 560, SW - M * 2, 40, custom.map(r => `${r[0]}: ${Array.isArray(r[1]) ? r[1].join(', ') : r[1]}`).join('   ·   '), { size: 12, color: C.ink2 });
      slides.push(b.done());
    }
    if (on('photos')) {
      const ph = d.photos.filter(x => x.kind !== 'elevation').slice(0, 4);
      if (ph.length) {
        const b = slideBuilder();
        b.head(projName(p) + ' — 현장 사진', ph.map(x => x.cat).join(' · '));
        const cols = ph.length <= 2 ? ph.length : 2, rows = Math.ceil(ph.length / cols);
        const cw = (SW - M * 2 - 16 * (cols - 1)) / cols, chh = (SH - 190 - 16 * (rows - 1)) / rows;
        for (let i = 0; i < ph.length; i++) {
          const x = M + (i % cols) * (cw + 16), y = 156 + Math.floor(i / cols) * (chh + 16);
          b.rect(x, y, cw, chh, C.soft);
          b.image(await photoData(ph[i]), x, y, cw, chh - 18, [ph[i].w, ph[i].h]);
          b.text(x, y + chh - 16, cw, 16, `${ph[i].cat}${ph[i].caption ? ' — ' + ph[i].caption : ''}`, { size: 11, color: C.muted });
        }
        slides.push(b.done());
      }
    }
    if (on('elev')) {
      const ev = d.photos.filter(x => x.kind === 'elevation' || x.cat === '입면').slice(0, 2);
      if (ev.length) {
        const b = slideBuilder();
        b.head(projName(p) + ' — 입면', '입면으로 분류한 사진');
        const cw = (SW - M * 2 - 20 * (ev.length - 1)) / ev.length;
        for (let i = 0; i < ev.length; i++) {
          const x = M + i * (cw + 20);
          b.image(await photoData(ev[i]), x, 156, cw, 440, [ev[i].w, ev[i].h]);
          b.text(x, 606, cw, 18, ev[i].caption || ev[i].memo || '입면 사진', { size: 11, color: C.muted, align: 'ctr' });
        }
        slides.push(b.done());
      }
    }
    const noteSlide = (title, kinds, key) => {
      if (!on(key)) return;
      const ns = d.notes.filter(n => !kinds || kinds.some(k => (n.kind || '').includes(k)));
      if (!ns.length) return;
      const b = slideBuilder();
      b.head(projName(p) + ' — ' + title, `${ns.length}건의 기록`);
      let y = 160;
      for (const n of ns.slice(0, 5)) {
        if (y > SH - 110) break;
        b.text(M, y, SW - M * 2, 20, `${n.title || '무제'}   ${n.date || ''} ${n.kind || ''}`, { size: 15, bold: true, color: C.accent });
        const lines = wrapKo(n.body, 60, 5);
        b.text(M, y + 24, SW - M * 2, lines.length * 21, lines, { size: 13, color: C.ink2, lnSpc: 150000 });
        y += 34 + lines.length * 21;
      }
      slides.push(b.done());
    };
    noteSlide('답사 기록', null, 'notes');
    noteSlide('건축적 특징', ['건축'], 'arch');
    noteSlide('도시적 특징', ['도시'], 'urban');
    if (on('transit')) {
      const b = slideBuilder();
      b.head(projName(p) + ' — 주변 교통시설', '기록된 참조 지점 기준 최단거리');
      b.table(M, 156, 600, [180, 250, 170], [['시설', '이름', '거리']].concat(facRows(near)),
        { head: true, size: 13, labelBold: true, rowH: 34 });
      if (p.lat != null) {
        const url = await mapImage({ items: [p], all: [], W: 520, H: 400 });
        b.image(url, 700, 156, 516, 400, [520, 400]);
      }
      b.foot('거리는 등록된 참조 지점(역·터미널·시장·노선)에서 자동 계산된 값이다. 지점을 더 등록할수록 정확해진다.');
      slides.push(b.done());
    }
  }

  if (on('compare') && ps.length > 1) {
    const b = slideBuilder();
    b.head('사례 비교', `${ps.length}개 사례를 같은 기준으로`);
    const rows = [['사례', '지역', '건축', '지하/시장＋주거', '결합유형', '현재역', '과거역', '터미널']].concat(
      data.map(d => [projName(d.p), [d.p.sido, d.p.sgg].filter(Boolean).join(' '), d.p.builtYear == null ? '—' : String(d.p.builtYear),
      floorShort(d.p),
      d.p.relation || '—', fmtKm(d.near.station && d.near.station.d), fmtKm(d.near.oldstation && d.near.oldstation.d), fmtKm(d.near.terminal && d.near.terminal.d)])
    );
    b.table(M, 156, SW - M * 2, [240, 190, 100, 140, 190, 116, 116, 60], rows.slice(0, 15), { head: true, size: 12, rowH: Math.min(34, 420 / Math.max(1, rows.length)) });
    if (rows.length > 15) b.foot(`표에는 앞의 14건만 담았습니다. 전체 비교는 CSV 내보내기를 쓰세요.`);
    slides.push(b.done());
  }
  if (on('memo')) {
    const memos = data.flatMap(d => (d.p.note ? [[projName(d.p), d.p.note]] : []));
    const b = slideBuilder();
    b.head('연구자 분석 메모', '각 프로젝트의 비고란에 적어둔 내용');
    let y = 160;
    for (const [nm, t] of memos.slice(0, 6)) {
      if (y > SH - 110) break;
      b.text(M, y, SW - M * 2, 20, nm, { size: 14, bold: true, color: C.accent });
      const lines = wrapKo(t, 62, 3);
      b.text(M, y + 22, SW - M * 2, lines.length * 20, lines, { size: 13, color: C.ink2 });
      y += 32 + lines.length * 20;
    }
    if (!memos.length) b.text(M, 200, SW - M * 2, 40, '아직 비고란에 적어둔 메모가 없습니다.', { size: 15, color: C.muted });
    slides.push(b.done());
  }
  if (on('conclusion')) {
    const hyp = Object.entries(typeHypotheses()).sort((a, b2) => b2[1] - a[1]);
    const b = slideBuilder();
    b.head('결론 · 연구 가설', '데이터에서 기계적으로 도출한 유형 후보');
    b.table(M, 156, 600, [400, 200], [['유형 후보', '사례 수']].concat(hyp.slice(0, 9).map(r => [r[0], String(r[1])])),
      { head: true, size: 13, numAlign: true, rowH: 32 });
    b.text(700, 156, SW - M - 700 + M, 300, [
      '다음 질문을 데이터로 검토한다.',
      '',
      '· 지방 중소도시의 시장아파트는 어디에 놓이는가',
      '· 과거 교통망과 현재 교통망 중 어느 쪽에 더 가까운가',
      '· 시장과 주거의 결합 방식에 지역차가 있는가',
      '· 규모와 도시 규모 사이에 관계가 있는가',
      '· 현재의 활성화 정도는 입지와 관계가 있는가'
    ], { size: 14, color: C.ink2, lnSpc: 155000 });
    b.foot('이 분류는 거리·층수·상태 값에서 규칙으로 붙인 후보이며, 확정된 유형이 아니라 연구자가 검토할 가설이다.');
    slides.push(b.done());
  }
  return slides;
}

/** 발표자료 구성 선택 → pptx 생성 */
function pptxDialog(list) {
  const ps = list && list.length ? list : target();
  if (!ps.length) return toast('먼저 프로젝트를 만들어 주세요');
  const saved = (() => { try { return JSON.parse(localStorage.getItem('mkt-deck') || 'null'); } catch (e) { return null; } })();
  const on = k => saved ? saved.includes(k) : DECK_SECTIONS.find(s => s.k === k).on;
  openModal(`<div class="mh"><h3>발표자료 만들기 · ${ps.length}건</h3><button class="x">×</button></div>
    <div class="mb"><p class="hint" style="margin:0 0 10px">넣을 슬라이드를 고르세요. <b>사례별</b> 항목은 선택한 프로젝트마다 한 장씩 만들어집니다.</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 18px">
        ${DECK_SECTIONS.map(s => `<label class="lyr"><input type="checkbox" data-sec="${s.k}" ${on(s.k) ? 'checked' : ''}>
          <span>${esc(s.label)}</span><span class="n">${s.scope === 'each' ? '사례별' : '1장'}</span></label>`).join('')}
      </div>
      <p class="hint" style="margin-top:10px">지도는 이 앱이 직접 그려 이미지로 넣습니다. 사진은 원본 해상도로 들어가므로 사례가 많으면 파일이 커집니다.</p>
      <p class="hint" id="pxEst"></p></div>
    <div class="mf"><button class="btn" id="pxPdf">PDF 슬라이드로</button><span class="spacer"></span>
      <button class="btn pri" id="pxGo">.pptx 내려받기</button></div>`);
  const picked = () => $$('#modalbox [data-sec]').filter(c => c.checked).map(c => c.dataset.sec);
  const est = () => {
    const p = picked();
    const each = DECK_SECTIONS.filter(s => s.scope === 'each' && p.includes(s.k)).length;
    const once = DECK_SECTIONS.filter(s => s.scope === 'once' && p.includes(s.k)).length;
    $('#pxEst').textContent = `최대 ${once + each * ps.length}장 — 내용이 없는 사례별 슬라이드는 자동으로 빠집니다.`;
  };
  $$('#modalbox [data-sec]').forEach(c => c.onchange = est); est();
  $('#pxPdf').onclick = () => { closeModal(); buildSlides(ps); };
  $('#pxGo').onclick = async () => {
    const sel = picked();
    if (!sel.length) return toast('슬라이드를 하나 이상 고르세요');
    try { localStorage.setItem('mkt-deck', JSON.stringify(sel)); } catch (e) { }
    const btn = $('#pxGo'); btn.disabled = true; btn.textContent = '만드는 중…';
    try {
      const slides = await composeDeck(ps, sel);
      if (!slides.length) { toast('만들 슬라이드가 없습니다'); btn.disabled = false; btn.textContent = '.pptx 내려받기'; return; }
      const blob = buildPptx(slides, { title: `시장아파트 답사 보고 ${today()}` });
      closeModal();
      await download(`시장아파트_발표자료_${today()}.pptx`, blob);
      toast(`슬라이드 ${slides.length}장 · ${bytes(blob.size)}`, 4200);
    } catch (e) {
      console.error(e);
      btn.disabled = false; btn.textContent = '.pptx 내려받기';
      toast('발표자료를 만들지 못했습니다: ' + (e && e.message || e), 4200);
    }
  };
}
