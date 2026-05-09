import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const APS_AUTH_URL = "https://developer.api.autodesk.com/authentication/v2/token";
const APS_OSS_URL = "https://developer.api.autodesk.com/oss/v2";
const APS_MD_URL = "https://developer.api.autodesk.com/modelderivative/v2/designdata";

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

interface ApsBucketDetails {
  bucketKey: string;
  objectId: string;
  objectKey: string;
  urn: string;
}

interface ApsManifestProgress {
  urn: string;
  status: "pending" | "processing" | "success" | "failed" | "timeout";
  progress: string;
  region: string;
  totalItems: number;
  completedItems: number;
}

interface ApsObjectMetadata {
  objectid: number;
  name: string;
  properties?: Record<string, Record<string, { value: unknown; units?: string }>>;
  children?: ApsObjectMetadata[];
}

interface ApsPropertiesResponse {
  data: {
    type: string;
    objects: ApsObjectMetadata[];
  };
}

interface ApsMetadataResponse {
  data: {
    type: string;
    metadata: Array<{
      guid: string;
      name: string;
      role: string;
      status?: string;
    }>;
  };
}

export class ApsClient {
  private clientId: string;
  private clientSecret: string;
  private tokenCache: TokenCache | null = null;

  constructor(clientId: string, clientSecret: string) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
  }

  private async fetchJson(url: string, init: RequestInit): Promise<unknown> {
    const response = await fetch(url, init);
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`APS API ${response.status} at ${url}: ${body.slice(0, 500)}`);
    }
    return response.json();
  }

  async authenticate(): Promise<string> {
    if (this.tokenCache && Date.now() < this.tokenCache.expiresAt - 60_000) {
      return this.tokenCache.accessToken;
    }
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: "client_credentials",
      scope: "data:read data:write bucket:read bucket:create viewables:read",
    });
    const result = await this.fetchJson(APS_AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    }) as { access_token: string; expires_in: number };
    this.tokenCache = {
      accessToken: result.access_token,
      expiresAt: Date.now() + result.expires_in * 1000,
    };
    return result.access_token;
  }

  private async authedHeaders(): Promise<Record<string, string>> {
    const token = await this.authenticate();
    return { Authorization: `Bearer ${token}` };
  }

  private bucketKey(): string {
    const hash = createHash("sha256").update(this.clientId).digest("hex").slice(0, 16).toLowerCase();
    return `bidwright-ingest-${hash}`;
  }

  async ensureBucket(): Promise<string> {
    const bucketKey = this.bucketKey();
    const headers = await this.authedHeaders();
    try {
      await this.fetchJson(`${APS_OSS_URL}/buckets/${bucketKey}/details`, { headers });
    } catch {
      await this.fetchJson(`${APS_OSS_URL}/buckets`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          bucketKey,
          policyKey: "transient",
        }),
      });
    }
    return bucketKey;
  }

  async uploadObject(objectKey: string, filePath: string): Promise<ApsBucketDetails> {
    const bucketKey = await this.ensureBucket();
    const fileData = await readFile(filePath);
    const headers = await this.authedHeaders();
    const result = await this.fetchJson(`${APS_OSS_URL}/buckets/${bucketKey}/objects/${objectKey}`, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/octet-stream" },
      body: fileData,
    }) as { objectId: string; objectKey: string; bucketKey: string };
    const urn = Buffer.from(result.objectId, "utf-8").toString("base64").replace(/=/g, "");
    return {
      bucketKey: result.bucketKey,
      objectId: result.objectId,
      objectKey: result.objectKey,
      urn,
    };
  }

  async submitTranslation(urn: string): Promise<void> {
    const headers = await this.authedHeaders();
    await this.fetchJson(`${APS_MD_URL}/job`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        input: { urn },
        output: {
          formats: [
            { type: "svf2", views: ["3d", "2d"] },
          ],
        },
      }),
    });
  }

  async getManifest(urn: string): Promise<ApsManifestProgress> {
    const headers = await this.authedHeaders();
    const result = await this.fetchJson(`${APS_MD_URL}/${urn}/manifest`, { headers }) as {
      urn: string;
      status: string;
      progress: string;
      region: string;
      derivatives?: Array<{ status: string; progress: string }>;
    };
    const derivatives = result.derivatives ?? [];
    const completed = derivatives.filter((d) => d.status === "success").length;
    return {
      urn: result.urn,
      status: result.status as ApsManifestProgress["status"],
      progress: result.progress,
      region: result.region,
      totalItems: derivatives.length,
      completedItems: completed,
    };
  }

  async waitForTranslation(urn: string, maxWaitMs = 600_000): Promise<ApsManifestProgress> {
    const deadline = Date.now() + maxWaitMs;
    const pollInterval = 5_000;
    while (Date.now() < deadline) {
      const manifest = await this.getManifest(urn);
      if (manifest.status === "success") return manifest;
      if (manifest.status === "failed") {
        throw new Error(`APS Model Derivative translation failed for URN ${urn}. Progress: ${manifest.progress}`);
      }
      const elapsed = deadline - Date.now();
      await new Promise((resolve) => setTimeout(resolve, Math.min(pollInterval, elapsed)));
    }
    return { urn, status: "timeout", progress: "unknown", region: "", totalItems: 0, completedItems: 0 };
  }

  async getMetadataViews(urn: string): Promise<ApsMetadataResponse> {
    const headers = await this.authedHeaders();
    return this.fetchJson(`${APS_MD_URL}/${urn}/metadata`, { headers }) as Promise<ApsMetadataResponse>;
  }

  async getViewProperties(urn: string, guid: string): Promise<ApsPropertiesResponse> {
    const headers = await this.authedHeaders();
    return this.fetchJson(`${APS_MD_URL}/${urn}/metadata/${guid}/properties`, { headers }) as Promise<ApsPropertiesResponse>;
  }

  async extractModelData(urn: string): Promise<{
    objects: Array<{
      objectid: number;
      name: string;
      elementClass: string;
      elementType: string;
      level: string;
      material: string;
      system: string;
      properties: Record<string, unknown>;
      quantities: Array<{ quantityType: string; value: number; unit: string }>;
    }>;
    views: ApsMetadataResponse["data"]["metadata"];
  }> {
    const metaResponse = await this.getMetadataViews(urn);
    const views = metaResponse.data.metadata.filter(
      (m) => m.role === "3d" || m.role === "2d"
    );
    if (views.length === 0) {
      return { objects: [], views: metaResponse.data.metadata };
    }

    const primary = views[0]!;
    const propsResponse = await this.getViewProperties(urn, primary.guid);
    const flatObjects = flattenApsTree(propsResponse.data.objects);

    const mapped = flatObjects.map((obj) => {
      const props = obj.properties ?? {};
      const classVal = firstStringValue(props, "Category", "Layer", "__category__", "Item Class", "Class") || "";
      const typeVal = firstStringValue(props, "Type", "Family and Type", "Element Type", "Family", "Entity Type") || "";
      const levelVal = firstStringValue(props, "Level", "Story", "Elevation", "Level Name", "Base Level", "Story Name") || "";
      const materialVal = firstStringValue(props, "Material", "Material Name", "Structural Material") || "";
      const systemVal = firstStringValue(props, "System", "System Type", "System Name", "MEP System") || "";

      const quantities = extractQuantities(props);

      return {
        objectid: obj.objectid,
        name: obj.name,
        elementClass: classVal,
        elementType: typeVal,
        level: levelVal,
        material: materialVal,
        system: systemVal,
        properties: serializeProperties(props),
        quantities,
      };
    });

    return { objects: mapped, views: metaResponse.data.metadata };
  }
}

