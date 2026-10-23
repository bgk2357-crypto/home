import { EmptyState, PageHeading } from "./components";
import { getUser, signInPath } from "./auth";
import { displayDate, getCommunityPost, getMember, getPosts, pageNumber } from "./data";

export async function CommunityBoard({ query }: { query: { page?: string; post?: string; write?: string; saved?: string; error?: string } }) {
  const user = await getUser(); const member = await getMember(user?.userId);
  const data = await getPosts("community", pageNumber(query.page));
  const selected = query.post ? await getCommunityPost(Number(query.post)) : null;
  return <><PageHeading eyebrow="커뮤니티" title="커뮤니티 게시판" description="누구나 읽고, 구글 계정으로 로그인한 후 글을 작성할 수 있습니다." />
    {query.saved === "1" && <p className="notice success" role="status">게시글을 등록했습니다.</p>}
    {query.error && <p className="notice error" role="alert">{query.error === "invalid" ? "제목과 내용을 확인해주세요. 제목은 100자, 내용은 2,000자까지 입력할 수 있습니다." : query.error === "capacity" ? "게시글 등록 한도에 도달했습니다." : "저장하지 못했습니다. 잠시 후 다시 시도해주세요."}</p>}
    {query.post && !selected && <p className="notice error" role="alert">게시글을 찾을 수 없습니다.</p>}
    {selected && <article className="board-panel post-detail"><h2>{selected.title}</h2><div className="entry-top"><strong>{selected.author}</strong><time dateTime={selected.createdAt}>{displayDate(selected.createdAt)}</time></div><p>{selected.body}</p><a className="button secondary" href="/community">목록으로 →</a></article>}
    <section className="board-panel"><div className="board-top"><h2>전체 게시글 <span>{data.total}개</span></h2><a className="button" href={user ? "/community?write=1#write-post" : signInPath("/community?write=1")}>{user ? "글쓰기" : "로그인 후 글쓰기"} →</a></div>
      <div className="board-table-wrap"><table className="board-table"><caption className="sr-only">커뮤니티 게시글 목록</caption><thead><tr><th scope="col">번호</th><th scope="col">제목</th><th scope="col">작성자</th><th scope="col">작성일</th></tr></thead><tbody>{data.items.length ? data.items.map(item => <tr key={item.id}><td>{item.id}</td><td><a href={`/community?post=${item.id}`}>{item.title}</a></td><td>{item.author}</td><td><time dateTime={item.createdAt}>{displayDate(item.createdAt)}</time></td></tr>) : <tr><td colSpan={4}><EmptyState title="첫 게시글을 기다립니다" description="로그인 후 건강한 일터의 이야기를 남겨주세요." /></td></tr>}</tbody></table></div>
      <nav className="pagination" aria-label="게시글 페이지">{data.current > 1 && <a href={`/community?page=${data.current - 1}`}>← 이전</a>}<span>{data.current} / {data.pages}</span>{data.current < data.pages && <a href={`/community?page=${data.current + 1}`}>다음 →</a>}</nav>
    </section>
    {query.write === "1" && <section className="form-panel" id="write-post">{user ? <><h2>커뮤니티 글쓰기</h2><p className="muted">{member?.displayName ?? user.displayName}님으로 작성합니다.</p><form action="/actions/community" method="post"><label htmlFor="title">제목 <small>최대 100자</small></label><input id="title" name="title" required maxLength={100} /><label htmlFor="body">내용 <small>최대 2,000자</small></label><textarea id="body" name="body" required maxLength={2000} rows={8} /><p className="form-help">작성자 이름과 글은 공개됩니다. 개인정보나 민감한 정보는 남기지 마세요.</p><button type="submit" className="button">글 등록 →</button></form></> : <><h2>로그인 후 작성할 수 있습니다</h2><a className="button" href={signInPath("/community?write=1")}>Google로 로그인 →</a></>}</section>}
  </>;
}
