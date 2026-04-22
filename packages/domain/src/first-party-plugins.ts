import type { Plugin, PluginField, PluginScoringCriterion, PluginToolDefinition } from "./models";
import { mockStore } from "./mock-data";
import { LEGACY_NECA_JOB_CONDITION_CRITERIA, SHOP_WELD_COMPONENTS, SHOP_PIPE_DATA } from "./plugin-calculators";

const pluginMap = new Map(mockStore.plugins.map((plugin) => [plugin.slug, plugin]));

function clonePlugin(slug: string): Plugin {
  const plugin = pluginMap.get(slug);
  if (!plugin) {
    throw new Error(`Missing base plugin: ${slug}`);
  }
  return structuredClone(plugin);
}

function findTool(plugin: Plugin, toolId: string): PluginToolDefinition {
  const tool = plugin.toolDefinitions.find((entry) => entry.id === toolId);
  if (!tool) {
    throw new Error(`Missing tool ${toolId} in ${plugin.slug}`);
  }
  return tool;
}

function findField(tool: PluginToolDefinition, fieldId: string): PluginField {
  for (const section of tool.ui?.sections ?? []) {
    const field = section.fields?.find((entry) => entry.id === fieldId);
    if (field) {
      return field;
    }
  }
  throw new Error(`Missing field ${fieldId} in ${tool.id}`);
}

function replaceField(tool: PluginToolDefinition, fieldId: string, field: PluginField) {
  for (const section of tool.ui?.sections ?? []) {
    if (!section.fields) {
      continue;
    }
    const index = section.fields.findIndex((entry) => entry.id === fieldId);
    if (index >= 0) {
      section.fields[index] = field;
      return;
    }
  }
  throw new Error(`Missing field ${fieldId} in ${tool.id}`);
}

function removeSection(tool: PluginToolDefinition, sectionId: string) {
  if (!tool.ui) {
    return;
  }
  tool.ui.sections = tool.ui.sections.filter((section) => section.id !== sectionId);
}

function upsertParameter(tool: PluginToolDefinition, parameter: PluginToolDefinition["parameters"][number]) {
  const existingIndex = tool.parameters.findIndex((entry) => entry.name === parameter.name);
  if (existingIndex >= 0) {
    tool.parameters[existingIndex] = parameter;
  } else {
    tool.parameters.push(parameter);
  }
}

function replaceServiceItemWithRateSchedule(tool: PluginToolDefinition, fieldId = "serviceItem") {
  const field = findField(tool, fieldId);
  replaceField(tool, fieldId, {
    ...field,
    id: "serviceItemId",
    label: "Labour Rate",
    description: "Select the labour rate schedule item to price these hours against",
    optionsSource: { type: "rate_schedule" },
    validation: { ...(field.validation ?? {}), required: true },
  });

  const existing = tool.parameters.find((entry) => entry.name === fieldId || entry.name === "serviceItemId");
  if (existing) {
    existing.name = "serviceItemId";
    existing.description = "Revision labour rate schedule item ID";
    existing.required = true;
  } else {
    tool.parameters.push({
      name: "serviceItemId",
      type: "string",
      description: "Revision labour rate schedule item ID",
      required: true,
    });
  }
}

function necaCriteria(): PluginScoringCriterion[] {
  return LEGACY_NECA_JOB_CONDITION_CRITERIA.map((criterion) => ({
    id: criterion.id,
    label: criterion.label,
    description: criterion.description,
    weight: 1,
    scale: { min: 0, max: 5, step: 1 },
  }));
}

