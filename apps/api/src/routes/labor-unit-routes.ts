import type { FastifyInstance } from "fastify";
import { z } from "zod";

const librarySchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().optional(),
  provider: z.string().optional(),
  discipline: z.string().optional(),
  source: z.enum(["manual", "import", "library", "plugin"]).optional(),
  sourceDescription: z.string().optional(),
  sourceDatasetId: z.string().nullable().optional(),
  cabinetId: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const unitSchema = z.object({
  catalogItemId: z.string().nullable().optional(),
  code: z.string().optional(),
  name: z.string().trim().min(1),
  description: z.string().optional(),
  discipline: z.string().optional(),
  category: z.string().optional(),
  className: z.string().optional(),
  subClassName: z.string().optional(),
  outputUom: z.string().optional(),
  hoursNormal: z.coerce.number().finite().nonnegative(),
  hoursDifficult: z.coerce.number().finite().nonnegative().nullable().optional(),
  hoursVeryDifficult: z.coerce.number().finite().nonnegative().nullable().optional(),
  defaultDifficulty: z.enum(["normal", "difficult", "very_difficult"]).optional(),
  entityCategoryType: z.string().optional(),
  tags: z.array(z.string()).optional(),
  sourceRef: z.record(z.unknown()).optional(),
  metadata: z.record(z.unknown()).optional(),
  sortOrder: z.coerce.number().int().optional(),
});

const unitPatchSchema = unitSchema.partial();

function statusForError(message: string) {
  if (message.includes("not found")) return 404;
  if (message.includes("required")) return 400;
  return 500;
}

export async function laborUnitRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/labor-units/libraries", async (request, reply) => {
    const query = request.query as { scope?: "organization" | "all" };
    try {
      return await request.store!.listLaborUnitLibraries(query.scope ?? "all");
    } catch (err: any) {
      reply.code(statusForError(err?.message ?? ""));
      return { error: err?.message ?? "Failed to list labor unit catalogs" };
    }
  });

  app.post("/api/labor-units/libraries", async (request, reply) => {
    const parsed = librarySchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "Invalid payload", issues: parsed.error.flatten() });
    try {
      const created = await request.store!.createLaborUnitLibrary(parsed.data);
      reply.code(201);
      return created;
    } catch (err: any) {
      reply.code(statusForError(err?.message ?? ""));
      return { error: err?.message ?? "Failed to create labor unit catalog" };
    }
  });

  app.get("/api/labor-units/libraries/:libraryId", async (request, reply) => {
    const { libraryId } = request.params as { libraryId: string };
    const library = await request.store!.getLaborUnitLibrary(libraryId);
    if (!library) return reply.code(404).send({ error: `Labor unit catalog ${libraryId} not found` });
    return library;
  });

  app.patch("/api/labor-units/libraries/:libraryId", async (request, reply) => {
    const { libraryId } = request.params as { libraryId: string };
    const parsed = librarySchema.partial().safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "Invalid payload", issues: parsed.error.flatten() });
    try {
      return await request.store!.updateLaborUnitLibrary(libraryId, parsed.data);
    } catch (err: any) {
      reply.code(statusForError(err?.message ?? ""));
      return { error: err?.message ?? "Failed to update labor unit catalog" };
    }
  });

  app.delete("/api/labor-units/libraries/:libraryId", async (request, reply) => {
    const { libraryId } = request.params as { libraryId: string };
    try {
      return await request.store!.deleteLaborUnitLibrary(libraryId);
    } catch (err: any) {
      reply.code(statusForError(err?.message ?? ""));
      return { error: err?.message ?? "Failed to delete labor unit catalog" };
    }
  });

  app.get("/api/labor-units/units", async (request, reply) => {
    const query = request.query as {
      libraryId?: string;
      q?: string;
      provider?: string;
      category?: string;
      className?: string;
      limit?: string;
      offset?: string;
    };
    try {
      return await request.store!.listLaborUnits({
        libraryId: query.libraryId,
        q: query.q,
        provider: query.provider,
        category: query.category,
        className: query.className,
        limit: query.limit ? Number(query.limit) : undefined,
        offset: query.offset ? Number(query.offset) : undefined,
      });
    } catch (err: any) {
      reply.code(statusForError(err?.message ?? ""));
      return { error: err?.message ?? "Failed to list labor units" };
    }
  });

  app.get("/api/labor-units/tree", async (request, reply) => {
    const query = request.query as {
      parentType?: "root" | "catalog" | "category" | "class" | "subclass";
      libraryId?: string;
      q?: string;
      category?: string;
      className?: string;
      subClassName?: string;
      limit?: string;
      offset?: string;
    };
    try {
      return await request.store!.listLaborUnitTree({
        parentType: query.parentType,
        libraryId: query.libraryId,
        q: query.q,
        category: query.category,
        className: query.className,
        subClassName: query.subClassName,
        limit: query.limit ? Number(query.limit) : undefined,
        offset: query.offset ? Number(query.offset) : undefined,
      });
    } catch (err: any) {
      reply.code(statusForError(err?.message ?? ""));
      return { error: err?.message ?? "Failed to list labor unit tree" };
    }
  });

  app.post("/api/labor-units/libraries/:libraryId/units", async (request, reply) => {
    const { libraryId } = request.params as { libraryId: string };
    const parsed = unitSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "Invalid payload", issues: parsed.error.flatten() });
    try {
      const unit = await request.store!.createLaborUnit(libraryId, parsed.data);
      reply.code(201);
      return unit;
    } catch (err: any) {
      reply.code(statusForError(err?.message ?? ""));
      return { error: err?.message ?? "Failed to create labor unit" };
    }
  });

  app.patch("/api/labor-units/units/:unitId", async (request, reply) => {
    const { unitId } = request.params as { unitId: string };
    const parsed = unitPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: "Invalid payload", issues: parsed.error.flatten() });
    try {
      return await request.store!.updateLaborUnit(unitId, parsed.data);
    } catch (err: any) {
      reply.code(statusForError(err?.message ?? ""));
      return { error: err?.message ?? "Failed to update labor unit" };
    }
  });

  app.delete("/api/labor-units/units/:unitId", async (request, reply) => {
    const { unitId } = request.params as { unitId: string };
    try {
      return await request.store!.deleteLaborUnit(unitId);
    } catch (err: any) {
      reply.code(statusForError(err?.message ?? ""));
      return { error: err?.message ?? "Failed to delete labor unit" };
    }
  });
}
