/**
 * Reusable seed functions — can be called from CLI (seed.ts) or API endpoints.
 */
import { mockStore, type BidwrightStore } from "@bidwright/domain";
import type { PrismaClient } from "@prisma/client";

export { mockStore };


export async function seedEntityCategories(prisma: PrismaClient, organizationId: string) {
  const categories = [
    {
      name: "Labour", entityType: "Labour", shortform: "L", defaultUom: "HR",
      validUoms: ["HR", "DAY", "WK", "MO"], color: "#3b82f6", order: 1,
      calculationType: "auto_labour", itemSource: "rate_schedule" as const,
      editableFields: { quantity: true, cost: false, markup: false, price: false, laborHourReg: true, laborHourOver: true, laborHourDouble: true },
      laborHourLabels: { reg: "Reg Hrs", over: "OT Hrs", double: "DT Hrs" },
    },
    {
      name: "Equipment", entityType: "Equipment", shortform: "E", defaultUom: "DAY",
      validUoms: ["DAY", "WK", "MO", "EA"], color: "#f59e0b", order: 2,
      calculationType: "auto_equipment", itemSource: "catalog" as const,
      editableFields: { quantity: true, cost: false, markup: false, price: false, laborHourReg: true, laborHourOver: false, laborHourDouble: false },
      laborHourLabels: { reg: "Duration", over: "", double: "" },
    },
    {
      name: "Material", entityType: "Material", shortform: "M", defaultUom: "EA",
      validUoms: ["EA", "LF", "SF", "CY", "TON", "GAL", "LB", "LS", "LOT", "SET"], color: "#22c55e", order: 3,
      calculationType: "manual", itemSource: "freeform" as const,
      editableFields: { quantity: true, cost: true, markup: true, price: true, laborHourReg: false, laborHourOver: false, laborHourDouble: false },
      laborHourLabels: { reg: "Reg Hrs", over: "OT Hrs", double: "DT Hrs" },
    },
    {
      name: "Subcontractor", entityType: "Subcontractor", shortform: "S", defaultUom: "LS",
      validUoms: ["EA", "LS", "HR"], color: "#8b5cf6", order: 4,
      calculationType: "manual", itemSource: "freeform" as const,
      editableFields: { quantity: true, cost: true, markup: true, price: true, laborHourReg: false, laborHourOver: false, laborHourDouble: false },
      laborHourLabels: { reg: "Reg Hrs", over: "OT Hrs", double: "DT Hrs" },
    },
    {
      name: "Consumables", entityType: "Consumable", shortform: "C", defaultUom: "EA",
      validUoms: ["EA", "KG", "LB", "GAL"], color: "#6b7280", order: 5,
      calculationType: "auto_consumable", itemSource: "freeform" as const,
      editableFields: { quantity: true, cost: true, markup: true, price: false, laborHourReg: false, laborHourOver: false, laborHourDouble: false },
      laborHourLabels: { reg: "Reg Hrs", over: "OT Hrs", double: "DT Hrs" },
    },
    {
      name: "Rental Equipment", entityType: "RentalEquipment", shortform: "R", defaultUom: "DAY",
      validUoms: ["DAY", "WK", "MO", "HR"], color: "#ec4899", order: 6,
      calculationType: "auto_equipment", itemSource: "rate_schedule" as const,
      editableFields: { quantity: true, cost: true, markup: true, price: true, laborHourReg: true, laborHourOver: false, laborHourDouble: false },
      laborHourLabels: { reg: "Duration", over: "", double: "" },
    },
    {
      name: "Travel & Per Diem", entityType: "Travel", shortform: "T", defaultUom: "DAY",
      validUoms: ["DAY", "EA", "MI"], color: "#f97316", order: 7,
      calculationType: "manual", itemSource: "freeform" as const,
      editableFields: { quantity: true, cost: true, markup: true, price: true, laborHourReg: false, laborHourOver: false, laborHourDouble: false },
      laborHourLabels: { reg: "Reg Hrs", over: "OT Hrs", double: "DT Hrs" },
    },
    {
      name: "Other Charges", entityType: "OtherCharges", shortform: "O", defaultUom: "LS",
      validUoms: ["EA", "LS", "%"], color: "#ef4444", order: 8,
      calculationType: "direct_price", itemSource: "freeform" as const,
      editableFields: { quantity: false, cost: false, markup: false, price: true, laborHourReg: false, laborHourOver: false, laborHourDouble: false },
      laborHourLabels: { reg: "", over: "", double: "" },
    },
    {
      name: "Allowances", entityType: "Allowance", shortform: "A", defaultUom: "LS",
      validUoms: ["EA", "LS"], color: "#14b8a6", order: 9,
      calculationType: "direct_price", itemSource: "freeform" as const,
      editableFields: { quantity: false, cost: false, markup: false, price: true, laborHourReg: false, laborHourOver: false, laborHourDouble: false },
      laborHourLabels: { reg: "", over: "", double: "" },
    },
    {
      name: "Overhead", entityType: "Overhead", shortform: "H", defaultUom: "%",
      validUoms: ["%", "EA", "LS"], color: "#a855f7", order: 10,
      calculationType: "direct_price", itemSource: "freeform" as const,
      editableFields: { quantity: false, cost: false, markup: false, price: true, laborHourReg: false, laborHourOver: false, laborHourDouble: false },
      laborHourLabels: { reg: "", over: "", double: "" },
    },
  ];

  for (const cat of categories) {
    await prisma.entityCategory.upsert({
      where: { organizationId_name: { organizationId, name: cat.name } },
      update: {
        entityType: cat.entityType, shortform: cat.shortform, defaultUom: cat.defaultUom,
        validUoms: cat.validUoms, editableFields: cat.editableFields as any,
        laborHourLabels: cat.laborHourLabels as any, calculationType: cat.calculationType,
        itemSource: cat.itemSource,
        color: cat.color, order: cat.order, isBuiltIn: true, enabled: true,
      },
      create: {
        organizationId, name: cat.name, entityType: cat.entityType, shortform: cat.shortform,
        defaultUom: cat.defaultUom, validUoms: cat.validUoms, editableFields: cat.editableFields as any,
        laborHourLabels: cat.laborHourLabels as any, calculationType: cat.calculationType,
        itemSource: cat.itemSource,
        color: cat.color, order: cat.order, isBuiltIn: true, enabled: true,
      },
    });
  }
}