function buildNecaPlugin(): Plugin {
  const plugin = clonePlugin("neca-labour");

  const labourTool = findTool(plugin, "neca.labourUnits");
  replaceServiceItemWithRateSchedule(labourTool);
  const hoursPerUnitField = findField(labourTool, "hoursPerUnit");
  hoursPerUnitField.computation = {
    formula: "lookup(category, class, subClass)",
    dependencies: ["category", "class", "subClass", "difficulty"],
    format: "number",
    datasetId: "ds-neca-labour",
    lookupColumns: ["category", "class", "subClass"],
    resultColumn: "hourNormal",
    resultColumnFrom: "difficulty",
    resultColumnMap: {
      Normal: "hourNormal",
      Difficult: "hourDifficult",
      "Very Difficult": "hourVeryDifficult",
      Extreme: "hourVeryDifficult",
    },
  };

  const totalHoursField = findField(labourTool, "totalHours");
  totalHoursField.computation = {
    formula: "hoursPerUnit * quantity",
    dependencies: ["hoursPerUnit", "quantity"],
    format: "hours",
  };

  upsertParameter(labourTool, {
    name: "difficulty",
    type: "string",
    description: "Difficulty level to apply to the NECA lookup",
    required: false,
    enum: ["Normal", "Difficult", "Very Difficult", "Extreme"],
    default: "Normal",
  });

  const jobConditionTool = findTool(plugin, "neca.jobCondition");
  if (jobConditionTool.ui?.sections[0]?.scoring) {
    jobConditionTool.ui.sections[0].scoring.criteria = necaCriteria();
    jobConditionTool.ui.sections[0].scoring.description = "Score each factor from 0-5 to determine the NECA difficulty band.";
    jobConditionTool.ui.sections[0].scoring.resultMapping = [
      { minScore: 0, maxScore: 75, label: "Normal", value: "Normal", color: "#22c55e", description: "Standard job conditions" },
      { minScore: 76, maxScore: 134, label: "Difficult", value: "Difficult", color: "#eab308", description: "Elevated field difficulty" },
      { minScore: 135, maxScore: 999, label: "Very Difficult", value: "Very Difficult", color: "#ef4444", description: "Severely constrained productivity" },
    ];
  }

  const temperatureTool = findTool(plugin, "neca.temperature");
  temperatureTool.parameters = [
    { name: "serviceItemId", type: "string", description: "Revision labour rate schedule item ID", required: true },
    { name: "baseHours", type: "number", description: "Base labour hours to adjust", required: true },
    { name: "temperature", type: "number", description: "Ambient temperature", required: true },
    { name: "temperatureUnit", type: "string", description: "Temperature unit", required: false, enum: ["C", "F"], default: "C" },
    { name: "humidity", type: "number", description: "Relative humidity percentage", required: true },
  ];
  temperatureTool.ui = {
    layout: "single",
    submitLabel: "Add Temperature Hours",
    showPreview: true,
    sections: [
      {
        id: "inputs",
        type: "fields",
        label: "Temperature Productivity Adjustment",
        description: "Estimate additional hours caused by ambient heat, cold, and humidity.",
        order: 0,
        fields: [
          { id: "serviceItemId", type: "select", label: "Labour Rate", optionsSource: { type: "rate_schedule" }, validation: { required: true }, width: "full", order: 0 },
          { id: "baseHours", type: "number", label: "Base Hours", validation: { required: true, min: 0 }, width: "third", order: 1 },
          { id: "temperature", type: "number", label: "Temperature", validation: { required: true }, width: "third", order: 2 },
          {
            id: "temperatureUnit",
            type: "select",
            label: "Unit",
            defaultValue: "C",
            width: "third",
            order: 3,
            options: [
              { value: "C", label: "Celsius" },
              { value: "F", label: "Fahrenheit" },
            ],
          },
          { id: "humidity", type: "number", label: "Humidity (%)", validation: { required: true, min: 0, max: 100 }, width: "third", order: 4 },
          {
            id: "lostProductivityPercent",
            type: "computed",
            label: "Lost Productivity",
            computation: {
              formula: "necaTemperatureLostProductivity(temperature, temperatureUnit, humidity)",
              dependencies: ["temperature", "temperatureUnit", "humidity"],
              format: "percentage",
            },
            width: "third",
            order: 5,
          },
          {
            id: "additionalHoursPreview",
            type: "computed",
            label: "Additional Hours",
            computation: {
              formula: "necaTemperatureAdditionalHours(baseHours, temperature, temperatureUnit, humidity)",
              dependencies: ["baseHours", "temperature", "temperatureUnit", "humidity"],
              format: "hours",
            },
            width: "third",
            order: 6,
          },
        ],
      },
    ],
  };

  const durationTool = findTool(plugin, "neca.extendedDuration");
  durationTool.parameters = [
    { name: "serviceItemId", type: "string", description: "Revision labour rate schedule item ID", required: true },
    { name: "baseHours", type: "number", description: "Base labour hours for the scope", required: true },
    { name: "workers", type: "number", description: "Crew size to model against the NECA recommendation", required: false },
    { name: "monthsExtended", type: "number", description: "Months added to the project duration", required: true },
  ];
  durationTool.ui = {
    layout: "single",
    submitLabel: "Add Extended Duration Hours",
    showPreview: true,
    sections: [
      {
        id: "inputs",
        type: "fields",
        label: "Extended Duration Adjustment",
        description: "Model the additional labour hours created by prolonged project duration.",
        order: 0,
        fields: [
          { id: "serviceItemId", type: "select", label: "Labour Rate", optionsSource: { type: "rate_schedule" }, validation: { required: true }, width: "full", order: 0 },
          { id: "baseHours", type: "number", label: "Base Labour Hours", validation: { required: true, min: 0 }, width: "half", order: 1 },
          { id: "workers", type: "number", label: "Crew Size", validation: { min: 1 }, width: "half", order: 2 },
          { id: "monthsExtended", type: "number", label: "Months Extended", validation: { required: true, min: 1, max: 36 }, width: "half", order: 3 },
          {
            id: "recommendedWorkers",
            type: "computed",
            label: "Recommended Crew",
            computation: {
              formula: "necaExtendedRecommendedWorkers(baseHours)",
              dependencies: ["baseHours"],
              format: "number",
            },
            width: "half",
            order: 4,
          },
          {
            id: "additionalHoursPreview",
            type: "computed",
            label: "Additional Hours",
            computation: {
              formula: "necaExtendedAdditionalHours(baseHours, workers, monthsExtended)",
              dependencies: ["baseHours", "workers", "monthsExtended"],
              format: "hours",
            },
            width: "full",
            order: 5,
          },
        ],
      },
    ],
  };

  return plugin;
}

