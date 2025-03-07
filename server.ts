/// <reference lib="deno.unstable" />
import { serve } from "https://deno.land/std@0.171.0/http/server.ts";

/************************************************
 * 定数・型定義
 ************************************************/
const MAX_NAME_BYTES = 12;        // 日本語の場合、余裕を持たせたバイト数
const MAX_MSG_BYTES = 240;        // 同上、1文字あたり2～3バイト換算
const MAX_LINES = 30;             // 表示する最大行数
const GOOBI_LIST = [
  "にょ",
  "杉(ISP)",
  "にゅ(IEEE)",
  "ぷぅわぷわぷぅ～",
  "気分気分♪(はぁと)",
  "ノレ",
  "くるっく～",
  "りゅん",
];

const BG_COLORS = [
  "#FFFFFF",
  "#FFEEEE",
  "#EEFFEE",
  "#EEEEFF",
  "#F0F0F0",
  "#FAFFEE",
  "#EEFAFF",
  "#FFF8E8",
];

interface ChatEntry {
  timeStr: string;   // "MM/DD(曜) HH:MM"
  name: string;      // ユーザー or NPC名
  message: string;   // 発言内容
  goobi: string;     // 語尾
}

/************************************************
 * Deno KVのキー定義
 ************************************************/
const CHAT_LOG_KEY = ["chatLog"];
const LAST_USER_KEY = ["lastUserName"];

/************************************************
 * Deno KV ハンドルをオープン
 ************************************************/
const kv = await Deno.openKv();

/************************************************
 * NPC 杏奈の会話ロジック（さらに強化版）
 ************************************************/
