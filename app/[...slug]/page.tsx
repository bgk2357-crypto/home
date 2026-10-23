import { LegalResources } from "../legal-resources";
import { notFound } from "next/navigation";
import { EmptyState, Footer, Header, PageHeading } from "../components";
import { company, navigation, newsGroups, services } from "../content";
import { signInPath, getUser } from "../auth";
import { NaverMap } from "../naver-map";
import { setting } from "../runtime-config";
import { CommunityBoard } from "../community-board";
import { displayDate, getEntries, getMember, getPosts, pageNumber } from "../data";

export const dynamic = "force-dynamic";
type Query = { page?: string; error?: string; saved?: string; post?: string; write?: string };
const errors: Record<string, string> = {
  invalid: "입력 항목과 글자 수를 확인해주세요. 공백만 입력할 수 없습니다.",
  consent: "가입 안내를 읽고 동의 항목을 선택해주세요.",
  capacity: "게시글 등록 한도에 도달했습니다. 전화로 문의해주세요.",
  busy: "지금은 저장할 수 없습니다. 잠시 후 다시 시도해주세요.",
};
function Messages({ query }: { query: Query }) { return <>{query.error && <p className="notice error" role="alert">{errors[query.error] ?? "요청을 처리하지 못했습니다. 다시 확인해주세요."}</p>}{query.saved === "1" && <p className="notice success" role="status">등록되었습니다.</p>}</>; }
function Pagination({ path, page, pages }: { path: string; page: number; pages: number }) { return <nav className="pagination" aria-label="게시글 페이지">{page > 1 && <a href={`${path}?page=${page - 1}`}>← 이전</a>}<span>{page} / {pages}</span>{page < pages && <a href={`${path}?page=${page + 1}`}>다음 →</a>}</nav>; }
function Access({ signedIn, target }: { signedIn: boolean; target: string }) { return <div className="access-card"><h2>회원 전용 서비스입니다</h2><p>Google 계정으로 로그인한 뒤 홈페이지 회원가입을 완료해주세요.</p><a className="button" href={signedIn ? "/join" : signInPath(target)} target={signedIn ? undefined : "_top"}>{signedIn ? "홈페이지 회원가입" : "Google로 로그인"} →</a></div>; }
function Subnav({ category, current }: { category: string; current: string }) { const group = navigation.find(item => item.children.some(([, href]) => href.startsWith(`/${category}/`))); return <nav className="subnav" aria-label="하위 메뉴">{group?.children.map(([label, href]) => <a className={current === href ? "active" : ""} href={href} key={href} aria-current={current === href ? "page" : undefined}>{label}</a>)}</nav>; }

async function Guestbook({ query }: { query: Query }) {
  const data = await getEntries(pageNumber(query.page));
  return <><PageHeading eyebrow="방명록" title="반가운 인사를 남겨주세요" description="회원가입이나 로그인 없이 누구나 작성할 수 있는 열린 방명록입니다." /><Messages query={query} /><div className="form-grid"><section className="form-panel"><h2>방명록 쓰기</h2><p className="muted">Argo&Health Lab에 전하고 싶은 한마디</p><form action="/actions/guestbook" method="post"><label htmlFor="author">이름 <small>최대 30자</small></label><input id="author" name="author" required maxLength={30} autoComplete="nickname" /><label htmlFor="body">내용 <small>최대 500자</small></label><textarea id="body" name="body" required maxLength={500} rows={6} /><p className="form-help">작성한 이름과 글은 공개됩니다. 연락처나 민감한 정보는 남기지 마세요.</p><button className="button" type="submit">인사 남기기 →</button></form></section><section className="board-panel"><div className="board-top"><h2>남겨진 인사</h2><span>{data.total}개의 글 · 최신순</span></div>{data.items.length ? data.items.map(item => <article className="board-entry" key={item.id}><div className="entry-top"><strong>{item.author}</strong><time dateTime={item.createdAt}>{displayDate(item.createdAt)}</time></div><p>{item.body}</p></article>) : <EmptyState title="첫 인사를 기다리고 있어요" description="왼쪽 양식에서 자유롭게 인사를 남겨주세요." />}<Pagination path="/guestbook" page={data.current} pages={data.pages} /></section></div></>;
}