function flattenApsTree(objects: ApsObjectMetadata[]): ApsObjectMetadata[] {
  const result: ApsObjectMetadata[] = [];
  const stack = [...objects];
  while (stack.length > 0) {
    const obj = stack.pop()!;
    result.push(obj);
    if (obj.children) {
      stack.push(...obj.children);
    }
  }
  return result;
}

function firstStringValue(
  props: Record<string, Record<string, { value: unknown; units?: string }>>,
  ...keys: string[]
): string | null {
  for (const group of Object.values(props)) {
    for (const key of keys) {
      const entry = group[key];
      if (entry?.value != null && entry.value !== "" && entry.value !== "none") {
        return String(entry.value);
      }
    }
  }
  return null;
}

function extractQuantities(
  props: Record<string, Record<string, { value: unknown; units?: string }>>
): Array<{ quantityType: string; value: number; unit: string }> {
  const quantities: Array<{ quantityType: string; value: number; unit: string }> = [];
  const quantityHints = new Set([
    "length", "width", "height", "depth", "area", "volume", "perimeter", "circumference",
    "thickness", "radius", "diameter", "elevation", "offset", "count",
    "gross area", "net area", "gross volume", "net volume", "gross length", "net length",
    "hand height", "structural area", "structural volume", "analytical area", "analytical volume",
    "unconnected height", "linear dimension",
  ]);

  for (const group of Object.values(props)) {
    for (const [key, entry] of Object.entries(group)) {
      if (typeof entry.value !== "number" || !isFinite(entry.value) || entry.value === 0) continue;
      const lowerKey = key.toLowerCase().trim();
      if (quantityHints.has(lowerKey) || lowerKey.includes("area") || lowerKey.includes("volume") || lowerKey.includes("length")) {
        quantities.push({
          quantityType: key,
          value: entry.value,
          unit: entry.units ?? "",
        });
      }
    }
  }
  return quantities;
}

function serializeProperties(
  props: Record<string, Record<string, { value: unknown; units?: string }>>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [groupName, group] of Object.entries(props)) {
    for (const [key, entry] of Object.entries(group)) {
      result[`${groupName}.${key}`] = entry.units ? `${entry.value} ${entry.units}` : entry.value;
    }
  }
  return result;
}
