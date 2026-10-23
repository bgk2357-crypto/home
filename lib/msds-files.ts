import { analyseMsds } from "./msds";

const MAX_UNPACKED = 16 * 1024 * 1024;
export async function extractMsdsFile(file: File, options: { pdfWorkerSrc?: string } = {}) {
  if (file.size > 10 * 1024 * 1024) throw new Error("파일은 10MB 이하로 선택해주세요.");
  const extension = file.name.split(".").pop()?.toLowerCase(); const buffer = await file.arrayBuffer(); let text = "";
  if (extension === "pdf") {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = options.pdfWorkerSrc ?? "/vendor/pdf.worker.min.mjs";
    const loading = pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true });
    const pdf = await loading.promise;
    try {
      if (pdf.numPages > 80) throw new Error("80페이지 이하의 MSDS를 선택해주세요.");
      for (let number = 1; number <= pdf.numPages; number++) {
        const content = await (await pdf.getPage(number)).getTextContent();
        text += content.items.map(item => "str" in item ? item.str + (item.hasEOL ? "\n" : " ") : "").join("") + "\n";
      }
    } finally { await loading.destroy(); }
  } else if (extension === "docx" || extension === "hwpx") {
    const { default: JSZip } = await import("jszip"); const zip = await JSZip.loadAsync(buffer);
    const names = Object.keys(zip.files).filter(name => extension === "docx" ? name === "word/document.xml" : /^Contents\/section\d+\.xml$/.test(name)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (names.length > 80) throw new Error("문서 구역이 너무 많습니다.");
    let xmlSize = 0;
    for (const name of names) {
      const entry = zip.file(name)!;
      const uncompressedSize = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
      if (uncompressedSize && uncompressedSize > MAX_UNPACKED) throw new Error("문서의 텍스트 용량이 너무 큽니다.");
      const xml = await entry.async("string"); xmlSize += xml.length; if (xmlSize > MAX_UNPACKED) throw new Error("문서의 텍스트 용량이 너무 큽니다.");
      const document = new DOMParser().parseFromString(xml, "application/xml");
      if (document.getElementsByTagName("parsererror").length) throw new Error("문서 XML을 읽을 수 없습니다.");
      const nodes = Array.from(document.getElementsByTagNameNS("*", "p"));
      text += nodes.map(node => Array.from(node.getElementsByTagNameNS("*", "t")).map(item => item.textContent ?? "").join(" ")).join("\n") + "\n";
    }
  } else if (extension === "hwp") {
    const CFB = await import("cfb"); const { inflateSync } = await import("fflate");
    const compound = CFB.read(new Uint8Array(buffer), { type: "array" });
    const header = compound.FileIndex[compound.FullPaths.findIndex(name => /\/FileHeader$/.test(name))]?.content;
    if (!header || header.length < 40) throw new Error("지원하는 HWP 5 형식이 아닙니다. HWPX로 저장해 다시 선택해주세요.");
    const headerBytes = new Uint8Array(header);
    const flags = new DataView(headerBytes.buffer, headerBytes.byteOffset, headerBytes.byteLength).getUint32(36, true);
    if (flags & (2 | 4 | 16)) throw new Error("암호화·배포용·DRM HWP는 읽을 수 없습니다. 일반 HWPX 또는 PDF로 저장해주세요.");
    let total = 0;
    for (let index = 0; index < compound.FullPaths.length; index++) {
      if (!/BodyText\/Section\d+$/.test(compound.FullPaths[index])) continue;
      const packed = new Uint8Array(compound.FileIndex[index].content);
      const data = flags & 1 ? inflateSync(packed) : packed;
      total += data.length; if (total > MAX_UNPACKED) throw new Error("HWP 문서 용량이 너무 큽니다.");
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      for (let at = 0; at + 4 <= data.length;) {
        const header = view.getUint32(at, true); at += 4; let size = header >>> 20;
        if (size === 4095) { if (at + 4 > data.length) break; size = view.getUint32(at, true); at += 4; }
        if (at + size > data.length) break;
        if ((header & 1023) === 67) {
          const paragraph = data.subarray(at, at + size); const words = new DataView(paragraph.buffer, paragraph.byteOffset, paragraph.byteLength);
          for (let offset = 0; offset + 2 <= paragraph.length; offset += 2) {
            const code = words.getUint16(offset, true);
            if (code >= 32) text += String.fromCharCode(code);
            else if (code === 13 || code === 10) text += "\n";
            else if ([1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23].includes(code)) { text += " "; offset += 14; }
          }
          text += "\n";
        }
        at += size;
      }
    }
  } else if (extension === "txt") { text = new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
  else throw new Error("PDF·HWP·HWPX·DOCX·UTF-8 TXT 파일을 선택해주세요.");
  if (text.trim().length < 60) throw new Error("텍스트를 충분히 추출하지 못했습니다. 스캔 PDF는 OCR 처리한 뒤 사용하거나 원문 텍스트를 붙여넣어주세요.");
  return analyseMsds(text, file.name);
}
