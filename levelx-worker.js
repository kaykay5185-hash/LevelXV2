/**
 * ============================================================
 * LEVELX GITHUB CSV API
 * Cloudflare Worker
 * ============================================================
 *
 * GitHub repository:
 *   levelx_database.csv
 *
 * Cloudflare Worker secrets:
 *
 *   GITHUB_TOKEN
 *   ADMIN_PASSWORD
 *
 * Cloudflare Worker variables:
 *
 *   GITHUB_OWNER
 *   GITHUB_REPO
 *   GITHUB_BRANCH
 *   GITHUB_CSV_PATH
 *   ALLOWED_ORIGIN
 *
 * Example:
 *
 *   GITHUB_OWNER = your-github-name
 *   GITHUB_REPO = LevelX
 *   GITHUB_BRANCH = main
 *   GITHUB_CSV_PATH = levelx_database.csv
 *   ALLOWED_ORIGIN = https://your-github-name.github.io
 *
 * Admin password:
 *
 *   karim2014
 *
 * Put that password into the Cloudflare secret:
 *
 *   ADMIN_PASSWORD
 *
 * DO NOT put your GitHub token in this file.
 * ============================================================
 */

const CSV_HEADERS = [
  "id",
  "name",
  "email",
  "rank",
  "role",
  "bannedUntil",
  "banReason",
  "avatar",
  "bio",
  "social",
  "createdAt",
  "updatedAt"
];

/* ============================================================
   CORS
============================================================ */

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin":
      env.ALLOWED_ORIGIN || "*",

    "Access-Control-Allow-Headers":
      "Content-Type, X-LevelX-Admin",

    "Access-Control-Allow-Methods":
      "GET, PUT, POST, OPTIONS",

    "Content-Type":
      "application/json; charset=utf-8"
  };
}

/* ============================================================
   JSON RESPONSE
============================================================ */

function json(data, status, env) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: corsHeaders(env)
    }
  );
}

/* ============================================================
   CSV ESCAPE
============================================================ */

function csvEscape(value) {

  const text =
    value === null ||
    value === undefined
      ? ""
      : String(value);

  return `"${text.replaceAll('"', '""')}"`;
}

/* ============================================================
   OBJECTS → CSV
============================================================ */

function rowsToCsv(rows) {

  const lines = [];

  lines.push(
    CSV_HEADERS
      .map(csvEscape)
      .join(",")
  );

  for (const row of rows) {

    lines.push(
      CSV_HEADERS
        .map(header =>
          csvEscape(row[header] ?? "")
        )
        .join(",")
    );
  }

  return lines.join("\r\n") + "\r\n";
}

/* ============================================================
   CSV → OBJECTS
============================================================ */

function parseCsv(text) {

  const rows = [];

  let row = [];
  let cell = "";
  let quoted = false;

  for (
    let i = 0;
    i < text.length;
    i++
  ) {

    const current = text[i];
    const next = text[i + 1];

    if (quoted) {

      if (
        current === '"' &&
        next === '"'
      ) {

        cell += '"';
        i++;

      } else if (
        current === '"'
      ) {

        quoted = false;

      } else {

        cell += current;
      }

    } else {

      if (current === '"') {

        quoted = true;

      } else if (
        current === ","
      ) {

        row.push(cell);
        cell = "";

      } else if (
        current === "\n"
      ) {

        row.push(cell);
        cell = "";

        if (
          row.length > 1 ||
          row[0] !== ""
        ) {

          rows.push(row);
        }

        row = [];

      } else if (
        current !== "\r"
      ) {

        cell += current;
      }
    }
  }

  if (
    cell !== "" ||
    row.length
  ) {

    row.push(cell);
    rows.push(row);
  }

  if (!rows.length) {
    return [];
  }

  const headers =
    rows[0].map(
      value => String(value).trim()
    );

  return rows
    .slice(1)
    .filter(row =>
      row.some(value => value !== "")
    )
    .map(row => {

      const object = {};

      headers.forEach(
        (header, index) => {

          object[header] =
            row[index] ?? "";
        }
      );

      return object;
    });
}

/* ============================================================
   GITHUB CONFIG
============================================================ */

function repoConfig(env) {

  return {

    owner:
      env.GITHUB_OWNER,

    repo:
      env.GITHUB_REPO,

    branch:
      env.GITHUB_BRANCH || "main",

    path:
      env.GITHUB_CSV_PATH ||
      "levelx_database.csv"
  };
}

/* ============================================================
   GITHUB HEADERS
============================================================ */

function githubHeaders(env) {

  return {

    "Accept":
      "application/vnd.github+json",

    "Authorization":
      `Bearer ${env.GITHUB_TOKEN}`,

    "X-GitHub-Api-Version":
      "2022-11-28",

    "User-Agent":
      "LevelX-Serverless-API"
  };
}