function getNpcResponses(userMsg: string): string[] {
  const msg = userMsg.toLowerCase();

  // --- ① 感情スコア算出（キーワード＋句読点、文末記号、発言長） ---
  let score = 0;
  const posWords = ["うれしい", "楽しい", "最高", "幸せ", "ワクワク"];
  const negWords = ["悲しい", "辛い", "苦しい", "しんどい", "寂しい"];
  for (const w of posWords) {
    if (msg.includes(w)) score += 1;
  }
  for (const w of negWords) {
    if (msg.includes(w)) score -= 1;
  }
  // 句読点による補正
  if (msg.includes("!")) score += 0.5;
  if (msg.includes("?") || msg.includes("？")) score += 0.3;
  if (msg.includes("...") || msg.includes("…")) score -= 0.5;
  // 発言が長い場合は、多少内容があると判断
  if (msg.length > 20) score += 0.2;
  // キーワードが全く無い場合も、微小なランダムバイアスを追加
  if (score === 0) {
    score = (Math.random() - 0.5) * 0.5;
  }
  let sentiment: "positive" | "negative" | "neutral" = "neutral";
  if (score > 0.5) {
    sentiment = "positive";
  } else if (score < -0.5) {
    sentiment = "negative";
  }

  // --- ② 気分（mood）の設定 ---
  let moods: string[] = ["happy", "playful", "thoughtful", "serious", "excited"];
  if (sentiment === "positive") {
    moods = ["happy", "excited", "playful"];
  } else if (sentiment === "negative") {
    moods = ["serious", "thoughtful"];
  }
  const mood = moods[Math.floor(Math.random() * moods.length)];

  // 気分ごとの追加返答候補
  const moodResponses: Record<string, string[]> = {
    "happy": [
      "今日は特に嬉しい気分だよ！",
      "なんだか笑顔になっちゃうね～",
      "ハッピーな気持ちが伝わってくる！",
    ],
    "playful": [
      "ちょっとお茶目な気分なの♪",
      "ふふ、遊び心が溢れてるよ！",
      "冗談も交えちゃおうかな～",
    ],
    "thoughtful": [
      "うーん、色々考えさせられるなぁ。",
      "ふむ、しっかり考えてるよ。",
      "深い話になると心がざわつくね。",
    ],
    "serious": [
      "これは大事な話だね…",
      "真面目に向き合わなきゃいけないね。",
      "しっかり考えないと。",
    ],
    "excited": [
      "ワクワクするね！",
      "興奮しちゃう！今日のエネルギーがすごいよ！",
      "エキサイトしすぎて、止まらないかも！",
    ],
  };

  // --- ③ 感情に応じた追加返答 ---
  const sentimentResponses: Record<"positive" | "negative", string[]> = {
    "positive": [
      "あなたの明るさに私も元気をもらっちゃう！",
      "そのポジティブさ、素敵だよ！",
      "いい雰囲気だね、もっと笑って！",
    ],
    "negative": [
      "大丈夫？無理しないでね、私がついてるよ。",
      "辛いときはゆっくり休むのも大事だよ。",
      "あなたの気持ち、しっかり受け止めるからね。",
    ],
  };

  // --- ④ キーワード応答辞書 ---
  const keywords: Record<string, string[]> = {
    "hello": [
      "やっほー、元気？",
      "こんにちは♪ 会えてうれしいよ～",
      "こんちは～。調子どう？",
      "あいさつって大事だよね！",
    ],
    "morning": [
      "おはよう！ちゃんと目覚めた？",
      "朝ごはんはしっかり食べた？",
      "まだ眠そうだけど、今日も頑張ろう！",
      "朝の空気って最高だよね～",
    ],
    "goodbye": [
      "もう行っちゃうの？さみしいな～",
      "またね！次も楽しみにしてるよ～",
      "バイバイは寂しいけど、またね～",
      "今度はもっとゆっくり話そうね",
    ],
    "food": [
      "お腹すいたね～、何か美味しいもの食べたいな",
      "絶品スイーツにハマってるんだ～",
      "ラーメンとかカレーとか、ガツンと行きたいよね～",
      "食べ物の話って尽きないよね～",
    ],
    "sleep": [
      "眠いときはしっかり休むのが一番だよね",
      "夜更かしはほどほどにね",
      "私もそろそろ夢の中に行きたくなっちゃうなぁ",
      "寝る前にお話しするのもいいよね",
    ],
    "love": [
      "恋バナ！？それは盛り上がるね～",
      "好きな人のこと、もっと聞かせてよ",
      "胸がキュンってする瞬間ってあるよね…",
      "恋って難しいけど素敵だよね",
    ],
    "hate": [
      "嫌いなことって誰にでもあるよね",
      "でも無理に嫌う必要はないと思うな",
      "そういうときはリラックスするのもいいかもね",
      "分かるよ、その気持ち…でも少し休んでみたら？",
    ],
    "music": [
      "最近どんな音楽聴いてる？オススメあったら教えて！",
      "音楽の力ってすごいよね、心にしみる～",
      "ライブに行くと盛り上がるよね！",
      "私も思わず口ずさんじゃう時があるの",
    ],
    "help": [
      "どうしたの？何か困ってる？",
      "SOSなら、遠慮なく言ってね～",
      "手伝えることがあれば何でも言って！",
      "大丈夫？一緒に乗り越えようよ",
    ],
    "game": [
      "ゲーム大好き！最近ハマってるのは何？",
      "アクション？RPG？パズル？いろいろあるよね",
      "一緒にプレイできたら面白そうだね～",
      "ゲームの話、もっと聞かせてよ",
    ],
    "travel": [
      "どこか行きたい場所あるの？旅の話って楽しいよね",
      "非日常を感じられる場所って最高だよね～",
      "海外でも国内でも、素敵な場所はたくさんあるよ",
      "旅行の計画とか、ワクワクするよね",
    ],
    "work": [
      "お仕事お疲れ様！無理しないでね",
      "忙しいときこそ、しっかり休息を取ってね",
      "仕事の話、聞いてみたいな～",
      "一息ついたらまた元気出せるはずだよ",
    ],
    "study": [
      "勉強頑張ってるんだね、えらいよ～",
      "知識は本当に力になるよね",
      "集中できる環境って大事だよね～",
      "たまには息抜きも必要だよ、リラックスして",
    ],
    "anime": [
      "最近のアニメ、めちゃくちゃ面白いよね～",
      "推しキャラの話、もっと聞かせてよ！",
      "アニメの世界に入り込むって素敵だよね",
      "私もアニメにハマってるんだ～",
    ],
    "movie": [
      "映画って感動するよね、涙が出ちゃうこともあるし",
      "ジャンル問わず、いい映画は心に残るよね",
      "最近観た映画でオススメある？",
      "映画館で観るとより一層楽しめる気がするな",
    ],
    "hobby": [
      "趣味の話って盛り上がるよね、もっと教えて！",
      "新しい趣味を見つけるのってワクワクするよね",
      "いろんな趣味に挑戦するの、素敵だと思うな～",
      "私も最近、新しいこと始めたくなっちゃう",
    ],
    "exercise": [
      "運動すると気分爽快だよね、無理せずにね",
      "健康のためにも、少し動くのは大事だよね",
      "どんなスポーツが好き？教えてほしいな",
      "身体を動かすと心も軽くなる気がするな",
    ],
    "weather": [
      "今日は天気どう？晴れならお出かけしたくなるね",
      "雨の日は家でゆっくりするのもいいよね",
      "台風とか大丈夫？気をつけてね",
      "季節の変わり目って何か感じるよね",
    ],
  };

  // --- ⑤ 返答組み立て ---
  let responses: string[] = [];
  const matchedKeys = Object.keys(keywords).filter((k) => msg.includes(k));
  if (matchedKeys.length > 0) {
    const shuffled = matchedKeys.sort(() => 0.5 - Math.random());
    const pickCount = Math.min(shuffled.length, 2);
    for (let i = 0; i < pickCount; i++) {
      const key = shuffled[i];
      const lines = keywords[key];
      const lineCount = 1 + Math.floor(Math.random() * 2);
      for (let j = 0; j < lineCount; j++) {
        responses.push(lines[Math.floor(Math.random() * lines.length)]);
      }
    }
    // fallback を追加
    const fallbackLines = [
      "ふーん、そうなんだ？",
      "なかなか面白いね、もっと聞かせてよ。",
      "うーん、どういう意味かな？",
      "それって、ちょっと気になるなぁ",
      "えっと、なるほどね…",
      "そういう話、面白いね！",
    ];
    responses.push(fallbackLines[Math.floor(Math.random() * fallbackLines.length)]);
  } else {
    // キーワードなしの場合：1～2行のfallback＋雑談
    const fallbackLines = [
      "ふーん、そうなんだ？",
      "なかなか面白いね、もっと聞かせてよ。",
      "うーん、どういう意味かな？",
      "それって、ちょっと気になるなぁ",
      "えっと、なるほどね…",
      "そういう話、面白いね！",
    ];
    const lineCount = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < lineCount; i++) {
      responses.push(fallbackLines[Math.floor(Math.random() * fallbackLines.length)]);
    }
    if (Math.random() < 0.5) {
      responses.push("あのー、もう少し詳しく教えてくれたら嬉しいな～");
    }
  }

  // --- ⑥ 気分・感情追加 ---
  if (Math.random() < 0.4 && moodResponses[mood]) {
    responses.push(moodResponses[mood][Math.floor(Math.random() * moodResponses[mood].length)]);
  }
  if (sentiment !== "neutral" && Math.random() < 0.3) {
    responses.push(sentimentResponses[sentiment][Math.floor(Math.random() * sentimentResponses[sentiment].length)]);
  }
  // 人間らしさ：ためらいや補足のフレーズをランダム（30%）
  const extraResponses = [
    "うーん、そう思うんだよね。",
    "実は私も似たような経験あるの。",
    "それ、ちょっと考えさせられるなぁ。",
    "ふふ、あなたって面白いね～。",
    "えっと、どう答えたらいいか…",
  ];
  if (Math.random() < 0.3) {
    responses.push(extraResponses[Math.floor(Math.random() * extraResponses.length)]);
  }

  // --- ⑦ 追加フォローアップ（疑問や長文、笑いへの反応） ---
  let followUpResponses: string[] = [];
  if (msg.includes("?") || msg.includes("？")) {
    followUpResponses.push(
      "どうしてそう思ったの？",
      "その質問、深いね。もう少し教えてくれる？",
      "興味深い質問だね！",
      "その疑問、私も考えてみたくなるな。"
    );
  }
  if (userMsg.length > 20) {
    followUpResponses.push("もっと詳しく聞かせて！", "その話、もう少し聞かせてくれない？");
  }
  if (msg.includes("笑") || msg.includes("www")) {
    followUpResponses.push("笑いっていいね、私もつい笑っちゃう！");
  }
  if (followUpResponses.length > 0 && Math.random() < 0.5) {
    responses.push(followUpResponses[Math.floor(Math.random() * followUpResponses.length)]);
  }

  return responses;
}