async function Join({ query }: { query: Query }) {
  const user = await getUser();
  const member = await getMember(user?.userId);
  return <><PageHeading eyebrow="회원가입" title="Argo&Health Lab 회원가입" description="Google 계정으로 로그인한 후 홈페이지에서 사용할 이름을 등록합니다." /><div className="content-panel auth-panel"><Messages query={query} />{member ? <><span className="eyebrow">WELCOME</span><h2>이미 가입하셨습니다</h2><p className="muted">{member.displayName}님, 회원 전용 서비스를 이용하세요.</p><a className="button" href="/members">회원 서비스로 이동 →</a></> : user ? <><h2>마지막으로 이용 이름을 정해주세요</h2><p className="muted">비밀번호는 이 홈페이지에서 수집하거나 저장하지 않습니다.</p><form className="form-panel" action="/actions/join" method="post"><label htmlFor="displayName">이용 이름 <small>2~30자</small></label><input id="displayName" name="displayName" required minLength={2} maxLength={30} autoComplete="nickname" /><label className="checkbox-label"><input type="checkbox" name="consent" value="yes" required /><span><a href="/privacy">개인정보 안내</a>를 확인했습니다. 회원 식별자·이용 이름·가입일을 회원 서비스 제공을 위해 저장하는 데 동의합니다.</span></label><button type="submit" className="button">회원가입 완료 →</button></form></> : <><h2>Google 계정으로 시작하세요</h2><p className="muted">Google 로그인 후 홈페이지의 별도 이용 등록을 진행합니다. 방명록은 가입하지 않아도 작성할 수 있습니다.</p><a className="button" href={signInPath("/join")} target="_top">Google로 로그인하고 가입하기 →</a></>}</div></>;
}

async function Board({ kind, query }: { kind: "qna" | "community"; query: Query }) {
  const isQna = kind === "qna"; const path = isQna ? "/qna" : "/community";
  const user = await getUser(); const member = await getMember(user?.userId);
  const data = (!isQna || member) ? await getPosts(kind, pageNumber(query.page), user?.userId) : null;
  return <><PageHeading eyebrow={isQna ? "Q&A" : "커뮤니티"} title={isQna ? "나의 Q&A" : "함께 나누는 일터 이야기"} description={isQna ? "회원가입 후 문의를 작성하고 본인이 등록한 내용을 확인할 수 있습니다." : "게시글은 누구나 읽을 수 있고, 글쓰기는 홈페이지 회원만 이용할 수 있습니다."} /><Messages query={query} /><div className="form-grid"><section className="form-panel">{member ? <><h2>{isQna ? "문의 작성" : "이야기 작성"}</h2><p className="muted">{member.displayName}님으로 작성합니다.</p><form action={`/actions/${kind}`} method="post"><label htmlFor="title">제목 <small>최대 100자</small></label><input id="title" name="title" required maxLength={100} /><label htmlFor="body">내용 <small>최대 2,000자</small></label><textarea id="body" name="body" required maxLength={2000} rows={8} /><p className="form-help">{isQna ? "문의 내용은 본인의 화면에서만 조회됩니다. 별도 알림은 발송하지 않습니다. 빠른 상담은 전화로 문의해주세요." : "이용 이름과 작성한 글은 공개됩니다. 개인정보나 민감한 정보는 남기지 마세요."}</p><button type="submit" className="button">{isQna ? "문의 등록" : "글 등록"} →</button></form></> : <Access signedIn={!!user} target={path} />}</section><section className="board-panel"><div className="board-top"><h2>{isQna ? "내 문의 내역" : "커뮤니티 글"}</h2><span>{data?.total ?? 0}개의 글</span></div>{data?.items.length ? data.items.map(item => <article className="board-entry" key={item.id}><div className="entry-top"><strong>{item.author}{isQna && <span className="status-badge">등록됨</span>}</strong><time dateTime={item.createdAt}>{displayDate(item.createdAt)}</time></div><h3>{item.title}</h3><p>{item.body}</p></article>) : <EmptyState title={isQna ? member ? "등록한 문의가 없습니다" : "회원가입 후 이용해주세요" : "첫 이야기를 기다립니다"} description={isQna ? "본인의 문의만 표시되며 다른 회원에게 공개되지 않습니다." : "건강한 일터에 관한 생각을 함께 나눠보세요."} />}{data && <Pagination path={path} page={data.current} pages={data.pages} />}</section></div></>;
}

