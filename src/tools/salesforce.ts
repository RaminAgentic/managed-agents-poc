/**
 * Salesforce custom-tool suite (jsforce-backed).
 *
 * Exposes 6 operations to managed agents as Anthropic custom tools:
 *   sf_query     — SOQL query
 *   sf_describe  — field metadata for an sObject
 *   sf_create    — insert a record
 *   sf_update    — update a record by Id
 *   sf_upsert    — upsert on an external ID field
 *   sf_chatter   — post a Chatter feed item on any record
 *
 * Auth: username/password/security-token via env vars. Dev orgs can
 * issue tokens at Setup > My Personal Information > Reset My Security
 * Token. Production orgs should use a Connected App instead.
 *
 * Connection caching: one logged-in Connection per Node process, reused
 * across calls. jsforce handles token refresh internally.
 */
import jsforce, { Connection } from "jsforce";
import type Anthropic from "@anthropic-ai/sdk";
import crypto from "crypto";

let cachedConn: Connection | null = null;
let loginPromise: Promise<Connection> | null = null;

function base64url(buf: Buffer | string): string {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return b.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

/**
 * JWT Bearer flow: sign a short-lived JWT with the configured RSA
 * private key, exchange it for an access token at /services/oauth2/token.
 *
 * Required env vars:
 *   SF_CLIENT_ID   — Connected App consumer key
 *   SF_USERNAME    — user whose access we're assuming
 *   SF_PRIVATE_KEY — PEM-formatted RSA private key. Newlines may be
 *                    escaped as \n (Render env var restriction).
 *   SF_LOGIN_URL   — defaults to https://login.salesforce.com
 *
 * Requires the Connected App's matching public cert to be uploaded
 * and the running user's profile to be pre-authorized.
 */
async function jwtLogin(): Promise<Connection> {
  const loginUrl = (process.env.SF_LOGIN_URL ?? "https://login.salesforce.com").replace(/\/+$/, "");
  const clientId = process.env.SF_CLIENT_ID;
  const username = process.env.SF_USERNAME;
  const rawKey = process.env.SF_PRIVATE_KEY;
  if (!clientId || !username || !rawKey) {
    throw new Error(
      "JWT flow requires SF_CLIENT_ID, SF_USERNAME, and SF_PRIVATE_KEY."
    );
  }
  // Render escapes newlines as \n in env values — un-escape.
  const privateKey = rawKey.includes("\\n")
    ? rawKey.replace(/\\n/g, "\n")
    : rawKey;

  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iss: clientId,
      sub: username,
      aud: loginUrl,
      exp: Math.floor(Date.now() / 1000) + 180,
    })
  );
  const signingInput = `${header}.${payload}`;
  const signature = base64url(
    crypto.sign("RSA-SHA256", Buffer.from(signingInput), privateKey)
  );
  const assertion = `${signingInput}.${signature}`;

  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });
  const resp = await fetch(`${loginUrl}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await resp.text();
  if (!resp.ok) {
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* noop */
    }
    throw new Error(
      `JWT exchange failed (HTTP ${resp.status}): ${JSON.stringify(parsed)}`
    );
  }
  const json = JSON.parse(text) as {
    access_token: string;
    instance_url: string;
    id?: string;
  };
  const conn = new Connection({
    instanceUrl: json.instance_url,
    accessToken: json.access_token,
  });
  console.log(
    `[salesforce] Authenticated via JWT bearer as ${username} on ${json.instance_url}`
  );
  return conn;
}

async function getConnection(): Promise<Connection> {
  if (cachedConn) return cachedConn;
  if (loginPromise) return loginPromise;

  const loginUrl = process.env.SF_LOGIN_URL ?? "https://login.salesforce.com";
  const username = process.env.SF_USERNAME;
  const password = process.env.SF_PASSWORD;
  const privateKey = process.env.SF_PRIVATE_KEY;

  // Prefer JWT bearer flow when a private key is present — works with
  // MFA-enforced users and doesn't need a password at all.
  if (privateKey) {
    loginPromise = jwtLogin()
      .then((c) => {
        cachedConn = c;
        return c;
      })
      .catch((err) => {
        loginPromise = null;
        throw err;
      });
    return loginPromise;
  }

  if (!username || !password) {
    throw new Error(
      "Salesforce tools not configured: set SF_USERNAME and either SF_PRIVATE_KEY (JWT flow) or SF_PASSWORD (password+token) on Render."
    );
  }

  const clientId = process.env.SF_CLIENT_ID;
  const clientSecret = process.env.SF_CLIENT_SECRET;

  const useOAuth2 = Boolean(clientId && clientSecret);
  loginPromise = (async () => {
    const conn = useOAuth2
      ? new Connection({ loginUrl, oauth2: { clientId, clientSecret, loginUrl } })
      : new Connection({ loginUrl });
    try {
      await conn.login(username, password);
    } catch (err) {
      // Dump the full error object so we can see whatever jsforce returned
      const raw = err as Record<string, unknown>;
      const dump: Record<string, unknown> = {};
      for (const key of Object.getOwnPropertyNames(raw)) {
        dump[key] = raw[key];
      }
      const flow = useOAuth2 ? "OAuth2 username-password" : "SOAP";
      console.error(
        `[salesforce] Login failed (${flow}). Raw error:`,
        JSON.stringify(dump, null, 2)
      );
      const message =
        typeof raw.message === "string" ? raw.message : "Login failed";
      const extra = [
        raw.errorCode ? `errorCode=${raw.errorCode}` : null,
        raw.name ? `name=${raw.name}` : null,
        raw.error ? `error=${raw.error}` : null,
        raw.error_description ? `desc=${raw.error_description}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      throw new Error(extra ? `${message} (${extra})` : message);
    }
    console.log(
      `[salesforce] Authenticated via ${useOAuth2 ? "OAuth2 username-password" : "SOAP login"} as ${conn.userInfo?.id} on ${conn.instanceUrl}`
    );
    cachedConn = conn;
    return conn;
  })();

  try {
    return await loginPromise;
  } catch (err) {
    // Reset so the next caller retries with fresh env vars / fixed config
    loginPromise = null;
    throw err;
  }
}

