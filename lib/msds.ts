export type MsdsRecord = {
  id: string; fileName: string; importedAt: string; product: string; supplier: string; address: string; phone: string;
  workplace: string; department: string; cas: string; ingredients: string; signal: string; hazards: string; precautions: string;
  firstAid: string; fire: string; spill: string; handling: string; protection: string; pictograms: string[];
  text: string; reviewed: boolean;
};
export const GHS = [
  ["GHS01", "폭발성"], ["GHS02", "인화성"], ["GHS03", "산화성"], ["GHS04", "고압가스"], ["GHS05", "부식성"],
  ["GHS06", "급성독성"], ["GHS07", "자극성 등"], ["GHS08", "건강 유해성"], ["GHS09", "환경 유해성"],
];
export const WARNING_SOURCE = "https://msds.kosha.or.kr/MSDSInfo/msds/web/kosha/msds02/Msds02WarningList.jsp";
export const WARNING_LAW = "https://www.law.go.kr/admRulLsInfoP.do?admRulSeq=2100000278320&chrClsCd=010202";
export const LABEL_PRESETS = [
  { id: "small", name: "5ℓ 미만 · 직접 확인", width: 100, height: 90, minimum: 0 },
  { id: "5", name: "5ℓ 이상 ~ 50ℓ 미만 · 90㎠", width: 100, height: 90, minimum: 90 },
  { id: "50", name: "50ℓ 이상 ~ 200ℓ 미만 · 180㎠", width: 150, height: 120, minimum: 180 },
  { id: "200", name: "200ℓ 이상 ~ 500ℓ 미만 · 300㎠", width: 200, height: 150, minimum: 300 },
  { id: "500", name: "500ℓ 이상 · 450㎠", width: 250, height: 180, minimum: 450 },
];
export function casNumbers(text: string) { return [...new Set(text.match(/\b\d{2,7}-\d{2}-\d\b/g) ?? [])]; }
export function sections(text: string) {
  const result: Record<number, string> = {}; const matches = [...text.matchAll(/(?:^|\n)\s*(1[0-6]|[1-9])\s*[.．、)]\s*(?:화학|유해|구성|응급|폭발|누출|취급|노출|물리|안정|독성|환경|폐기|운송|법적|그\s*밖|기타|Identification|Hazard|Composition|First|Fire|Accidental|Handling|Exposure|Physical|Stability|Toxicological|Ecological|Disposal|Transport|Regulatory|Other)[^\n]*/gi)];
  matches.forEach((match, index) => { result[Number(match[1])] = text.slice(match.index! + match[0].length, matches[index + 1]?.index ?? text.length).trim(); });
  return result;
}
function field(text: string, labels: string) { return text.match(new RegExp(`(?:${labels})\\s*[:：]\\s*([^\\n]+)`, "i"))?.[1].trim() ?? ""; }
export function analyseMsds(textValue: string, fileName: string): MsdsRecord {
  const text = textValue.replace(/\r\n?/g, "\n").replace(/\u0000/g, "").slice(0, 250000);
  const s = sections(text); const identification = s[1] || text.slice(0, 6000); const hazard = s[2] || "";
  const signal = field(hazard, "신호어|Signal word");
  return {
    id: typeof crypto.randomUUID === "function" ? crypto.randomUUID() : Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, "0")).join(""), fileName, importedAt: new Date().toISOString(),
    product: field(identification, "제품명|제품 이름|Product name|Product identifier"),
    supplier: field(identification, "회사명|공급자명|제조자명|Company name|Supplier"), address: field(identification, "주소|Address"),
    phone: field(identification, "긴급전화번호|긴급 전화번호|전화번호|Emergency phone|Telephone"), workplace: "", department: "",
    cas: casNumbers(s[3] || text).join(", "), ingredients: (s[3] || "").slice(0, 10000),
    signal: /위험|Danger/i.test(signal) ? "위험" : /경고|Warning/i.test(signal) ? "경고" : "",
    hazards: hazard.split("\n").filter(line => /\bH\d{3}(?:\+H?\d{3})*\b/.test(line)).join("\n"),
    precautions: hazard.split("\n").filter(line => /\bP\d{3}(?:\+P?\d{3})*\b/.test(line)).join("\n"),
    firstAid: s[4] || "", fire: s[5] || "", spill: s[6] || "", handling: s[7] || "", protection: s[8] || "",
    pictograms: [...new Set(hazard.match(/\bGHS0[1-9]\b/gi) ?? [])].map(value => value.toUpperCase()), text, reviewed: false,
  };
}
export function labelProblems(record: MsdsRecord, width: number, height: number, presetId: string, surfaceArea: number) {
  const problems: string[] = []; const preset = LABEL_PRESETS.find(item => item.id === presetId);
  const area = width * height / 100;
  if (!Number.isFinite(area) || width < 30 || height < 30 || width > 400 || height > 400) problems.push("가로·세로는 30~400mm 범위로 입력해주세요.");
  const minimum = presetId === "small" ? surfaceArea * 0.05 : preset?.minimum ?? 0;
  if (presetId === "small" && (!Number.isFinite(surfaceArea) || surfaceArea <= 0)) problems.push("5ℓ 미만은 용기·포장 표면적(상하 면적 제외)을 입력해 면적 기준을 확인해주세요.");
  if (area + 0.001 < minimum) problems.push(`표지 면적이 ${minimum.toFixed(1)}㎠ 이상이어야 합니다.`);
  if (!record.product.trim()) problems.push("제품명을 확인해주세요.");
  if (!record.supplier.trim() || !record.address.trim() || !record.phone.trim()) problems.push("공급자명·주소·전화번호를 입력해주세요.");
  if (!["위험", "경고", "해당 없음"].includes(record.signal)) problems.push("원문 2항의 신호어를 선택해주세요.");
  if (record.signal !== "해당 없음" && (!record.hazards.trim() || !record.precautions.trim() || !record.pictograms.length)) problems.push("원문에 따른 그림문자·유해위험 문구·예방조치 문구를 확인해주세요.");
  if (record.signal === "해당 없음" && (record.pictograms.length || record.hazards.trim())) problems.push("분류 해당 없음과 유해성 항목이 충돌합니다. 원문을 다시 확인해주세요.");
  if (record.pictograms.includes("GHS06") && record.pictograms.includes("GHS07")) problems.push("해골과 느낌표의 우선순위 적용 여부를 원문과 대조해 그림문자를 정리해주세요.");
  if (!record.reviewed) problems.push("원문 MSDS와 추출·수정 내용을 대조한 뒤 검토 완료를 선택해주세요.");
  return problems;
}