async function Members() {
  const user = await getUser(); const member = await getMember(user?.userId);
  return <><PageHeading eyebrow="회원 전용 서비스" title="회원 전용 서비스" description="회원정보를 확인하고 안전보건 문의를 남겨주세요." /><div className="content-panel">{member ? <><span className="eyebrow">MY ACCOUNT</span><h2>{member.displayName}님, 반갑습니다</h2><dl className="profile-list"><dt>이용 이름</dt><dd>{member.displayName}</dd><dt>가입일</dt><dd>{displayDate(member.createdAt)}</dd><dt>로그인 방식</dt><dd>Google 계정</dd></dl><div className="subnav"><a href="/qna">나의 Q&A →</a><a href="/community">커뮤니티 →</a><a href="/resources/osh-law">자료실 →</a></div></> : <Access signedIn={!!user} target="/members" />}</div></>;
}

function Information({ path }: { path: string }) {
  const segments = path.split("/"); const category = segments[1];
  const menu = navigation.flatMap(item => item.children).find(([, href]) => href === path);
  if (!menu) notFound();
  const [title] = menu;
  let content;
  if (path === "/company/greeting") content = <div className="prose"><p className="eyebrow">MESSAGE FROM THE REPRESENTATIVE</p><h2>사람을 중심에 두고,<br />현장에서 답을 찾겠습니다.</h2><p>안녕하세요. Argo&Health Lab 대표 김지훈입니다.</p><p>건강한 일터는 사람을 이해하는 데서 시작합니다. Argo&Health Lab은 사업장과 근로자의 관점에서 안전과 건강을 함께 고민하는 파트너가 되고자 합니다.</p><p>안전보건관리체계 구축, 위험성평가, 근골격계부담작업 유해요인조사에 관한 안내를 홈페이지에서 확인하시고, 사업 안내가 필요하시면 편하게 문의해주세요.</p><p>Argo&Health Lab 대표 <strong>김지훈</strong></p></div>;
  else if (path === "/company/vision") content = <div className="prose"><h2>안전한 현장, 건강한 사람, 지속 가능한 일터</h2><p>사람의 안전과 건강을 중심에 두고 현장에서 실행할 수 있는 개선 방향을 함께 찾는 것을 지향합니다.</p><h3>사람 중심</h3><p>근로자와 사업장의 이야기를 듣고 이해합니다.</p><h3>현장 중심</h3><p>업무 환경과 작업 특성을 살펴 실천 가능한 방향을 고민합니다.</p><h3>지속적인 개선</h3><p>한 번의 점검을 넘어 일상적인 안전보건 활동을 지향합니다.</p></div>;
  else if (path === "/company/location") content = <div className="prose"><h2>Argo&Health Lab 찾아오는길</h2><div className="location-box"><strong>{company.address}</strong><p>방문 전 연락주시면 상세 위치를 안내해드립니다.</p><a className="button" href="tel:01076519208">{company.phone} 전화하기 →</a></div><NaverMap clientId={setting("NAVER_MAP_CLIENT_ID")} /><a className="button secondary" href="https://map.naver.com/p/search/%EA%B2%BD%EA%B8%B0%EB%8F%84%20%EC%95%88%EC%82%B0%EC%8B%9C%20%EC%83%81%EB%A1%9D%EA%B5%AC%20%ED%8C%94%EA%B3%A1%EC%9D%BC%EB%8F%99" target="_blank" rel="noopener noreferrer">주변 지역 지도 보기 ↗</a></div>;
  else if (path === "/company/organization") content = <div className="prose"><h2>조직도</h2><div className="location-box"><strong>대표 김지훈</strong><p>Argo&Health Lab</p></div><p>부서와 담당자 정보는 확정 후 등록합니다.</p></div>;
  else if (category === "business" && path !== "/business/achievements") { const service = services.find(item => item.href === path)!; content = <div className="prose"><h2>{service.title}</h2><p>{service.description}</p><h3>상담 시 함께 살펴볼 내용</h3><ul>{service.points.map(point => <li key={point}>{point}</li>)}</ul><p>구체적인 제공 범위와 일정은 사업장의 상황을 확인한 뒤 협의합니다.</p><a className="button" href="/qna">회원 Q&A로 문의하기 →</a></div>; }
  else if (category === "resources") content = <LegalResources path={path} />;
  else content = <EmptyState title={category === "news" ? "아직 등록된 소식이 없습니다" : "내용 등록 예정"} description={path === "/company/history" ? "확인된 회사 연혁을 준비하고 있습니다." : path === "/business/achievements" ? "공개 가능한 수행 실적을 정리해 등록할 예정입니다." : "등록된 소식은 이 페이지에서 확인할 수 있습니다."} />;
  return <><PageHeading eyebrow={navigation.find(item => item.children.some(([, href]) => href === path))?.label ?? "안내"} title={title} description={category === "company" ? "사람과 현장을 생각하는 Argo&Health Lab을 소개합니다." : category === "business" ? "사업장의 안전과 건강을 위한 사업범위를 안내합니다." : category === "resources" ? "안전보건 관련 공식 자료를 확인하세요." : newsGroups.find(item => item.href === path)?.description ?? "산업보건 소식을 안내합니다."} /><Subnav category={category} current={path} /><section className="content-panel">{content}</section></>;
}