// ── Tool schemas (Anthropic custom tool shape) ────────────────────────

export const SF_TOOL_DEFINITIONS: Anthropic.Beta.Agents.BetaManagedAgentsCustomToolParams[] =
  [
    {
      type: "custom",
      name: "sf_query",
      description:
        "Run a SOQL query against Salesforce. Returns up to 2000 records. Example: SELECT Id, Name, Amount FROM Opportunity WHERE CloseDate = THIS_QUARTER",
      input_schema: {
        type: "object",
        properties: {
          soql: {
            type: "string",
            description: "A full SOQL query string.",
          },
        },
        required: ["soql"],
      },
    },
    {
      type: "custom",
      name: "sf_describe",
      description:
        "Describe an sObject — returns its field list, types, and reference relationships. Use before writing to learn valid field API names.",
      input_schema: {
        type: "object",
        properties: {
          object: {
            type: "string",
            description: "sObject API name, e.g. 'Account', 'Opportunity', 'Contact'.",
          },
        },
        required: ["object"],
      },
    },
    {
      type: "custom",
      name: "sf_create",
      description:
        "Create (insert) a new Salesforce record. Returns { id, success }. Use sf_describe first if unsure of valid field names.",
      input_schema: {
        type: "object",
        properties: {
          object: { type: "string", description: "sObject API name" },
          fields: {
            type: "object",
            description:
              "Field name → value pairs for the new record. All required fields must be present.",
            additionalProperties: true,
          },
        },
        required: ["object", "fields"],
      },
    },
    {
      type: "custom",
      name: "sf_update",
      description:
        "Update an existing Salesforce record by ID. Only the fields you pass are changed.",
      input_schema: {
        type: "object",
        properties: {
          object: { type: "string", description: "sObject API name" },
          id: { type: "string", description: "The record's 15 or 18-char Id" },
          fields: {
            type: "object",
            description: "Field name → value pairs to update.",
            additionalProperties: true,
          },
        },
        required: ["object", "id", "fields"],
      },
    },
    {
      type: "custom",
      name: "sf_upsert",
      description:
        "Idempotent upsert: create-or-update based on an external ID field. Good for repeatable runs.",
      input_schema: {
        type: "object",
        properties: {
          object: { type: "string" },
          externalIdField: {
            type: "string",
            description:
              "API name of the external ID field (must be marked External Id + Unique in Salesforce).",
          },
          fields: {
            type: "object",
            description:
              "Field name → value pairs. Must include the external ID field.",
            additionalProperties: true,
          },
        },
        required: ["object", "externalIdField", "fields"],
      },
    },
    {
      type: "custom",
      name: "sf_chatter",
      description:
        "Post a Chatter feed item on any Salesforce record (Account, Opportunity, Contact, etc.). Good for audit trails + human handoffs. Returns { id } — the FeedItem Id, which you can pass to sf_watch_chatter to wait for replies.",
      input_schema: {
        type: "object",
        properties: {
          parentId: {
            type: "string",
            description: "Id of the record to post on.",
          },
          body: { type: "string", description: "Plain-text message body." },
        },
        required: ["parentId", "body"],
      },
    },
    {
      type: "custom",
      name: "sf_watch_chatter",
      description:
        "Wait for replies on a Chatter FeedItem. Blocks until a new FeedComment appears (relative to `sinceIso`, default: now) or the timeout elapses. Use this after sf_chatter when you want the agent to react to a human's reply — e.g. '@-mention the account owner, ask a yes/no question, wait for their reply, then act on it'. Returns an array of comments or an empty array on timeout.",
      input_schema: {
        type: "object",
        properties: {
          feedItemId: {
            type: "string",
            description: "Id returned by sf_chatter (the FeedItem to watch).",
          },
          timeoutSeconds: {
            type: "number",
            description:
              "How long to wait for a reply before giving up. Default 300 (5 min). Max 600.",
          },
          pollIntervalSeconds: {
            type: "number",
            description: "Seconds between polls. Default 10.",
          },
          sinceIso: {
            type: "string",
            description:
              "ISO-8601 timestamp — only return comments created after this. Default: the moment this tool is invoked.",
          },
        },
        required: ["feedItemId"],
      },
    },
  ];