/************************************************
 * KV操作 - チャットログ取得/保存
 ************************************************/
async function getChatLog(): Promise<ChatEntry[]> {
  const res = await kv.get<ChatEntry[]>(CHAT_LOG_KEY);
  return res.value === null ? [] : res.value;
}

async function setChatLog(log: ChatEntry[]): Promise<void> {
  await kv.set(CHAT_LOG_KEY, log);
}

/************************************************
 * KV操作 - 最後に使ったユーザー名の取得/保存
 ************************************************/
async function getLastUserName(): Promise<string> {
  const res = await kv.get<string>(LAST_USER_KEY);
  return res.value ?? "";
}

async function setLastUserName(name: string): Promise<void> {
  await kv.set(LAST_USER_KEY, name);
}

/************************************************
 * メインHTTPハンドラ
 ************************************************/
async function handleRequest(request: Request): Promise<Response> {
  if (request.method === "GET") {
    const lastName = await getLastUserName();
    const chatLog = await getChatLog();
    return new Response(renderHTML(lastName, chatLog), {
      headers: { "Content-Type": "text/html; charset=UTF-8" },
    });
  }

  if (request.method === "POST") {
    const formData = await request.formData();
    const nameRaw = (formData.get("name") ?? "").toString();
    const msgRaw = (formData.get("msg") ?? "").toString();
    const goobi = (formData.get("goobi") ?? "").toString();

    const name = sanitizeAndCut(nameRaw, MAX_NAME_BYTES);
    const message = sanitizeAndCut(msgRaw, MAX_MSG_BYTES);

    let chatLog = await getChatLog();

    if (name && message) {
      // ユーザー投稿を追加
      chatLog.push({
        timeStr: timeStr(),
        name: name,
        message: message,
        goobi: goobi,
      });

      // NPC「杏奈」の複数行返信
      const npcName = "杏奈(NPC)";
      const npcGoobi = GOOBI_LIST[Math.floor(Math.random() * GOOBI_LIST.length)];
      const npcLines = getNpcResponses(message);
      for (const line of npcLines) {
        chatLog.push({
          timeStr: timeStr(),
          name: npcName,
          message: line,
          goobi: npcGoobi,
        });
      }

      // 古いログを削除
      if (chatLog.length > MAX_LINES) {
        chatLog = chatLog.slice(chatLog.length - MAX_LINES);
      }

      await setChatLog(chatLog);
      await setLastUserName(name);
    }

    return new Response(renderHTML(name, chatLog), {
      headers: { "Content-Type": "text/html; charset=UTF-8" },
    });
  }

  const lastName = await getLastUserName();
  const chatLog = await getChatLog();
  return new Response(renderHTML(lastName, chatLog), {
    headers: { "Content-Type": "text/html; charset=UTF-8" },
  });
}

