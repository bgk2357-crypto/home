import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, mkdir } from 'node:fs/promises';
import { DOMParser } from '@xmldom/xmldom';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import CFB from 'cfb';
import { deflateSync } from 'fflate';
globalThis.DOMParser=DOMParser;
await mkdir('.sites-runtime/tests',{recursive:true});
for(const [name,entry]of [['core','lib/msds.ts'],['files','lib/msds-files.ts'],['export','lib/msds-export.ts'],['print','lib/msds-print.ts'],['selection','lib/msds-file-selection.ts']])await build({entryPoints:[entry],outfile:'.sites-runtime/tests/msds-'+name+'.mjs',bundle:true,platform:'node',format:'esm',packages:'external'});
const {analyseMsds,labelProblems}=await import('../.sites-runtime/tests/msds-core.mjs');
const {extractMsdsFile}=await import('../.sites-runtime/tests/msds-files.mjs');
const {msdsWorkbook,msdsHwpx,msdsRtf}=await import('../.sites-runtime/tests/msds-export.mjs');
const {msdsPrintHtml}=await import('../.sites-runtime/tests/msds-print.mjs');
const {takeMsdsFiles}=await import('../.sites-runtime/tests/msds-selection.mjs');
const text=`1. 화학제품과 회사에 관한 정보
제품명: 시험용 에탄올
회사명: 테스트 공급자
주소: 테스트 주소
전화번호: 000-0000-0000
2. 유해성·위험성
신호어: 위험
GHS02 GHS07
H225 고인화성 액체 및 증기
P210 열·스파크로부터 멀리할 것
3. 구성성분의 명칭 및 함유량
에탄올 64-17-5 95%
물 7732-18-5 5%
4. 응급조치 요령
눈에 들어가면 원문에 정한 방법으로 씻으시오.
5. 폭발·화재시 대처방법
원문의 소화 방법을 따르시오.
6. 누출사고시 대처방법
점화원을 제거하시오.
7. 취급 및 저장방법
밀폐 용기에 보관하시오.
8. 노출방지 및 개인보호구
원문에 명시한 보호구를 사용하시오.
9. 물리화학적 특성
비점 등
16. 그 밖의 참고사항
실제 제품의 분류를 대신하지 않는 시험 자료`;
let checks=0;function equal(a,b){assert.deepEqual(a,b);checks++;}
const record=analyseMsds(text,'sample.txt');equal(record.product,'시험용 에탄올');equal(record.supplier,'테스트 공급자');equal(record.signal,'위험');equal(record.cas,'64-17-5, 7732-18-5');equal(record.pictograms,['GHS02','GHS07']);equal(record.reviewed,false);assert.ok(record.hazards.includes('H225'));assert.ok(record.firstAid.includes('눈에'));checks+=2;
equal(labelProblems(record,100,90,'5',0).length,1);record.reviewed=true;equal(labelProblems(record,100,90,'5',0),[]);assert.ok(labelProblems(record,90,90,'5',0).some(s=>s.includes('90.0')));checks++;
equal(analyseMsds('2. 유해성·위험성\nH225 고인화성 액체\n3. 구성성분\n64-17-5','no-image.txt').pictograms,[]);
equal((await extractMsdsFile(new File([text],'test.txt'))).product,record.product);
// Model a live native FileList: clearing the input invalidates its entries.
const sourceFiles=[new File([text],'picker-test.txt'),new File([text],'picker-second.txt')];
const liveFiles={get length(){return sourceFiles.length;},item(index){return sourceFiles[index]??null;},*[Symbol.iterator](){yield* sourceFiles;}};
const picker={files:liveFiles,get value(){return 'selected';},set value(value){assert.equal(value,'');sourceFiles.length=0;}};
const selection=takeMsdsFiles(picker);equal(liveFiles.length,0);equal(selection.length,2);
await new Promise(resolve=>setTimeout(resolve,0));
equal((await extractMsdsFile(selection[0])).product,record.product);equal((await extractMsdsFile(selection[1])).fileName,'picker-second.txt');
equal(takeMsdsFiles(picker),[]);
const pdfLines=['1. Identification','Product name: TEST ETHANOL','Company name: Test Supplier','Address: Test Address','Telephone: 000-0000','2. Hazards identification','Signal word: Danger','GHS02','H225 Highly flammable liquid and vapour','P210 Keep away from heat','3. Composition','Ethanol 64-17-5 95 percent'];
const stream='BT /F1 12 Tf 16 TL 40 750 Td '+pdfLines.map((line,index)=>(index?'T* ':'')+'('+line+') Tj').join('\n')+' ET';
const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
let pdf='%PDF-1.4\n',offsets=[0];objects.forEach((object,index)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${index+1} 0 obj\n${object}\nendobj\n`;});const xref=Buffer.byteLength(pdf);pdf+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')+`trailer << /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
equal((await extractMsdsFile(new File([pdf],'sample.pdf'),{pdfWorkerSrc:new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs',import.meta.url).href})).product,'TEST ETHANOL');
const docx=new JSZip();docx.file('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+text.split('\n').map(line=>'<w:p><w:r><w:t>'+line+'</w:t></w:r></w:p>').join('')+'</w:body></w:document>');
equal((await extractMsdsFile(new File([await docx.generateAsync({type:'uint8array'})],'sample.docx'))).cas,record.cas);
const compound=CFB.utils.cfb_new();const header=Buffer.alloc(256);header.write('HWP Document File');header.writeUInt32LE(1,36);CFB.utils.cfb_add(compound,'FileHeader',header);const body=Buffer.from(text,'utf16le');const paragraph=Buffer.alloc(4+body.length);paragraph.writeUInt32LE((body.length<<20)|67,0);body.copy(paragraph,4);CFB.utils.cfb_add(compound,'BodyText/Section0',deflateSync(paragraph));
equal((await extractMsdsFile(new File([CFB.write(compound,{type:'buffer'})],'sample.hwp'))).product,record.product);
const images=Object.fromEntries(await Promise.all(['GHS02','GHS07'].map(async id=>[id,new Uint8Array(await readFile(`public/ghs/${id}.png`))])));
const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(await msdsWorkbook([record],{images}));equal(workbook.worksheets.map(s=>s.name),['물질목록','취급·응급조치','전체항목','MSDS16항','GHS그림문자','추출원문']);equal(workbook.getWorksheet('물질목록').getCell('A2').value,record.product);const summary=workbook.getWorksheet('물질목록');const reviewCol=summary.getRow(1).values.indexOf('원문 검토');equal(summary.getRow(2).getCell(reviewCol).value,'검토 완료');equal(workbook.getWorksheet('GHS그림문자').getImages().length,2);equal(workbook.getWorksheet('MSDS16항').rowCount,17);
const template=await readFile('public/templates/blank.hwpx');const hwpx=await msdsHwpx(record,template.buffer.slice(template.byteOffset,template.byteOffset+template.byteLength),{images});const zip=await JSZip.loadAsync(hwpx);equal(await zip.file('mimetype').async('string'),'application/hwp+zip');const xml=await zip.file('Contents/section0.xml').async('string');const document=new DOMParser().parseFromString(xml,'application/xml');equal(document.getElementsByTagName('parsererror').length,0);assert.ok(xml.includes(record.product));checks++;equal(document.getElementsByTagNameNS('*','pic').length,2);equal(await zip.file('BinData/GHS02.png').async('uint8array'),images.GHS02);const localHeader=new DataView(hwpx.buffer,hwpx.byteOffset,hwpx.byteLength);equal(localHeader.getUint16(8,true),0);equal(new TextDecoder().decode(hwpx.slice(30,38)),'mimetype');
const rtf=new TextDecoder().decode(await msdsRtf(record,{images}));assert.ok(rtf.startsWith('{\\rtf1'));assert.ok(rtf.includes('\\pngblip'));assert.ok(rtf.includes('\\u'));assert.ok(!/[^\x00-\x7f]/.test(rtf));checks+=4;
equal((await extractMsdsFile(new File([hwpx],'editable.hwpx'))).product,record.product);
const html=msdsPrintHtml({...record,product:'<script>alert(1)</script>'},'label',100,90,'https://test.local');assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));assert.ok(!html.includes('<h1><script>'));assert.ok(html.includes('100mm 90mm'));assert.ok(html.includes('/ghs/GHS02.svg'));assert.ok(html.includes('scrollHeight'));checks+=5;
await assert.rejects(()=>extractMsdsFile(new File(['tiny'],'scan.txt')));checks++;
console.log(`${checks} MSDS checks passed: picker reset before async analysis, evidence-only fields, missing pictograms, label area/review gates, TXT/PDF/DOCX/HWP/HWPX reads, XLSX/HWPX round trip, escaping and print dimensions.`);
