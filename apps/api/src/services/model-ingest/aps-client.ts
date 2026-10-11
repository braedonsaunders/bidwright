import { createHash } from "node:crypto";
import { open } from "node:fs/promises";

const APS_AUTH_URL = "https://developer.api.autodesk.com/authentication/v2/token";
const APS_OSS_URL = "https://developer.api.autodesk.com/oss/v2";
const APS_MD_URL = "https://developer.api.autodesk.com/modelderivative/v2/designdata";

interface TokenCache {
  accessToken: string;
  expiresAt: number;
}

export interface ApsViewerToken {
  accessToken: string;
  expiresIn: number;
}

interface ApsBucketDetails {
  bucketKey: string;
  objectId: string;
  objectKey: string;
  urn: string;
  size?: number;
}

export interface ApsManifestProgress {
  urn: string;
  status: "pending" | "processing" | "success" | "failed" | "timeout";
  progress: string;
  region: string;
  totalItems: number;
  completedItems: number;
  messages?: ApsDerivativeMessage[];
}

export interface ApsDerivativeMessage {
  type: string;
  code: string;
  message: string;
}

export function derivativeMessages(node: unknown): ApsDerivativeMessage[] {
  if (!node || typeof node !== "object") return [];
  const record = node as Record<string, unknown>;
  const messages = Array.isArray(record.messages) ? record.messages.map((entry) => ({
    type: String(entry.type ?? ""), code: String(entry.code ?? ""),
    message: typeof entry.message === "string" ? entry.message : JSON.stringify(entry.message),
  })) : [];
  for (const key of ["derivatives", "children"]) {
    if (Array.isArray(record[key])) messages.push(...record[key].flatMap(derivativeMessages));
  }
  return messages;
}

export class ApsTranslationError extends Error {
  constructor(readonly manifest: ApsManifestProgress) {
    const details = manifest.messages?.map(m => `${m.code}: ${m.message}`).join("; ");
    super(`APS Model Derivative translation failed. Progress: ${manifest.progress}.${details ? ` ${details}` : " Autodesk returned no detailed message."}`);
    this.name = "ApsTranslationError";
  }
}

interface ApsObjectMetadata {
  objectid: number;
  name: string;
  properties?: Record<string, Record<string, unknown>>;
  children?: ApsObjectMetadata[];
}

interface ApsPropertiesResponse {
  data: {
    type: string;
    objects?: ApsObjectMetadata[];
    collection?: ApsObjectMetadata[];
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

class ApsApiError extends Error {
  constructor(
    readonly status: number,
    url: string,
    body: string,
  ) {
    super(`APS API ${status} at ${url}: ${body.slice(0, 500)}`);
    this.name = "ApsApiError";
  }
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
      throw new ApsApiError(response.status, url, body);
    }
    return response.json();
  }