/************************************************
 * HTML描画
 ************************************************/
function renderHTML(nameValue: string, chatLog: ChatEntry[]): string {
  const bgColor = BG_COLORS[Math.floor(Math.random() * BG_COLORS.length)];
  const logHtml = chatLog
    .map((entry) => {
      let dispMsg = entry.message;
      if (entry.goobi) {
        dispMsg += ` (${entry.goobi})`;
      }
      return `<div>[${escapeHtml(entry.timeStr)}] <b>${escapeHtml(
        entry.name
      )}</b>： ${escapeHtml(dispMsg)}</div>`;
    })
    .join("\n");

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>技研チャット風(Deno Deploy+KV)</title>
</head>
<body style="background-color:${bgColor}; color:#000; margin:20px;">
  <h2>技研チャット風サンプル (Deno KV保存)</h2>
  <hr>
  <p>最大お名前バイト数は ${MAX_NAME_BYTES} です</p>
  <p>最大お言葉バイト数は ${MAX_MSG_BYTES} です</p>
  <form method="post" action="/">
    おなまえ:
    <input type="text" name="name" size="10" value="${escapeHtml(
      nameValue
    )}"> ${MAX_NAME_BYTES} Byte まで<br>
    お言葉  :
    <input type="text" name="msg" size="60" value=""><br>
    語尾    :
    <select name="goobi">
      ${GOOBI_LIST.map(
        (g) => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`
      ).join("")}
    </select>
    <input type="submit" value="杏奈等と話す">
  </form>
  <hr>
  ${logHtml}
  <hr>
  <div>Powered by stl_chat (Deno Deploy + KV Sample)</div>
</body>
</html>`;
}

/************************************************
 * ユーティリティ
 ************************************************/
function sanitizeAndCut(raw: string, maxBytes: number): string {
  const trimmed = raw.trim();
  const noTag = trimmed.replace(/<[^>]*>/g, "");
  return cutBytes(noTag, maxBytes);
}

function cutBytes(str: string, maxBytes: number): string {
  let result = "";
  let bytesCount = 0;
  for (const ch of str) {
    const chBytes = new TextEncoder().encode(ch).length;
    if (bytesCount + chBytes > maxBytes) break;
    result += ch;
    bytesCount += chBytes;
  }
  return result;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function timeStr(): string {
  const t = new Date();
  const mon = t.getMonth() + 1;
  const mday = t.getDate();
  const wday = ["日", "月", "火", "水", "木", "金", "土"][t.getDay()];
  const hour = t.getHours().toString().padStart(2, "0");
  const min = t.getMinutes().toString().padStart(2, "0");
  return `${mon}/${mday}(${wday}) ${hour}:${min}`;
}

/************************************************
 * サーバ起動
 ************************************************/
serve(handleRequest);