export async function seedSampleProjects(prisma: PrismaClient, store: BidwrightStore, organizationId: string) {
  for (const project of store.projects) {
    await prisma.project.create({
      data: {
        id: project.id,
        organizationId,
        name: project.name,
        clientName: project.clientName,
        location: project.location,
        packageName: project.packageName,
        packageUploadedAt: project.packageUploadedAt,
        ingestionStatus: project.ingestionStatus,
        summary: project.summary,
        sourceDocuments: {
          create: store.sourceDocuments
            .filter((d) => d.projectId === project.id)
            .map((d) => ({
              id: d.id, fileName: d.fileName, fileType: d.fileType, documentType: d.documentType,
              pageCount: d.pageCount, checksum: d.checksum, storagePath: d.storagePath,
              extractedText: d.extractedText, createdAt: new Date(d.createdAt), updatedAt: new Date(d.updatedAt),
            })),
        },
      },
    });
  }

  for (const quote of store.quotes) {
    await prisma.quote.create({
      data: {
        id: quote.id, projectId: quote.projectId, quoteNumber: quote.quoteNumber,
        title: quote.title, status: quote.status, currentRevisionId: quote.currentRevisionId,
      },
    });
  }

  for (const revision of store.revisions) {
    await prisma.quoteRevision.create({
      data: {
        id: revision.id, quoteId: revision.quoteId, revisionNumber: revision.revisionNumber,
        title: revision.title, description: revision.description, notes: revision.notes,
        breakoutStyle: revision.breakoutStyle, useCalculatedTotal: revision.useCalculatedTotal,
        subtotal: revision.subtotal, cost: revision.cost,
        estimatedProfit: revision.estimatedProfit,
        estimatedMargin: revision.estimatedMargin,
        totalHours: revision.totalHours,
        worksheets: {
          create: store.worksheets
            .filter((w) => w.revisionId === revision.id)
            .map((w) => ({
              id: w.id, name: w.name, order: w.order,
              items: {
                create: store.worksheetItems
                  .filter((i) => i.worksheetId === w.id)
                  .map((i) => ({
                    id: i.id, category: i.category, entityType: i.entityType, entityName: i.entityName,
                    description: i.description, quantity: i.quantity, uom: i.uom,
                    cost: i.cost, markup: i.markup, price: i.price,
                    laborHourReg: i.laborHourReg, laborHourOver: i.laborHourOver,
                    laborHourDouble: i.laborHourDouble, lineOrder: i.lineOrder,
                  })),
              },
            })),
        },
        phases: {
          create: store.phases
            .filter((p) => p.revisionId === revision.id)
            .map((p) => ({ id: p.id, number: p.number, name: p.name, description: p.description, order: p.order })),
        },
        modifiers: {
          create: store.modifiers
            .filter((m) => m.revisionId === revision.id)
            .map((m) => ({
              id: m.id, name: m.name, type: m.type, appliesTo: m.appliesTo,
              percentage: m.percentage ?? null, amount: m.amount ?? null, show: m.show,
            })),
        },
        conditions: {
          create: store.conditions
            .filter((c) => c.revisionId === revision.id)
            .map((c) => ({ id: c.id, type: c.type, value: c.value, order: c.order })),
        },
      },
    });
  }

  for (const catalog of store.catalogs) {
    await prisma.catalog.create({
      data: {
        id: catalog.id, organizationId, projectId: catalog.projectId,
        name: catalog.name, kind: catalog.kind, scope: catalog.scope, description: catalog.description,
        items: {
          create: store.catalogItems
            .filter((i) => i.catalogId === catalog.id)
            .map((i) => ({
              id: i.id, code: i.code, name: i.name, unit: i.unit,
              unitCost: i.unitCost, unitPrice: i.unitPrice, metadata: i.metadata,
            })),
        },
      },
    });
  }

  for (const aiRun of store.aiRuns) {
    await prisma.aiRun.create({
      data: {
        id: aiRun.id, projectId: aiRun.projectId, revisionId: aiRun.revisionId,
        kind: aiRun.kind, status: aiRun.status, model: aiRun.model,
        promptVersion: aiRun.promptVersion, input: aiRun.input as any, output: aiRun.output as any,
        createdAt: new Date(aiRun.createdAt), updatedAt: new Date(aiRun.updatedAt),
      },
    });
  }

  for (const citation of store.citations) {
    await prisma.citation.create({
      data: {
        id: citation.id, projectId: citation.projectId, aiRunId: citation.aiRunId,
        sourceDocumentId: citation.sourceDocumentId, resourceType: citation.resourceType,
        resourceKey: citation.resourceKey, pageStart: citation.pageStart, pageEnd: citation.pageEnd,
        excerpt: citation.excerpt, confidence: citation.confidence,
      },
    });
  }
}

