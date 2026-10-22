
/* ZebMod v0.1.5 experimental (formerly Lampa Online).
 * Standalone ES5 plugin. Rezka contracts are static-source/fixture verified only.
 * Live Rezka returned an anti-bot page; no challenge or authorization bypass.
 */
(function () {
    'use strict';

    var FLAG = '__lampa_online_loaded';
    var PREFIX = 'lampa_online_';
    var COMPONENT = 'lampa_online_filmix_screen';
    var PROVIDERS_COMPONENT = 'lampa_online_provider_screen';
    var REZKA_COMPONENT = 'lampa_online_rezka_screen';
    var REZKA_ORIGIN = 'https://rezka.ag';
    var API_DEFAULT = 'https://filmixapp.cyou/api/v2/';

    if (window[FLAG]) return;
    window[FLAG] = true;

    var initialized = false;
    var readyHandler;

    function tr(key) { return Lampa.Lang.translate(PREFIX + key); }
    function setting(key, fallback) {
        var value = Lampa.Storage.get(PREFIX + key, fallback);
        // Storage.get coerces numeric strings, losing leading zeros/precision in IDs.
        if (typeof value !== 'string' && typeof Lampa.Storage.value === 'function') {
            return Lampa.Storage.value(PREFIX + key, fallback);
        }
        return value;
    }

    function uid() {
        var value = setting('device_id', '');
        if (!value) {
            value = '';
            for (var i = 0; i < 16; i++) value += Math.floor(Math.random() * 16).toString(16);
            Lampa.Storage.set(PREFIX + 'device_id', value);
        }
        return value;
    }

    function apiUrl(path, extra) {
        var base = String(setting('api_url', API_DEFAULT) || API_DEFAULT).trim();
        var proxy = String(setting('proxy', '') || '').trim();
        var token = String(setting('token', '') || '');
        if (!/^https?:\/\/[^\s\/?#@\\]+(?:\/[^\s?#\\]*)?$/i.test(base)) throw new Error(tr('bad_api'));
        if (proxy && !/^https:\/\/[^\s\/?#@\\]+(?:\/[^\s?#\\]*)?$/i.test(proxy)) throw new Error(tr('bad_proxy'));
        if (!proxy && !/^https:\/\//i.test(base)) throw new Error(tr('https_required'));
        if (base.charAt(base.length - 1) !== '/') base += '/';
        if (proxy && proxy.charAt(proxy.length - 1) !== '/') proxy += '/';
        var query = [
            'app_lang=ru_RU',
            'user_dev_apk=2.2.13',
            'user_dev_id=' + encodeURIComponent(uid()),
            'user_dev_name=Lampa',
            'user_dev_os=Android',
            'user_dev_vendor=Lampa',
            'user_dev_token=' + encodeURIComponent(token)
        ];
        if (extra) query.push(extra);
        return proxy + base + path + '?' + query.join('&');
    }

    function validUrl(url) { return /^https?:\/\/[^\s\/?#@\\]+\/[^\s]*$/i.test(url || ''); }
    function isPlayable(url) {
        return validUrl(url) && !/[\[\]<>"\\]/.test(url) && !/%s/i.test(url) && /\.(mp4|m3u8)(?:[?#]|$)/i.test(url);
    }
    function ownKeys(obj) {
        return obj && typeof obj === 'object' && !Array.isArray(obj) ? Object.keys(obj) : [];
    }
    function numberSort(a, b) { return parseInt(a, 10) - parseInt(b, 10); }
    function parseQualityList(text) {
        var list = [], seen = {}, items = String(text || '').split(',');
        for (var i = 0; i < items.length; i++) {
            var n = /^\s*\d+p?\s*$/.test(items[i]) ? parseInt(items[i], 10) : 0;
            if (n > 0 && n <= 4320 && !seen[n]) { list.push(n); seen[n] = true; }
        }
        return list.sort(function (a, b) { return b - a; });
    }

    // Only returns provider-advertised qualities; never fabricates stream resolutions.
    function mediaFromRecord(record, maxQuality) {
        if (!record || typeof record.link !== 'string') return null;
        var link = record.link.trim();
        var match = link.match(/\[([\d,\s]+)\]/);
        var levels = match ? parseQualityList(match[1]) : [];
        if (!levels.length && Array.isArray(record.qualities)) {
            levels = parseQualityList(record.qualities.join(','));
        }
        var map = {};
        var selected = '';
        var limit = Math.min(maxQuality || 480, 2160);
        var preferred = parseInt(Lampa.Storage.get('video_quality_default', '720'), 10);
        if (!preferred || preferred < 1) preferred = limit;

        if (match || /%s/i.test(link)) {
            for (var i = 0; i < levels.length; i++) {
                var q = levels[i];
                if (q > limit) continue;
                var url = match ? link.replace(match[0], String(q)) : link.replace(/%s/gi, String(q));
                if (isPlayable(url)) map[q + 'p'] = url;
            }
            var allowed = Object.keys(map).sort(function (a, b) { return parseInt(b, 10) - parseInt(a, 10); });
            if (!allowed.length) return null;
            selected = map[allowed[0]];
            for (var j = 0; j < allowed.length; j++) {
                if (parseInt(allowed[j], 10) <= preferred) { selected = map[allowed[j]]; break; }
            }
        } else if (isPlayable(link)) {
            var explicit = parseQualityList(record.quality || (levels.length === 1 ? levels[0] : ''));
            var suffix = link.split(/[?#]/)[0].match(/[_/.-](\d{3,4})p?\.(mp4|m3u8)$/i);
            if ((explicit.length && explicit[0] > limit) || (suffix && parseInt(suffix[1], 10) > limit)) return null;
            selected = link;
        }
        if (!selected) return null;
        return { url: selected, quality: Object.keys(map).length ? map : undefined };
    }

    function log(stage, code) {
        // Only local stage names and numeric status codes; never server text or URLs.
        if (window.console && console.log) console.log('LampaOnline', stage, code || '');
    }

    function looksLikeFilmix(stage, data) {
        if (stage === 'search') {
            return Array.isArray(data) && (!data.length || data.some(function (item) {
                return item && /^\d+$/.test(String(item.id));
            }));
        }
        if (!data || typeof data !== 'object' || Array.isArray(data) || data.error || data.errors) return false;
        if (stage === 'post') return !!data.player_links && typeof data.player_links === 'object' && !Array.isArray(data.player_links);
        var p = data.user_data || data;
        return !!p && typeof p === 'object' && !Array.isArray(p) &&
            !!(p.user_id || p.login || p.is_pro != null || p.is_pro_plus != null);
    }

    function networkLog(stage, result, status, kind, json, filmix) {
        // Fixed endpoint labels and allowlisted outcomes only; never pass URLs/data/errors.
        stage = stage === 'search' || stage === 'user_profile' ? stage : 'post';
        status = Number(status);
        if (!(status >= 100 && status <= 599 && status === Math.floor(status))) status = 0;
        kind = /^(timeout|error|parsererror|abort)$/.test(kind) ? kind : (kind ? 'error' : 'none');
        if (window.console && console.log) console.log('LampaOnline | network | ' + stage + ' | ' + result +
            ' http=' + status + ' error=' + kind + ' json=' + json + ' filmix=' + filmix);
    }

    function errorText(status, kind) {
        if (kind === 'timeout') return tr('timeout');
        if (kind === 'parsererror') return tr('bad_json');
        if (status === 401 || status === 403) return tr('auth_error');
        if (status === 404) return tr('api_missing');
        if (status === 429) return tr('rate_limit');
        if (status >= 500) return tr('server_error');
        return tr('network_error');
    }

    function clockMs() {
        return window.performance && typeof window.performance.now === 'function' ? window.performance.now() : new Date().getTime();
    }
    function diagnostic(stage, status, kind, elapsed, json, filmix) {
        status = Number(status);
        elapsed = Number(elapsed);
        return {
            stage: stage === 'search' || stage === 'user_profile' ? stage : 'post',
            transport: 'ajax',
            status: status >= 100 && status <= 599 && status === Math.floor(status) ? status : 0,
            kind: /^(none|error|timeout|parsererror|abort)$/.test(kind) ? kind : 'error',
            elapsed: isFinite(elapsed) ? Math.max(0, Math.min(86400000, Math.round(elapsed))) : 0,
            json: json === true || json === false ? json : 'unknown',
            filmix: filmix === true || filmix === false ? filmix : 'unknown'
        };
    }
    function diagnosticLog(info) {
        // This object was built from scalar allowlisted fields, never from xhr/errors.
        if (window.console && console.log) console.log('LampaOnline | diagnostic | stage=' + info.stage +
            ' transport=' + info.transport + ' http=' + info.status + ' error=' + info.kind +
            ' elapsed_ms=' + info.elapsed + ' json=' + info.json + ' filmix=' + info.filmix);
    }
    function configurationError(error) {
        var keys = ['bad_api', 'bad_proxy', 'https_required'];
        for (var i = 0; i < keys.length; i++) {
            if (error && error.message === tr(keys[i])) return tr(keys[i]);
        }
        return tr('bad_api');
    }

    // Reguest logs credential-bearing URLs and clear() does not abort HTTP.
    // Use Lampa's existing jQuery with an owned, cancellable request instead.
    function Network(timeout) {
        var xhr = null, timer = null, generation = 0, cancel = null;
        this.clear = function () {
            generation++;
            clearTimeout(timer);
            timer = null;
            if (cancel) cancel();
            cancel = null;
            var previous = xhr;
            xhr = null;
            if (previous && previous.abort) previous.abort();
        };
        this.get = function (url, stage, success, failure) {
            this.clear();
            var current = generation, done = false, startedAt = clockMs();
            networkLog(stage, 'start', 0, '', 'unknown', 'unknown');
            cancel = function () {
                if (done) return;
                done = true;
                networkLog(stage, 'complete', 0, 'abort', 'unknown', 'unknown');
                diagnosticLog(diagnostic(stage, 0, 'abort', clockMs() - startedAt));
            };
            function finish(data, status, kind, json) {
                if (done || current !== generation) return;
                done = true;
                cancel = null;
                clearTimeout(timer);
                timer = null;
                xhr = null;
                var info = diagnostic(stage, status, kind || 'none', clockMs() - startedAt, json,
                    json === true ? looksLikeFilmix(stage, data) : (json === false ? false : 'unknown'));
                networkLog(info.stage, 'complete', info.status, kind, info.json, info.filmix);
                diagnosticLog(info);
                if (kind) failure(info.status, info.kind, info);
                else success(data, info);
            }
            timer = setTimeout(function () {
                var pending = xhr;
                finish(null, 0, 'timeout');
                if (pending && pending.abort) pending.abort();
            }, timeout);
            try {
                var pending = $.ajax({
                    url: url, type: 'GET', dataType: 'text', timeout: timeout,
                    crossDomain: true, global: false,
                    success: function (text, textStatus, response) {
                        var data, status = Number(response && response.status) || 0;
                        try { data = typeof text === 'string' ? JSON.parse(text) : text; }
                        catch (ignored) { finish(null, status, 'parsererror', false); return; }
                        finish(data, status, '', true);
                    },
                    error: function (response, kind) {
                        kind = /^(timeout|error|parsererror|abort)$/.test(kind) ? kind : 'error';
                        finish(null, Number(response && response.status) || 0, kind, kind === 'parsererror' ? false : undefined);
                    }
                });
                if (!done && current === generation) xhr = pending;
            } catch (ignored) { finish(null, 0, 'error'); }
        };
    }

    function titleOf(movie) {
        return movie && (movie.title || movie.name || movie.original_title || movie.original_name) || '';
    }
    function yearOf(movie) {
        var value = movie && (movie.year || movie.release_date || movie.first_air_date || movie.alt_name) || '';
        var match = String(value).match(/\b(?:19|20)\d{2}\b/);
        return match ? match[0] : '';
    }
    function playbackError() {
        log('playback.error');
        Lampa.Noty.show(tr('play_error'));
    }

    function FilmixScreen(object) {
        object = object || {};
        var network = new Network(15000);
        var profileNetwork = new Network(8000);
        var scroll = new Lampa.Scroll({ mask: true, over: true });
        var self = this;
        var alive = false;
        var started = false;
        var last = false;
        var stage = 'results';
        var candidates = [];
        var sources = [];
        var episodes = [];
        var maxQuality = 480;
        var searchTitle = titleOf(object.movie) || object.search || '';
        var serialTitle = searchTitle;
        var originalTitle = object.movie && (object.movie.original_title || object.movie.original_name) || '';
        var searchTried = false;
        var requestSeq = 0;
        var rows = [];
        var focusMemory = { results: 0, sources: 0, episodes: 0 };
        var resultQuery = searchTitle;
        var controller;
        var destroyed = false;
        var busy = false, profileDiagnostic = null, profileRetryRow = null;
        var resultDiagnostic = null, postDiagnostic = null, unsupportedMovie = false;

        function header(title, subtitle) {
            var line = $('<div class="lampa-online-head"></div>');
            line.append($('<div class="lampa-online-title"></div>').text(title));
            if (subtitle) line.append($('<div class="lampa-online-muted"></div>').text(subtitle));
            scroll.append(line);
        }

        function addRow(title, sub, callback) {
            var el = $('<div class="lampa-online-row selector"></div>');
            var index = rows.length;
            el.append($('<div class="lampa-online-row-title"></div>').text(title));
            if (sub) el.append($('<div class="lampa-online-muted"></div>').text(sub));
            el.on('hover:focus.lampaonline', function () { last = el; focusMemory[stage] = index; scroll.update(el, true); });
            el.on('hover:enter.lampaonline', function () { if (alive) callback(); });
            rows.push(el);
            scroll.append(el);
            return el;
        }

        function begin(title, subtitle) {
            last = false;
            clearRows();
            scroll.clear();
            scroll.reset();
            header(title, subtitle);
            addRow('← ' + tr('back'), '', goBack);
            if (profileDiagnostic) showDiagnostic(profileDiagnostic);
        }

        function clearRows() {
            for (var i = 0; i < rows.length; i++) rows[i].off('.lampaonline').remove();
            rows = [];
            profileRetryRow = null;
        }

        function restoreFocus() {
            if (alive && !busy && profileDiagnostic && !profileRetryRow) {
                profileRetryRow = addRow(tr('profile_retry'), tr('retry'), retryProfile);
            }
            if (started && alive && Lampa.Controller.enabled().controller === controller) {
                Lampa.Controller.collectionSet(scroll.render());
                Lampa.Controller.collectionFocus(last || rows[focusMemory[stage]] || rows[0] || false, scroll.render());
            }
        }

        function loading(value) {
            busy = !!value;
            if (alive && self.activity) self.activity.loader(!!value);
        }

        function showDiagnostic(info, explanation) {
            if (!alive || !info) return;
            var box = $('<div class="lampa-online-diagnostic"></div>');
            var lines = [tr('diagnostic'), tr('diag_stage') + ': ' + info.stage,
                'Transport: WebView AJAX', 'HTTP: ' + info.status, 'Error: ' + info.kind,
                tr('diag_elapsed') + ': ' + info.elapsed + ' ms',
                'JSON: ' + info.json + ' · Filmix: ' + info.filmix];
            if (!explanation) {
                if (info.json === true && info.filmix === false) explanation = tr('bad_response');
                else if (info.kind === 'none') explanation = tr('no_stream');
                else if (info.kind === 'abort') explanation = tr('diag_abort');
                else if (info.status === 0 && info.kind === 'error') explanation = tr('diag_unknown');
                else explanation = errorText(info.status, info.kind);
            }
            lines.push(explanation);
            for (var i = 0; i < lines.length; i++) box.append($('<div class="lampa-online-diagnostic-line"></div>').text(lines[i]));
            scroll.append(box);
        }

        function retryProfile() {
            profileDiagnostic = null;
            stage = 'results';
            requestSeq++;
            network.clear();
            begin(tr('name') + ' · Filmix · ' + tr('loading'), searchTitle);
            loading(true);
            restoreFocus();
            fetchProfile(function () { if (alive) search(searchTitle); });
        }

        function fail(message, retry, info) {
            loading(false);
            if (!alive) return;
            showDiagnostic(info);
            addRow(message || tr('network_error'), tr('retry'), retry);
            last = rows[rows.length - 1];
            restoreFocus();
        }

        function request(path, extra, success, onError) {
            var url;
            var seq = ++requestSeq;
            network.clear();
            try { url = apiUrl(path, extra); }
            catch (e) { onError(configurationError(e)); return; }
            network.get(url, path === 'search' ? 'search' : 'post', function (data, info) {
                if (alive && seq === requestSeq) success(data, info);
            }, function (status, kind, info) {
                if (!alive || seq !== requestSeq) return;
                onError(errorText(status, kind), info);
            });
        }

        function fetchProfile(complete) {
            if (!setting('token', '')) { complete(); return; }
            var url;
            try { url = apiUrl('user_profile'); } catch (e) { complete(); return; }
            function granted(value) {
                if (value === true || value === 1 || value === '1') return true;
                return Number(value) > new Date().getTime() / 1000;
            }
            profileNetwork.get(url, 'user_profile', function (data, info) {
                if (!alive) return;
                if (looksLikeFilmix('user_profile', data)) {
                    var p = data.user_data || data;
                    maxQuality = granted(p.is_pro_plus) ? 2160 : (granted(p.is_pro) ? 1080 : 720);
                    profileDiagnostic = null;
                } else {
                    profileDiagnostic = info;
                    Lampa.Noty.show(tr('profile_error') + '. ' + tr('bad_response'));
                }
                log('profile.quality', maxQuality);
                complete();
            }, function (status, kind, info) {
                if (!alive) return;
                profileDiagnostic = info;
                Lampa.Noty.show(tr('profile_error') + '. ' + errorText(status, kind));
                complete();
            });
        }

        function search(query) {
            stage = 'results';
            begin(tr('name') + ' · Filmix · ' + tr('search'), query);
            loading(true);
            restoreFocus();
            if (!query) { fail(tr('missing_title'), function () { search(query); }); return; }
            request('search', 'story=' + encodeURIComponent(query), function (data, info) {
                loading(false);
                resultDiagnostic = info;
                if (!Array.isArray(data)) { fail(tr('bad_response'), function () { search(query); }, info); return; }
                candidates = data.filter(function (item) { return item && /^\d+$/.test(String(item.id)); });
                if (!candidates.length && !searchTried && originalTitle && originalTitle !== query) {
                    searchTried = true;
                    search(originalTitle);
                    return;
                }
                resultQuery = query;
                log('search.results', candidates.length);
                showResults();
            }, function (err, info) {
                begin(tr('name') + ' · Filmix · ' + tr('search'), query);
                fail(err, function () { search(query); }, info);
            });
        }

        function showResults() {
            stage = 'results';
            begin(tr('name') + ' · Filmix · ' + tr('results'), resultQuery + (yearOf(object.movie) ? ' · ' + yearOf(object.movie) : ''));
            if (!candidates.length) {
                fail(tr('nothing'), function () { search(resultQuery); }, resultDiagnostic && resultDiagnostic.filmix === false ? resultDiagnostic : null);
                return;
            }
            for (var i = 0; i < candidates.length; i++) {
                (function (candidate) {
                    var name = titleOf(candidate) || 'ID ' + candidate.id;
                    var original = candidate.original_title || candidate.original_name || candidate.original_title_en || '';
                    var info = [yearOf(candidate), original !== name ? original : '', 'Filmix ID ' + candidate.id].filter(Boolean).join(' · ');
                    addRow(String(name), info, function () { openPost(candidate); });
                })(candidates[i]);
            }
            restoreFocus();
        }

        function openPost(candidate) {
            stage = 'sources';
            focusMemory.sources = 0;
            focusMemory.episodes = 0;
            serialTitle = titleOf(candidate) || searchTitle;
            begin(tr('name') + ' · Filmix · ' + tr('loading'), candidate.title || serialTitle);
            loading(true);
            restoreFocus();
            request('post/' + encodeURIComponent(candidate.id), '', function (data, info) {
                loading(false);
                postDiagnostic = info;
                unsupportedMovie = false;
                if (!data || !data.player_links || typeof data.player_links !== 'object' || Array.isArray(data.player_links)) {
                    fail(tr('no_stream'), function () { openPost(candidate); }, info);
                    return;
                }
                sources = [];
                var links = data.player_links;
                unsupportedMovie = !!links.movie && !Array.isArray(links.movie) && ownKeys(links.movie).length > 0;
                if (Array.isArray(links.movie)) {
                    for (var m = 0; m < links.movie.length; m++) {
                        var movie = links.movie[m];
                        if (!movie || /^заблокировано /i.test(movie.translation || '')) continue;
                        sources.push({
                            kind: 'movie',
                            title: movie.translation || (tr('voice') + ' ' + (m + 1)),
                            record: movie
                        });
                    }
                }
                var playlist = links.playlist;
                var seasons = ownKeys(playlist).sort(numberSort);
                for (var s = 0; s < seasons.length; s++) {
                    var seasonKey = seasons[s];
                    if (!/^(?:-1|\d+)$/.test(seasonKey)) continue;
                    var seasonNumber = seasonKey === '-1' ? '1' : seasonKey;
                    var voices = playlist[seasonKey];
                    var voiceKeys = ownKeys(voices);
                    for (var v = 0; v < voiceKeys.length; v++) {
                        var voice = voiceKeys[v];
                        if (!voices[voice] || typeof voices[voice] !== 'object' || !Object.keys(voices[voice]).length) continue;
                        sources.push({
                            kind: 'series', title: tr('season') + ' ' + seasonNumber + ' · ' + voice,
                            season: seasonNumber, voice: voice, record: voices[voice]
                        });
                    }
                }
                log('post.sources', sources.length);
                showSources();
            }, function (err, info) {
                fail(err, function () { openPost(candidate); }, info);
            });
        }

        function showSources() {
            stage = 'sources';
            begin(serialTitle, tr('name') + ' · Filmix · ' + tr('select'));
            if (!sources.length) {
                header(tr('nothing'), tr('no_stream'));
                if (unsupportedMovie) showDiagnostic(postDiagnostic, tr('diag_movie_object'));
                restoreFocus();
                return;
            }
            for (var i = 0; i < sources.length; i++) {
                (function (source) {
                    addRow(source.title, source.kind === 'movie' ? tr('film') : tr('series'), function () {
                        if (source.kind === 'movie') {
                            var media = mediaFromRecord(source.record, maxQuality);
                            if (!media) { Lampa.Noty.show(tr('no_stream')); return; }
                            play([{ title: serialTitle + ' · ' + source.title, media: media }], 0);
                        } else {
                            showEpisodes(source);
                        }
                    });
                })(sources[i]);
            }
            restoreFocus();
        }

        function showEpisodes(source) {
            episodes = [];
            var map = source.record;
            var keys;
            if (Array.isArray(map)) {
                keys = [];
                for (var i = 0; i < map.length; i++) keys.push(String(i));
            } else keys = ownKeys(map).sort(numberSort);
            for (var j = 0; j < keys.length; j++) {
                var entry = map[keys[j]];
                if (!entry || typeof entry.link !== 'string') continue;
                // Lampa's Filmix provider also identifies named episodes by sNeN URLs.
                var marker = entry.link.split(/[?#]/)[0].match(/s(\d+)e(\d+)[_.]/i);
                if (!marker && !Array.isArray(map) && !/^\d+$/.test(keys[j])) continue;
                var episodeNumber = Array.isArray(map) ? j + 1 : parseInt(keys[j], 10);
                if (marker) episodeNumber = parseInt(marker[2], 10);
                if (!episodeNumber || episodeNumber < 0) continue;
                var media = mediaFromRecord(entry, maxQuality);
                if (!media) continue;
                episodes.push({
                    title: serialTitle + ' · S' + source.season + 'E' + episodeNumber + ' · ' + source.voice,
                    label: tr('episode') + ' ' + episodeNumber,
                    number: episodeNumber,
                    season: source.season,
                    media: media
                });
            }
            episodes.sort(function (a, b) { return a.number - b.number; });
            stage = 'episodes';
            begin(source.title, tr('name') + ' · Filmix · ' + tr('episode_select'));
            if (!episodes.length) {
                header(tr('no_stream'), 'Filmix');
            } else {
                for (var k = 0; k < episodes.length; k++) {
                    (function (index) {
                        addRow(episodes[index].label, source.voice, function () { play(episodes, index); });
                    })(k);
                }
            }
            restoreFocus();
        }

        function play(items, selected) {
            var playlist = [];
            for (var i = 0; i < items.length; i++) {
                playlist.push({
                    title: items[i].title,
                    url: items[i].media.url,
                    quality: items[i].media.quality,
                    episode: items[i].number,
                    season: items[i].season,
                    movie: object.movie,
                    error: playbackError
                });
            }
            var first = playlist[selected];
            if (!first || !isPlayable(first.url)) { Lampa.Noty.show(tr('no_stream')); return; }
            if (playlist.length > 1) {
                // Android.openPlayer serializes data.playlist before Player.playlist().
                // Keep the launch object outside the list so JSON has no cycle.
                var selectedItem = first;
                first = {};
                Object.keys(selectedItem).forEach(function (key) { first[key] = selectedItem[key]; });
                first.playlist = playlist;
            }
            try {
                log('playback.start');
                Lampa.Player.play(first);
                Lampa.Player.playlist(playlist);
            } catch (err) {
                playbackError();
                if (alive) Lampa.Controller.toggle('content');
            }
        }

        function goBack() {
            if (!alive) return;
            requestSeq++;
            network.clear();
            loading(false);
            if (stage === 'episodes') showSources();
            else if (stage === 'sources') showResults();
            else Lampa.Activity.backward();
        }

        function navMove(direction) {
            var nav = Lampa.Navigator || window.Navigator;
            if (nav && typeof nav.move === 'function') nav.move(direction);
        }

        this.create = function () {
            if (alive || destroyed) return this.render();
            alive = true;
            begin(tr('name') + ' · Filmix · ' + tr('loading'), searchTitle);
            loading(true);
            fetchProfile(function () { if (alive) search(searchTitle); });
            return this.render();
        };
        this.start = function () {
            if (!alive) return;
            started = true;
            controller = {
                toggle: function () {
                    started = true;
                    restoreFocus();
                },
                gone: function () { started = false; },
                up: function () { navMove('up'); },
                down: function () { navMove('down'); },
                left: function () {
                    var nav = Lampa.Navigator || window.Navigator;
                    if (nav && nav.canmove && nav.canmove('left')) nav.move('left');
                    else Lampa.Controller.toggle('menu');
                },
                right: function () { navMove('right'); },
                back: goBack
            };
            Lampa.Controller.add('content', controller);
            Lampa.Controller.toggle('content');
        };
        this.stop = function () { started = false; };
        this.pause = this.stop;
        this.destroy = function () {
            if (destroyed) return;
            loading(false);
            alive = false;
            destroyed = true;
            started = false;
            requestSeq++;
            network.clear();
            profileNetwork.clear();
            clearRows();
            last = false;
            candidates = sources = episodes = [];
            profileDiagnostic = resultDiagnostic = postDiagnostic = profileRetryRow = null;
            if (controller) {
                if (Lampa.Controller.enabled().controller === controller) Lampa.Controller.clear();
                // Lampa has no Controller.remove(). Release captured screen references.
                Object.keys(controller).forEach(function (key) { delete controller[key]; });
                controller.invisible = true;
            }
            scroll.destroy();
            log('screen.destroy');
        };
        this.render = function () { return scroll.render(); };
    }

    // Conservative, inert extraction of known markup. No DOM insertion, eval or
    // page scripts; unfamiliar/encoded formats fail closed in this preview.
    function rezkaText(value) {
        return String(value || '').replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
            .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '').replace(/<[^>]*>/g, ' ')
            .replace(/&#(x[0-9a-f]+|\d+);|&(amp|quot|apos|lt|gt|nbsp);/gi, function (all, code, named) {
                if (code) {
                    var n = code.charAt(0).toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : parseInt(code, 10);
                    return n > 0 && n <= 65535 ? String.fromCharCode(n) : '';
                }
                return { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' }[named.toLowerCase()];
            }).replace(/\s+/g, ' ').trim().slice(0, 500);
    }
    function rezkaAttrs(text) {
        var attrs = {}, re = /([a-z_][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi, m;
        while ((m = re.exec(text))) attrs[m[1].toLowerCase()] = rezkaText(m[2] != null ? m[2] : (m[3] != null ? m[3] : m[4]));
        return attrs;
    }
    function rezkaBlocks(html, tag, callback) {
        var re = new RegExp('<' + tag + '\\b([^>]*)>([\\s\\S]*?)<\\/' + tag + '\\s*>', 'gi'), m;
        while ((m = re.exec(html))) callback(rezkaAttrs(m[1]), m[2]);
    }
    function rezkaClass(attrs, name) { return (' ' + (attrs['class'] || '') + ' ').indexOf(' ' + name + ' ') !== -1; }
    function rezkaId(value) { return /^[1-9]\d{0,9}$/.test(String(value || '')) ? String(value) : ''; }
    function rezkaDetailUrl(value) {
        value = String(value || '');
        if (/^\/(?!\/)/.test(value)) value = REZKA_ORIGIN + value;
        return /^https:\/\/rezka\.ag\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.html$/i.test(value) ? value : '';
    }
    function rezkaMediaUrl(value) {
        // Only actual HTTPS MP4/HLS addresses; no templates, credentials or downgrade.
        return typeof value === 'string' && /^https:\/\/(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::443)?\/[^\s<>"'\\\[\]#]*\.(?:mp4|m3u8)(?:\?[^\s<>"'\\\[\]#]*)?$/i.test(value) &&
            !/%s|%(?:0[0-9a-f]|1[0-9a-f]|7f)/i.test(value) ? value : '';
    }
    function rezkaGate(html) {
        if (/captcha|проверяем,?\s*что вы не бот|verify you are human|\.within\.website\/|cf-chl-|challenge-platform/i.test(html)) return 'blocked';
        if (/b-player__restricted|premium_content\s*["']?\s*:\s*true/i.test(html)) return 'restricted';
        if (/<form\b[^>]*(?:id|class)=["'][^"']*(?:login|auth)[^"']*["']/i.test(html) && !/initCDN(?:Movies|Series)Events|b-content__inline_item-link|class=["']enty["']/i.test(html)) return 'auth';
        return '';
    }
    function rezkaNormalize(value) { return rezkaText(value).toLowerCase().replace(/[^a-z0-9\u00c0-\u024f\u0400-\u04ff]+/g, ' ').trim(); }
    function rezkaSearch(html, movie) {
        var result = [], seen = {}, recognized = false;
        function candidate(attrs, content) {
            var link = '', name = '', alternate = '', info = rezkaText(content);
            rezkaBlocks(content, 'a', function (a, inner) {
                if (!link) link = rezkaDetailUrl(a.href);
                if (!name && !/<(?:span|div)\b[^>]*class=["']enty["']/i.test(inner)) name = rezkaText(inner);
                var enty = inner.match(/<(?:span|div)\b[^>]*class=["']enty["'][^>]*>([\s\S]*?)<\/(?:span|div)>/i);
                if (enty) {
                    name = rezkaText(enty[1]);
                    alternate = rezkaText(inner.replace(enty[0], '')).replace(/\s*\((?:19|20)\d{2}\).*$/, '').trim();
                }
            });
            if (!link || !name || seen[link]) return;
            seen[link] = true;
            var year = yearOf({ alt_name: info }), score = 0;
            var names = [movie.title, movie.name, movie.original_title, movie.original_name].map(rezkaNormalize).filter(function (v) { return !!v; });
            var normalized = [rezkaNormalize(name), rezkaNormalize(alternate)];
            for (var i = 0; i < names.length; i++) {
                if (normalized.indexOf(names[i]) !== -1) score = Math.max(score, 100);
                else if (normalized[0].indexOf(names[i]) !== -1) score = Math.max(score, 30);
            }
            if (year && yearOf(movie)) score += year === yearOf(movie) ? 20 : -20;
            result.push({ url: link, title: name, year: year, score: score });
        }
        rezkaBlocks(html, 'li', function (a, content) {
            if (/class=["']enty["']/i.test(content)) { recognized = true; candidate(a, content); }
        });
        // Catalog search alternative, accepted as a response shape, not queried as a bypass.
        var re = /<div\b([^>]*class=["'][^"']*b-content__inline_item-link[^"']*["'][^>]*)>([\s\S]*?)<\/div>/gi, m;
        while ((m = re.exec(html))) { recognized = true; candidate(rezkaAttrs(m[1]), m[2]); }
        if (/ничего не найдено|ничего не удалось найти|поиск не дал результатов|no results|b-search__notfound/i.test(rezkaText(html))) recognized = true;
        return recognized ? { items: result.sort(function (a, b) { return b.score - a.score; }) } : { error: 'parser' };
    }
    function rezkaEpisodeData(seasonsHtml, episodesHtml) {
        var seasons = [], episodes = [], seenS = {}, seenE = {};
        rezkaBlocks(seasonsHtml, 'li', function (a, inner) {
            var id = rezkaId(a['data-tab_id']);
            if (rezkaClass(a, 'b-simple_season__item') && id && !seenS[id]) {
                seenS[id] = true; seasons.push({ id: id, title: rezkaText(inner) || tr('season') + ' ' + id });
            }
        });
        rezkaBlocks(episodesHtml, 'li', function (a, inner) {
            var season = rezkaId(a['data-season_id']), episode = rezkaId(a['data-episode_id']), key = season + ':' + episode;
            if (rezkaClass(a, 'b-simple_episode__item') && season && episode && !seenE[key]) {
                seenE[key] = true; episodes.push({ season: season, id: episode, title: rezkaText(inner) || tr('episode') + ' ' + episode });
            }
        });
        return { seasons: seasons.sort(function (a, b) { return numberSort(a.id, b.id); }),
            episodes: episodes.sort(function (a, b) { return numberSort(a.season, b.season) || numberSort(a.id, b.id); }) };
    }
    function rezkaDetail(html) {
        var series = html.match(/\.initCDNSeriesEvents\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,/);
        var film = html.match(/\.initCDNMoviesEvents\(\s*(\d+)\s*,\s*(\d+)\s*,\s*([01])\s*,\s*([01])\s*,\s*([01])\s*,/);
        var init = series || film, title = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i), voices = [], seen = {};
        if (!init || !rezkaId(init[1]) || !rezkaId(init[2]) || !title || !rezkaText(title[1])) return { error: 'parser' };
        rezkaBlocks(html, 'li', function (a, inner) {
            var id = rezkaId(a['data-translator_id']);
            if (rezkaClass(a, 'b-translator__item') && id && !seen[id]) {
                seen[id] = true;
                voices.push({ id: id, title: a.title || rezkaText(inner) || tr('voice'),
                    camrip: a['data-camrip'] === '1' ? '1' : '0', ads: a['data-ads'] === '1' ? '1' : '0', director: a['data-director'] === '1' ? '1' : '0' });
            }
        });
        if (!voices.length) voices.push({ id: init[2], title: tr('rezka_default_voice'),
            camrip: film ? film[3] : '0', ads: film ? film[4] : '0', director: film ? film[5] : '0' });
        var favs = '', input = /<input\b([^>]*)>/gi, m;
        while ((m = input.exec(html))) {
            var attrs = rezkaAttrs(m[1]);
            if (attrs.id === 'ctrl_favs' && /^[a-z0-9_-]{0,256}$/i.test(attrs.value || '')) favs = attrs.value || '';
        }
        return { id: init[1], title: rezkaText(title[1]), year: yearOf({ alt_name: rezkaText(title[1]) }),
            series: !!series, voices: voices, favs: favs };
    }
    function rezkaJson(text, stage) {
        var data;
        try { data = JSON.parse(text); } catch (ignored) { return { error: 'parser' }; }
        if (!data || typeof data !== 'object' || Array.isArray(data)) return { error: 'parser' };
        if (data.premium_content) return { error: 'restricted' };
        if (data.success === false) return { error: 'rejected' };
        if (stage === 'episodes') {
            if (typeof data.seasons !== 'string' || typeof data.episodes !== 'string') return { error: 'parser' };
            var items = rezkaEpisodeData(data.seasons, data.episodes);
            return items.seasons.length && items.episodes.length ? items : { error: 'empty' };
        }
        if (typeof data.url !== 'string') return { error: 'parser' };
        if (/^\s*#/.test(data.url)) return { error: 'encoded' };
        var streams = [], seen = {}, re = /\[([^\]]+)\]([^\[]+)/g, m;
        function add(label, url) {
            url = rezkaMediaUrl(url.trim());
            if (url && !seen[url]) { seen[url] = true; streams.push({ title: label, url: url }); }
        }
        while ((m = re.exec(data.url))) {
            var quality = m[1].trim();
            if (!/^(?:240|360|480|720|1080|1440|2160)p(?: Ultra)?$/i.test(quality)) continue;
            m[2].replace(/,\s*$/, '').split(/\s+or\s+/).forEach(function (url) { add(quality, url); });
        }
        if (!streams.length && rezkaMediaUrl(data.url.trim())) add(tr('rezka_source_quality'), data.url);
        return streams.length ? { streams: streams } : { error: 'empty_stream' };
    }

    // Own request lifecycle; deliberately no native/proxy fallback in the preview.
    function RezkaNetwork() {
        var xhr = null, timer = null, generation = 0;
        this.clear = function () {
            generation++; clearTimeout(timer); timer = null;
            var pending = xhr; xhr = null;
            if (pending && pending.abort) pending.abort();
        };
        this.send = function (path, stage, data, parser, complete) {
            this.clear();
            var current = generation, done = false, startedAt = clockMs();
            function finish(text, status, kind) {
                if (done || current !== generation) return;
                done = true; clearTimeout(timer); timer = null; xhr = null;
                status = Number(status);
                if (!(status >= 100 && status <= 599 && status === Math.floor(status))) status = 0;
                kind = /^(none|timeout|error|abort)$/.test(kind) ? kind : 'error';
                var type = typeof text === 'string' && /^\s*[\[{]/.test(text) ? 'json' : (typeof text === 'string' && /<\w/.test(text) ? 'html' : 'unknown');
                var result = { error: kind === 'none' ? '' : kind };
                if (status === 401) result.error = 'auth';
                else if (status === 403 || status === 429) result.error = 'blocked';
                else if (status === 404) result.error = 'missing';
                else if (status >= 500) result.error = 'server';
                else if (kind === 'none' && status >= 200 && status < 300) {
                    if (typeof text !== 'string' || text.length > 2000000) result.error = 'parser';
                    else {
                        var gate = rezkaGate(text);
                        if (gate) result.error = gate;
                        else { try { result = parser(text); } catch (ignored) { result = { error: 'parser' }; } }
                    }
                } else if (!result.error) result.error = 'error';
                var elapsed = Number(clockMs() - startedAt);
                complete(result, { provider: 'rezka', stage: stage, transport: 'WebView AJAX', status: status,
                    kind: result.error || 'none', elapsed: isFinite(elapsed) ? Math.max(0, Math.min(86400000, Math.round(elapsed))) : 0, type: type });
            }
            timer = setTimeout(function () { var pending = xhr; finish(null, 0, 'timeout'); if (pending && pending.abort) pending.abort(); }, 15000);
            try {
                var pending = $.ajax({ url: REZKA_ORIGIN + path, type: data ? 'POST' : 'GET', data: data || undefined,
                    contentType: 'application/x-www-form-urlencoded; charset=UTF-8', dataType: 'text', timeout: 15000,
                    crossDomain: true, global: false, xhrFields: { withCredentials: false },
                    success: function (text, ignored, response) { finish(text, response && response.status, 'none'); },
                    error: function (response, kind) { finish(null, response && response.status, kind); }
                });
                if (!done && current === generation) xhr = pending;
            } catch (ignored) { finish(null, 0, 'error'); }
        };
    }

    // Shared only by the two new components; FilmixScreen remains independent.
    function ProviderPanel(owner, back) {
        var scroll = new Lampa.Scroll({ mask: true, over: true }), rows = [], last = false, focus = {}, page = '';
        var alive = false, destroyed = false, started = false, controller;
        var self = this;
        function clearRows() { rows.forEach(function (row) { row.off('.zebproviders').remove(); }); rows = []; last = false; }
        this.active = function () { return alive; };
        this.loading = function (value) { if (alive && owner.activity) owner.activity.loader(!!value); };
        this.restore = function () {
            if (alive && started && Lampa.Controller.enabled().controller === controller) {
                Lampa.Controller.collectionSet(scroll.render());
                Lampa.Controller.collectionFocus(last || rows[focus[page]] || rows[0], scroll.render());
            }
        };
        this.draw = function (key, title, subtitle, entries, info) {
            if (!alive) return;
            clearRows(); scroll.clear(); scroll.reset(); page = key;
            var head = $('<div class="lampa-online-head"></div>');
            head.append($('<div class="lampa-online-title"></div>').text(title));
            if (subtitle) head.append($('<div class="lampa-online-muted"></div>').text(subtitle));
            scroll.append(head);
            if (info) {
                var box = $('<div class="lampa-online-diagnostic"></div>');
                ['provider: rezka', 'stage: ' + info.stage, 'transport: ' + info.transport, 'HTTP: ' + info.status,
                    'error: ' + info.kind, 'elapsed: ' + info.elapsed + ' ms', 'response type: ' + info.type,
                    tr('rezka_' + info.kind)].forEach(function (line) { box.append($('<div class="lampa-online-diagnostic-line"></div>').text(line)); });
                scroll.append(box);
            }
            [{ title: '← ' + tr('back'), action: back }].concat(entries).forEach(function (entry, index) {
                var row = $('<div class="lampa-online-row selector"></div>');
                row.append($('<div class="lampa-online-row-title"></div>').text(entry.title));
                if (entry.sub) row.append($('<div class="lampa-online-muted"></div>').text(entry.sub));
                row.on('hover:focus.zebproviders', function () { last = row; focus[page] = index; scroll.update(row, true); });
                row.on('hover:enter.zebproviders', function () { if (alive && entry.action) entry.action(); });
                rows.push(row); scroll.append(row);
            });
            self.restore();
        };
        this.create = function () { if (destroyed || alive) return false; alive = true; return true; };
        this.start = function () {
            if (!alive) return;
            function move(direction) { var nav = Lampa.Navigator || window.Navigator; if (nav && nav.move) nav.move(direction); }
            controller = { toggle: function () { started = true; self.restore(); }, gone: function () { started = false; },
                up: function () { move('up'); }, down: function () { move('down'); }, right: function () { move('right'); },
                left: function () { var nav = Lampa.Navigator || window.Navigator; if (nav && nav.canmove && nav.canmove('left')) move('left'); else Lampa.Controller.toggle('menu'); }, back: back };
            Lampa.Controller.add('content', controller); Lampa.Controller.toggle('content');
        };
        this.stop = function () { started = false; };
        this.destroy = function () {
            if (destroyed) return;
            self.loading(false); alive = false; destroyed = true; started = false; clearRows(); focus = {};
            if (controller) {
                if (Lampa.Controller.enabled().controller === controller) Lampa.Controller.clear();
                Object.keys(controller).forEach(function (key) { delete controller[key]; }); controller.invisible = true;
            }
            scroll.destroy();
        };
        this.render = function () { return scroll.render(); };
    }
    function pushProvider(component, card, provider) {
        Lampa.Activity.push({ url: '', title: tr('name') + ' · ' + provider, component: component,
            movie: card, search: titleOf(card), page: 1 });
    }
    function ProviderScreen(object) {
        object = object || {};
        var movie = object.movie || {}, panel = new ProviderPanel(this, function () { Lampa.Activity.backward(); });
        this.create = function () {
            if (panel.create()) {
                panel.loading(false);
                panel.draw('providers', tr('name'), titleOf(movie), [
                    { title: 'Rezka', sub: tr('rezka_experimental'), action: function () { pushProvider(REZKA_COMPONENT, movie, 'Rezka'); } },
                    { title: 'Filmix', action: function () { pushProvider(COMPONENT, movie, 'Filmix'); } }
                ]);
            }
            return panel.render();
        };
        this.start = panel.start; this.stop = panel.stop; this.pause = panel.stop; this.destroy = panel.destroy; this.render = panel.render;
    }
    function RezkaScreen(object) {
        object = object || {};
        var movie = object.movie || {}, network = new RezkaNetwork(), history = [], current = null;
        var panel = new ProviderPanel(this, goBack), detail = null, voice = null, chosenEpisode = null;
        function goBack() {
            if (!panel.active()) return;
            network.clear(); panel.loading(false);
            if (history.length) { current = history.pop(); current(); }
            else Lampa.Activity.backward();
        }
        function navigate(action) { if (current) history.push(current); action(); }
        function page(key, entries, sub, info) {
            current = function () { panel.draw(key, tr('name') + ' · Rezka', sub || titleOf(movie), entries, info); };
            panel.loading(false); current();
        }
        function request(stage, path, data, parser, retry, success) {
            panel.draw('loading-' + stage, tr('name') + ' · Rezka', tr('loading'), []);
            panel.loading(true);
            network.send(path, stage, data, parser, function (result, info) {
                if (!panel.active()) return;
                if (result.error) {
                    page('error-' + stage, [{ title: tr('retry'), action: retry }], tr('rezka_experimental'), info);
                } else success(result, info);
            });
        }
        function search(query) {
            if (!query) { page('missing', [], tr('missing_title')); return; }
            request('search', '/engine/ajax/search.php', { q: query }, function (html) { return rezkaSearch(html, movie); }, function () { search(query); }, function (result, info) {
                var entries = result.items.map(function (item) {
                    return { title: item.title, sub: item.year, action: function () { navigate(function () { loadDetail(item); }); } };
                });
                var alternate = movie.original_title || movie.original_name;
                if (alternate && rezkaNormalize(alternate) !== rezkaNormalize(query)) entries.push({ title: tr('search') + ': ' + alternate, action: function () { navigate(function () { search(alternate); }); } });
                if (!result.items.length) { info.kind = 'empty'; page('results', entries.concat([{ title: tr('retry'), action: function () { search(query); } }]), tr('nothing'), info); }
                else page('results', entries, tr('results') + ' · ' + query);
            });
        }
        function loadDetail(item) {
            var safe = rezkaDetailUrl(item.url);
            if (!safe) return;
            request('detail', safe.slice(REZKA_ORIGIN.length), null, rezkaDetail, function () { loadDetail(item); }, function (result) {
                detail = result;
                page('voices', detail.voices.map(function (itemVoice) {
                    return { title: itemVoice.title, action: function () {
                        voice = itemVoice;
                        navigate(function () { if (detail.series) loadEpisodes(); else { chosenEpisode = null; loadStream(); } });
                    } };
                }), detail.title + ' · ' + tr('voice'));
            });
        }
        function form(action) { return { id: detail.id, translator_id: voice.id, favs: detail.favs, action: action }; }
        function loadEpisodes() {
            request('episodes', '/ajax/get_cdn_series/', form('get_episodes'), function (text) { return rezkaJson(text, 'episodes'); }, loadEpisodes, function (result) {
                page('seasons', result.seasons.map(function (season) {
                    return { title: season.title, action: function () { navigate(function () {
                        page('episodes-' + season.id, result.episodes.filter(function (episode) { return episode.season === season.id; }).map(function (episode) {
                            return { title: episode.title, sub: tr('episode') + ' ' + episode.id, action: function () { chosenEpisode = episode; navigate(loadStream); } };
                        }), detail.title + ' · ' + voice.title + ' · ' + season.title);
                    }); } };
                }), detail.title + ' · ' + voice.title);
            });
        }
        function loadStream() {
            var data = form(detail.series ? 'get_stream' : 'get_movie');
            if (detail.series) { data.season = chosenEpisode.season; data.episode = chosenEpisode.id; }
            else { data.is_camrip = voice.camrip; data.is_ads = voice.ads; data.is_director = voice.director; }
            request('stream', '/ajax/get_cdn_series/', data, function (text) { return rezkaJson(text, 'stream'); }, loadStream, function (result) {
                page('qualities', result.streams.map(function (stream) {
                    return { title: stream.title, action: function () { play(stream); } };
                }), detail.title + ' · ' + voice.title + (chosenEpisode ? ' · ' + tr('episode') + ' ' + chosenEpisode.id : ''));
            });
        }
        function play(stream) {
            if (!rezkaMediaUrl(stream.url)) return;
            function playerError() {
                if (!panel.active()) return;
                Lampa.Noty.show(tr('play_error'));
                if (panel.active()) {
                    page('player-error', [{ title: tr('retry'), action: function () { play(stream); } }], detail.title,
                        { stage: 'stream', transport: 'Lampa.Player', status: 0, kind: 'player', elapsed: 0, type: 'unknown' });
                    Lampa.Controller.toggle('content');
                }
            }
            var item = { url: stream.url, title: detail.title, movie: movie, voice_name: voice.title, error: playerError };
            if (chosenEpisode) { item.season = Number(chosenEpisode.season); item.episode = Number(chosenEpisode.id); }
            try {
                Lampa.Player.play(item);
                // No guessed next episode links. This entry is the one fetched above.
                Lampa.Player.playlist([item]);
            } catch (ignored) { playerError(); }
        }
        this.create = function () { if (panel.create()) search(titleOf(movie) || object.search || ''); return panel.render(); };
        this.start = panel.start; this.stop = panel.stop; this.pause = panel.stop; this.render = panel.render;
        this.destroy = function () { network.clear(); history = []; current = null; detail = voice = chosenEpisode = null; panel.destroy(); };
    }

    function openOnline(card) {
        card = card || {};
        Lampa.Activity.push({
            url: '', title: tr('name'), component: PROVIDERS_COMPONENT,
            movie: card, search: titleOf(card), page: 1
        });
    }

    function addFullSource(event) {
        if (!event || event.type !== 'complite' || !event.data || !event.data.movie) return;
        var activity = event.object && event.object.activity;
        var root = activity && typeof activity.render === 'function' ? activity.render() : event.body;
        if (!root || typeof root.find !== 'function') return;
        // Lampa groups direct source children after the full/complite listeners run.
        // Keep every query inside this card; never attach to another activity's DOM.
        var container = root.find('.buttons--container').first();
        if (!container.length) return;
        var card = event.data.movie;
        var button = container.children('.view--lampa-online').first();
        if (!button.length) {
            button = $('<div class="full-start__button selector view--lampa-online">' +
                '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">' +
                '<circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/>' +
                '<path d="M9 7L17 12L9 17V7Z" fill="currentColor"/></svg>' +
                '<span>ZebMod</span></div>');
            var torrent = container.children('.view--torrent').last();
            if (torrent.length) torrent.after(button);
            else container.append(button);
        }
        // Repeated completion for the same DOM refreshes card data, not handlers.
        button.off('.lampaOnlineSource').on('hover:enter.lampaOnlineSource', function () {
            openOnline(card);
        });
    }

    function renameInstalledExtension() {
        if (!Lampa.Plugins || typeof Lampa.Plugins.get !== 'function') return;
        function ownIndex(list) {
            if (!Array.isArray(list)) return -1;
            var index = -1;
            for (var i = 0; i < list.length; i++) {
                if (list[i] && list[i].url === 'https://zwanns.github.io/zeb.js') {
                    if (index !== -1) return -1;
                    index = i;
                }
            }
            return index;
        }
        try {
            // Plugins.get() returns a shallow array of local installed records.
            // Require one exact URL in both lists; never infer identity from a name.
            var installed = Lampa.Plugins.get();
            var stored = Lampa.Storage.get('plugins', []);
            var liveIndex = ownIndex(installed), storedIndex = ownIndex(stored);
            if (liveIndex < 0 || storedIndex < 0) return;
            if (stored[storedIndex].name !== 'ZebMod') {
                var entry = {}, updated = stored.slice();
                Object.keys(stored[storedIndex]).forEach(function (key) { entry[key] = stored[storedIndex][key]; });
                entry.name = 'ZebMod';
                updated[storedIndex] = entry;
                // Preserve the fresh stored list and all unrelated metadata. Avoid
                // Plugins.save(), which logs the entire list including private URLs.
                Lampa.Storage.set('plugins', updated);
            }
            installed[liveIndex].name = 'ZebMod';
        } catch (ignored) { /* Optional host metadata must not prevent plugin startup. */ }
    }

    function init() {
        if (initialized) return;
        initialized = true;
        if (readyHandler) Lampa.Listener.remove('app', readyHandler);

        Lampa.Lang.add({
            lampa_online_name: { uk: 'ZebMod', ru: 'ZebMod', en: 'ZebMod' },
            lampa_online_rezka_experimental: { uk: 'Експериментальний адаптер. Живий пошук і відтворення не підтверджені; можливі CORS та захист від ботів.', ru: 'Экспериментальный адаптер. Живой поиск и воспроизведение не подтверждены; возможны CORS и защита от ботов.', en: 'Experimental adapter. Live search and playback unverified; CORS and anti-bot protection may prevent access.' },
            lampa_online_rezka_default_voice: { uk: 'Озвучення сайту', ru: 'Озвучка сайта', en: 'Site default audio' },
            lampa_online_rezka_source_quality: { uk: 'Якість джерела', ru: 'Качество источника', en: 'Source quality' },
            lampa_online_rezka_none: { uk: 'Відповідь розпізнано локальним парсером', ru: 'Ответ распознан локальным парсером', en: 'Response recognized by the local parser' },
            lampa_online_rezka_blocked: { uk: 'Rezka обмежує доступ або вимагає перевірку на бота. Обхід не підтримується.', ru: 'Rezka ограничивает доступ или требует проверку на бота. Обход не поддерживается.', en: 'Rezka blocks access or requires a human check. Bypass is not supported.' },
            lampa_online_rezka_auth: { uk: 'Rezka вимагає авторизацію. Підтримується лише гостьовий режим.', ru: 'Rezka требует авторизацию. Поддерживается только гостевой режим.', en: 'Rezka requires sign-in. Only guest mode is supported.' },
            lampa_online_rezka_restricted: { uk: 'Матеріал має обмеження доступу. Обхід не підтримується.', ru: 'Доступ к материалу ограничен. Обход не поддерживается.', en: 'Access to this content is restricted. Bypass is not supported.' },
            lampa_online_rezka_parser: { uk: 'Невідомий або пошкоджений формат Rezka; парсер не підтверджено живою відповіддю.', ru: 'Неизвестный или повреждённый формат Rezka; парсер не подтверждён живым ответом.', en: 'Unknown or malformed Rezka format; parser unverified against live content.' },
            lampa_online_rezka_empty: { uk: 'Розпізнана відповідь не містить результатів або серій.', ru: 'Распознанный ответ не содержит результатов или серий.', en: 'Recognized response has no results or episodes.' },
            lampa_online_rezka_empty_stream: { uk: 'Немає підтримуваного HTTPS MP4/HLS потоку.', ru: 'Нет поддерживаемого HTTPS MP4/HLS потока.', en: 'No supported HTTPS MP4/HLS stream.' },
            lampa_online_rezka_encoded: { uk: 'Закодовані посилання не підтримуються цим експериментальним адаптером.', ru: 'Закодированные ссылки не поддерживаются этим экспериментальным адаптером.', en: 'Encoded links are unsupported by this experimental adapter.' },
            lampa_online_rezka_rejected: { uk: 'Rezka відхилила гостьовий запит. Причину не підтверджено.', ru: 'Rezka отклонила гостевой запрос. Причина не подтверждена.', en: 'Rezka rejected the guest request. Cause unconfirmed.' },
            lampa_online_rezka_error: { uk: 'Причину не визначено: можливі мережа, DNS, TLS або CORS. HTTP 0 не є відповіддю сервера.', ru: 'Причина не определена: возможны сеть, DNS, TLS или CORS. HTTP 0 не является ответом сервера.', en: 'Cause unknown: network, DNS, TLS or CORS. HTTP 0 is not a server response.' },
            lampa_online_rezka_timeout: { uk: 'Rezka не відповіла вчасно.', ru: 'Rezka не ответила вовремя.', en: 'Rezka request timed out.' },
            lampa_online_rezka_abort: { uk: 'Запит скасовано.', ru: 'Запрос отменён.', en: 'Request cancelled.' },
            lampa_online_rezka_missing: { uk: 'Сторінка або endpoint не знайдені (404).', ru: 'Страница или endpoint не найдены (404).', en: 'Page or endpoint not found (404).' },
            lampa_online_rezka_server: { uk: 'Помилка сервера Rezka (5xx).', ru: 'Ошибка сервера Rezka (5xx).', en: 'Rezka server error (5xx).' },
            lampa_online_rezka_player: { uk: 'Помилка запуску Lampa.Player.', ru: 'Ошибка запуска Lampa.Player.', en: 'Lampa.Player launch error.' },
            lampa_online_watch: { uk: 'Дивитися через ZebMod', ru: 'Смотреть через ZebMod', en: 'Watch via ZebMod' },
            lampa_online_search: { uk: 'Пошук', ru: 'Поиск', en: 'Search' },
            lampa_online_results: { uk: 'Результати пошуку', ru: 'Результаты поиска', en: 'Search results' },
            lampa_online_back: { uk: 'Назад', ru: 'Назад', en: 'Back' },
            lampa_online_loading: { uk: 'Завантаження', ru: 'Загрузка', en: 'Loading' },
            lampa_online_retry: { uk: 'Натисни для повтору', ru: 'Нажмите для повтора', en: 'Press to retry' },
            lampa_online_diagnostic: { uk: 'Діагностика Filmix', ru: 'Диагностика Filmix', en: 'Filmix diagnostics' },
            lampa_online_diag_stage: { uk: 'Етап', ru: 'Этап', en: 'Stage' },
            lampa_online_diag_elapsed: { uk: 'Час', ru: 'Время', en: 'Elapsed' },
            lampa_online_diag_unknown: { uk: 'Причину не визначено: можливі мережа, DNS, CORS або TLS. HTTP 0 не є кодом відповіді сервера.', ru: 'Причина не определена: возможны сеть, DNS, CORS или TLS. HTTP 0 не является кодом ответа сервера.', en: 'Cause unknown: network, DNS, CORS or TLS may be involved. HTTP 0 is not a server response code.' },
            lampa_online_diag_abort: { uk: 'Запит скасовано', ru: 'Запрос отменён', en: 'Request cancelled' },
            lampa_online_diag_movie_object: { uk: 'Отримано movie як Object. Поточний парсер підтримує movie лише як Array; це обмеження клієнта, а не доказ мережевого збою.', ru: 'Получен movie как Object. Текущий парсер поддерживает movie только как Array; это ограничение клиента, а не доказательство сетевого сбоя.', en: 'Received movie as Object. The current parser supports movie only as Array; this is a client limitation, not evidence of network failure.' },
            lampa_online_profile_retry: { uk: 'Повторити user_profile і пошук', ru: 'Повторить user_profile и поиск', en: 'Retry user_profile and search' },
            lampa_online_network_error: { uk: 'Помилка підключення до Filmix. Перевір API URL, мережу, HTTPS-сертифікат і CORS', ru: 'Ошибка соединения с Filmix. Проверьте API URL, сеть, HTTPS-сертификат и CORS', en: 'Filmix connection error. Check API URL, network, HTTPS certificate and CORS' },
            lampa_online_bad_api: { uk: 'Некоректна адреса Filmix API: потрібна базова адреса без параметрів', ru: 'Некорректный Filmix API URL: нужен базовый адрес без параметров', en: 'Invalid Filmix API base URL: remove query parameters' },
            lampa_online_bad_proxy: { uk: 'Для проксі потрібна базова HTTPS-адреса без параметрів', ru: 'Для прокси нужен базовый HTTPS-адрес без параметров', en: 'Proxy requires an HTTPS base URL without query parameters' },
            lampa_online_https_required: { uk: 'Потрібен HTTPS Filmix API або власний HTTPS-проксі; HTTP автоматично не вмикається', ru: 'Нужен HTTPS Filmix API или свой HTTPS-прокси; HTTP автоматически не включается', en: 'Use an HTTPS Filmix API or your own HTTPS proxy; HTTP fallback is disabled' },
            lampa_online_timeout: { uk: 'Filmix не відповів вчасно. Спробуй ще раз', ru: 'Filmix не ответил вовремя. Попробуйте снова', en: 'Filmix request timed out. Retry' },
            lampa_online_bad_json: { uk: 'Filmix повернув некоректний JSON', ru: 'Filmix вернул некорректный JSON', en: 'Filmix returned invalid JSON' },
            lampa_online_bad_response: { uk: 'Неочікуваний формат відповіді Filmix', ru: 'Неожиданный формат ответа Filmix', en: 'Unexpected Filmix response format' },
            lampa_online_auth_error: { uk: 'Filmix відхилив доступ (401/403). Перевір токен і права облікового запису', ru: 'Filmix отказал в доступе (401/403). Проверьте токен и права аккаунта', en: 'Filmix denied access (401/403). Check your token and account access' },
            lampa_online_api_missing: { uk: 'Filmix API або запис не знайдено (404). Перевір адресу API', ru: 'Filmix API или запись не найдены (404). Проверьте адрес API', en: 'Filmix API or post not found (404). Check the API URL' },
            lampa_online_rate_limit: { uk: 'Забагато запитів до Filmix (429). Повтори пізніше', ru: 'Слишком много запросов к Filmix (429). Повторите позже', en: 'Filmix rate limit (429). Retry later' },
            lampa_online_server_error: { uk: 'Помилка сервера Filmix (5xx). Повтори пізніше', ru: 'Ошибка сервера Filmix (5xx). Повторите позже', en: 'Filmix server error (5xx). Retry later' },
            lampa_online_profile_error: { uk: 'Профіль Filmix не підтверджено. Використовується гостьове обмеження якості', ru: 'Профиль Filmix не подтверждён. Используется гостевой предел качества', en: 'Filmix profile unverified. Using the guest quality limit' },
            lampa_online_missing_title: { uk: 'У картці відсутня назва для пошуку', ru: 'В карточке нет названия для поиска', en: 'The card has no title to search' },
            lampa_online_nothing: { uk: 'Нічого не знайдено', ru: 'Ничего не найдено', en: 'Nothing found' },
            lampa_online_select: { uk: 'Вибери озвучення або сезон', ru: 'Выбери озвучку или сезон', en: 'Select audio or season' },
            lampa_online_no_stream: { uk: 'Немає доступного відеопотоку', ru: 'Нет доступного видеопотока', en: 'No playable stream' },
            lampa_online_voice: { uk: 'Озвучення', ru: 'Озвучка', en: 'Audio' },
            lampa_online_season: { uk: 'Сезон', ru: 'Сезон', en: 'Season' },
            lampa_online_episode: { uk: 'Серія', ru: 'Серия', en: 'Episode' },
            lampa_online_episode_select: { uk: 'Вибери серію', ru: 'Выбери серию', en: 'Choose episode' },
            lampa_online_film: { uk: 'Фільм', ru: 'Фильм', en: 'Film' },
            lampa_online_series: { uk: 'Серіал', ru: 'Сериал', en: 'Series' },
            lampa_online_play_error: { uk: 'Не вдалося відкрити плеєр', ru: 'Не удалось открыть плеер', en: 'Player launch failed' }
        });

        Lampa.Template.add(PREFIX + 'style', '<style>' +
            '.lampa-online-head{padding:1.2em 1.4em .65em;color:#fff}' +
            '.lampa-online-title{font-size:1.35em;font-weight:600;margin-bottom:.2em}' +
            '.lampa-online-muted{font-size:.82em;opacity:.66;margin-top:.28em;line-height:1.35}' +
            '.lampa-online-diagnostic{margin:.7em 1.1em;padding:.85em 1.1em;border:1px solid rgba(255,255,255,.3);border-radius:.38em;color:#fff;line-height:1.45}' +
            '.lampa-online-diagnostic-line{font-size:1em;word-wrap:break-word;margin:.12em 0}' +
            '.lampa-online-row{padding:.8em 1.35em;margin:.35em 1.1em;border-radius:.38em;' +
            'background:rgba(255,255,255,.065);color:#fff;cursor:pointer}' +
            '.lampa-online-row.focus{background:#fff;color:#181818}' +
            '.lampa-online-row-title{font-size:1.05em;line-height:1.35;word-wrap:break-word}' +
            '</style>');
        $('body').append(Lampa.Template.get(PREFIX + 'style', {}, true));

        if (!Lampa.Component.get(COMPONENT)) Lampa.Component.add(COMPONENT, FilmixScreen);
        if (!Lampa.Component.get(PROVIDERS_COMPONENT)) Lampa.Component.add(PROVIDERS_COMPONENT, ProviderScreen);
        if (!Lampa.Component.get(REZKA_COMPONENT)) Lampa.Component.add(REZKA_COMPONENT, RezkaScreen);
        Lampa.Manifest.plugins = {
            type: 'video', version: '0.1.5', name: 'ZebMod',
            description: 'Rezka (experimental), Filmix', component: PROVIDERS_COMPONENT,
            onContextMenu: function () { return { name: tr('watch'), description: 'Rezka (experimental), Filmix' }; },
            onContextLauch: openOnline
        };
        Lampa.Listener.follow('full', addFullSource);

        Lampa.SettingsApi.addComponent({
            component: PREFIX + 'settings', name: 'ZebMod',
            icon: '<svg width="44" height="44" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="5" y="9" width="34" height="26" rx="4" stroke="currentColor" stroke-width="3"/><path d="M18 16L29 22L18 28V16Z" fill="currentColor"/></svg>'
        });
        Lampa.SettingsApi.addParam({
            component: PREFIX + 'settings',
            param: { name: PREFIX + 'api_url', type: 'input', values: '', default: API_DEFAULT, placeholder: API_DEFAULT },
            field: { name: 'Filmix API URL', description: 'Адреса API (не адреса каталогу filmix.gg)' }
        });
        Lampa.SettingsApi.addParam({
            component: PREFIX + 'settings',
            param: { name: PREFIX + 'token', type: 'input', values: '', default: '', placeholder: 'Filmix device token' },
            field: { name: 'Filmix device token (необов’язково)', description: 'Токен власного облікового запису; не вводь пароль' }
        });
        Lampa.SettingsApi.addParam({
            component: PREFIX + 'settings',
            param: { name: PREFIX + 'proxy', type: 'input', values: '', default: '', placeholder: 'https://your-trusted-proxy/' },
            field: { name: 'HTTPS CORS-проксі (необов’язково)', description: 'Лише довірений проксі: він бачитиме запити й токен' }
        });
        Lampa.SettingsApi.addParam({
            component: PREFIX + 'settings',
            param: { name: PREFIX + 'device_id', type: 'input', values: '', default: uid() },
            field: { name: 'Filmix device ID', description: 'Сталий ідентифікатор пристрою; для наявного токена збережи відповідний ID' }
        });
        renameInstalledExtension();
        log('v0.1.5.ready');
    }

    function bootstrap() {
        if (!window.Lampa || !Lampa.Listener) { setTimeout(bootstrap, 200); return; }
        if (window.appready) { init(); return; }
        readyHandler = function (event) { if (event && event.type === 'ready') init(); };
        Lampa.Listener.follow('app', readyHandler);
        if (window.appready) init();
    }
    bootstrap();
})();
