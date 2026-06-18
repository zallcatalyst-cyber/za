/**
 * ╔══════════════════════════════════════════════════════╗
 * ║          WHATSAPP BOT - ALL IN ONE (40+ FITUR)       ║
 * ║  Pairing Code Login + Command Logs + LID Owner Check ║
 * ╚══════════════════════════════════════════════════════╝
 *
 * STRUKTUR FOLDER YANG DIBUTUHKAN:
 * ├── index.js          ← file ini
 * ├── package.json
 * └── database/
 *     ├── owner.json         ← ["6283171413750"]  (owner tambahan, opsional)
 *     ├── premium.json       ← ["6283171413750@s.whatsapp.net"]
 *     ├── registered.json    ← []
 *     ├── nsfw.json          ← []
 *     ├── antitoxic.json     ← ["asu","anj","kntl", ...]
 *     ├── antivirus.json     ← ["6285165639635@g.us", ...]
 *     ├── bad.json           ← ["628xxx@g.us", ...]
 *     ├── tahlil.json        ← (data tahlil)
 *     ├── tebaklagu.json     ← (data tebak lagu)
 *     ├── doaharian.json     ← (data doa harian)
 *     ├── family100.json     ← (data family 100)
 *     └── anuu.json          ← (data video)
 *
 * CARA JALANKAN DI TERMUX:
 *   1. npm install
 *   2. node index.js
 *   3. Masukkan nomor WhatsApp bot (628xxxxxxxxxx) saat diminta
 *   4. Masukkan kode pairing yang tampil ke HP -> Linked Devices -> Link with phone number
 */

'use strict';

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');
const FormData = require('form-data');
const https = require('https');
const readline = require('readline');
const figlet = require('figlet');
const chalk = require('chalk');

// ──────────────────────────────────────────────
//  KONFIGURASI BOT
// ──────────────────────────────────────────────
const CONFIG = {
    PREFIX: '.',
    BOT_NAME: 'rijal💫',
    BOT_NUMBER: '6285165639635',   // ← ganti dengan nomor bot kamu
    TIMEZONE: 'Asia/Tokyo',
    MAX_UPLOAD: 100 * 1024 * 1024, // 100MB
    MENU_IMAGE: 'https://files.catbox.moe/u514uo.jpg',
    // Owner utama bot. Tambahkan pasangan {number, lid} kalau owner punya
    // identitas LID (WhatsApp kadang mengirim peserta sebagai @lid bukan
    // @s.whatsapp.net, jadi kita simpan keduanya supaya tetap dikenali).
    OWNERS: [
        { number: '6283171413750', lid: '155418206691577' },
    ],
};

// ──────────────────────────────────────────────
//  DATABASE HELPER (baca/tulis JSON)
// ──────────────────────────────────────────────
const DB_DIR = path.join(__dirname, 'database');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });

function readDB(filename) {
    const filePath = path.join(DB_DIR, filename);
    if (!fs.existsSync(filePath)) return [];
    try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); }
    catch { return []; }
}
function writeDB(filename, data) {
    fs.writeFileSync(path.join(DB_DIR, filename), JSON.stringify(data, null, 2));
}

// ──────────────────────────────────────────────
//  LOAD DATABASE
// ──────────────────────────────────────────────
let owner         = readDB('owner.json');         // ["628xxx"]  -> owner tambahan (legacy, by number)
let premium       = readDB('premium.json');       // ["628xxx@s.whatsapp.net"]
let registered    = readDB('registered.json');    // [{id, name, age, time}]
let nsfwGroups    = readDB('nsfw.json');          // ["groupid@g.us"]
let antitoxicList = readDB('antitoxic.json');     // ["kata kasar", ...]
let antivirusGrp  = readDB('antivirus.json');     // ["groupid@g.us"]
let badGrp        = readDB('bad.json');           // ["groupid@g.us"]
let tahlilData    = readDB('tahlil.json');
let tebaklaguData = readDB('tebaklagu.json');
let doaHarianData = readDB('doaharian.json');
let family100Data = readDB('family100.json');
let anuuData      = readDB('anuu.json');          // [{url}]

// State game (in-memory)
const gameState = {
    tebakLagu:  {},   // jid -> {jawaban, artist, link, timeout}
    family100:  {},   // jid -> {soal, jawaban, sisa, score, timeout}
    tictactoe:  {},   // jid -> TicTacToe instance
};

// ──────────────────────────────────────────────
//  HELPER FUNCTIONS
// ──────────────────────────────────────────────
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const getRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];
const isRegistered = (jid) => registered.some(r => r.id === jid);
const isGroup = (jid) => jid.endsWith('@g.us');
const phoneToJid = (phone) => phone.replace(/\D/g, '') + '@s.whatsapp.net';

function formatTime(ms) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const h = Math.floor(m / 60);
    return `${h > 0 ? h + 'j ' : ''}${m % 60 > 0 ? (m % 60) + 'm ' : ''}${s % 60}d`;
}

async function getBuffer(url) {
    const { data } = await axios.get(url, { responseType: 'arraybuffer' });
    return Buffer.from(data);
}

// ──────────────────────────────────────────────
//  WAKTU / GREETING HELPER (Asia/Jakarta aware)
// ──────────────────────────────────────────────
function getZonedHour() {
    const now = new Date();
    // Trik aman dari bug ICU (hour12:false kadang mengembalikan "24")
    const zoned = new Date(now.toLocaleString('en-US', { timeZone: CONFIG.TIMEZONE }));
    return zoned.getHours();
}
function getGreeting() {
    const hour = getZonedHour();
    if (hour >= 4 && hour < 11) return 'Selamat Pagi 🌤️';
    if (hour >= 11 && hour < 15) return 'Selamat Siang ☀️';
    if (hour >= 15 && hour < 19) return 'Selamat Sore 🌥️';
    return 'Selamat Malam 🌙';
}

// ──────────────────────────────────────────────
//  SENDER RESOLVER + OWNER CHECK (mendukung @lid)
// ──────────────────────────────────────────────
// WhatsApp kadang mengirim identitas peserta sebagai "@lid" (Linked ID)
// bukan nomor telepon biasa ("@s.whatsapp.net"). Baileys versi terbaru
// menyertakan nomor telepon aslinya di field participantPn / senderPn
// ketika hal itu terjadi. Fungsi ini menggabungkan semua kemungkinan itu
// supaya owner tetap dikenali walau JID yang masuk berbentuk @lid.
function resolveSender(msg, jid, isGrp) {
    const participant = isGrp ? (msg.key.participant || jid) : jid;
    const participantPn =
        msg.key.participantPn ||
        msg.key.senderPn ||
        msg.key.participantAlt ||
        msg.key.remoteJidAlt ||
        null;

    const isLid = !!participant && participant.endsWith('@lid');
    const lidNumber = isLid ? participant.split('@')[0] : null;
    const phoneNumber = isLid
        ? (participantPn ? participantPn.split('@')[0] : null)
        : (participant ? participant.split('@')[0] : null);

    return { participant, isLid, lidNumber, phoneNumber, participantPn };
}

function isOwner(senderInfo) {
    if (!senderInfo) return false;
    const { phoneNumber, lidNumber } = senderInfo;
    const matchConfig = CONFIG.OWNERS.some(o =>
        (phoneNumber && phoneNumber === o.number) ||
        (lidNumber && lidNumber === o.lid)
    );
    const matchLegacy = phoneNumber ? owner.some(n => phoneNumber.includes(n)) : false;
    return matchConfig || matchLegacy;
}
const isPremium = (jid, senderInfo) => premium.includes(jid) || isOwner(senderInfo);

// ──────────────────────────────────────────────
//  LOG COMMAND KE TERMINAL
// ──────────────────────────────────────────────
function logCommand({ pushName, senderInfo, jid, isGrp, cmd, args }) {
    const waktu = new Date().toLocaleString('id-ID', { timeZone: CONFIG.TIMEZONE });
    const idLabel = senderInfo.phoneNumber || senderInfo.lidNumber || 'unknown';
    console.log(chalk.hex('#1e90ff')('───────────────────────────────────────────'));
    console.log(`${chalk.bold.yellow('[CMD]')} ${chalk.bold.green(pushName || 'User')} ${chalk.dim(`(${idLabel})`)}${isOwner(senderInfo) ? chalk.bold.magenta(' [OWNER]') : ''}`);
    console.log(`${chalk.cyan('Chat    :')} ${isGrp ? 'Group' : 'Private'} → ${jid}`);
    console.log(`${chalk.cyan('Command :')} ${CONFIG.PREFIX}${cmd} ${args.join(' ')}`.trim());
    console.log(`${chalk.cyan('Waktu   :')} ${waktu}`);
}

