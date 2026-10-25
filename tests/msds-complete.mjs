import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { DOMParser } from '@xmldom/xmldom';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import sharp from 'sharp';
globalThis.DOMParser=DOMParser;
await mkdir('.sites-runtime/tests',{recursive:true});
for(const[name,entry]of[['core','lib/msds.ts'],['files','lib/msds-files.ts'],['layout','lib/msds-layout.ts'],['pictures','lib/msds-pictograms.ts'],['export','lib/msds-export.ts']])await build({entryPoints:[entry],outfile:`.sites-runtime/tests/msds-complete-${name}.mjs`,bundle:true,platform:'node',format:'esm',packages:'external'});
const {analyseMsds,MSDS_SECTION_TITLES}=await import('../.sites-runtime/tests/msds-complete-core.mjs');
const{extractMsdsFile}=await import('../.sites-runtime/tests/msds-complete-files.mjs');
const{pdfPageText}=await import('../.sites-runtime/tests/msds-complete-layout.mjs');
const{recognisePictograms}=await import('../.sites-runtime/tests/msds-complete-pictures.mjs');
const{msdsWorkbook,msdsHwpx,msdsRtf}=await import('../.sites-runtime/tests/msds-complete-export.mjs');
let checks=0;const equal=(a,b)=>{assert.deepEqual(a,b);checks++;};
const body=['가. 제 품 명','테스트 세정제','나. 제품의 권고 용도와 사용상의 제한','권고 용도','세정용','사용상의 제한','원문에 정한 용도 외 사용 금지','다. 공급자 정보','회 사 명','시험 공급회사','주 소','경기도 테스트시 시험로 100','전화번호','031-000-0000','긴급전화번호','010-0000-0000'];
const hazard=['가. 유해성·위험성 분류','인화성 액체 구분 2','그림문자','불꽃, 느낌표','신호어','위험','유해·위험 문구','고인화성 액체 및 증기','눈에 심한 자극을 일으킴','예방조치 문구','열과 스파크로부터 멀리하시오','사용 후 손을 씻으시오'];
const parts=MSDS_SECTION_TITLES.map((title,index)=>`${index+1}. ${title}\n${index===0?body.join('\n'):index===1?hazard.join('\n'):index===2?'에탄올 64-17-5 95%':`항목 ${index+1}의 원문 추가 정보`}`);
const text=parts.join('\n');const parsed=analyseMsds(text,'table.hwpx');
for(const[key,value]of Object.entries({product:'테스트 세정제',supplier:'시험 공급회사',address:'경기도 테스트시 시험로 100',phone:'031-000-0000',emergencyPhone:'010-0000-0000',recommendedUse:'세정용',restrictions:'원문에 정한 용도 외 사용 금지',signal:'위험'}))equal(parsed[key],value);
equal(parsed.pictograms,['GHS02','GHS07']);equal(parsed.hazards,'고인화성 액체 및 증기\n눈에 심한 자극을 일으킴');equal(parsed.precautions,'열과 스파크로부터 멀리하시오\n사용 후 손을 씻으시오');equal(Object.keys(parsed.sectionText).length,16);equal(parsed.sectionText['16'],'항목 16의 원문 추가 정보');
equal(analyseMsds(parts.map(part=>part.replace(/^\d+\. /,'')).join('\n'),'autonumber.hwpx').signal,'위험');
equal(analyseMsds('1. 화학제품과 회사에 관한 정보\n제품명: 안전시험\n2. 유해성·위험성\nH225 인화성 액체\n3. 구성성분\n64-17-5','no-image.txt').pictograms,[]);
const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;');
const source=new JSZip();source.file('Contents/section0.xml','<hs:sec xmlns:hs="sec" xmlns:hp="p"><hp:p><hp:run><hp:tbl>'+text.split('\n').map(line=>`<hp:tr><hp:tc><hp:subList><hp:p><hp:run><hp:t>${escape(line)}</hp:t></hp:run></hp:p></hp:subList></hp:tc></hp:tr>`).join('')+'</hp:tbl></hp:run></hp:p></hs:sec>');
const fromFile=await extractMsdsFile(new File([await source.generateAsync({type:'uint8array'})],'nested-table.hwpx'));
equal(fromFile.product,parsed.product);equal(fromFile.address,parsed.address);equal(fromFile.text.match(/테스트 세정제/g).length,1);equal(fromFile.sectionText['16'],parsed.sectionText['16']);
const items=[{str:'제 품 명',transform:[10,0,0,10,10,700],height:10,width:50},{str:'테스트 세정제',transform:[10,0,0,10,130,700],height:10,width:80},{str:'회 사 명',transform:[10,0,0,10,10,680],height:10,width:50},{str:'시험 공급회사',transform:[10,0,0,10,130,680],height:10,width:80}];
const layout=pdfPageText(items);assert.ok(layout.includes('제 품 명\t테스트 세정제\n회 사 명\t시험 공급회사'));checks++;equal(analyseMsds('1. 화학제품과 회사에 관한 정보\n'+layout,'layout.pdf').supplier,'시험 공급회사');
const images={};for(let i=1;i<=9;i++){const id='GHS0'+i;images[id]=new Uint8Array(await readFile(`public/ghs/${id}.png`));for(const size of [64,192,300]){const{data,info}=await sharp(images[id]).resize(size,size).ensureAlpha().raw().toBuffer({resolveWithObject:true});equal(recognisePictograms({data,width:info.width,height:info.height}).map(item=>item.id),[id]);}}
// Execute the actual HWPX image-import path using decoded PNG pixels. No UI or
// OCR is mocked: canvas merely supplies the already decoded bitmap to matching.
const previousDocument=globalThis.document,previousBitmap=globalThis.createImageBitmap;
globalThis.createImageBitmap=async blob=>{const{data,info}=await sharp(new Uint8Array(await blob.arrayBuffer())).ensureAlpha().raw().toBuffer({resolveWithObject:true});return{width:info.width,height:info.height,data,close(){}};};
globalThis.document={createElement(){let bitmap;return{width:0,height:0,getContext(){return{fillStyle:'',fillRect(){},drawImage(value){bitmap=value;},getImageData(){return{data:bitmap.data,width:bitmap.width,height:bitmap.height};}};}};}};
try{const withImage=await JSZip.loadAsync(await source.generateAsync({type:'uint8array'}));const sourceXml=await withImage.file('Contents/section0.xml').async('string');withImage.file('Contents/section0.xml',sourceXml.replace('불꽃, 느낌표',''));withImage.file('BinData/image0001.bin',images.GHS02);const detected=await extractMsdsFile(new File([await withImage.generateAsync({type:'uint8array'})],'image-source.hwpx'));equal(detected.pictograms,['GHS02']);assert.ok(detected.pictogramEvidence.GHS02.includes('원본 문서 그림'));checks++;}finally{globalThis.document=previousDocument;globalThis.createImageBitmap=previousBitmap;}
// Generic red boxes and text are not sufficient to auto-select a GHS symbol.
const red=await sharp({create:{width:64,height:64,channels:4,background:'#ff0000'}}).raw().toBuffer();equal(recognisePictograms({data:red,width:64,height:64}),[]);
parsed.workplace='사용사업장';parsed.department='생산1팀';parsed.hazards+='\nH319 편집자가 확인한 추가 문구';parsed.sectionText['16']='원문 검토 후 편집한 추가정보';parsed.ingredients='전체성분\n'+'장문성분'.repeat(10000);
const book=new ExcelJS.Workbook();const xlsx=await msdsWorkbook([parsed],{images});await book.xlsx.load(xlsx);
for(const title of ['제품명','공급자·제조자명','공급자 주소','공급자 전화','긴급전화','권고 용도','사용상의 제한','신호어'])assert.ok(book.getWorksheet('물질목록').getRow(1).values.includes(title));checks+=8;
const all=book.getWorksheet('전체항목');const ingredients=[];all.eachRow((row,index)=>{if(index>1&&row.getCell(3).value==='구성성분·함유량')ingredients.push(row.getCell(5).value);});equal(ingredients.join(''),parsed.ingredients);
equal(book.getWorksheet('MSDS16항').getRow(17).getCell(5).value,'원문 검토 후 편집한 추가정보');equal(book.getWorksheet('GHS그림문자').getImages().length,2);
const template=await readFile('public/templates/blank.hwpx');const hwpx=await msdsHwpx(parsed,template.buffer.slice(template.byteOffset,template.byteOffset+template.byteLength),{images});const zip=await JSZip.loadAsync(hwpx);const section=await zip.file('Contents/section0.xml').async('string');assert.ok(section.includes('시험 공급회사')&&section.includes('031-000-0000')&&section.includes('원문 검토 후 편집한 추가정보'));checks++;
const doc=new DOMParser().parseFromString(section,'application/xml');equal(doc.getElementsByTagNameNS('*','pic').length,2);equal(doc.getElementsByTagName('parsererror').length,0);
const manifest=await zip.file('Contents/content.hpf').async('string');for(const id of parsed.pictograms){assert.ok(manifest.includes(`id="${id}"`)&&zip.file(`BinData/${id}.png`));checks++;}
const rtf=await msdsRtf(parsed,{images});const rtfString=new TextDecoder().decode(rtf);equal((rtfString.match(/\\pngblip/g)||[]).length,2);assert.ok(rtfString.includes('031-000-0000'));checks++;
await mkdir('outputs/msds-samples',{recursive:true});const sample={...parsed,ingredients:'에탄올 64-17-5 95%\n물 7732-18-5 5%',fileName:'기능검증 예제(실제 MSDS 아님).hwpx'};await writeFile('outputs/msds-samples/MSDS-full-demo.xlsx',new Uint8Array(await msdsWorkbook([sample],{images})));await writeFile('outputs/msds-samples/MSDS-full-demo.hwpx',await msdsHwpx(sample,template.buffer.slice(template.byteOffset,template.byteOffset+template.byteLength),{images}));await writeFile('outputs/msds-samples/MSDS-full-demo.rtf',await msdsRtf(sample,{images}));
console.log(`${checks} complete MSDS checks passed: HWPX nested tables, split labels, all 16 sections, layout, GHS image matching at three sizes, full-length fields, embedded pictures and RTF/HWPX export.`);
