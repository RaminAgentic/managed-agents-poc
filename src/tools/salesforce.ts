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

let cachedConn: Connection | null = null;
let loginPromise: Promise<Connection> | null = null;

async function getConnection(): Promise<Connection> {
  if (cachedConn) return cachedConn;
  if (loginPromise) return loginPromise;

  const loginUrl = process.env.SF_LOGIN_URL ?? "https://login.salesforce.com";
  const username = process.env.SF_USERNAME;
  const password = process.env.SF_PASSWORD;

  if (!username || !password) {
    throw new Error(
      "Salesforce tools not configured: set SF_USERNAME and SF_PASSWORD (password = password + security token) on Render."
    );
  }

  const clientId = process.env.SF_CLIENT_ID;
  const clientSecret = process.env.SF_CLIENT_SECRET;

  loginPromise = (async () => {
    const conn = clientId && clientSecret
      ? new Connection({ loginUrl, oauth2: { clientId, clientSecret, loginUrl } })
      : new Connection({ loginUrl });
    await conn.login(username, password);
    console.log(
      `[salesforce] Authenticated via ${clientId && clientSecret ? "OAuth2 username-password" : "SOAP login"} as ${conn.userInfo?.id} on ${conn.instanceUrl}`
    );
    cachedConn = conn;
    return conn;
  })();

  return loginPromise;
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
        "Post a Chatter feed item on any Salesforce record (Account, Opportunity, Contact, etc.). Good for audit trails + human handoffs.",
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

      default:
        return `Error: unknown Salesforce tool '${name}'.`;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[salesforce] ${name} failed:`, message);
    return `Error: ${message}`;
  }
}