// ──────────────────────────────────────────────
//  PLUGIN: TicTacToe
// ──────────────────────────────────────────────
class TicTacToe {
    constructor(playerX = 'x', playerO = 'o') {
        this.playerX = playerX; this.playerO = playerO;
        this._currentTurn = false; this._x = 0; this._o = 0; this.turns = 0;
    }
    get board() { return this._x | this._o; }
    get currentTurn() { return this._currentTurn ? this.playerO : this.playerX; }
    get enemyTurn() { return this._currentTurn ? this.playerX : this.playerO; }
    static check(state) {
        for (let combo of [7,56,73,84,146,273,292,448])
            if ((state & combo) === combo) return true;
        return false;
    }
    static toBinary(x=0,y=0) { return 1 << x + (3*y); }
    turn(player=0,x=0,y) {
        if (this.board === 511) return -3;
        let pos = 0;
        if (y == null) { if (x<0||x>8) return -1; pos = 1<<x; }
        else { if (x<0||x>2||y<0||y>2) return -1; pos = TicTacToe.toBinary(x,y); }
        if (this._currentTurn ^ player) return -2;
        if (this.board & pos) return 0;
        this[this._currentTurn?'_o':'_x'] |= pos;
        this._currentTurn = !this._currentTurn; this.turns++;
        return 1;
    }
    static render(boardX=0,boardO=0) {
        let x = parseInt(boardX.toString(2),4);
        let y = parseInt(boardO.toString(2),4)*2;
        return [...(x+y).toString(4).padStart(9,'0')].reverse().map((v,i)=>v=='1'?'X':v=='2'?'O':++i);
    }
    render() { return TicTacToe.render(this._x,this._o); }
    get winner() {
        let x = TicTacToe.check(this._x), o = TicTacToe.check(this._o);
        return x ? this.playerX : o ? this.playerO : false;
    }
}

function renderTTTBoard(board) {
    const e = board;
    return `\`\`\`\n ${e[0]} │ ${e[1]} │ ${e[2]}\n───┼───┼───\n ${e[3]} │ ${e[4]} │ ${e[5]}\n───┼───┼───\n ${e[6]} │ ${e[7]} │ ${e[8]}\`\`\``;
}

// ──────────────────────────────────────────────
//  PLUGIN: TelegraPH Upload
// ──────────────────────────────────────────────
const TelegraPH = async (filePath) => new Promise(async (resolve, reject) => {
    if (!fs.existsSync(filePath)) return reject(new Error('File not Found'));
    try {
        const form = new FormData();
        form.append('file', fs.createReadStream(filePath));
        const { data } = await axios({ url: 'https://telegra.ph/upload', method: 'POST', headers: form.getHeaders(), data: form });
        return resolve('https://telegra.ph' + data[0].src);
    } catch (err) { return reject(new Error(String(err))); }
});

// ──────────────────────────────────────────────
//  PLUGIN: YouTube Download
// ──────────────────────────────────────────────
const ytdl = {
    isUrl: str => { try { new URL(str); return true; } catch { return false; } },
    youtube: url => {
        if (!url) return null;
        const patterns = [
            /youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
            /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
            /youtu\.be\/([a-zA-Z0-9_-]{11})/
        ];
        for (let p of patterns) if (p.test(url)) return url.match(p)[1];
        return null;
    },
    formatVideo: ['144','240','360','480','720','1080'],
    formatAudio: ['mp3','m4a','aac','opus'],
    download: async (link, format) => {
        if (!link || !ytdl.isUrl(link)) return { status: false, error: 'Link tidak valid' };
        const id = ytdl.youtube(link);
        if (!id) return { status: false, error: 'Bukan link YouTube' };
        const allFormats = [...ytdl.formatVideo, ...ytdl.formatAudio];
        if (!format || !allFormats.includes(format)) return { status: false, error: 'Format tidak valid', available: allFormats };
        try {
            const { data: cdnData } = await axios.get('https://media.savetube.me/api/random-cdn', { headers: { 'user-agent': 'Postify/1.0.0' } });
            const cdn = cdnData.cdn;
            const headers = { 'accept': '*/*', 'content-type': 'application/json', 'origin': 'https://yt.savetube.me', 'user-agent': 'Postify/1.0.0' };
            const { data: infoData } = await axios.post(`https://${cdn}/v2/info`, { url: `https://www.youtube.com/watch?v=${id}` }, { headers });
            const crypto = require('crypto');
            const secretKey = 'C5D58EF67A7584E4A29F6C35BBC4EB12';
            const enc = Buffer.from(infoData.data, 'base64');
            const iv = enc.slice(0, 16);
            const content = enc.slice(16);
            const key = Buffer.from(secretKey.match(/.{1,2}/g).join(''), 'hex');
            const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
            let dec = decipher.update(content);
            dec = Buffer.concat([dec, decipher.final()]);
            const info = JSON.parse(dec.toString());
            const isAudio = ytdl.formatAudio.includes(format);
            const { data: dlData } = await axios.post(`https://${cdn}/download`, { id, downloadType: isAudio ? 'audio' : 'video', quality: isAudio ? '128' : format, key: info.key }, { headers });
            return { status: true, result: { title: info.title, thumbnail: info.thumbnail || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, format, type: isAudio ? 'audio' : 'video', download: dlData.data.downloadUrl, duration: info.duration } };
        } catch (e) { return { status: false, error: e.message }; }
    }
};

// ──────────────────────────────────────────────
//  PLUGIN: TikTok Download
// ──────────────────────────────────────────────
const tiktokDl = async (url) => {
    const clean = (d) => d.replace(/(<br?\s?\/>)/gi, '\n').replace(/(<([^>]+)>)/gi, '');
    const response = await axios('https://lovetik.com/api/ajax/search', {
        method: 'POST', data: new URLSearchParams(Object.entries({ query: url }))
    });
    const d = response.data;
    return {
        title: clean(d.desc), author: clean(d.author),
        nowm: (d.links[0]?.a || '').replace('https', 'http'),
        watermark: (d.links[1]?.a || '').replace('https', 'http'),
        audio: (d.links[2]?.a || '').replace('https', 'http'),
        thumbnail: d.cover
    };
};

