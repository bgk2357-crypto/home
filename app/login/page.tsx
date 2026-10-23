import { Footer, Header, PageHeading } from "../components";
import { getUser } from "../auth";
import { safeReturnPath } from "../auth/session";
import { setting } from "../runtime-config";

export const dynamic = "force-dynamic";
const errors: Record<string, string> = {
  configuration: "구글 로그인을 준비 중입니다. 설정이 완료되면 이용할 수 있습니다.",
  origin: "구글 로그인은 등록된 홈페이지 주소에서 이용해주세요.",
  cancelled: "로그인이 취소되었거나 요청이 만료되었습니다. 다시 시도해주세요.",
  failed: "구글 로그인에 실패했습니다. 잠시 후 다시 시도해주세요.",
};
export default async function Login({ searchParams }: { searchParams: Promise<{ return_to?: string; error?: string }> }) {
  const query = await searchParams; const user = await getUser();
  const ready = !!setting("GOOGLE_CLIENT_ID") && !!setting("GOOGLE_CLIENT_SECRET") && setting("AUTH_SECRET").length >= 32 && !!setting("APP_ORIGIN");
  const returnTo = safeReturnPath(query.return_to ?? "/members");
  return <><Header /><main className="page-main container" id="main-content"><PageHeading eyebrow="로그인" title="구글 계정으로 로그인" description="사용하는 구글 계정으로 Argo&Health Lab을 이용하세요." /><section className="content-panel auth-panel">
    {query.error && <p className="notice error" role="alert">{errors[query.error] ?? errors.failed}</p>}
    {user ? <><h2>{user.displayName}님, 로그인되어 있습니다</h2><a className="button" href={returnTo}>계속하기 →</a></> : <><h2>반갑습니다</h2><p className="muted">방명록과 커뮤니티는 로그인 없이 이용할 수 있습니다. 회원 전용 서비스는 로그인 후 이용하세요.</p>
      {ready ? <a className="button google-button" href={`/auth/google?return_to=${encodeURIComponent(returnTo)}`} target="_top"><span aria-hidden="true">G</span> Google 계정으로 계속하기</a> : <p className="notice" role="status">구글 로그인을 준비 중입니다. 설정이 완료되면 이용할 수 있습니다.</p>}
      <p className="form-help"><a href="/privacy">개인정보 안내</a> · 비밀번호는 이 홈페이지에 저장되지 않습니다.</p></>}
  </section></main><Footer /></>;
}
