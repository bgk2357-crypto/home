<?php
require getenv('ARGO_SERVER_ROOT') . '/bootstrap.php';
require getenv('ARGO_SERVER_ROOT') . '/news.php';
require getenv('ARGO_SERVER_ROOT') . '/routes.php';
$checks = 0;
function equal($actual, $expected) { global $checks; $checks++; if ($actual !== $expected) throw new RuntimeException('Check failed: ' . json_encode([$actual, $expected], JSON_UNESCAPED_UNICODE)); }
equal(safe_path('//evil.test'), '/'); equal(safe_path('/\\evil.test'), '/'); equal(safe_path('/auth/logout'), '/'); equal(safe_path('/qna?page=2'), '/qna?page=2');
equal(route_url('/auth/google/callback'), '/index.php?route=%2Fauth%2Fgoogle%2Fcallback');
$signed = sign_value(['type' => 'test', 'exp' => time() + 60]); equal(read_value($signed)['type'], 'test'); equal(read_value($signed . 'tampered'), null); equal(read_value(sign_value(['exp' => time() - 1])), null);
equal(field(['name' => '  한글 이름  '], 'name', 5), '한글 이름'); equal(field(['name' => '   '], 'name', 30), null); equal(field(['name' => str_repeat('한', 31)], 'name', 30), null);
equal(parse_form('author=a&author=b'), null); equal(parse_form('author=%FF'), null);
equal(news_date('2026.10.23'), '2026-10-22T15:00:00.000Z');
$sources = json_decode(file_get_contents(getenv('ARGO_SERVER_ROOT') . '/news-sources.json'), true);
$byId = array_column($sources, null, 'id'); $general = $byId['news-safety']; $kiha = $byId['kiha-notice']; $today = gmdate('Y-m-d');
$xml = '<rss><channel><item><title><![CDATA[산업안전 &amp; 화학물질 누출 &#xC0AC;고 - 테스트신문]]></title><link>https://example.com/news?id=1&amp;utm_source=test</link><pubDate>' . $today . 'T09:00:00+09:00</pubDate><source>테스트신문</source></item></channel></rss>';
$parsed = news_parse($xml, $general);
equal(count($parsed), 1); equal($parsed[0]['title'], '산업안전 & 화학물질 누출 사고'); equal($parsed[0]['publisher'], '테스트신문'); equal($parsed[0]['url'], 'https://example.com/news?id=1'); equal($parsed[0]['topics'], ['안전', '화학물질']);
equal(news_url('javascript:alert(1)', $general['url'], false), null); equal(news_url('https://evil.test/a', $byId['moel-notice']['url'], true), null); equal(news_url('', $general['url'], false), null);
$board = '<table><tr><td><a href="community_view.htm?uid=1&amp;tbn=gongi">[정보마당] 산업보건 화학물질 포럼</a></td><td>' . $today . '</td></tr></table>';
$rows = news_parse($board, $kiha); equal($rows[0]['url'], 'https://www.kiha.kr/main/community_view.htm?uid=1&tbn=gongi'); equal($rows[0]['publishedAt'], news_date($today));
equal(count(news_deduplicate(array_merge($parsed, [$parsed[0]]))), 1);
equal(news_parse(json_encode(['result' => 'success', 'payload' => [['pstNm' => '안전 알림', 'wrtDt' => $today, 'contentsLinkUrl' => 'https://evil.test/x']]]), $byId['kosha-notice']), []);
$calls = 0; $fail = false;
$request = function ($batch) use (&$calls, &$fail, $xml, $board, $today) {
    $results = [];
    foreach ($batch as $source) {
        $calls++;
        if ($fail) { $results[$source['id']] = null; continue; }
        if ($source['format'] === 'kosha') $body = json_encode(['result' => 'success', 'payload' => [['pstNm' => '화학물질 누출사고 안전 알림', 'wrtDt' => $today, 'contentsLinkUrl' => '/community/notice?pstNo=' . $source['id']]]], JSON_UNESCAPED_UNICODE);
        elseif ($source['format'] === 'board') $body = $source['id'] === 'kiha-notice' ? $board : '<table><tr><td><a href="enewsView.do?news_seq=1">산업안전 감독 결과</a></td><td>' . $today . '</td></tr></table>';
        else $body = $source['kind'] === 'general' ? $xml : str_replace('https://example.com/news?id=1&amp;utm_source=test', 'https://www.moel.go.kr/news/notice/noticeView.do?bbs_seq=1', $xml);
        $results[$source['id']] = $body;
    }
    return $results;
};
$first = news_result('trends', $request); equal($calls, 6); equal(count(array_filter($first['sources'], function ($source) { return $source['status'] === 'ok'; })), 6); equal(count($first['articles']) > 0, true);
news_result('trends', $request); equal($calls, 6);
db()->exec("UPDATE news_feed_cache SET checked_at='2000-01-01T00:00:00Z' WHERE source_id='kosha-notice'"); $fail = true;
$stale = news_result('trends', $request); equal($calls, 7); equal($stale['sources'][0]['status'], 'stale'); equal(count($stale['articles']), count($first['articles'])); news_result('trends', $request); equal($calls, 7);
$unavailable = news_result('general', $request); equal($unavailable['articles'], []); equal($unavailable['sources'][0]['status'], 'unavailable');
$fail = false; db()->exec("UPDATE news_feed_cache SET checked_at='2000-01-01T00:00:00Z'"); news_result('trends', $request); news_result('general', $request);
$seen = [];
$identity = oauth_identity('code', 'verifier', function ($url, $post = null, $bearer = null) use (&$seen) {
    $seen[] = [$url, $post, $bearer];
    if ($post !== null) return ['access_token' => 'test-token'];
    return ['sub' => '1234', 'email' => 'test@example.test', 'email_verified' => true, 'name' => '테스트 회원'];
});
equal($identity['userId'], 'google:1234'); equal($seen[0][1]['code_verifier'], 'verifier'); equal($seen[0][1]['redirect_uri'], config()['app_origin'] . '/index.php?route=%2Fauth%2Fgoogle%2Fcallback'); equal($seen[1][2], 'test-token');
$rejected = false; try { oauth_identity('bad', 'bad', function ($url, $post = null) { return $post !== null ? ['access_token' => 'token'] : ['sub' => 'fake', 'email' => 'fake@test', 'email_verified' => false]; }); } catch (Throwable $error) { $rejected = true; } equal($rejected, true);
echo $checks . " PHP unit checks passed: signed sessions, OAuth PKCE exchange, verification, validation, news parsers, cache/retry/stale fallback.\n";
