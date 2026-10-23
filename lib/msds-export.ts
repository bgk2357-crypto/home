import type { MsdsRecord } from "./msds";
export function downloadBytes(bytes: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type })); const link = document.createElement("a"); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 20000);
}
export async function msdsWorkbook(records: MsdsRecord[]) {
  const { default: ExcelJS } = await import("exceljs"); const workbook = new ExcelJS.Workbook(); workbook.creator = "Argo&Health Lab"; workbook.created = new Date();
  const sheet = workbook.addWorksheet("물질목록", { views: [{ state: "frozen", ySplit: 1 }] });
  const columns: [keyof MsdsRecord, string, number][] = [["product", "제품명", 25], ["cas", "CAS 번호", 24], ["supplier", "공급자명", 22], ["address", "공급자 주소", 35], ["phone", "공급자 전화", 20], ["workplace", "사용 회사", 22], ["department", "부서·공정", 20], ["signal", "신호어", 12], ["hazards", "유해·위험 문구", 60], ["precautions", "예방조치 문구", 70], ["pictograms", "그림문자", 28], ["reviewed", "원문 검토", 14], ["fileName", "출처 파일", 30], ["importedAt", "가져온 일시", 25]];
  sheet.columns = columns.map(([key, header, width]) => ({ key, header, width }));
  for (const record of records) sheet.addRow(Object.fromEntries(columns.map(([key]) => [key, key === "reviewed" ? record.reviewed ? "검토 완료" : "검토 필요" : Array.isArray(record[key]) ? (record[key] as string[]).join(", ") : String(record[key]).slice(0, 32000)])));
  sheet.autoFilter = { from: "A1", to: "N1" };
  const details = workbook.addWorksheet("취급·응급조치"); details.columns = [{ header: "제품명", key: "product", width: 25 }, ...["ingredients", "firstAid", "fire", "spill", "handling", "protection"].map((key, i) => ({ header: ["구성성분 원문", "응급조치", "화재 대응", "누출 대응", "취급·저장", "보호구·노출방지"][i], key, width: 60 }))];
  records.forEach(record => details.addRow(Object.fromEntries(["product", "ingredients", "firstAid", "fire", "spill", "handling", "protection"].map(key => [key, String(record[key as keyof MsdsRecord]).slice(0, 32000)]))));
  const raw = workbook.addWorksheet("추출원문"); raw.columns = [{ header: "출처 파일", key: "file", width: 30 }, { header: "제품명", key: "product", width: 25 }, { header: "텍스트 조각 번호", key: "part", width: 18 }, { header: "추출 원문", key: "text", width: 100 }];
  for (const record of records) for (let at = 0; at < record.text.length; at += 30000) raw.addRow({ file: record.fileName, product: record.product, part: at / 30000 + 1, text: record.text.slice(at, at + 30000) });
  workbook.eachSheet(sheet => { sheet.getRow(1).height = 26; sheet.getRow(1).eachCell(cell => { cell.font = { bold: true, color: { argb: "FFFFFFFF" } }; cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF154B6B" } }; }); sheet.eachRow((row, number) => { if (number > 1) { row.alignment = { vertical: "top", wrapText: true }; row.font = { size: 10 }; } }); });
  return workbook.xlsx.writeBuffer();
}
function xml(value: string) { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, ""); }
export async function msdsHwpx(record: MsdsRecord, template: ArrayBuffer) {
  const { default: JSZip } = await import("jszip"); const zip = await JSZip.loadAsync(template);
  zip.file("mimetype", "application/hwp+zip", { compression: "STORE" });
  let section = await zip.file("Contents/section0.xml")!.async("string");
  // Preserve the blank document's section/page/style definitions; append editable paragraphs.
  const lines = ["물질안전보건자료 검토·유해성 안내", `제품명: ${record.product}`, `사용 회사: ${record.workplace} / 부서·공정: ${record.department}`, `공급자: ${record.supplier}`, `공급자 주소: ${record.address}`, `공급자 전화: ${record.phone}`, `CAS 번호: ${record.cas}`, `신호어: ${record.signal}`, `그림문자(원문 대조): ${record.pictograms.join(", ")}`, "유해·위험 문구", record.hazards, "예방조치 문구", record.precautions, "응급조치", record.firstAid, "보호구·노출 방지", record.protection, "취급·저장", record.handling, "누출 대응", record.spill, "화재 대응", record.fire, `원문: ${record.fileName} / ${record.reviewed ? "검토 완료" : "검토 필요"}`, "이 문서는 편집용 안내 문서입니다. 규격 경고표지는 홈페이지의 경고표지 인쇄 기능을 이용하세요."];
  const paragraphs = lines.flatMap(line => line.split("\n")).map((line, index) => `<hp:p id="${1000 + index}" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0"><hp:run charPrIDRef="0"><hp:t>${xml(line)}</hp:t></hp:run></hp:p>`).join("");
  section = section.replace("</hs:sec>", paragraphs + "</hs:sec>"); zip.file("Contents/section0.xml", section);
  zip.file("Preview/PrvText.txt", lines.join("\r\n"));
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