export async function seedRateSchedules(prisma: PrismaClient, store: BidwrightStore, organizationId: string) {
  for (const schedule of store.rateSchedules ?? []) {
    await prisma.rateSchedule.create({
      data: {
        id: schedule.id, organizationId, name: schedule.name, description: schedule.description,
        category: schedule.category, scope: schedule.scope, defaultMarkup: schedule.defaultMarkup,
        autoCalculate: schedule.autoCalculate, metadata: schedule.metadata as any,
        tiers: {
          create: (store.rateScheduleTiers ?? [])
            .filter((t) => t.scheduleId === schedule.id)
            .map((t) => ({ id: t.id, name: t.name, multiplier: t.multiplier, sortOrder: t.sortOrder })),
        },
        items: {
          create: (store.rateScheduleItems ?? [])
            .filter((i) => i.scheduleId === schedule.id)
            .map((i) => ({
              id: i.id, catalogItemId: i.catalogItemId, code: i.code, name: i.name,
              unit: i.unit, rates: i.rates, costRates: i.costRates, burden: i.burden,
              perDiem: i.perDiem, metadata: i.metadata, sortOrder: i.sortOrder,
            })),
        },
      },
    });
  }
}

export async function seedCustomersAndDepartments(prisma: PrismaClient, organizationId: string) {
  const customers = [
    { id: "cust_metro_health", name: "Metro Health Authority", shortName: "MHA", phone: "(416) 555-0100", email: "procurement@metrohealth.ca", website: "https://metrohealth.ca", addressStreet: "200 University Ave", addressCity: "Toronto", addressProvince: "Ontario", addressPostalCode: "M5H 3C6", addressCountry: "Canada", notes: "Major institutional client. Net-30 terms." },
    { id: "cust_northern_builders", name: "Northern Builders Ltd", shortName: "NBL", phone: "(403) 555-0200", email: "estimating@northernbuilders.ca", website: "https://northernbuilders.ca", addressStreet: "1500 Centre St N", addressCity: "Calgary", addressProvince: "Alberta", addressPostalCode: "T2E 2R8", addressCountry: "Canada", notes: "General contractor. Repeat client since 2019." },
    { id: "cust_greenfield_dev", name: "Greenfield Development Corp", shortName: "GDC", phone: "(604) 555-0300", email: "projects@greenfielddev.com", website: "https://greenfielddev.com", addressStreet: "888 Dunsmuir St, Suite 400", addressCity: "Vancouver", addressProvince: "British Columbia", addressPostalCode: "V6C 3K4", addressCountry: "Canada", notes: "Commercial developer. High-rise and mixed-use projects." },
    { id: "cust_apex_industrial", name: "Apex Industrial Services", shortName: "AIS", phone: "(905) 555-0400", email: "bids@apexindustrial.com", website: "", addressStreet: "45 Industrial Pkwy", addressCity: "Hamilton", addressProvince: "Ontario", addressPostalCode: "L8W 3N6", addressCountry: "Canada", notes: "Industrial maintenance and plant upgrades." },
  ];

  for (const c of customers) {
    await prisma.customer.create({ data: { ...c, organizationId } });
  }

  const contacts = [
    { id: "ccon_smith", customerId: "cust_metro_health", name: "John Smith", title: "Director of Facilities", phone: "(416) 555-0101", email: "john.smith@metrohealth.ca", isPrimary: true },
    { id: "ccon_chen", customerId: "cust_metro_health", name: "Linda Chen", title: "Procurement Manager", phone: "(416) 555-0102", email: "linda.chen@metrohealth.ca", isPrimary: false },
    { id: "ccon_taylor", customerId: "cust_northern_builders", name: "Mike Taylor", title: "Project Manager", phone: "(403) 555-0201", email: "m.taylor@northernbuilders.ca", isPrimary: true },
    { id: "ccon_patel", customerId: "cust_northern_builders", name: "Priya Patel", title: "Estimating Lead", phone: "(403) 555-0202", email: "p.patel@northernbuilders.ca", isPrimary: false },
    { id: "ccon_wong", customerId: "cust_greenfield_dev", name: "David Wong", title: "VP Construction", phone: "(604) 555-0301", email: "d.wong@greenfielddev.com", isPrimary: true },
    { id: "ccon_murphy", customerId: "cust_apex_industrial", name: "Sean Murphy", title: "Plant Manager", phone: "(905) 555-0401", email: "s.murphy@apexindustrial.com", isPrimary: true },
  ];

  for (const c of contacts) {
    await prisma.customerContact.create({ data: c });
  }

  const departments = [
    { id: "dept_mechanical", name: "Mechanical", code: "MECH", description: "Piping, HVAC, plumbing, and mechanical systems" },
    { id: "dept_electrical", name: "Electrical", code: "ELEC", description: "Power distribution, lighting, and controls" },
    { id: "dept_general", name: "General Contracting", code: "GC", description: "General construction and coordination" },
    { id: "dept_precon", name: "Pre-construction", code: "PRECON", description: "Estimating, planning, and value engineering" },
  ];

  for (const d of departments) {
    await prisma.department.create({ data: { ...d, organizationId } });
  }
}

/**
 * Seed all sample data into an organization.
 * This is the main entry point called from both CLI and API.
 */
export async function seedAllForOrganization(prisma: PrismaClient, organizationId: string) {
  await seedEntityCategories(prisma, organizationId);
  await seedSampleProjects(prisma, mockStore, organizationId);
  await seedRateSchedules(prisma, mockStore, organizationId);
  await seedCustomersAndDepartments(prisma, organizationId);
}
