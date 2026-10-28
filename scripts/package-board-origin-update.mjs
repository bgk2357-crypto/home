import { readFile } from 'node:fs/promises';
import { saveDeployment } from './deployment-output.mjs';

const source = new URL('../nas-webstation/server/routes.php', import.meta.url);
const instructions = `방명록·커뮤니티 different-origin 수정

1. NAS의 /volume1/web/argo/server/routes.php를 먼저 다운로드해 백업합니다.
2. 이 압축파일의 server/routes.php를 NAS의 /volume1/web/argo/server/routes.php에 덮어씁니다.
   File Station에서는 web → argo → server 폴더입니다. public 폴더가 아닙니다.
3. 휴대폰에서 https://ssk2357.synology.me 에 다시 접속합니다.
4. 방명록과 커뮤니티 작성 화면을 새로 열어 각각 글을 등록하고,
   새로고침 후에도 내용이 남아 있는지 확인합니다.

config.php와 DB 파일은 교체하지 않습니다.
공개 주소(app_origin) 또는 직접 접속 주소만 허용하며 CSRF 토큰 검사도 유지합니다.
PHP 7.4.30: 단위 검사 41개 + HTTP 검사 80개 통과.
실제 NAS 반영과 휴대폰 테스트는 업로드 후 진행해야 합니다.
`;
await saveDeployment({name:'HOME_게시판_수정',files:{
  'server/routes.php':new Uint8Array(await readFile(source)),
  'UPDATE.txt':new TextEncoder().encode(instructions),
},guide:instructions});
await import('./build-webstation.mjs');