function buildPhccPlugin(): Plugin {
  const plugin = clonePlugin("phcc-labour");
  const labourTool = findTool(plugin, "phcc.labourUnits");
  labourTool.parameters = [
    { name: "category", type: "string", description: "PHCC labour category", required: true },
    { name: "class", type: "string", description: "PHCC labour class", required: true },
    { name: "subClass", type: "string", description: "PHCC labour subclass", required: false },
    { name: "quantity", type: "number", description: "Quantity of units to estimate", required: true },
    {
      name: "difficulty",
      type: "string",
      description: "Difficulty level to apply to the PHCC lookup",
      required: false,
      enum: ["Normal", "Difficult", "Very Difficult", "Extreme"],
      default: "Normal",
    },
    { name: "serviceItemId", type: "string", description: "Revision labour rate schedule item ID", required: true },
  ];
  labourTool.ui = {
    layout: "single",
    submitLabel: "Add Labour Item",
    showPreview: true,
    sections: [
      {
        id: "lookup",
        type: "fields",
        label: "PHCC Labour Lookup",
        description: "Select PHCC category, class, and subclass to find standard hours.",
        order: 0,
        fields: [
          {
            id: "category",
            type: "select",
            label: "Category",
            description: "Primary PHCC labour category",
            placeholder: "Select category...",
            optionsSource: { type: "dataset", datasetId: "ds-phcc-labour", column: "category" },
            validation: { required: true },
            width: "full",
            order: 0,
          },
          {
            id: "class",
            type: "select",
            label: "Class",
            description: "PHCC labour class",
            placeholder: "Select class...",
            optionsSource: {
              type: "cascade",
              datasetId: "ds-phcc-labour",
              column: "class",
              dependsOn: "category",
              parentColumn: "category",
            },
            validation: { required: true },
            width: "full",
            order: 1,
          },
          {
            id: "subClass",
            type: "select",
            label: "Sub-Class",
            description: "Specific PHCC labour subclass",
            placeholder: "Select sub-class...",
            optionsSource: {
              type: "cascade",
              datasetId: "ds-phcc-labour",
              column: "subClass",
              dependsOn: "class",
              parentColumn: "class",
            },
            width: "full",
            order: 2,
          },
          {
            id: "hoursPerUnit",
            type: "computed",
            label: "Hours per Unit",
            description: "Standard PHCC hours for this item",
            computation: {
              formula: "lookup(category, class, subClass)",
              dependencies: ["category", "class", "subClass", "difficulty"],
              format: "number",
              datasetId: "ds-phcc-labour",
              lookupColumns: ["category", "class", "subClass"],
              resultColumn: "hourNormal",
              resultColumnFrom: "difficulty",
              resultColumnMap: {
                Normal: "hourNormal",
                Difficult: "hourDifficult",
                "Very Difficult": "hourVeryDifficult",
                Extreme: "hourVeryDifficult",
              },
            },
            width: "half",
            order: 3,
          },
          {
            id: "quantity",
            type: "number",
            label: "Quantity",
            placeholder: "Enter quantity",
            defaultValue: 1,
            validation: { required: true, min: 0.01 },
            width: "half",
            order: 4,
          },
          {
            id: "difficulty",
            type: "select",
            label: "Difficulty",
            defaultValue: "Normal",
            options: [
              { value: "Normal", label: "Normal", description: "Use standard PHCC hours" },
              { value: "Difficult", label: "Difficult", description: "Use difficult-condition PHCC hours" },
              { value: "Very Difficult", label: "Very Difficult", description: "Use very difficult PHCC hours" },
              { value: "Extreme", label: "Extreme", description: "Use the most conservative PHCC difficulty hours" },
            ],
            width: "half",
            order: 5,
          },
          {
            id: "serviceItemId",
            type: "select",
            label: "Labour Rate",
            description: "Select the labour rate schedule item to price these hours against",
            optionsSource: { type: "rate_schedule" },
            validation: { required: true },
            width: "half",
            order: 6,
          },
          {
            id: "totalHours",
            type: "computed",
            label: "Total Hours",
            computation: {
              formula: "hoursPerUnit * quantity",
              dependencies: ["hoursPerUnit", "quantity"],
              format: "hours",
            },
            width: "full",
            order: 7,
          },
        ],
      },
    ],
  };

  return plugin;
}

