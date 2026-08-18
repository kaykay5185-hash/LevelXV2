/**
 * LevelX GitHub CSV API — Cloudflare Worker
 *
 * Secrets to configure:
 *   GITHUB_TOKEN
 *   ADMIN_PASSWORD
 *
 * Variables:
 *   GITHUB_OWNER
 *   GITHUB_REPO
 *   GITHUB_BRANCH   (default: main)
 *   GITHUB_CSV_PATH (default: levelx_database.csv)
 *   ALLOWED_ORIGIN (your GitHub Pages/custom-domain URL)
 *
 * The GitHub token NEVER goes to the browser.
 */

const CSV_HEADERS = [
  "id","name","email","rank","role","bannedUntil","banReason",
  "avatar","bio","social","createdAt","updatedAt"
];

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,PUT,POST,OPTIONS",
    "Content-Type": "application/json; charset=utf-8"
  };
}

function json(data, status, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsHeaders(env)
  });
}

function csvEscape(value) {
  const s = value == null ? "" : String(value);
  return `"${s.replaceAll('"', '""')}"`;
}

function rowsToCsv(rows) {
  const lines = [
    CSV_HEADERS.map(csvEscape).join(","),
    ...rows.map(row => CSV_HEADERS.map(h => csvEscape(row[h] ?? "")).join(","))
  ];
  return lines.join("\r\n") + "\r\n";
}

function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", quoted = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (quoted) {
      if (c === '"' && n === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else {
      if (c === '"') quoted = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n") {
        row.push(cell); cell = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      } else if (c !== "\r") cell += c;
    }
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }

  if (!rows.length) return [];
  const header = rows[0].map(x => x.trim());
  return rows.slice(1).filter(r => r.some(x => x !== "")).map(r => {
    const obj = {};
    header.forEach((h, i) => obj[h] = r[i] ?? "");
    return obj;
  });
}

function repoConfig(env) {
  return {
    owner: env.GITHUB_OWNER,
    repo: env.GITHUB_REPO,
    branch: env.GITHUB_BRANCH || "main",
    path: env.GITHUB_CSV_PATH || "levelx_database.csv"
  };
}

async function githubGet(env) {
  const c = repoConfig(env);
  const url = `https://api.github.com/repos/${c.owner}/${c.repo}/contents/${encodeURIComponent(c.path)}?ref=${encodeURIComponent(c.branch)}`;
  const r = await fetch(url, {
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2026-03-10",
      "User-Agent": "LevelX-Serverless-API"
    }
  });
  if (!r.ok) throw new Error(`GitHub read failed: ${r.status}`);
  const data = await r.json();
  const decoded = atob((data.content || "").replace(/\n/g, ""));
  return { rows: parseCsv(decoded), sha: data.sha, config: c };
}

async function githubPut(env, rows, sha, message) {
  const c = repoConfig(env);
  const content = btoa(unescape(encodeURIComponent(rowsToCsv(rows))));
  const url = `https://api.github.com/repos/${c.owner}/${c.repo}/contents/${encodeURIComponent(c.path)}`;

  const r = await fetch(url, {
    method: "PUT",
    headers: {
      "Accept": "application/vnd.github+json",
      "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
      "X-GitHub-Api-Version": "2026-03-10",
      "User-Agent": "LevelX-Serverless-API",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      message,
      content,
      sha,
      branch: c.branch
    })
  });

  if (!r.ok) {
    const detail = await r.text();
    throw new Error(`GitHub write failed: ${r.status} ${detail}`);
  }
  return await r.json();
}

function checkAdmin(request, env, body) {
  const supplied = body?.adminPassword || request.headers.get("X-LevelX-Admin");
  if (!supplied || supplied !== env.ADMIN_PASSWORD) return false;
  return true;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(env) });
    }

    const url = new URL(request.url);

    try {
      if (request.method === "GET" && url.pathname === "/api/members") {
        const { rows } = await githubGet(env);

        // Public endpoint: do not expose private fields.
        const members = rows.map(m => ({
          id: m.id,
          name: m.name,
          rank: m.rank,
          role: m.role,
          bannedUntil: Number(m.bannedUntil || 0),
          banReason: m.banReason || "",
          avatar: m.avatar || "",
          bio: m.bio || "",
          social: m.social || ""
        }));

        return json({ members }, 200, env);
      }

      if (request.method === "PUT" && url.pathname === "/api/admin/member") {
        const body = await request.json();
        if (!checkAdmin(request, env, body)) return json({ error: "Admin authentication failed." }, 401, env);

        const member = body.member;
        if (!member?.id) return json({ error: "Member ID is required." }, 400, env);

        const { rows, sha } = await githubGet(env);
        const index = rows.findIndex(x => x.id === member.id);
        if (index < 0) return json({ error: "Member not found." }, 404, env);

        if (rows[index].role === "owner") {
          return json({ error: "Owner cannot be edited from this endpoint." }, 403, env);
        }

        rows[index] = {
          ...rows[index],
          ...member,
          id: rows[index].id,
          updatedAt: new Date().toISOString()
        };

        await githubPut(env, rows, sha, `LevelX: update member ${rows[index].name || rows[index].id}`);
        return json({ ok: true }, 200, env);
      }

      if (request.method === "POST" && url.pathname === "/api/admin/ban") {
        const body = await request.json();
        if (!checkAdmin(request, env, body)) return json({ error: "Admin authentication failed." }, 401, env);

        const { memberId, duration = 0, reason = "" } = body;
        if (!memberId) return json({ error: "Member ID is required." }, 400, env);

        const { rows, sha } = await githubGet(env);
        const index = rows.findIndex(x => x.id === memberId);
        if (index < 0) return json({ error: "Member not found." }, 404, env);
        if (rows[index].role === "owner") return json({ error: "Owner cannot be banned." }, 403, env);

        rows[index].bannedUntil =
          Number(duration) === -1 ? -1 :
          Number(duration) > 0 ? Date.now() + Number(duration) : 0;
        rows[index].banReason = reason;
        rows[index].updatedAt = new Date().toISOString();

        await githubPut(env, rows, sha, `LevelX: ${rows[index].bannedUntil ? "ban" : "unban"} ${rows[index].name || rows[index].id}`);
        return json({ ok: true }, 200, env);
      }

      return json({ error: "Not found." }, 404, env);
    } catch (error) {
      return json({ error: error.message || "Server error." }, 500, env);
    }
  }
};