/* ============================================================
   READ CSV FROM GITHUB
============================================================ */

async function githubGet(env) {

  const config =
    repoConfig(env);

  const url =
    `https://api.github.com/repos/` +
    `${config.owner}/` +
    `${config.repo}/contents/` +
    `${encodeURIComponent(config.path)}` +
    `?ref=${encodeURIComponent(config.branch)}`;

  const response =
    await fetch(
      url,
      {
        method: "GET",
        headers: githubHeaders(env)
      }
    );

  if (!response.ok) {

    const details =
      await response.text();

    throw new Error(
      `GitHub read failed: ` +
      `${response.status} ${details}`
    );
  }

  const data =
    await response.json();

  if (!data.content) {

    throw new Error(
      "GitHub CSV has no content."
    );
  }

  const base64 =
    data.content.replace(/\s/g, "");

  const binary =
    atob(base64);

  const bytes =
    Uint8Array.from(
      binary,
      character =>
        character.charCodeAt(0)
    );

  const decoded =
    new TextDecoder(
      "utf-8"
    ).decode(bytes);

  return {

    rows:
      parseCsv(decoded),

    sha:
      data.sha
  };
}

/* ============================================================
   WRITE CSV TO GITHUB
============================================================ */

async function githubPut(
  env,
  rows,
  sha,
  commitMessage
) {

  const config =
    repoConfig(env);

  const csv =
    rowsToCsv(rows);

  const bytes =
    new TextEncoder().encode(csv);

  let binary = "";

  const chunkSize = 0x8000;

  for (
    let i = 0;
    i < bytes.length;
    i += chunkSize
  ) {

    binary += String.fromCharCode(
      ...bytes.subarray(
        i,
        i + chunkSize
      )
    );
  }

  const base64 =
    btoa(binary);

  const url =
    `https://api.github.com/repos/` +
    `${config.owner}/` +
    `${config.repo}/contents/` +
    `${encodeURIComponent(config.path)}`;

  const response =
    await fetch(
      url,
      {
        method: "PUT",

        headers: {
          ...githubHeaders(env),
          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({

          message:
            commitMessage,

          content:
            base64,

          sha:
            sha,

          branch:
            config.branch
        })
      }
    );

  if (!response.ok) {

    const details =
      await response.text();

    throw new Error(
      `GitHub write failed: ` +
      `${response.status} ${details}`
    );
  }

  return response.json();
}

/* ============================================================
   ADMIN AUTHENTICATION
============================================================ */

function checkAdmin(
  request,
  env,
  body
) {

  const suppliedPassword =
    body?.adminPassword ||
    request.headers.get(
      "X-LevelX-Admin"
    );

  if (!suppliedPassword) {
    return false;
  }

  if (!env.ADMIN_PASSWORD) {
    return false;
  }

  return (
    suppliedPassword ===
    env.ADMIN_PASSWORD
  );
}

/* ============================================================
   FIND MEMBER
============================================================ */

function findMemberIndex(
  rows,
  memberId
) {

  return rows.findIndex(
    member =>
      String(member.id) ===
      String(memberId)
  );
}

/* ============================================================
   PUBLIC MEMBER DATA
============================================================ */

function publicMember(member) {

  return {

    id:
      member.id,

    name:
      member.name,

    rank:
      member.rank,

    role:
      member.role,

    bannedUntil:
      Number(
        member.bannedUntil || 0
      ),

    banReason:
      member.banReason || "",

    avatar:
      member.avatar || "",

    bio:
      member.bio || "",

    social:
      member.social || ""
  };
}

/* ============================================================
   MAIN WORKER
============================================================ */

export default {

  async fetch(
    request,
    env
  ) {

    /* --------------------------------------------------------
       OPTIONS / CORS
    -------------------------------------------------------- */

    if (
      request.method ===
      "OPTIONS"
    ) {

      return new Response(
        null,
        {
          status: 204,
          headers:
            corsHeaders(env)
        }
      );
    }

    const url =
      new URL(request.url);

    try {

      /* ======================================================
         HEALTH CHECK
      ====================================================== */

      if (
        request.method ===
          "GET" &&
        url.pathname ===
          "/"
      ) {

        return json(
          {
            ok: true,
            service:
              "LevelX API",
            status:
              "online"
          },
          200,
          env
        );
      }

      /* ======================================================
         PUBLIC MEMBERS
      ====================================================== */

      if (
        request.method ===
          "GET" &&
        url.pathname ===
          "/api/members"
      ) {

        const {
          rows
        } =
          await githubGet(env);

        const members =
          rows.map(
            publicMember
          );

        return json(
          {
            ok: true,
            members
          },
          200,
          env
        );
      }

      /* ======================================================
         ADMIN LOGIN CHECK
      ====================================================== */

      if (
        request.method ===
          "POST" &&
        url.pathname ===
          "/api/admin/login"
      ) {

        const body =
          await request.json();

        if (
          !checkAdmin(
            request,
            env,
            body
          )
        ) {

          return json(
            {
              ok: false,
              error:
                "Wrong Admin password."
            },
            401,
            env
          );
        }

        return json(
          {
            ok: true,
            message:
              "LevelX Admin login successful. 🔐"
          },
          200,
          env
        );
      }

      /* ======================================================
         UPDATE MEMBER
      ====================================================== */

      if (
        request.method ===
          "PUT" &&
        url.pathname ===
          "/api/admin/member"
      ) {

        const body =
          await request.json();

        if (
          !checkAdmin(
            request,
            env,
            body
          )
        ) {

          return json(
            {
              ok: false,
              error:
                "Admin authentication failed."
            },
            401,
            env
          );
        }

        const member =
          body.member;

        if (
          !member ||
          !member.id
        ) {

          return json(
            {
              ok: false,
              error:
                "Member ID is required."
            },
            400,
            env
          );
        }

        const {
          rows,
          sha
        } =
          await githubGet(env);

        const index =
          findMemberIndex(
            rows,
            member.id
          );

        if (index < 0) {

          return json(
            {
              ok: false,
              error:
                "Member not found."
            },
            404,
            env
          );
        }

        /* Never allow Owner editing */

        if (
          rows[index].role ===
          "owner"
        ) {

          return json(
            {
              ok: false,
              error:
                "The Owner account cannot be edited."
            },
            403,
            env
          );
        }

        /* Only accept safe editable fields */

        const allowedFields = [
          "name",
          "rank",
          "role",
          "bannedUntil",
          "banReason",
          "avatar",
          "bio",
          "social"
        ];

        for (
          const field
          of allowedFields
        ) {

          if (
            Object.prototype
              .hasOwnProperty
              .call(
                member,
                field
              )
          ) {

            rows[index][field] =
              member[field];
          }
        }

        rows[index].updatedAt =
          new Date().toISOString();

        await githubPut(
          env,
          rows,
          sha,
          `LevelX: update member ${
            rows[index].name ||
            rows[index].id
          }`
        );

        return json(
          {
            ok: true,
            member:
              publicMember(
                rows[index]
              )
          },
          200,
          env
        );
      }

      /* ======================================================
         BAN / UNBAN
      ====================================================== */

      if (
        request.method ===
          "POST" &&
        url.pathname ===
          "/api/admin/ban"
      ) {

        const body =
          await request.json();

        if (
          !checkAdmin(
            request,
            env,
            body
          )
        ) {

          return json(
            {
              ok: false,
              error:
                "Admin authentication failed."
            },
            401,
            env
          );
        }

        const memberId =
          body.memberId;

        const duration =
          Number(
            body.duration || 0
          );

        const reason =
          String(
            body.reason || ""
          );

        if (!memberId) {

          return json(
            {
              ok: false,
              error:
                "Member ID is required."
            },
            400,
            env
          );
        }

        const {
          rows,
          sha
        } =
          await githubGet(env);

        const index =
          findMemberIndex(
            rows,
            memberId
          );

        if (index < 0) {

          return json(
            {
              ok: false,
              error:
                "Member not found."
            },
            404,
            env
          );
        }

        /* Owner cannot be banned */

        if (
          rows[index].role ===
          "owner"
        ) {

          return json(
            {
              ok: false,
              error:
                "The Owner account cannot be banned."
            },
            403,
            env
          );
        }

        /*
         * duration:
         *
         * 0      = unban
         * > 0    = milliseconds
         * -1     = permanent
         */

        if (
          duration === -1
        ) {

          rows[index].bannedUntil =
            -1;

        } else if (
          duration > 0
        ) {

          rows[index].bannedUntil =
            Date.now() +
            duration;

        } else {

          rows[index].bannedUntil =
            0;
        }

        rows[index].banReason =
          reason;

        rows[index].updatedAt =
          new Date().toISOString();

        const action =
          rows[index].bannedUntil
            ? "ban"
            : "unban";

        await githubPut(
          env,
          rows,
          sha,
          `LevelX: ${action} ${
            rows[index].name ||
            rows[index].id
          }`
        );

        return json(
          {
            ok: true,
            member:
              publicMember(
                rows[index]
              )
          },
          200,
          env
        );
      }

      /* ======================================================
         404
      ====================================================== */

      return json(
        {
          ok: false,
          error:
            "LevelX API endpoint not found."
        },
        404,
        env
      );

    } catch (error) {

      console.error(
        "LEVELX ERROR:",
        error
      );

      return json(
        {
          ok: false,
          error:
            error?.message ||
            "Internal server error."
        },
        500,
        env
      );
    }
  }
};