function buildMethvinPlugin(): Plugin {
  const plugin = clonePlugin("methvin");
  replaceServiceItemWithRateSchedule(findTool(plugin, "methvin.pipe"));
  replaceServiceItemWithRateSchedule(findTool(plugin, "methvin.fabrication"));
  replaceServiceItemWithRateSchedule(findTool(plugin, "methvin.conduit"));
  return plugin;
}

function buildHomeDepotPlugin(): Plugin {
  const plugin = clonePlugin("home-depot");
  const tool = findTool(plugin, "homedepot.search");
  const searchField = findField(tool, "query");
  searchField.searchConfig = {
    endpoint: "/plugins/helpers/home-depot/search",
    queryParam: "q",
    displayField: "title",
    valueField: "title",
    resultFields: ["vendor", "price", "rating"],
    minQueryLength: 2,
    populateFields: {
      name: "title",
      vendor: "vendor",
      cost: "price",
      description: "title",
    },
  };
  return plugin;
}

function buildGoogleShoppingPlugin(): Plugin {
  const plugin = clonePlugin("google-shopping");
  const tool = findTool(plugin, "google.shopping");
  const searchField = findField(tool, "query");
  searchField.searchConfig = {
    endpoint: "/plugins/helpers/google-shopping/search",
    queryParam: "q",
    displayField: "title",
    valueField: "title",
    resultFields: ["vendor", "price", "rating"],
    minQueryLength: 2,
    populateFields: {
      name: "title",
      vendor: "vendor",
      cost: "price",
      description: "title",
    },
  };
  return plugin;
}

function buildGoogleHotelsPlugin(): Plugin {
  const plugin = clonePlugin("google-hotels");
  const tool = findTool(plugin, "google.hotels");
  removeSection(tool, "results");
  const locationField = findField(tool, "location");
  locationField.type = "search";
  locationField.placeholder = "Search for hotels near the project";
  locationField.searchConfig = {
    endpoint: "/plugins/helpers/google-hotels/search",
    queryParam: "q",
    displayField: "name",
    valueField: "name",
    resultFields: ["price", "rating", "type"],
    minQueryLength: 2,
    params: {
      checkin: "checkin",
      checkout: "checkout",
    },
    populateFields: {
      hotelName: "name",
      nightlyRate: "price",
    },
  };
  return plugin;
}

