<?php
function news_plain($text) {
    $text = preg_replace('/<!\[CDATA\[([\s\S]*?)\]\]>/', '$1', (string)$text);
    $text = preg_replace('#<script\b[^>]*>[\s\S]*?</script>#i', '', $text);
    return trim(preg_replace('/\s+/u', ' ', html_entity_decode(strip_tags($text), ENT_QUOTES | ENT_HTML5, 'UTF-8')));
}
function news_topics($title) {
    $topics = [];
    foreach (['안전' => '/안전|재해|산재|추락|끼임|붕괴|폭발|사고/u', '보건' => '/보건|위생|직업병|건강|중독|질식|작업환경|근골격|유해|납\s/u', '사망사고' => '/사망|숨져|숨진|중대재해|중대산업/u', '화학물질' => '/화학|누출|유출|가스|유해물질|유해인자|중독|MSDS|물질안전/u', '화재' => '/화재|불길|불이\s?나|산불|소방|폭발/u'] as $topic => $pattern) if (preg_match($pattern, $title)) $topics[] = $topic;
    return $topics;
}
function news_date($value) {
    $text = news_plain($value); if ($text === '') return null;
    try {
        if (preg_match('/^(\d{4})[.\-\/](\d{1,2})[.\-\/](\d{1,2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/D', $text, $m)) {
            $text = sprintf('%04d-%02d-%02dT%s:%s:%s+09:00', $m[1], $m[2], $m[3], $m[4] ?? '00', $m[5] ?? '00', $m[6] ?? '00');
        }
        $date = new DateTimeImmutable($text, new DateTimeZone('UTC')); return $date->setTimezone(new DateTimeZone('UTC'))->format('Y-m-d\TH:i:s.000\Z');
    } catch (Throwable $error) { return null; }
}
function news_url($value, $base, $institution) {
    $value = news_plain($value); if ($value === '' || preg_match('/[\x00-\x20\x7f\\\\]/', $value)) return null;
    $root = parse_url($base);
    if (substr($value, 0, 2) === '//') $value = $root['scheme'] . ':' . $value;
    elseif (!preg_match('/^[a-zA-Z][a-zA-Z0-9+.-]*:/', $value)) {
        $value = $root['scheme'] . '://' . $root['host'] . ($value[0] === '/' ? '' : preg_replace('#/[^/]*$#', '/', $root['path'] ?? '/')) . $value;
    }
    $url = parse_url($value);
    if (!$url || !in_array(strtolower($url['scheme'] ?? ''), ['https', 'http'], true) || empty($url['host']) || isset($url['user']) || isset($url['pass']) || ($institution && strtolower($url['host']) !== strtolower($root['host']))) return null;
    $query = [];
    foreach (explode('&', $url['query'] ?? '') as $pair) { if ($pair !== '' && !preg_match('/^(utm_|fbclid|gclid)/i', urldecode(explode('=', $pair, 2)[0]))) $query[] = $pair; }
    return strtolower($url['scheme']) . '://' . strtolower($url['host']) . (isset($url['port']) ? ':' . $url['port'] : '') . ($url['path'] ?? '/') . ($query ? '?' . implode('&', $query) : '');
}
function news_article($title, $link, $date, $source, $publisher = '') {
    $title = mb_substr(news_plain($title), 0, 400, 'UTF-8');
    $name = mb_substr(news_plain($publisher ?: ($source['institution'] ?? $source['name'])), 0, 100, 'UTF-8');
    $suffix = ' - ' . $name;
    if ($source['kind'] === 'general' && substr($title, -strlen($suffix)) === $suffix) $title = trim(substr($title, 0, -strlen($suffix)));
    $url = news_url($link, $source['url'], $source['kind'] === 'trends');
    if ($title === '' || $url === null) return null;
    $topics = news_topics($title);
    if (!$topics && ($source['id'] !== 'kiha-notice' || preg_match('/구인구직|채용|연회비|평의원|선거|회비/u', $title))) return null;
    return ['title' => $title, 'url' => $url, 'publisher' => $name, 'sourceId' => $source['id'], 'publishedAt' => news_date($date), 'topics' => $topics];
}
function news_tag($block, $tag) { return preg_match('#<' . preg_quote($tag, '#') . '(?:\s[^>]*)?>([\s\S]*?)</' . preg_quote($tag, '#') . '>#i', $block, $m) ? $m[1] : ''; }
function news_parse($body, $source) {
    $items = [];
    if ($source['format'] === 'kosha') {
        $data = json_decode($body, true, 128, JSON_THROW_ON_ERROR);
        if (($data['result'] ?? '') !== 'success' || !is_array($data['payload'] ?? null)) throw new RuntimeException('Invalid KOSHA response');
        foreach ($data['payload'] as $row) { $item = news_article($row['pstNm'] ?? '', $row['contentsLinkUrl'] ?? '', $row['wrtDt'] ?? '', $source); if ($item) $items[] = $item; }
    } elseif ($source['format'] === 'board') {
        preg_match_all('#<tr\b[^>]*>[\s\S]*?</tr>#i', $body, $rows); $matched = 0;
        foreach ($rows[0] as $row) {
            $date = ''; preg_match_all('#<td\b[^>]*>([\s\S]*?)</td>#i', $row, $cells);
            foreach ($cells[1] as $cell) { $value = news_plain($cell); if (preg_match('/^20\d{2}[.\-\/]\d{1,2}[.\-\/]\d{1,2}$/D', $value)) { $date = $value; break; } }
            preg_match_all('#<a\b[^>]*href\s*=\s*["\']([^"\']+)["\'][^>]*>([\s\S]*?)</a>#i', $row, $links, PREG_SET_ORDER);
            foreach ($links as $link) {
                if (!preg_match($source['id'] === 'kiha-notice' ? '/community_view\.htm\?.*\buid=/' : '/enewsView\.do\?.*\bnews_seq=/', $link[1])) continue;
                $matched++; $item = news_article($link[2], $link[1], $date, $source); if ($item) $items[] = $item;
            }
        }
        if (!$matched) throw new RuntimeException('Board layout changed');
    } else {
        if (!preg_match('/<(?:rss|feed)\b/i', $body) || preg_match('/<!DOCTYPE/i', $body)) throw new RuntimeException('Invalid RSS response');
        preg_match_all('#<item\b[^>]*>([\s\S]*?)</item>#i', $body, $blocks);
        foreach ($blocks[1] as $block) { $item = news_article(news_tag($block, 'title'), news_tag($block, 'link'), news_tag($block, 'pubDate') ?: news_tag($block, 'dc:date'), $source, news_tag($block, 'source')); if ($item) $items[] = $item; }
    }
    return $items;
}
function news_deduplicate($items) {
    usort($items, function ($a, $b) { return (strtotime($b['publishedAt'] ?? '') ?: 0) <=> (strtotime($a['publishedAt'] ?? '') ?: 0); });
    $urls = []; $titles = []; $result = [];
    foreach ($items as $item) {
        $key = $item['publisher'] . ':' . mb_strtolower(preg_replace('/[\s\p{P}]/u', '', $item['title']), 'UTF-8');
        if (isset($urls[$item['url']]) || isset($titles[$key])) continue;
        $urls[$item['url']] = true; $titles[$key] = true; $result[] = $item;
    }
    return $result;
}
function news_requests($sources) {
    $results = [];
    foreach (array_chunk($sources, 4) as $batch) {
        $multi = curl_multi_init(); $handles = []; $bodies = [];
        foreach ($batch as $source) {
            $id = $source['id']; $bodies[$id] = ''; $curl = curl_init($source['url']);
            $headers = ['Accept: application/rss+xml, application/xml, text/html, application/json'];
            if (($source['method'] ?? '') === 'POST') $headers = array_merge($headers, ['Content-Type: application/json', 'chnlId: portal24']);
            curl_setopt_array($curl, [CURLOPT_TIMEOUT => 12, CURLOPT_CONNECTTIMEOUT => 6, CURLOPT_FOLLOWLOCATION => true, CURLOPT_MAXREDIRS => 3, CURLOPT_PROTOCOLS => CURLPROTO_HTTPS, CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTPS, CURLOPT_ENCODING => '', CURLOPT_HTTPHEADER => $headers, CURLOPT_USERAGENT => 'ArgoHealthLab/1.0', CURLOPT_WRITEFUNCTION => function ($handle, $chunk) use (&$bodies, $id) { if (strlen($bodies[$id]) + strlen($chunk) > 1500000) return 0; $bodies[$id] .= $chunk; return strlen($chunk); }]);
            if (($source['method'] ?? '') === 'POST') curl_setopt_array($curl, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => '{}']);
            curl_multi_add_handle($multi, $curl); $handles[$id] = $curl;
        }
        do { $status = curl_multi_exec($multi, $running); if ($running && curl_multi_select($multi, 0.5) === -1) usleep(10000); } while ($running && $status === CURLM_OK);
        foreach ($handles as $id => $curl) {
            $status = curl_getinfo($curl, CURLINFO_HTTP_CODE); $type = curl_getinfo($curl, CURLINFO_CONTENT_TYPE) ?: '';
            if (curl_errno($curl) || $status < 200 || $status >= 300) $results[$id] = null;
            else {
                $body = $bodies[$id]; $charset = '';
                if (preg_match('/charset=([^;\s]+)/i', $type, $m) || preg_match('/charset=["\']?([\w-]+)/i', substr($body, 0, 1500), $m)) $charset = trim($m[1], '"\'');
                if ($charset && strcasecmp($charset, 'utf-8') !== 0) { try { $body = mb_convert_encoding($body, 'UTF-8', $charset); } catch (Throwable $error) { $body = ''; } }
                $results[$id] = $body;
            }
            curl_multi_remove_handle($multi, $curl); curl_close($curl);
        }
        curl_multi_close($multi);
    }
    return $results;
}
function news_snapshot($source, $previous, $body, $now) {
    try {
        if ($body === null) throw new RuntimeException('Source unavailable');
        $items = news_deduplicate(news_parse($body, $source)); $oldest = time() - ($source['kind'] === 'general' ? 30 : 180) * 86400;
        $items = array_slice(array_values(array_filter($items, function ($item) use ($oldest) { $time = $item['publishedAt'] ? strtotime($item['publishedAt']) : null; return $time === null || ($time >= $oldest && $time <= time() + 86400); })), 0, 100);
        return ['items' => $items, 'fetchedAt' => $now, 'checkedAt' => $now, 'failed' => false];
    } catch (Throwable $error) {
        $usable = $previous && $previous['fetchedAt'] && time() - strtotime($previous['fetchedAt']) < 7 * 86400;
        return ['items' => $usable ? $previous['items'] : [], 'fetchedAt' => $usable ? $previous['fetchedAt'] : null, 'checkedAt' => $now, 'failed' => true];
    }
}
function news_result($kind, $request = 'news_requests') {
    $sources = array_values(array_filter(json_decode(file_get_contents(__DIR__ . '/news-sources.json'), true, 64, JSON_THROW_ON_ERROR), function ($source) use ($kind) { return $source['kind'] === $kind; }));
    $snapshots = []; $refresh = []; $now = now_iso(); $db = db();
    foreach ($sources as $source) {
        $query = $db->prepare('SELECT items_json,fetched_at,checked_at,failed FROM news_feed_cache WHERE source_id=?'); $query->execute([$source['id']]); $row = $query->fetch();
        $previous = $row ? ['items' => json_decode($row['items_json'], true), 'fetchedAt' => $row['fetched_at'], 'checkedAt' => $row['checked_at'], 'failed' => (bool)$row['failed']] : null;
        $snapshots[$source['id']] = $previous;
        if (!$previous || time() - strtotime($previous['checkedAt']) >= ($previous['failed'] ? 300 : 1800)) $refresh[] = $source;
    }
    $responses = $refresh ? $request($refresh) : [];
    foreach ($refresh as $source) {
        $snapshot = news_snapshot($source, $snapshots[$source['id']], $responses[$source['id']] ?? null, $now); $snapshots[$source['id']] = $snapshot;
        $query = $db->prepare('INSERT OR REPLACE INTO news_feed_cache(source_id,items_json,fetched_at,checked_at,failed) VALUES (?,?,?,?,?)');
        $query->execute([$source['id'], json_encode($snapshot['items'], JSON_UNESCAPED_UNICODE), $snapshot['fetchedAt'], $snapshot['checkedAt'], $snapshot['failed'] ? 1 : 0]);
    }
    $articles = []; $statuses = [];
    foreach ($sources as $source) {
        $snapshot = $snapshots[$source['id']]; $articles = array_merge($articles, $snapshot['items']);
        $statuses[] = ['id' => $source['id'], 'name' => $source['name'], 'homepage' => $source['homepage'], 'count' => count($snapshot['items']), 'fetchedAt' => $snapshot['fetchedAt'], 'checkedAt' => $snapshot['checkedAt'], 'status' => $snapshot['failed'] ? ($snapshot['fetchedAt'] ? 'stale' : 'unavailable') : 'ok'];
    }
    return ['articles' => array_slice(news_deduplicate($articles), 0, 150), 'sources' => $statuses, 'generatedAt' => $now, 'refreshMinutes' => 30];
}
