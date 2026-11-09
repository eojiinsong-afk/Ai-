// 무압축(STORE) ZIP 스트리머. 사진은 이미 압축돼 있어 다시 압축할 이유가 없다.
// 파일을 하나씩 읽어 CRC를 계산한 뒤 내보내므로 메모리는 파일 1장 크기만 쓴다.
// 전체가 4GB를 넘으면 ZIP64 레코드를 붙인다.
import { readFile } from 'node:fs/promises';
import { crc32 } from 'node:zlib';
import { once } from 'node:events';

const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n >>> 0); return b; };
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const MAX32 = 0xffffffff;

function dosTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {{name: string, path: string, date?: Date}[]} entries
 */
export async function streamZip(res, entries) {
  let offset = 0;
  const central = [];
  const write = async (buf) => {
    offset += buf.length;
    if (!res.write(buf)) await Promise.race([once(res, 'drain'), once(res, 'close')]);
    if (res.destroyed) throw new Error('client closed');
  };

  for (const e of entries) {
    let data;
    try { data = await readFile(e.path); } catch { continue; } // 사라진 파일은 건너뛴다
    if (res.destroyed) return;
    const name = Buffer.from(e.name, 'utf8');
    const crc = crc32(data);
    const { time, date } = dosTime(e.date || new Date());
    const headerOffset = offset;
    await write(Buffer.concat([
      u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(time), u16(date),
      u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0), name,
    ]));
    await write(data);
    central.push({ name, crc, size: data.length, time, date, headerOffset });
  }

  const cdStart = offset;
  for (const c of central) {
    const big = c.headerOffset > MAX32;
    const extra = big ? Buffer.concat([u16(0x0001), u16(8), u64(c.headerOffset)]) : Buffer.alloc(0);
    await write(Buffer.concat([
      u32(0x02014b50), u16(big ? 45 : 20), u16(big ? 45 : 20), u16(0x0800), u16(0),
      u16(c.time), u16(c.date), u32(c.crc), u32(c.size), u32(c.size),
      u16(c.name.length), u16(extra.length), u16(0), u16(0), u16(0), u32(0),
      u32(big ? MAX32 : c.headerOffset), c.name, extra,
    ]));
  }
  const cdSize = offset - cdStart;
  const n = central.length;
  const needs64 = n > 0xffff || cdStart > MAX32 || cdSize > MAX32;
  if (needs64) {
    const z64Start = offset;
    await write(Buffer.concat([
      u32(0x06064b50), u64(44), u16(45), u16(45), u32(0), u32(0),
      u64(n), u64(n), u64(cdSize), u64(cdStart),
    ]));
    await write(Buffer.concat([u32(0x07064b50), u32(0), u64(z64Start), u32(1)]));
  }
  await write(Buffer.concat([
    u32(0x06054b50), u16(0), u16(0),
    u16(needs64 ? 0xffff : n), u16(needs64 ? 0xffff : n),
    u32(needs64 ? MAX32 : cdSize), u32(needs64 ? MAX32 : cdStart), u16(0),
  ]));
  res.end();
}