function buildShopToolsPlugin(): Plugin {
  const pipeOptions = SHOP_PIPE_DATA
    .map((row) => ({ value: String(row.nominalDiameter), label: `${row.nominalDiameter}" (OD ${row.actualSize}")` }))
    .sort((left, right) => Number(left.value) - Number(right.value));
  const shopWeldOptions = SHOP_WELD_COMPONENTS.map((component) => ({
    value: component.id,
    label: component.label,
  }));

  return {
    id: "plugin-shop-tools",
    name: "Shop Pipe & Weld",
    slug: "shop-tools",
    icon: "Factory",
    category: "labour",
    description: "Clean shop-floor labour tools for pipe fabrication and weld prep based on the legacy quoting module.",
    llmDescription: "Use these shop tools when you need shop fabrication or weld-prep labour hours from the legacy quoting workflow. They create labour line items tied to the selected revision rate schedule item.",
    version: "1.0.0",
    author: "Bidwright",
    enabled: true,
    config: {},
    configSchema: [],
    tags: ["shop", "pipe", "weld", "fabrication", "labour"],
    supportedCategories: ["Labour"],
    defaultOutputType: "line_items",
    documentation: "# Shop Pipe & Weld\n\nIncludes a clean shop pipe estimator and a shop weld/prep calculator derived from the legacy quote tools.",
    createdAt: "2026-03-20T00:00:00.000Z",
    updatedAt: "2026-03-20T00:00:00.000Z",
    toolDefinitions: [
      {
        id: "shop.pipe",
        name: "Shop Pipe Manual",
        description: "Estimate shop pipe weld, fit-up, handling, and QA hours from nominal pipe size and weld counts.",
        llmDescription: "Use this tool for estimator-style piping shop hours. It models welds, olets, fit-up, cutting, beveling, and optional QA/heat treatment steps from the legacy shop-pipe calculator.",
        parameters: [
          { name: "serviceItemId", type: "string", description: "Revision labour rate schedule item ID", required: true },
          { name: "description", type: "string", description: "Line item description", required: false },
          { name: "pipeType", type: "string", description: "Pipe material type", required: false, enum: ["carbon", "stainless"], default: "carbon" },
          { name: "efficiencyModifier", type: "number", description: "Crew efficiency percentage", required: false, default: 75 },
        ],
        outputType: "line_items",
        requiresConfirmation: false,
        mutates: true,
        tags: ["shop", "pipe", "fabrication"],
        ui: {
          layout: "single",
          submitLabel: "Add Shop Pipe Hours",
          showPreview: true,
          sections: [
            {
              id: "config",
              type: "fields",
              label: "Shop Pipe Setup",
              order: 0,
              fields: [
                { id: "serviceItemId", type: "select", label: "Labour Rate", optionsSource: { type: "rate_schedule" }, validation: { required: true }, width: "full", order: 0 },
                { id: "description", type: "text", label: "Description", placeholder: "e.g. Shop fabricated carbon steel spool", width: "full", order: 1 },
                {
                  id: "pipeType",
                  type: "radio",
                  label: "Material Type",
                  defaultValue: "carbon",
                  width: "half",
                  order: 2,
                  options: [
                    { value: "carbon", label: "Carbon Steel" },
                    { value: "stainless", label: "Stainless Steel" },
                  ],
                },
                { id: "efficiencyModifier", type: "number", label: "Efficiency Modifier (%)", defaultValue: 75, validation: { min: 1, max: 200 }, width: "half", order: 3 },
                { id: "stressRelief", type: "boolean", label: "Stress Relief", defaultValue: false, width: "third", order: 4 },
                { id: "radiographicInspection", type: "boolean", label: "Radiographic Inspection", defaultValue: false, width: "third", order: 5 },
                { id: "mpiInspection", type: "boolean", label: "MPI Inspection", defaultValue: false, width: "third", order: 6 },
                { id: "preheat", type: "boolean", label: "Preheat", defaultValue: false, width: "third", order: 7 },
                { id: "purge", type: "boolean", label: "Purge", defaultValue: false, width: "third", order: 8 },
                { id: "purgePercentage", type: "number", label: "Purge % of Fit-Up", defaultValue: 20, validation: { min: 0, max: 100 }, width: "third", order: 9 },
                { id: "handlingPercentage", type: "number", label: "Handling % of Weld Time", defaultValue: 10, validation: { min: 0, max: 100 }, width: "third", order: 10 },
              ],
            },
            {
              id: "pipeRows",
              type: "table",
              label: "Pipe Specifications",
              description: "Add one row per pipe size and weld pattern.",
              order: 1,
              table: {
                id: "pipeRows",
                label: "Pipe Rows",
                columns: [
                  { id: "pipeSize", label: "Pipe Size", type: "select", width: "180px", editable: true, options: pipeOptions },
                  {
                    id: "weldType",
                    label: "Weld Type",
                    type: "select",
                    width: "120px",
                    editable: true,
                    options: [
                      { value: "butt", label: "Butt Weld" },
                      { value: "fillet", label: "Fillet Weld" },
                    ],
                  },
                  { id: "weldCount", label: "Welds", type: "number", width: "90px", editable: true, defaultValue: 0, aggregate: "sum" },
                  { id: "oletCount", label: "Olets", type: "number", width: "90px", editable: true, defaultValue: 0, aggregate: "sum" },
                ],
                defaultRows: [{ pipeSize: "", weldType: "butt", weldCount: 0, oletCount: 0 }],
                allowAddRow: true,
                allowDeleteRow: true,
                allowReorder: false,
                totalsRow: true,
                rowTemplate: { pipeSize: "", weldType: "butt", weldCount: 0, oletCount: 0 },
              },
            },
          ],
        },
      },
      {
        id: "shop.weld",
        name: "Shop Weld Prep",
        description: "Calculate welding, drilling, and cleaning man-hours from standard shop tasks.",
        llmDescription: "Use this tool for shop weld prep, hole drilling, fillet welds, and buffing/cleaning. It rounds the result to the nearest quarter hour like the legacy tool.",
        parameters: [
          { name: "serviceItemId", type: "string", description: "Revision labour rate schedule item ID", required: true },
          { name: "description", type: "string", description: "Line item description", required: false },
        ],
        outputType: "line_items",
        requiresConfirmation: false,
        mutates: true,
        tags: ["shop", "weld", "prep"],
        ui: {
          layout: "single",
          submitLabel: "Add Shop Weld Hours",
          showPreview: true,
          sections: [
            {
              id: "config",
              type: "fields",
              label: "Shop Weld Setup",
              order: 0,
              fields: [
                { id: "serviceItemId", type: "select", label: "Labour Rate", optionsSource: { type: "rate_schedule" }, validation: { required: true }, width: "full", order: 0 },
                { id: "description", type: "text", label: "Description", placeholder: "e.g. Tank shell weld prep", width: "full", order: 1 },
              ],
            },
            {
              id: "weldRows",
              type: "table",
              label: "Weld Tasks",
              order: 1,
              table: {
                id: "weldRows",
                label: "Shop Weld Tasks",
                columns: [
                  { id: "taskId", label: "Task", type: "select", width: "260px", editable: true, options: shopWeldOptions },
                  { id: "quantity", label: "Qty / Length", type: "number", width: "100px", editable: true, defaultValue: 0, aggregate: "sum" },
                  { id: "passes", label: "Passes", type: "number", width: "80px", editable: true, defaultValue: 1 },
                  {
                    id: "unit",
                    label: "Unit",
                    type: "select",
                    width: "90px",
                    editable: true,
                    options: [
                      { value: "ft", label: "ft" },
                      { value: "in", label: "in" },
                      { value: "cm", label: "cm" },
                      { value: "m", label: "m" },
                    ],
                  },
                ],
                defaultRows: [{ taskId: "holeDrilling", quantity: 0, passes: 1, unit: "ft" }],
                allowAddRow: true,
                allowDeleteRow: true,
                allowReorder: false,
                totalsRow: true,
                rowTemplate: { taskId: "holeDrilling", quantity: 0, passes: 1, unit: "ft" },
              },
            },
          ],
        },
      },
    ],
  };
}

export const firstPartyPlugins: Plugin[] = [
  buildNecaPlugin(),
  buildPhccPlugin(),
  buildMethvinPlugin(),
  buildShopToolsPlugin(),
  buildHomeDepotPlugin(),
  buildGoogleShoppingPlugin(),
  buildGoogleHotelsPlugin(),
];
