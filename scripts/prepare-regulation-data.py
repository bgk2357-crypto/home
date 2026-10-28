"""Build a dated, traceable chemical-CAS lookup from current official annex PDFs.
The HTML retrieval identifying these files is retained in work/msds-enhancement.
No unsupported CAS-family expansion or legal applicability inference is performed.
"""
import re,json,hashlib
from pathlib import Path
from pypdf import PdfReader
root=Path(__file__).resolve().parents[1]
sources=[('managed','annex12','155899307','산업안전보건기준에 관한 규칙 별표 12','2026-03-02'),('measurement','annex21','167476075','산업안전보건법 시행규칙 별표 21','2026-08-01'),('health','annex22','167476101','산업안전보건법 시행규칙 별표 22','2026-08-01')]
entries=[];metadata=[]
exceptions=['디메틸아세트아미드','디메틸포름아미드','디부틸프탈레이트','2-메톡시에탄올','2-메톡시에틸아세테이트','1-브로모프로판','2-브로모프로판','2-에톡시에탄올','2-에톡시에틸아세테이트','와파린','페놀','포름아미드','납[','산화붕소','수은[','사붕소산나트륨']
for kind,name,seq,title,effective in sources:
    path=root/'public/regulations'/f'{name}.pdf'
    text='\n'.join(p.extract_text(extraction_mode='layout') or '' for p in PdfReader(path).pages)
    metadata.append(dict(id=kind,title=title,effective=effective,checked='2026-10-26',url=f'https://www.law.go.kr/LSW/flDownload.do?flSeq={seq}',local=f'/regulations/{name}.pdf',sha256=hashlib.sha256(path.read_bytes()).hexdigest()))
    group='';record='';ordinal=0
    def flush():
        global record
        value=re.sub(r'\s+','',record)
        cas=list(dict.fromkeys(re.findall(r'(?<!\d)\d{2,7}-\d{2}-\d(?!\d)',value)))
        if cas and not re.match(r'\d+\)부터',value):
            special='특별관리물질' in value
            conditional=special and any(x in value for x in ['불용성','6가크롬','삼산화안티몬만','벤젠을','pH','제외한다'])
            name_end=re.search(r'[\[(](?=[^가-힣]*;)|[\[(](?=\d{2,7}-\d{2}-\d)',value)
            korean=value[:name_end.start()] if name_end else value.split(';')[0]
            # '등', salts, compounds and physical forms need explicit final review.
            family=any(x in value for x in ['및그','동족체','등)','등]','휘발물','분진','미스트','흄'])
            if kind=='managed':
                threshold=0.3 if special and any(x in value for x in exceptions) else 0.1 if special else 1
                basis='weight'
            else:
                threshold=0.5 if group=='허가대상' and '98-07-7' in cas else 1
                basis='volume' if group in ['유기화합물','가스'] else 'weight'
            entries.append(dict(kind=kind,group=group,ordinal=ordinal,name=korean,cas=cas,special=special,conditional=conditional,family=family,threshold=threshold,basis=basis,text=value))
        record=''
    for line in text.splitlines():
        line=line.strip()
        if not line:continue
        # Stop before nonchemical dust/noise/night-work sections; they are not CAS-only decisions.
        if kind!='managed' and re.match(r'^2\.',line):
            flush();break
        if re.match(r'^(?:[1-4]|[가-바])\.',line):
            flush()
            if '유기화합물' in line:group='유기화합물'
            elif '금속류' in line:group='금속'
            elif '산' in line and ('알칼리' in line or '알카리' in line):group='산알칼리'
            elif '가스' in line:group='가스'
            elif '허가' in line:group='허가대상'
            else:group='기타'
            continue
        match=re.match(r'^(\d+)\)(.*)',line)
        if match:
            flush();ordinal=int(match[1]);record=match[2]
        elif record:record+=' '+line
    flush()
data=dict(sources=metadata,entries=entries,coverage='별표에 명시된 화학물질 CAS만 매칭. 화합물군·이성질체 확장, 분진·물리적 인자·야간작업 및 작업장 적용 여부는 별도 확인.')
(root/'lib/regulation-data.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print({kind:sum(e['kind']==kind for e in entries) for kind,*_ in sources})
print('special',sum(e['kind']=='managed' and e['special'] for e in entries))