// ──────────────────────────────────────────────
//  PLUGIN: Instagram Download
// ──────────────────────────────────────────────
const igDl = async (url) => {
    const qs = require('qs');
    const HEADERS = {
        'Accept': '*/*', 'Content-Type': 'application/x-www-form-urlencoded',
        'X-CSRFToken': 'RVDUooU5MYsBbS1CNN3CzVAuEP8oHB52', 'X-IG-App-ID': '1217981644879628',
        'X-FB-LSD': 'AVqbxe3J_YA', 'User-Agent': 'Mozilla/5.0 (Linux; Android 11; SAMSUNG SM-G973U) AppleWebKit/537.36'
    };
    const postId = url.match(/(?:p|tv|stories|reel)\/([^/?#&]+)/)?.[1];
    if (!postId) throw new Error('Invalid Instagram URL');
    const reqData = qs.stringify({ av:'0', __d:'www', __user:'0', __a:'1', __req:'3', lsd:'AVqbxe3J_YA', fb_api_req_friendly_name:'PolarisPostActionLoadPostQueryQuery', variables: JSON.stringify({ shortcode: postId, has_threaded_comments: false }), server_timestamps:'true', doc_id:'10015901848480474' });
    const { data } = await axios.post('https://www.instagram.com/api/graphql', reqData, { headers: HEADERS });
    const media = data.data?.xdt_shortcode_media;
    if (!media) throw new Error('Media not found');
    const urls = media.edge_sidecar_to_children ? media.edge_sidecar_to_children.edges.map(e => e.node.video_url || e.node.display_url) : [media.video_url || media.display_url];
    return { url: urls, metadata: { caption: media.edge_media_to_caption.edges[0]?.node.text || '', username: media.owner.username, isVideo: media.is_video } };
};

// ──────────────────────────────────────────────
//  PLUGIN: Facebook Download (fdown)
// ──────────────────────────────────────────────
const fbDl = async (url) => {
    const qs = require('qs');
    const resToken = await axios.get('https://fdown.net', { headers: { 'User-Agent': 'Mozilla/5.0 (Android 10; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0' } });
    const $t = cheerio.load(resToken.data);
    const token_v = $t('input[name="token_v"]').val(), token_c = $t('input[name="token_c"]').val(), token_h = $t('input[name="token_h"]').val();
    const { data } = await axios.post('https://fdown.net/download.php', qs.stringify({ URLz: url, token_v, token_c, token_h }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0', 'referer': 'https://fdown.net/' } });
    const $ = cheerio.load(data);
    return { sd: $('#sdlink').attr('href'), hd: $('#hdlink').attr('href'), title: $('.lib-header').first().text().trim(), thumbnail: $('.lib-img-show').first().attr('data-cfsrc') };
};

// ──────────────────────────────────────────────
//  PLUGIN: Pinterest
// ──────────────────────────────────────────────
const pinterestSearch = async (query) => {
    const { data } = await axios.get('https://www.pinterest.com/resource/BaseSearchResource/get/', {
        params: { source_url: `/search/pins/?q=${query}`, data: JSON.stringify({ options: { query, scope: 'pins', no_fetch_context_on_resource: false }, context: {} }) }
    });
    return data.resource_response.data.results.filter(v => v.images?.orig).map(r => ({
        upload_by: r.pinner.username, fullname: r.pinner.full_name, followers: r.pinner.follower_count,
        caption: r.grid_title, image: r.images.orig.url, source: 'https://id.pinterest.com/pin/' + r.id
    }));
};

// ──────────────────────────────────────────────
//  PLUGIN: SavePin (download Pinterest)
// ──────────────────────────────────────────────
const savePinDl = async (url) => {
    const { data } = await axios.get(`https://www.savepin.app/download.php?url=${encodeURIComponent(url)}&lang=en&type=redirect`);
    const $ = cheerio.load(data);
    const results = [];
    $('td.video-quality').each((i, el) => {
        const type = $(el).text().trim(), downloadLink = $(el).nextAll().find('#submiturl').attr('href');
        if (downloadLink) results.push({ type, downloadLink });
    });
    return { title: $('h1').text().trim(), results };
};

// ──────────────────────────────────────────────
//  PLUGIN: Google Drive Download
// ──────────────────────────────────────────────
const gdriveDl = async (url) => {
    if (!url?.match(/drive\.google/i)) return { error: true };
    const id = (url.match(/\/?id=(.+)/i) || url.match(/\/d\/(.*?)\//)) ?.[1];
    if (!id) return { error: true };
    const res = await axios(`https://drive.google.com/uc?id=${id}&authuser=0&export=download`, {
        method: 'post', headers: { 'content-length': 0, 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'origin': 'https://drive.google.com', 'x-drive-first-party': 'DriveWebUi', 'x-json-requested': 'true' }
    });
    const { fileName, sizeBytes, downloadUrl } = JSON.parse(res.data.slice(4));
    if (!downloadUrl) throw new Error('Link Download Limit!');
    return { downloadUrl, fileName, fileSize: sizeBytes };
};

// ──────────────────────────────────────────────
//  PLUGIN: SoundCloud Search
// ──────────────────────────────────────────────
const soundcloudSearch = async (query) => {
    const { data } = await axios.get(`https://m.soundcloud.com/search?q=${encodeURIComponent(query)}`);
    const $ = cheerio.load(data);
    const results = [];
    $('.List_VerticalList__2uQYU li').each((i, el) => {
        const title = $(el).find('.Cell_CellLink__3yLVS').attr('aria-label');
        const url = 'https://m.soundcloud.com' + $(el).find('.Cell_CellLink__3yLVS').attr('href');
        if (title && url) results.push({ title, url });
    });
    return results.slice(0, 5);
};

// ──────────────────────────────────────────────
//  PLUGIN: Play Store Search
// ──────────────────────────────────────────────
const playstoreSearch = async (search) => {
    const { data } = await axios.get(`https://play.google.com/store/search?q=${search}&c=apps`);
    const $ = cheerio.load(data);
    const hasil = [];
    $('.ULeU3b .VfPpkd-EScbFb-JIbuQc.TAQqTe > a').each((i, u) => {
        hasil.push({
            link: `https://play.google.com${$(u).attr('href')}`,
            nama: $(u).find('.DdYX5').text() || 'No name',
            developer: $(u).find('.wMUdtb').text() || 'No Developer',
            img: $(u).find('img').attr('src') || '',
            rate: $(u).find('div').attr('aria-label') || 'No Rate'
        });
    });
    return hasil;
};

// ──────────────────────────────────────────────
//  PLUGIN: Lyrics
// ──────────────────────────────────────────────
const lyricsSearch = async (song) => {
    const { data } = await axios.get(`https://www.lyrics.com/lyrics/${encodeURIComponent(song)}`);
    const $ = cheerio.load(data);
    return $('.best-matches .bm-case').map((i, el) => ({
        title: $(el).find('.bm-label a').first().text(),
        artist: $(el).find('.bm-label a').last().text(),
        link: 'https://www.lyrics.com' + $(el).find('.bm-label a').first().attr('href')
    })).get();
};

const lyricsGet = async (url) => {
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);
    return { lyrics: $('#lyric-body-text').text().trim(), about: $('.artist-meta .bio').text().trim() };
};

// ──────────────────────────────────────────────
//  PLUGIN: BMKG Gempa
// ──────────────────────────────────────────────
const getGempa = async () => {
    const { data } = await axios.get('https://www.bmkg.go.id/gempabumi/gempabumi-dirasakan.bmkg');
    const $ = cheerio.load(data);
    const dirasakan = [];
    $('table > tbody > tr:nth-child(1) > td:nth-child(6) > span').each((i, el) => dirasakan.push($(el).text().replace('\t', ' ')));
    return {
        imagemap: $('div.modal-body > div > div:nth-child(1) > img').attr('src'),
        magnitude: $('table > tbody > tr:nth-child(1) > td:nth-child(4)').text(),
        kedalaman: $('table > tbody > tr:nth-child(1) > td:nth-child(5)').text(),
        wilayah: $('table > tbody > tr:nth-child(1) > td:nth-child(6) > a').text(),
        waktu: $('table > tbody > tr:nth-child(1) > td:nth-child(2)').text(),
        dirasakan: dirasakan.join('\n')
    };
};

// ──────────────────────────────────────────────
//  PLUGIN: JKT48 News
// ──────────────────────────────────────────────
const getJktNews = async (lang = 'id') => {
    const { data } = await axios.get(`https://jkt48.com/news/list?lang=${lang}`);
    const $ = cheerio.load(data);
    return $('.entry-news__list').map((i, el) => ({
        title: $(el).find('h3 a').text().trim(),
        link: 'https://jkt48.com' + $(el).find('h3 a').attr('href'),
        date: $(el).find('time').text().trim()
    })).get();
};

// ──────────────────────────────────────────────
//  PLUGIN: Halodoc
// ──────────────────────────────────────────────
const halodoc = async (penyakit) => {
    const { data } = await axios.get(`https://www.halodoc.com/artikel/search/${penyakit}`);
    const $ = cheerio.load(data);
    const articles = [];
    $('magneto-card').each((i, el) => {
        const title = $(el).find('header a').text().trim();
        const link = $(el).find('header a').attr('href');
        if (title && link) articles.push({ title, link: 'https://www.halodoc.com' + link, description: $(el).find('.description').text().trim() });
    });
    return articles;
};

// ──────────────────────────────────────────────
//  PLUGIN: Komiku (Manga)
// ──────────────────────────────────────────────
const komikuSearch = async (name, type = 'manga') => {
    const { data } = await axios.get(`https://api.komiku.id/?post_type=${type}&s=${encodeURIComponent(name)}&APIKEY=undefined`);
    const $ = cheerio.load(data);
    return $('.bge').map((i, el) => ({
        title: $(el).find('h3').text().trim(),
        genre: $(el).find('.tpe1_inf b').text().trim(),
        description: $(el).find('p').text().trim(),
        img: $(el).find('img').attr('src'),
        url: 'https://komiku.id/' + $(el).find('a').attr('href')
    })).get();
};

// ──────────────────────────────────────────────
//  PLUGIN: Kusonime (Anime)
// ──────────────────────────────────────────────
const kusonimeList = async () => {
    const { data } = await axios.get('https://kusonime.com/');
    const $ = cheerio.load(data);
    return $('.venz .detpost').map((i, el) => ({
        title: $(el).find('.content h2 a').text().trim(),
        url: $(el).find('.content h2 a').attr('href'),
        thumbnail: $(el).find('.thumbz img').attr('src')
    })).get();
};

const kusonimeSearch = async (anime) => {
    const { data } = await axios.get(`https://kusonime.com/?s=${encodeURIComponent(anime)}`);
    const $ = cheerio.load(data);
    return $('.venz .detpost').map((i, el) => ({
        title: $(el).find('.content h2 a').text().trim(),
        url: $(el).find('.content h2 a').attr('href'),
        thumbnail: $(el).find('.thumbz img').attr('src')
    })).get();
};

// ──────────────────────────────────────────────
//  PLUGIN: Bukalapak
// ──────────────────────────────────────────────
const bukalapakSearch = async (search) => {
    const { data } = await axios.get(`https://www.bukalapak.com/products?from=omnisearch&search[keywords]=${encodeURIComponent(search)}`, { headers: { 'user-agent': 'Mozilla/5.0' } });
    const $ = cheerio.load(data);
    const hasil = [];
    $('div.bl-flex-item.mb-8').each((i, u) => {
        const img = $(u).find('div > a > img').attr('src');
        if (!img) return;
        hasil.push({
            title: $(u).find('.bl-product-card__description-name > p > a').text().trim(),
            harga: $(u).find('div.bl-product-card__description-price > p').text().trim(),
            rating: $(u).find('div.bl-product-card__description-rating > p').text().trim(),
            image: img,
            link: $(u).find('.bl-thumbnail--slider > div > a').attr('href')
        });
    });
    return hasil;
};

// ──────────────────────────────────────────────
//  PLUGIN: Wallpaper / Scraper
// ──────────────────────────────────────────────
const wallpaperSearch = async (title, page = '1') => {
    const { data } = await axios.get(`https://www.besthdwallpaper.com/search?CurrentPage=${page}&q=${title}`);
    const $ = cheerio.load(data);
    return $('div.grid-item').map((i, el) => ({
        title: $(el).find('div.info > a > h3').text(),
        image: $(el).find('picture > img').attr('data-src') || $(el).find('picture > img').attr('src'),
        source: 'https://www.besthdwallpaper.com/' + $(el).find('div > a:nth-child(3)').attr('href')
    })).get();
};

const githubstalk = async (user) => {
    const { data } = await axios.get(`https://api.github.com/users/${user}`);
    return { username: data.login, nickname: data.name, bio: data.bio, followers: data.followers, following: data.following, public_repo: data.public_repos, url: data.html_url, profile_pic: data.avatar_url };
};

const mlstalk = async (id, zoneId) => {
    const { data } = await axios.post('https://api.duniagames.co.id/api/transaction/v1/top-up/inquiry/store',
        new URLSearchParams({ productId:'1', itemId:'2', catalogId:'57', paymentId:'352', gameId: id, zoneId, product_ref:'REG', product_ref_denom:'AE' }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Referer': 'https://www.duniagames.co.id/' } }
    );
    return data.data.gameDetail;
};

// ──────────────────────────────────────────────
//  PLUGIN: Quotes Anime
// ──────────────────────────────────────────────
const quotesAnime = async () => {
    const page = Math.floor(Math.random() * 184);
    const { data } = await axios.get(`https://otakotaku.com/quote/feed/${page}`);
    const $ = cheerio.load(data);
    const hasil = [];
    $('div.kotodama-list').each((i, el) => {
        hasil.push({ karakter: $(el).find('div.char-name').text().trim(), anime: $(el).find('div.anime-title').text().trim(), quotes: $(el).find('div.quote').text().trim(), gambar: $(el).find('img').attr('data-src') });
    });
    return hasil;
};

// ──────────────────────────────────────────────
//  PLUGIN: SimSimi
// ──────────────────────────────────────────────
const simsimi = async (teks, bahasa = 'id') => {
    const formData = new URLSearchParams();
    formData.append('text', teks); formData.append('lc', bahasa);
    const { data } = await axios.post('https://api.simsimi.vn/v2/simtalk', formData);
    return data.message;
};

// ──────────────────────────────────────────────
//  PLUGIN: Remini (AI Photo Enhance)
// ──────────────────────────────────────────────
const reminiEnhance = (imageBuffer, mode = 'enhance') => new Promise((resolve, reject) => {
    const modes = ['enhance', 'recolor', 'dehaze'];
    if (!modes.includes(mode)) mode = 'enhance';
    const url = `https://inferenceengine.vyro.ai/${mode}`;
    const formData = new FormData();
    formData.append('model_version', 1);
    formData.append('image', imageBuffer, { filename: 'enhance_image_body.jpg', contentType: 'image/jpeg' });
    const req = https.request(url, { method: 'POST', headers: { ...formData.getHeaders(), 'User-Agent': 'okhttp/4.9.3', Connection: 'Keep-Alive' } }, (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('error', reject);
    formData.pipe(req);
});

// ──────────────────────────────────────────────
//  PLUGIN: Blue Archive TTS
// ──────────────────────────────────────────────
const blueArchiveTTS = async (text, model = 'Airi', speed = 1.2) => {
    const WebSocket = require('ws');
    return new Promise((resolve, reject) => {
        if (!text || text.length >= 500) return reject(new Error('Text tidak valid atau > 500 karakter'));
        const session_hash = Math.random().toString(36).substring(2);
        const socket = new WebSocket('wss://ori-muchim-bluearchivetts.hf.space/queue/join');
        socket.on('message', (data) => {
            const d = JSON.parse(data.toString());
            if (d.msg === 'send_hash') socket.send(JSON.stringify({ fn_index: 0, session_hash }));
            else if (d.msg === 'send_data') socket.send(JSON.stringify({ fn_index: 0, session_hash, data: [text, 'JP_' + model, speed] }));
            else if (d.msg === 'process_completed') { socket.close(); resolve({ text, model, url: 'https://ori-muchim-bluearchivetts.hf.space/file=' + d.output.data[1]?.name }); }
        });
        socket.on('error', reject);
    });
};

// ──────────────────────────────────────────────
//  PLUGIN: Free Fire
// ──────────────────────────────────────────────
const ffCh = async () => {
    const { data } = await axios.get('https://ff.garena.com/id/chars/');
    const $ = cheerio.load(data);
    return $('.char-box.char-box-new').map((i, el) => ({ name: $(el).find('.char-item-name').text().trim(), desc: $(el).find('.char-item-desc').text().trim() })).get();
};
const ffNews = async () => {
    const { data } = await axios.get('https://ff.garena.com/id/news/');
    const $ = cheerio.load(data);
    return $('.news-item.news-elem').map((i, el) => ({ title: $(el).find('.news-title').text().trim(), time: $(el).find('.news-time').text().trim(), link: 'https://ff.garena.com' + $(el).find('a').attr('href') })).get();
};

// ──────────────────────────────────────────────
//  TERMINAL BANNER + INPUT NOMOR (untuk pairing code)
// ──────────────────────────────────────────────
const question = (text) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => rl.question(text, (value) => { rl.close(); resolve(value); }));
};

function tampilkanBanner() {
    return new Promise((resolve) => {
        figlet.text(CONFIG.BOT_NAME, { font: 'Slant', horizontalLayout: 'fitted' }, (err, data) => {
            if (!err) {
                console.log(chalk.bold.cyan(data));
                console.log(chalk.bold.hex('#1e90ff')('==========================================================='));
                console.log(`  ${chalk.bold.hex('#ff007f')(`✨ ${CONFIG.BOT_NAME} MULTI DEVICE ✨`)} ${chalk.dim('|')} ${chalk.yellow('Pairing Mode')}`);
                console.log(chalk.bold.hex('#1e90ff')('===========================================================\n'));
            }
            resolve();
        });
    });
}

// ──────────────────────────────────────────────
//  MAIN BOT
// ──────────────────────────────────────────────
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('./session');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false, // pakai pairing code, bukan QR
        auth: state,
        browser: ['Ubuntu', 'Chrome', '20.0.04'], // browser ini disyaratkan agar pairing code muncul
    });

    await tampilkanBanner();

    // ── PAIRING CODE: hanya jalan kalau belum pernah login ──
    if (!sock.authState.creds.registered) {
        console.log(`[ ${chalk.bold.yellow('INFO')} ] Silakan masukkan nomor WhatsApp yang akan dijadikan bot.`);
        console.log(`[ ${chalk.bold.yellow('INFO')} ] Contoh format: 6281234567xxx (kode negara, tanpa spasi/+)\n`);

        let phoneNumber = await question(chalk.bold.green('Masukkan Nomor WA Bot: '));
        phoneNumber = phoneNumber.replace(/[^0-9]/g, '');

        if (!phoneNumber) {
            console.log(chalk.bold.red('\nNomor tidak valid! Restart bot untuk mencoba lagi.'));
            process.exit(0);
        }

        setTimeout(async () => {
            try {
                let code = await sock.requestPairingCode(phoneNumber);
                code = code?.match(/.{1,4}/g)?.join('-') || code;

                console.log(chalk.bold.hex('#1e90ff')('\n───────────────────────────────────────────────────────────'));
                console.log(`[ ${chalk.bold.green('KODE PAIRING ANDA')} ] : ${chalk.bold.bgHex('#ff007f').white(` ${code} `)}`);
                console.log(chalk.bold.hex('#1e90ff')('───────────────────────────────────────────────────────────'));
                console.log(chalk.dim('Buka WhatsApp di HP -> Linked Devices -> Link with phone number, lalu masukkan kode di atas.\n'));
            } catch (error) {
                console.error('Gagal meminta kode pairing:', error);
            }
        }, 3000);
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log(chalk.bold.red(`[BOT] Koneksi terputus, reconnect: ${shouldReconnect}`));
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log(chalk.bold.hex('#1e90ff')('───────────────────────────────────────────────────────────'));
            console.log(`[ ${chalk.bold.green('SUCCESS')} ] Bot ${CONFIG.BOT_NAME} berhasil terhubung ke WhatsApp!`);
            console.log(`[ ${chalk.bold.blue('TIME')}    ] ${new Date().toLocaleString('id-ID', { timeZone: CONFIG.TIMEZONE })}`);
            console.log(chalk.bold.hex('#1e90ff')('───────────────────────────────────────────────────────────\n'));
        }
    });

    // ──────────────────────────────────────────
    //  HELPER SEND
    // ──────────────────────────────────────────
    const reply = (jid, text, quoted) => sock.sendMessage(jid, { text }, { quoted });
    const sendImg = (jid, buffer, caption = '', quoted) => sock.sendMessage(jid, { image: buffer, caption }, { quoted });
    const sendAudio = (jid, buffer, ptt = false, quoted) => sock.sendMessage(jid, { audio: buffer, ptt, mimetype: 'audio/mp4' }, { quoted });
    const sendVideo = (jid, buffer, caption = '', quoted) => sock.sendMessage(jid, { video: buffer, caption }, { quoted });
    const sendDoc = (jid, buffer, filename, mimetype, quoted) => sock.sendMessage(jid, { document: buffer, fileName: filename, mimetype }, { quoted });
    const react = (jid, emoji, key) => sock.sendMessage(jid, { react: { text: emoji, key } });

    // ──────────────────────────────────────────
    //  MESSAGE HANDLER
    // ──────────────────────────────────────────
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (!msg.message || msg.key.fromMe) continue;

            const jid = msg.key.remoteJid;
            const isGrp = isGroup(jid);
            const sender = isGrp ? msg.key.participant : jid;
            const senderInfo = resolveSender(msg, jid, isGrp);
            const pushName = msg.pushName || 'User';
            const body =
                msg.message?.conversation ||
                msg.message?.extendedTextMessage?.text ||
                msg.message?.imageMessage?.caption ||
                msg.message?.videoMessage?.caption || '';

            const prefix = CONFIG.PREFIX;
            const isCmd = body.startsWith(prefix);
            const cmd = isCmd ? body.slice(prefix.length).trim().split(/\s+/)[0].toLowerCase() : '';
            const args = isCmd ? body.slice(prefix.length + cmd.length).trim().split(/\s+/).filter(Boolean) : [];
            const text = args.join(' ');
            const quoted = msg;

            // ── Anti-Toxic (grup) ──────────────────
            if (isGrp && antitoxicList.length) {
                const lowerBody = body.toLowerCase();
                if (antitoxicList.some(kata => lowerBody.includes(kata.toLowerCase()))) {
                    await sock.sendMessage(jid, { delete: msg.key });
                    await reply(jid, `⚠️ @${sender.split('@')[0]} pesan kamu dihapus karena mengandung kata tidak sopan!`, quoted);
                    continue;
                }
            }

            if (!isCmd) continue;

            // ── Log command ke terminal ──────────────
            logCommand({ pushName, senderInfo, jid, isGrp, cmd, args });

            // ── React loading ──────────────────────
            await react(jid, '⏳', msg.key);

            try {
                // ═══════════════════════════════════════
                //  MENU
                // ═══════════════════════════════════════
                if (cmd === 'menu' || cmd === 'help') {
                    const ucapan = getGreeting();
                    const tanggal = new Date().toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

                    const header = `🛠️ *INFO USER & BOT*
│ 👤 *Nama:* ${pushName || 'User'}
│ 🕒 *Waktu:* ${ucapan}
│ 📅 *Tanggal:* ${tanggal}
│ 👑 *Prefix:* [ ${prefix} ]
│`;

                    const menuText = `${header}

📥 *DOWNLOADER*
.ytmp3
.ytmp4
.tiktok
.ig
.fb
.gdrive
.savepin
.soundcloud

🎮 *GAME*
.tebak
.stl
.f100
.stf
.ttt

🔍 *PENCARIAN*
.pinterest
.wallpaper
.playstore
.bukalapak
.komiku
.kusonime
.lyrics

ℹ️ *INFO*
.gempa
.jktnews
.halodoc
.ffnews
.ffch
.mlstalk
.github
.myid

🤖 *AI/TOOLS*
.remini
.bluearchive
.simsimi
.quotesanime
.telegraph

🙏 *ISLAMI*
.doa
.tahlil

📋 *LAIN-LAIN*
.anuu
.register
.profil
.nsfw
.addpremium
.delpremium

💡 Ketik perintahnya untuk melihat cara pakainya.`.trim();

                    try {
                        const imgBuf = await getBuffer(CONFIG.MENU_IMAGE);
                        await sendImg(jid, imgBuf, menuText, quoted);
                    } catch {
                        // fallback ke teks biasa kalau gambar gagal diunduh
                        await reply(jid, menuText, quoted);
                    }
                }

                // ═══════════════════════════════════════
                //  MYID / IDINFO
                // ═══════════════════════════════════════
                else if (cmd === 'myid' || cmd === 'idinfo') {
                    const ownerNumbers = CONFIG.OWNERS.map(o => o.number).join(', ') || '-';
                    const ownerLids = CONFIG.OWNERS.map(o => o.lid).join(', ') || '-';
                    const terdeteksi = senderInfo.lidNumber || senderInfo.phoneNumber || '-';

                    const infoText = `🆔 *INFO ID*

JID asli: ${senderInfo.participant}
Nomor terdeteksi: ${terdeteksi}
senderPn/participantPn: ${senderInfo.participantPn || '-'}
Owner di config: ${ownerNumbers} (LID: ${ownerLids})
Dikenali sebagai owner? ${isOwner(senderInfo) ? '✅ YA' : '❌ TIDAK'}`;
                    await reply(jid, infoText, quoted);
                }

                // ═══════════════════════════════════════
                //  REGISTER / PROFILE
                // ═══════════════════════════════════════
                else if (cmd === 'register' || cmd === 'daftar') {
                    if (isRegistered(sender)) return reply(jid, '❌ Kamu sudah terdaftar!', quoted);
                    if (args.length < 2) return reply(jid, `❌ Format: ${prefix}register <nama> <usia>`, quoted);
                    const nama = args.slice(0, -1).join(' '), usia = args[args.length - 1];
                    registered.push({ id: sender, name: nama, age: usia, time: Date.now().toString(16) });
                    writeDB('registered.json', registered);
                    await reply(jid, `✅ Berhasil daftar!\n👤 Nama: ${nama}\n🎂 Usia: ${usia}`, quoted);
                }
                else if (cmd === 'profil' || cmd === 'profile') {
                    const user = registered.find(r => r.id === sender);
                    if (!user) return reply(jid, `❌ Kamu belum daftar! Ketik ${prefix}register <nama> <usia>`, quoted);
                    await reply(jid, `╔══ PROFIL ══╗\n👤 Nama: ${user.name}\n🎂 Usia: ${user.age}\n🆔 ID: ${sender.split('@')[0]}\n${isPremium(sender, senderInfo) ? '⭐ Status: Premium' : ''}`, quoted);
                }

                // ═══════════════════════════════════════
                //  OWNER COMMANDS
                // ═══════════════════════════════════════
                else if (cmd === 'addpremium') {
                    if (!isOwner(senderInfo)) return reply(jid, '❌ Hanya owner!', quoted);
                    const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || (args[0] ? args[0].replace(/\D/g,'') + '@s.whatsapp.net' : null);
                    if (!target) return reply(jid, '❌ Tag atau masukkan nomor!', quoted);
                    if (!premium.includes(target)) { premium.push(target); writeDB('premium.json', premium); }
                    await reply(jid, `✅ @${target.split('@')[0]} berhasil ditambahkan sebagai premium!`, quoted);
                }
                else if (cmd === 'delpremium') {
                    if (!isOwner(senderInfo)) return reply(jid, '❌ Hanya owner!', quoted);
                    const target = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || (args[0] ? args[0].replace(/\D/g,'') + '@s.whatsapp.net' : null);
                    premium = premium.filter(p => p !== target); writeDB('premium.json', premium);
                    await reply(jid, `✅ @${target?.split('@')[0]} dihapus dari premium!`, quoted);
                }

                // ═══════════════════════════════════════
                //  NSFW TOGGLE
                // ═══════════════════════════════════════
                else if (cmd === 'nsfw') {
                    if (!isGrp) return reply(jid, '❌ Hanya di grup!', quoted);
                    if (!isOwner(senderInfo)) return reply(jid, '❌ Hanya owner/admin!', quoted);
                    if (args[0] === 'on') {
                        if (!nsfwGroups.includes(jid)) { nsfwGroups.push(jid); writeDB('nsfw.json', nsfwGroups); }
                        await reply(jid, '✅ NSFW diaktifkan di grup ini.', quoted);
                    } else {
                        nsfwGroups = nsfwGroups.filter(g => g !== jid); writeDB('nsfw.json', nsfwGroups);
                        await reply(jid, '✅ NSFW dinonaktifkan di grup ini.', quoted);
                    }
                }

                // ═══════════════════════════════════════
                //  DOWNLOADER
                // ═══════════════════════════════════════
                else if (cmd === 'ytmp3' || cmd === 'ytmp4') {
                    if (!text) return reply(jid, `❌ Masukkan link YouTube!\nContoh: ${prefix}${cmd} https://youtu.be/xxx`, quoted);
                    const format = cmd === 'ytmp3' ? 'mp3' : '360';
                    await reply(jid, '⏳ Sedang memproses...', quoted);
                    const result = await ytdl.download(text, format);
                    if (!result.status) return reply(jid, '❌ Gagal: ' + result.error, quoted);
                    const { title, thumbnail, download, duration } = result.result;
                    const dur = duration ? `\n⏱ Durasi: ${formatTime(duration * 1000)}` : '';
                    if (cmd === 'ytmp3') {
                        const buf = await getBuffer(download);
                        await reply(jid, `🎵 *${title}*${dur}\n\n📥 Mengunduh audio...`, quoted);
                        await sendAudio(jid, buf, false, quoted);
                    } else {
                        await reply(jid, `🎬 *${title}*${dur}\n\n🔗 Link: ${download}`, quoted);
                    }
                }
                else if (cmd === 'tiktok' || cmd === 'tt') {
                    if (!text) return reply(jid, `❌ Masukkan link TikTok!\nContoh: ${prefix}tiktok <url>`, quoted);
                    await reply(jid, '⏳ Sedang memproses...', quoted);
                    const r = await tiktokDl(text);
                    await reply(jid, `🎵 *${r.title}*\n👤 ${r.author}\n\n📥 Video (no watermark): ${r.nowm}\n💧 Video (watermark): ${r.watermark}\n🎵 Audio: ${r.audio}`, quoted);
                }
                else if (cmd === 'ig' || cmd === 'instagram') {
                    if (!text) return reply(jid, `❌ Masukkan link Instagram!`, quoted);
                    await reply(jid, '⏳ Sedang memproses...', quoted);
                    const r = await igDl(text);
                    const cap = `📸 *@${r.metadata.username}*\n${r.metadata.caption ? '📝 ' + r.metadata.caption.substring(0, 100) + '...' : ''}`;
                    for (const url of r.url) {
                        if (r.metadata.isVideo) await reply(jid, `${cap}\n🎬 Video: ${url}`, quoted);
                        else { const buf = await getBuffer(url); await sendImg(jid, buf, cap, quoted); }
                    }
                }
                else if (cmd === 'fb' || cmd === 'facebook') {
                    if (!text) return reply(jid, `❌ Masukkan link Facebook!`, quoted);
                    await reply(jid, '⏳ Sedang memproses...', quoted);
                    const r = await fbDl(text);
                    await reply(jid, `🎬 *${r.title || 'Video Facebook'}*\n\n📥 SD: ${r.sd}\n📺 HD: ${r.hd}`, quoted);
                }
                else if (cmd === 'gdrive') {
                    if (!text) return reply(jid, `❌ Masukkan link Google Drive!`, quoted);
                    await reply(jid, '⏳ Sedang memproses...', quoted);
                    const r = await gdriveDl(text);
                    if (r.error) return reply(jid, '❌ Link tidak valid atau limit!', quoted);
                    await reply(jid, `📁 *${r.fileName}*\n📦 Ukuran: ${r.fileSize || 'N/A'}\n\n📥 Download: ${r.downloadUrl}`, quoted);
                }
                else if (cmd === 'savepin') {
                    if (!text) return reply(jid, `❌ Masukkan link Pinterest!`, quoted);
                    const r = await savePinDl(text);
                    let res = `📌 *${r.title}*\n\n`;
                    r.results.forEach((item, i) => res += `${i+1}. ${item.type}: ${item.downloadLink}\n`);
                    await reply(jid, res, quoted);
                }
                else if (cmd === 'soundcloud' || cmd === 'sc') {
                    if (!text) return reply(jid, `❌ Masukkan kata kunci!`, quoted);
                    const r = await soundcloudSearch(text);
                    if (!r.length) return reply(jid, '❌ Tidak ditemukan!', quoted);
                    let res = '🎵 *Hasil SoundCloud:*\n\n';
                    r.forEach((item, i) => res += `${i+1}. ${item.title}\n🔗 ${item.url}\n\n`);
                    await reply(jid, res, quoted);
                }

                // ═══════════════════════════════════════
                //  GAME: TEBAK LAGU
                // ═══════════════════════════════════════
                else if (cmd === 'tebak' || cmd === 'tebaklagu') {
                    if (gameState.tebakLagu[jid]) return reply(jid, '❌ Masih ada game berjalan! Ketik jawaban atau .stl untuk berhenti.', quoted);
                    const soal = getRandom(tebaklaguData);
                    if (!soal) return reply(jid, '❌ Data tebak lagu kosong!', quoted);
                    gameState.tebakLagu[jid] = {
                        jawaban: soal.jawaban.toLowerCase(),
                        artist: soal.artist,
                        link: soal.link_song,
                        timeout: setTimeout(() => {
                            delete gameState.tebakLagu[jid];
                            sock.sendMessage(jid, { text: `⏰ Waktu habis! Jawabannya: *${soal.jawaban}* - ${soal.artist}` });
                        }, 60000)
                    };
                    await reply(jid, `🎵 *TEBAK LAGU!*\n\nDengarkan preview lagunya dan tebak judulnya!\n🎧 ${soal.link_song}\n\n💡 Ketik jawaban kamu! (60 detik)`, quoted);
                }
                else if (cmd === 'stl') {
                    if (!gameState.tebakLagu[jid]) return reply(jid, '❌ Tidak ada game berjalan!', quoted);
                    clearTimeout(gameState.tebakLagu[jid].timeout);
                    const ans = gameState.tebakLagu[jid].jawaban;
                    delete gameState.tebakLagu[jid];
                    await reply(jid, `🛑 Game dihentikan!\n🎵 Jawabannya: *${ans}*`, quoted);
                }

                // ═══════════════════════════════════════
                //  GAME: FAMILY 100
                // ═══════════════════════════════════════
                else if (cmd === 'f100' || cmd === 'family100') {
                    if (gameState.family100[jid]) return reply(jid, '❌ Masih ada game berjalan! Jawab atau ketik .stf untuk berhenti.', quoted);
                    const soal = getRandom(family100Data);
                    if (!soal) return reply(jid, '❌ Data family 100 kosong!', quoted);
                    const jawaban = soal.jawaban.map(j => j.toLowerCase().trim());
                    const sisa = [...jawaban];
                    gameState.family100[jid] = {
                        soal: soal.soal, jawaban, sisa, score: 0,
                        timeout: setTimeout(() => {
                            const g = gameState.family100[jid];
                            if (!g) return;
                            sock.sendMessage(jid, { text: `⏰ Waktu habis!\nSisa jawaban: ${g.sisa.join(', ')}` });
                            delete gameState.family100[jid];
                        }, 120000)
                    };
                    await reply(jid, `🎮 *FAMILY 100!*\n\n❓ ${soal.soal}\n\n💡 Ada *${jawaban.length}* jawaban. Ketik jawabanmu! (120 detik)`, quoted);
                }
                else if (cmd === 'stf') {
                    if (!gameState.family100[jid]) return reply(jid, '❌ Tidak ada game berjalan!', quoted);
                    clearTimeout(gameState.family100[jid].timeout);
                    const g = gameState.family100[jid];
                    delete gameState.family100[jid];
                    await reply(jid, `🛑 Game dihentikan!\nSisa jawaban: ${g.sisa.join(', ')}`, quoted);
                }

                // ═══════════════════════════════════════
                //  GAME: TIC TAC TOE
                // ═══════════════════════════════════════
                else if (cmd === 'ttt' || cmd === 'tictactoe') {
                    const opponent = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                    if (!opponent) return reply(jid, `❌ Tag lawan kamu!\nContoh: ${prefix}ttt @user`, quoted);
                    if (gameState.tictactoe[jid]) return reply(jid, '❌ Sudah ada game berjalan!', quoted);
                    const game = new TicTacToe(sender, opponent);
                    gameState.tictactoe[jid] = game;
                    await reply(jid, `🎮 *TIC TAC TOE*\n\n❌ Pemain X: @${sender.split('@')[0]}\n⭕ Pemain O: @${opponent.split('@')[0]}\n\n${renderTTTBoard(game.render())}\n\nGiliran: @${sender.split('@')[0]} (X)\nKetik nomor 1-9 untuk bermain!`, quoted);
                }

                // ═══════════════════════════════════════
                //  PENCARIAN
                // ═══════════════════════════════════════
                else if (cmd === 'pinterest' || cmd === 'pin') {
                    if (!text) return reply(jid, `❌ Masukkan kata kunci!`, quoted);
                    const r = await pinterestSearch(text);
                    if (!r.length) return reply(jid, '❌ Tidak ditemukan!', quoted);
                    const item = r[0];
                    const buf = await getBuffer(item.image);
                    await sendImg(jid, buf, `📌 *${item.caption}*\n👤 ${item.fullname} (@${item.upload_by})\n👥 ${item.followers} followers\n🔗 ${item.source}`, quoted);
                }
                else if (cmd === 'wallpaper' || cmd === 'wp') {
                    if (!text) return reply(jid, `❌ Masukkan kata kunci!`, quoted);
                    const r = await wallpaperSearch(text);
                    if (!r.length) return reply(jid, '❌ Tidak ditemukan!', quoted);
                    const item = getRandom(r.slice(0, 10));
                    const buf = await getBuffer(item.image);
                    await sendImg(jid, buf, `🖼️ *${item.title}*\n🔗 ${item.source}`, quoted);
                }
                else if (cmd === 'playstore') {
                    if (!text) return reply(jid, `❌ Masukkan nama aplikasi!`, quoted);
                    const r = await playstoreSearch(text);
                    if (!r.length) return reply(jid, '❌ Tidak ditemukan!', quoted);
                    let res = `🎮 *Hasil Play Store: "${text}"*\n\n`;
                    r.slice(0, 5).forEach((item, i) => res += `${i+1}. *${item.nama}*\n👨‍💻 ${item.developer}\n⭐ ${item.rate}\n🔗 ${item.link}\n\n`);
                    await reply(jid, res, quoted);
                }
                else if (cmd === 'bukalapak' || cmd === 'bkl') {
                    if (!text) return reply(jid, `❌ Masukkan nama produk!`, quoted);
                    const r = await bukalapakSearch(text);
                    if (!r.length) return reply(jid, '❌ Tidak ditemukan!', quoted);
                    let res = `🛒 *Hasil Bukalapak: "${text}"*\n\n`;
                    r.slice(0, 5).forEach((item, i) => res += `${i+1}. *${item.title}*\n💰 ${item.harga}\n⭐ ${item.rating || 'N/A'}\n🔗 ${item.link}\n\n`);
                    await reply(jid, res, quoted);
                }
                else if (cmd === 'komiku') {
                    if (!text) return reply(jid, `❌ Masukkan judul manga!`, quoted);
                    const r = await komikuSearch(text);
                    if (!r.length) return reply(jid, '❌ Tidak ditemukan!', quoted);
                    let res = `📚 *Hasil Komiku: "${text}"*\n\n`;
                    r.slice(0, 5).forEach((item, i) => res += `${i+1}. *${item.title}*\n🏷️ ${item.genre}\n📝 ${item.description.substring(0, 80)}...\n🔗 ${item.url}\n\n`);
                    await reply(jid, res, quoted);
                }
                else if (cmd === 'kusonime') {
                    if (!text) return reply(jid, `❌ Masukkan judul anime!`, quoted);
                    const r = await kusonimeSearch(text);
                    if (!r.length) return reply(jid, '❌ Tidak ditemukan!', quoted);
                    let res = `🎌 *Hasil Kusonime: "${text}"*\n\n`;
                    r.slice(0, 5).forEach((item, i) => res += `${i+1}. *${item.title}*\n🔗 ${item.url}\n\n`);
                    await reply(jid, res, quoted);
                }
                else if (cmd === 'lyrics') {
                    if (!text) return reply(jid, `❌ Masukkan judul lagu!`, quoted);
                    const r = await lyricsSearch(text);
                    if (!r.length) return reply(jid, '❌ Tidak ditemukan!', quoted);
                    let res = `🎵 *Hasil Lyrics: "${text}"*\n\n`;
                    r.slice(0, 5).forEach((item, i) => res += `${i+1}. *${item.title}* - ${item.artist}\n🔗 ${item.link}\n\n`);
                    res += `\n💡 Ketik ${prefix}getlyrics <link> untuk lihat liriknya`;
                    await reply(jid, res, quoted);
                }
                else if (cmd === 'getlyrics') {
                    if (!text) return reply(jid, `❌ Masukkan link lyrics!`, quoted);
                    const r = await lyricsGet(text);
                    await reply(jid, `🎵 *Lirik Lagu*\n\n${r.lyrics.substring(0, 3000)}${r.lyrics.length > 3000 ? '...' : ''}`, quoted);
                }

                // ═══════════════════════════════════════
                //  INFO
                // ═══════════════════════════════════════
                else if (cmd === 'gempa') {
                    const r = await getGempa();
                    await reply(jid, `🌏 *INFO GEMPA TERBARU (BMKG)*\n\n📍 Wilayah: ${r.wilayah}\n💥 Magnitudo: ${r.magnitude}\n📏 Kedalaman: ${r.kedalaman}\n🕐 Waktu: ${r.waktu}\n📌 Koordinat: ${r.lintang_bujur || '-'}\n\nDirasakan di:\n${r.dirasakan}`, quoted);
                }
                else if (cmd === 'jktnews') {
                    const r = await getJktNews();
                    let res = `📰 *Berita JKT48 Terbaru*\n\n`;
                    r.slice(0, 5).forEach((item, i) => res += `${i+1}. *${item.title}*\n📅 ${item.date}\n🔗 ${item.link}\n\n`);
                    await reply(jid, res, quoted);
                }
                else if (cmd === 'halodoc') {
                    if (!text) return reply(jid, `❌ Masukkan kata kunci penyakit/artikel!`, quoted);
                    const r = await halodoc(text);
                    if (!r.length) return reply(jid, '❌ Tidak ditemukan!', quoted);
                    let res = `🏥 *Halodoc: "${text}"*\n\n`;
                    r.slice(0, 5).forEach((item, i) => res += `${i+1}. *${item.title}*\n📝 ${item.description.substring(0, 80)}...\n🔗 ${item.link}\n\n`);
                    await reply(jid, res, quoted);
                }
                else if (cmd === 'ffnews') {
                    const r = await ffNews();
                    let res = `🔫 *Berita Free Fire Terbaru*\n\n`;
                    r.slice(0, 5).forEach((item, i) => res += `${i+1}. *${item.title}*\n📅 ${item.time}\n🔗 ${item.link}\n\n`);
                    await reply(jid, res, quoted);
                }
                else if (cmd === 'ffch') {
                    const r = await ffCh();
                    let res = `🔫 *Karakter Free Fire*\n\n`;
                    r.slice(0, 10).forEach((item, i) => res += `${i+1}. *${item.name}*\n📝 ${item.desc.substring(0, 60)}...\n\n`);
                    await reply(jid, res, quoted);
                }
                else if (cmd === 'mlstalk') {
                    if (args.length < 2) return reply(jid, `❌ Format: ${prefix}mlstalk <id> <zone>`, quoted);
                    const r = await mlstalk(args[0], args[1]);
                    await reply(jid, `🎮 *Mobile Legends Stalk*\n\n👤 Nama: ${r.username || r.name}\n🆔 ID: ${args[0]}\n🌏 Zone: ${args[1]}`, quoted);
                }
                else if (cmd === 'github') {
                    if (!text) return reply(jid, `❌ Masukkan username GitHub!`, quoted);
                    const r = await githubstalk(text);
                    await reply(jid, `🐙 *GitHub: @${r.username}*\n\n👤 ${r.nickname || '-'}\n📝 ${r.bio || '-'}\n📦 Repos: ${r.public_repo}\n👥 Followers: ${r.followers} | Following: ${r.following}\n🔗 ${r.url}`, quoted);
                }

                // ═══════════════════════════════════════
                //  AI / TOOLS
                // ═══════════════════════════════════════
                else if (cmd === 'remini') {
                    const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                    const imgBuf = quotedMsg?.imageMessage ? await sock.downloadMediaMessage({ message: quotedMsg }) : null;
                    if (!imgBuf) return reply(jid, `❌ Reply foto untuk di-enhance!`, quoted);
                    await reply(jid, '⏳ Sedang memproses foto...', quoted);
                    const result = await reminiEnhance(imgBuf, args[0] || 'enhance');
                    await sendImg(jid, result, '✨ Foto berhasil di-enhance!', quoted);
                }
                else if (cmd === 'bluearchive' || cmd === 'battts') {
                    if (!text) return reply(jid, `❌ Masukkan teks!\nContoh: ${prefix}bluearchive Halo!`, quoted);
                    const model = args[0] || 'Airi';
                    const teksBA = args.slice(1).join(' ') || text;
                    await reply(jid, '⏳ Sedang generate TTS...', quoted);
                    const r = await blueArchiveTTS(teksBA, model);
                    const buf = await getBuffer(r.url);
                    await sendAudio(jid, buf, true, quoted);
                }
                else if (cmd === 'simsimi') {
                    if (!text) return reply(jid, `❌ Masukkan teks!`, quoted);
                    const r = await simsimi(text);
                    await reply(jid, `🤖 ${r}`, quoted);
                }
                else if (cmd === 'quotesanime' || cmd === 'qa') {
                    const r = await quotesAnime();
                    if (!r.length) return reply(jid, '❌ Gagal mengambil quotes!', quoted);
                    const item = getRandom(r);
                    await reply(jid, `💬 *${item.quotes}*\n\n— ${item.karakter}\n📺 ${item.anime}`, quoted);
                }
                else if (cmd === 'telegraph' || cmd === 'tele') {
                    const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                    if (!quotedMsg) return reply(jid, `❌ Reply file/foto untuk diupload ke Telegraph!`, quoted);
                    const tmpPath = `/tmp/telegraph_${Date.now()}`;
                    const buf = await sock.downloadMediaMessage({ message: quotedMsg });
                    fs.writeFileSync(tmpPath, buf);
                    const url = await TelegraPH(tmpPath);
                    fs.unlinkSync(tmpPath);
                    await reply(jid, `✅ File berhasil diupload!\n🔗 ${url}`, quoted);
                }

                // ═══════════════════════════════════════
                //  ISLAMI
                // ═══════════════════════════════════════
                else if (cmd === 'doa') {
                    const idx = parseInt(args[0]) - 1;
                    if (isNaN(idx) || !doaHarianData[idx]) {
                        let listDoa = '📿 *Doa Harian*\n\n';
                        doaHarianData.slice(0, 15).forEach((d, i) => listDoa += `${i+1}. ${d.doa || d.title || 'Doa ' + (i+1)}\n`);
                        listDoa += `\n💡 Ketik ${prefix}doa <nomor> untuk melihat doanya`;
                        return reply(jid, listDoa, quoted);
                    }
                    const d = doaHarianData[idx];
                    await reply(jid, `📿 *${d.doa || d.title}*\n\n🕌 Arab:\n${d.ayat || d.arabic || '-'}\n\n🔤 Latin:\n${d.latin || '-'}\n\n📝 Artinya:\n${d.arti || d.translation || '-'}`, quoted);
                }
                else if (cmd === 'tahlil') {
                    const data = Array.isArray(tahlilData) ? tahlilData : tahlilData?.result;
                    if (!data?.length) return reply(jid, '❌ Data tahlil tidak tersedia!', quoted);
                    let res = `🤲 *BACAAN TAHLIL*\n\n`;
                    data.slice(0, 5).forEach((item, i) => {
                        res += `📖 *${item.title || item.id}*\n${item.arabic || ''}\n\n🌏 ${(item.translation || '').substring(0, 100)}...\n\n`;
                    });
                    res += `💡 Menampilkan ${Math.min(5, data.length)} dari ${data.length} bacaan`;
                    await reply(jid, res, quoted);
                }

                // ═══════════════════════════════════════
                //  LAIN-LAIN
                // ═══════════════════════════════════════
                else if (cmd === 'anuu') {
                    if (!nsfwGroups.includes(jid) && isGrp) return reply(jid, '❌ Fitur ini hanya tersedia di grup NSFW!', quoted);
                    if (!anuuData.length) return reply(jid, '❌ Data kosong!', quoted);
                    const item = getRandom(anuuData);
                    await reply(jid, `🎬 ${item.url}`, quoted);
                }

            } catch (err) {
                console.error(chalk.red(`[ERROR] cmd: ${cmd} -> ${err.message}`));
                await reply(jid, `❌ Terjadi error: ${err.message}`, quoted);
            }

            await react(jid, '✅', msg.key);

            // ── Cek jawaban game (di luar prefix) ──
        } // end for msg

        // ── Handler jawaban game (non-prefix) ──
        for (const msg of messages) {
            if (!msg.message || msg.key.fromMe) continue;
            const jid = msg.key.remoteJid;
            const body = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
            if (!body || body.startsWith(CONFIG.PREFIX)) continue;

            // Tebak Lagu
            if (gameState.tebakLagu[jid]) {
                const game = gameState.tebakLagu[jid];
                if (body.toLowerCase().trim() === game.jawaban) {
                    clearTimeout(game.timeout);
                    delete gameState.tebakLagu[jid];
                    const sender = msg.key.participant || jid;
                    await sock.sendMessage(jid, { text: `🎉 @${sender.split('@')[0]} BENAR!\n🎵 Jawabannya: *${game.jawaban}* - ${game.artist}` }, { quoted: msg });
                }
            }

            // Family 100
            if (gameState.family100[jid]) {
                const game = gameState.family100[jid];
                const jawaban = body.toLowerCase().trim();
                const idx = game.sisa.indexOf(jawaban);
                if (idx !== -1) {
                    game.sisa.splice(idx, 1);
                    game.score++;
                    const sender = msg.key.participant || jid;
                    if (game.sisa.length === 0) {
                        clearTimeout(game.timeout);
                        delete gameState.family100[jid];
                        await sock.sendMessage(jid, { text: `🎉 Semua jawaban ditemukan! Skor: ${game.score}` }, { quoted: msg });
                    } else {
                        await sock.sendMessage(jid, { text: `✅ @${sender.split('@')[0]} benar! (+1)\nSisa: ${game.sisa.length} jawaban` }, { quoted: msg });
                    }
                }
            }

            // Tic Tac Toe
            if (gameState.tictactoe[jid]) {
                const game = gameState.tictactoe[jid];
                const sender = msg.key.participant || jid;
                const num = parseInt(body.trim()) - 1;
                if (!isNaN(num) && num >= 0 && num <= 8 && sender === game.currentTurn) {
                    const result = game.turn(sender === game.playerX ? 0 : 1, num);
                    if (result === 1) {
                        const board = renderTTTBoard(game.render());
                        const winner = game.winner;
                        if (winner) {
                            delete gameState.tictactoe[jid];
                            await sock.sendMessage(jid, { text: `${board}\n\n🏆 @${winner.split('@')[0]} MENANG!` }, { quoted: msg });
                        } else if (game.board === 511) {
                            delete gameState.tictactoe[jid];
                            await sock.sendMessage(jid, { text: `${board}\n\n🤝 SERI!` }, { quoted: msg });
                        } else {
                            await sock.sendMessage(jid, { text: `${board}\n\n🎮 Giliran: @${game.currentTurn.split('@')[0]}` }, { quoted: msg });
                        }
                    }
                }
            }
        }
    });

    return sock;
}

// ──────────────────────────────────────────────
//  START
// ──────────────────────────────────────────────
startBot().catch(err => {
    console.error('[BOT] Fatal Error:', err);
    process.exit(1);
});