  private async requestToken(scope: string): Promise<{ accessToken: string; expiresIn: number }> {
    const body = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      grant_type: "client_credentials",
      scope,
    });
    const result = await this.fetchJson(APS_AUTH_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    }) as { access_token: string; expires_in: number };
    return { accessToken: result.access_token, expiresIn: result.expires_in };
  }

  async authenticate(): Promise<string> {
    if (this.tokenCache && Date.now() < this.tokenCache.expiresAt - 60_000) {
      return this.tokenCache.accessToken;
    }
    const result = await this.requestToken("data:read data:write bucket:read bucket:create viewables:read");
    this.tokenCache = {
      accessToken: result.accessToken,
      expiresAt: Date.now() + result.expiresIn * 1000,
    };
    return result.accessToken;
  }

  async createViewerToken(): Promise<ApsViewerToken> {
    const token = await this.requestToken("viewables:read");
    return { accessToken: token.accessToken, expiresIn: token.expiresIn };
  }

  private async authedHeaders(): Promise<Record<string, string>> {
    const token = await this.authenticate();
    return { Authorization: `Bearer ${token}` };
  }

  private bucketKey(): string {
    const hash = createHash("sha256").update(this.clientId).digest("hex").slice(0, 16).toLowerCase();
    return `bidwright-models-${hash}`;
  }

  async ensureBucket(): Promise<string> {
    const bucketKey = this.bucketKey();
    const headers = await this.authedHeaders();
    try {
      await this.fetchJson(`${APS_OSS_URL}/buckets/${bucketKey}/details`, { headers });
    } catch (error) {
      if (!(error instanceof ApsApiError) || error.status !== 404) throw error;
      await this.fetchJson(`${APS_OSS_URL}/buckets`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          bucketKey,
          policyKey: "persistent",
        }),
      });
    }
    return bucketKey;
  }

  async uploadObject(objectKey: string, filePath: string): Promise<ApsBucketDetails> {
    const bucketKey = await this.ensureBucket();
    const headers = await this.authedHeaders();
    const encodedObjectKey = encodeURIComponent(objectKey);
    const chunkSize = 5 << 20;
    const file = await open(filePath, "r");
    const fileSize = (await file.stat()).size;
    if (fileSize === 0) {
      await file.close();
      throw new Error("APS cannot upload an empty model file.");
    }
    const totalParts = Math.ceil(fileSize / chunkSize);
    let partsUploaded = 0;
    let uploadKey = "";
    let signedUrlRefreshes = 0;

    try {
      upload: while (partsUploaded < totalParts) {
        const batchSize = Math.min(25, totalParts - partsUploaded);
        const query = new URLSearchParams({
          parts: String(batchSize),
          firstPart: String(partsUploaded + 1),
          minutesExpiration: "10",
          ...(uploadKey ? { uploadKey } : {}),
        });
        const signed = await this.fetchJson(
          `${APS_OSS_URL}/buckets/${bucketKey}/objects/${encodedObjectKey}/signeds3upload?${query}`,
          { headers },
        ) as { urls: string[]; uploadKey: string };
        if (!signed.uploadKey || signed.urls.length !== batchSize) {
          throw new Error("APS returned an incomplete signed upload response.");
        }
        uploadKey = signed.uploadKey;

        for (const url of signed.urls) {
          const start = partsUploaded * chunkSize;
          const length = Math.min(chunkSize, fileSize - start);
          const chunk = Buffer.allocUnsafe(length);
          const { bytesRead } = await file.read(chunk, 0, length, start);
          if (bytesRead !== length) throw new Error(`Could not read APS upload part ${partsUploaded + 1}.`);
          const response = await fetch(url, {
            method: "PUT",
            headers: { "Content-Type": "application/octet-stream" },
            body: chunk,
          });
          if (!response.ok) {
            if (response.status === 403 && signedUrlRefreshes < 3) {
              signedUrlRefreshes += 1;
              continue upload;
            }
            const body = await response.text().catch(() => "");
            throw new Error(`APS signed upload failed for part ${partsUploaded + 1} (${response.status}): ${body.slice(0, 500)}`);
          }
          signedUrlRefreshes = 0;
          partsUploaded += 1;
        }
      }
    } finally {
      await file.close();
    }

    const result = await this.fetchJson(
      `${APS_OSS_URL}/buckets/${bucketKey}/objects/${encodedObjectKey}/signeds3upload`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json", "x-ads-meta-Content-Type": "application/octet-stream" },
        body: JSON.stringify({ uploadKey }),
      },
    ) as { objectId: string; objectKey: string; bucketKey: string };
    const urn = Buffer.from(result.objectId, "utf-8").toString("base64").replace(/=/g, "");
    return {
      bucketKey: result.bucketKey,
      objectId: result.objectId,
      objectKey: result.objectKey,
      urn,
    };
  }

  async getObjectDetails(objectKey: string): Promise<ApsBucketDetails | null> {
    const bucketKey = await this.ensureBucket();
    const headers = await this.authedHeaders();
    try {
      const result = await this.fetchJson(
        `${APS_OSS_URL}/buckets/${bucketKey}/objects/${encodeURIComponent(objectKey)}/details`,
        { headers },
      ) as { bucketKey: string; objectId: string; objectKey: string; size?: number };
      return {
        ...result,
        urn: Buffer.from(result.objectId, "utf-8").toString("base64").replace(/=/g, ""),
      };
    } catch (error) {
      if (error instanceof ApsApiError && error.status === 404) return null;
      throw error;
    }
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
      messages: derivativeMessages(result),
    };
  }

  async waitForTranslation(urn: string, maxWaitMs = 600_000): Promise<ApsManifestProgress> {
    const deadline = Date.now() + maxWaitMs;
    const pollInterval = 5_000;
    while (Date.now() < deadline) {
      const manifest = await this.getManifest(urn);
      if (manifest.status === "success") return manifest;
      if (manifest.status === "failed") {
        throw new ApsTranslationError(manifest);
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

  async getViewProperties(urn: string, guid: string, maxWaitMs = 120_000): Promise<ApsPropertiesResponse> {
    const url = `${APS_MD_URL}/${urn}/metadata/${guid}/properties`;
    const deadline = Date.now() + maxWaitMs;
    // A successful translation can still return 202 { result: "success" }
    // while APS builds the property database. That is not an empty model.
    while (Date.now() < deadline) {
      const response = await fetch(url, {
        headers: await this.authedHeaders(),
        signal: AbortSignal.timeout(Math.max(1, Math.min(60_000, deadline - Date.now()))),
      });
      if (!response.ok) throw new ApsApiError(response.status, url, await response.text().catch(() => ""));
      if (response.status === 202) {
        await response.body?.cancel();
        await new Promise(resolve => setTimeout(resolve, Math.max(0, Math.min(2_000, deadline - Date.now()))));
        continue;
      }
      const result = await response.json() as ApsPropertiesResponse;
      if (!Array.isArray(result.data?.collection) && !Array.isArray(result.data?.objects)) {
        throw new Error("APS returned no property collection after translation; model quantities are not available.");
      }
      return result;
    }
    throw new Error("APS properties are still processing (HTTP 202) after the polling window; model quantities are not available yet.");
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
      estimateRelevant: boolean;
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
    const propertyObjects = propsResponse.data?.collection ?? propsResponse.data?.objects ?? [];
    const flatObjects = flattenApsTree(propertyObjects);

    const seenPhysicalIds = new Set<string>();
    const mapped = flatObjects.map((obj) => {
      const props = obj.properties ?? {};
      const classVal = firstStringValue(props, "Class", "Item Class", "__category__", "Category", "Layer") || "";
      const typeVal = firstStringValue(props, "Entity Type", "Element Type", "Family and Type", "Type", "Family") || "";
      const levelVal = firstStringValue(props, "Level", "Story", "Elevation", "Level Name", "Base Level", "Story Name") || "";
      const materialVal = firstStringValue(props, "Plant Material", "Material Code", "Structural Material", "Material Name", "Material") || "";
      const systemVal = firstStringValue(
        props,
        "PipeLineNumber",
        "Pipe Line Number",
        "Pipeline Tag",
        "Line Number Tag",
        "Line Number",
        "System Name",
        "MEP System",
        "System Type",
        "System",
      ) || "";

      const icon = String(apsPropertyValue(props.Item?.Icon) ?? "");
      const container = /^(File|Layer|Group|Insert ?Group|Composite ?Object)$/i.test(icon) || Boolean(obj.children?.length);
      const guid = firstStringValue(props, "PnPGuid", "GUID");
      const physicalKey = guid ? `${firstStringValue(props, "Source File") ?? ""}:${guid}` : "";
      const duplicate = !container && Boolean(physicalKey && seenPhysicalIds.has(physicalKey));
      if (!container && physicalKey) seenPhysicalIds.add(physicalKey);
      const estimateRelevant = !container && !duplicate;
      const quantities = estimateRelevant ? extractQuantities(props) : [];

      return {
        objectid: obj.objectid,
        name: obj.name,
        elementClass: classVal,
        elementType: typeVal,
        level: levelVal,
        material: materialVal,
        system: systemVal,
        properties: { ...serializeProperties(props), estimateRelevant, ...(duplicate ? { duplicatePhysicalIdentity: physicalKey } : {}) },
        estimateRelevant,
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
  props: Record<string, Record<string, unknown>>,
  ...keys: string[]
): string | null {
  // Property priority must win over property-group iteration order. Plant3D
  // exposes both AutoCAD.Class and General.Layer; searching groups first made
  // the layer accidentally become the element class.
  for (const key of keys) {
    for (const group of Object.values(props)) {
      const value = apsPropertyValue(group[key]);
      if (value != null && value !== "" && value !== "none") {
        return String(value);
      }
    }
  }
  return null;
}

function extractQuantities(
  props: Record<string, Record<string, unknown>>
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
    const lengthUnit = firstStringValue({ group }, "LengthUnit", "Length Unit", "Port1_LengthUnit");
    for (const [key, entry] of Object.entries(group)) {
      // Port/nozzle dimensions and minimum cut lengths describe components or
      // fabrication constraints, not additional installed pipe lengths.
      if (/^(Port\d+_|Nozzle\d+_|MinCutLength$|MaxCutLength$)/i.test(key)) continue;
      const rawValue = apsPropertyValue(entry);
      const value = typeof rawValue === "number"
        ? rawValue
        : typeof rawValue === "string" && /^[-+]?(?:\d+(?:,\d{3})*|\d*)(?:\.\d+)?(?:[eE][-+]?\d+)?$/.test(rawValue.trim())
          ? Number(rawValue.trim().replace(/,/g, ""))
          : Number.NaN;
      // Navisworks/AutoCAD properties frequently serialize numeric property
      // values as strings (for example AutoCAD.Length: "9.043757"). Those
      // are still native BIM quantities and must not be discarded merely
      // because APS chose the display-value representation.
      if (!Number.isFinite(value) || value === 0) continue;
      const lowerKey = key.toLowerCase().trim();
      if (quantityHints.has(lowerKey) || lowerKey.includes("area") || lowerKey.includes("volume") || lowerKey.includes("length")) {
        quantities.push({
          quantityType: key,
          value,
          unit: apsPropertyUnits(entry) || (lengthUnit && /length|width|height|depth|thickness|radius|diameter|offset|elevation/i.test(lowerKey) ? lengthUnit : ""),
        });
      }
    }
  }
  const nominal = firstStringValue(props, "NominalDiameter", "Port1_NominalDiameter");
  const nominalUnit = firstStringValue(props, "LengthUnit", "Port1_LengthUnit");
  if (nominal && nominalUnit && Number.isFinite(Number(nominal))) {
    quantities.push({ quantityType: "nominal_diameter", value: Number(nominal), unit: nominalUnit });
  }
  return quantities;
}

function serializeProperties(
  props: Record<string, Record<string, unknown>>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [groupName, group] of Object.entries(props)) {
    for (const [key, entry] of Object.entries(group)) {
      const value = apsPropertyValue(entry);
      const units = apsPropertyUnits(entry);
      result[`${groupName}.${key}`] = units ? `${value} ${units}` : value;
    }
  }
  return result;
}

function apsPropertyValue(entry: unknown): unknown {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
  const record = entry as Record<string, unknown>;
  return record.value ?? record.displayValue ?? record.display_value ?? entry;
}

function apsPropertyUnits(entry: unknown): string {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return "";
  const units = (entry as Record<string, unknown>).units;
  return typeof units === "string" ? units : "";
}