export const SF_TOOL_NAMES = new Set(SF_TOOL_DEFINITIONS.map((t) => t.name));

// ── Dispatcher ────────────────────────────────────────────────────────

function trimForLog(value: unknown): string {
  const s = JSON.stringify(value);
  return s.length > 400 ? s.slice(0, 400) + "…" : s;
}

/**
 * Dispatch a single Salesforce custom-tool call.
 *
 * Returns a string the managed agent will see as the tool result.
 * Errors are caught and returned as string messages (the agent can then
 * decide how to recover) rather than thrown.
 */
export async function dispatchSalesforceTool(
  name: string,
  input: Record<string, unknown>
): Promise<string> {
  try {
    const conn = await getConnection();

    switch (name) {
      case "sf_query": {
        const soql = String(input.soql ?? "");
        if (!soql) return "Error: sf_query requires a 'soql' argument.";
        const result = await conn.query(soql);
        console.log(
          `[salesforce] sf_query → ${result.totalSize} record(s) for "${soql.slice(0, 80)}"`
        );
        return JSON.stringify({
          totalSize: result.totalSize,
          done: result.done,
          records: result.records,
        });
      }

      case "sf_describe": {
        const object = String(input.object ?? "");
        if (!object) return "Error: sf_describe requires an 'object' argument.";
        const meta = await conn.sobject(object).describe();
        const fields = (meta.fields as ReadonlyArray<Record<string, unknown>>).map(
          (f) => ({
            name: f.name,
            label: f.label,
            type: f.type,
            custom: f.custom,
            nillable: f.nillable,
            referenceTo: f.referenceTo,
          })
        );
        return JSON.stringify({ name: meta.name, label: meta.label, fields });
      }

      case "sf_create": {
        const object = String(input.object ?? "");
        const fields = input.fields as Record<string, unknown> | undefined;
        if (!object || !fields) {
          return "Error: sf_create requires 'object' and 'fields' arguments.";
        }
        const result = await conn.sobject(object).create(fields);
        console.log(
          `[salesforce] sf_create ${object} → ${trimForLog(result)}`
        );
        return JSON.stringify(result);
      }

      case "sf_update": {
        const object = String(input.object ?? "");
        const id = String(input.id ?? "");
        const fields = input.fields as Record<string, unknown> | undefined;
        if (!object || !id || !fields) {
          return "Error: sf_update requires 'object', 'id', and 'fields'.";
        }
        const result = await conn
          .sobject(object)
          .update({ Id: id, ...fields });
        console.log(
          `[salesforce] sf_update ${object}/${id} → ${trimForLog(result)}`
        );
        return JSON.stringify(result);
      }

      case "sf_upsert": {
        const object = String(input.object ?? "");
        const externalIdField = String(input.externalIdField ?? "");
        const fields = input.fields as Record<string, unknown> | undefined;
        if (!object || !externalIdField || !fields) {
          return "Error: sf_upsert requires 'object', 'externalIdField', and 'fields'.";
        }
        const result = await conn
          .sobject(object)
          .upsert(fields, externalIdField);
        console.log(
          `[salesforce] sf_upsert ${object} on ${externalIdField} → ${trimForLog(result)}`
        );
        return JSON.stringify(result);
      }

      case "sf_chatter": {
        const parentId = String(input.parentId ?? "");
        const body = String(input.body ?? "");
        if (!parentId || !body) {
          return "Error: sf_chatter requires 'parentId' and 'body'.";
        }
        const result = await conn.sobject("FeedItem").create({
          ParentId: parentId,
          Body: body,
        });
        console.log(
          `[salesforce] sf_chatter on ${parentId} → ${trimForLog(result)}`
        );
        return JSON.stringify(result);
      }

      case "sf_watch_chatter": {
        const feedItemId = String(input.feedItemId ?? "");
        if (!feedItemId) {
          return "Error: sf_watch_chatter requires 'feedItemId'.";
        }
        const timeoutSeconds = Math.min(
          Number(input.timeoutSeconds ?? 300) || 300,
          600
        );
        const pollIntervalSeconds = Math.max(
          Number(input.pollIntervalSeconds ?? 10) || 10,
          3
        );
        const sinceIso =
          typeof input.sinceIso === "string"
            ? input.sinceIso
            : new Date().toISOString();

        const deadline = Date.now() + timeoutSeconds * 1000;
        console.log(
          `[salesforce] sf_watch_chatter ${feedItemId} — waiting up to ${timeoutSeconds}s for replies since ${sinceIso}`
        );

        while (Date.now() < deadline) {
          const soql =
            `SELECT Id, Body, CreatedDate, CreatedBy.Name ` +
            `FROM FeedComment ` +
            `WHERE FeedItemId = '${feedItemId.replace(/'/g, "\\'")}' ` +
            `AND CreatedDate > ${sinceIso} ` +
            `ORDER BY CreatedDate ASC`;
          try {
            const result = await conn.query(soql);
            if (result.totalSize > 0) {
              console.log(
                `[salesforce] sf_watch_chatter ${feedItemId} — got ${result.totalSize} new reply(ies)`
              );
              return JSON.stringify({
                feedItemId,
                replies: result.records,
                timedOut: false,
              });
            }
          } catch (err) {
            console.error("[salesforce] sf_watch_chatter poll error:", err);
          }
          await new Promise((r) =>
            setTimeout(r, pollIntervalSeconds * 1000)
          );
        }
        console.log(
          `[salesforce] sf_watch_chatter ${feedItemId} — timed out with no replies`
        );
        return JSON.stringify({ feedItemId, replies: [], timedOut: true });
      }

      default:
        return `Error: unknown Salesforce tool '${name}'.`;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[salesforce] ${name} failed:`, message);
    return `Error: ${message}`;
  }
}