export default async function ContentPage({ params, searchParams }: { params: Promise<{ slug: string[] }>; searchParams: Promise<Query> }) {
  const { slug } = await params; const query = await searchParams; const path = "/" + slug.join("/");
  let content;
  if (path === "/guestbook") content = await Guestbook({ query });
  else if (path === "/join") content = await Join({ query });
  else if (path === "/members") content = await Members();
  else if (path === "/community") content = await CommunityBoard({ query });
  else if (path === "/qna") content = await Board({ kind: "qna", query });
  else if (path === "/privacy") content = <><PageHeading eyebrow="개인정보 안내" title="개인정보 안내" description="홈페이지의 회원 서비스와 게시글 처리 범위를 안내합니다." /><div className="content-panel prose"><h2>수집·저장하는 정보</h2><p>회원 식별을 위한 Google 사용자 식별자·이메일·이름, 홈페이지 이용 이름, 가입일을 저장합니다. 비밀번호는 수집하지 않습니다. 회원정보는 회원 서비스 제공과 문의 작성자 확인에 사용합니다.</p><h3>게시글</h3><p>방명록의 이름·내용·작성일과 커뮤니티의 이용 이름·제목·내용·작성일은 공개됩니다. Q&A는 작성한 회원 본인의 화면에서만 조회됩니다. 사이트 소유자는 운영 데이터에 접근할 수 있습니다. 주민등록번호나 건강상태 등 민감한 정보는 입력하지 마세요.</p><h3>보관 및 삭제 문의</h3><p>게시글과 회원정보는 운영자가 삭제하기 전까지 보관됩니다. 회원정보·게시글 삭제 및 운영 문의는 대표 김지훈({company.phone})에게 연락해주세요.</p><p className="muted">정식 운영 전 회사의 실제 처리 절차에 맞춰 개인정보처리방침을 확정해야 합니다.</p></div></>;
  else content = <Information path={path} />;
  return <><Header /><main className="page-main container" id="main-content">{content}</main><Footer /></>;
}
