import type { Plugin, PluginField, PluginScoringCriterion, PluginToolDefinition } from "./models";
import { mockStore } from "./mock-data";
import { LEGACY_NECA_JOB_CONDITION_CRITERIA, SHOP_WELD_COMPONENTS, SHOP_PIPE_DATA } from "./plugin-calculators";
import {
  googleHotelsOutputTemplate,
  googleShoppingOutputTemplate,
  homeDepotSearchOutputTemplate,
} from "./plugin-output-templates";

const pluginMap = new Map(mockStore.plugins.map((plugin) => [plugin.slug, plugin]));
const LABOR_RATE_OPTIONS_SOURCE = { type: "rate_schedule", scope: "revision", category: "Labor" } as const;

function americanizeLaborText(value: string | undefined): string {
  return (value ?? "").replaceAll("labour", "labor").replaceAll("Labour", "Labor");
}

function americanizeLaborList(values: string[] | undefined): string[] {
  return (values ?? []).map((value) => americanizeLaborText(value));
}

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
    label: "Labor Rate",
    description: "Select the labor rate schedule item to price these hours against",
    optionsSource: LABOR_RATE_OPTIONS_SOURCE,
    validation: { ...(field.validation ?? {}), required: true },
  });

  const existing = tool.parameters.find((entry) => entry.name === fieldId || entry.name === "serviceItemId");
  if (existing) {
    existing.name = "serviceItemId";
    existing.description = "Revision labor rate schedule item ID";
    existing.required = true;
  } else {
    tool.parameters.push({
      name: "serviceItemId",
      type: "string",
      description: "Revision labor rate schedule item ID",
      required: true,
    });
  }
}

function upsertSectionField(tool: PluginToolDefinition, sectionId: string, field: PluginField) {
  const section = tool.ui?.sections.find((entry) => entry.id === sectionId);
  if (!section?.fields) {
    throw new Error(`Missing section ${sectionId} in ${tool.id}`);
  }

  const existingIndex = section.fields.findIndex((entry) => entry.id === field.id);
  if (existingIndex >= 0) {
    section.fields[existingIndex] = field;
  } else {
    section.fields.unshift(field);
  }
}

function addLabourHierarchySearch(tool: PluginToolDefinition, args: {
  datasetId: string;
  providerLabel: string;
}) {
  upsertSectionField(tool, "lookup", {
    id: "globalSearch",
    type: "search",
    label: `${args.providerLabel} Global Search`,
    description: `Search any ${args.providerLabel} category, class, or sub-class and auto-fill the hierarchy.`,
    placeholder: `Search ${args.providerLabel} class or sub-class...`,
    width: "full",
    order: -1,
    searchConfig: {
      datasetId: args.datasetId,
      displayField: ["subClass", "class", "category"],
      valueField: ["subClass", "class", "category"],
      searchFields: ["class", "subClass", "category"],
      resultFields: ["category", "class", "subClass", "hourNormal"],
      populateFields: {
        category: "category",
        class: "class",
        subClass: "subClass",
      },
      minQueryLength: 1,
    },
  });
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
  plugin.name = "NECA Labor Units";
  plugin.description = "Calculate labor hours using NECA industry standards. Supports Normal, Difficult, and Very Difficult conditions with cascading category/class/subclass lookups.";
  plugin.llmDescription = americanizeLaborText(plugin.llmDescription);
  plugin.documentation = americanizeLaborText(plugin.documentation);
  plugin.tags = americanizeLaborList(plugin.tags);
  plugin.supportedCategories = americanizeLaborList(plugin.supportedCategories);

  const labourTool = findTool(plugin, "neca.labourUnits");
  labourTool.name = "NECA Labor Unit Calculator";
  labourTool.description = "Calculate labor hours from NECA standards by category/class/subclass";
  labourTool.llmDescription = americanizeLaborText(labourTool.llmDescription);
  labourTool.execution = { type: "dataset_labour_units", datasetId: "ds-neca-labour", providerLabel: "NECA" };
  replaceServiceItemWithRateSchedule(labourTool);
  addLabourHierarchySearch(labourTool, {
    datasetId: "ds-neca-labour",
    providerLabel: "NECA",
  });
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
  jobConditionTool.outputType = "revision_patch";
  jobConditionTool.execution = {
    type: "scoring_result_patch",
    scoringId: "necaJobCondition",
    revisionField: "necaDifficulty",
    summaryTitle: "NECA Job Condition",
  };
  if (jobConditionTool.ui?.sections[0]?.scoring) {
    jobConditionTool.ui.sections[0].scoring.criteria = necaCriteria();
    jobConditionTool.ui.sections[0].scoring.description = "Score each factor from 0-5 to determine the NECA difficulty band.";
    jobConditionTool.ui.sections[0].scoring.resultMapping = [
      { minScore: 0, maxScore: 75, label: "Normal", value: "Normal", color: "#22c55e", description: "Standard job conditions" },
      { minScore: 76, maxScore: 134, label: "Difficult", value: "Difficult", color: "#eab308", description: "Elevated field difficulty" },
      { minScore: 135, maxScore: 999, label: "Very Difficult", value: "Very Difficult", color: "#ef4444", description: "Severely constrained productivity" },
    ];
    jobConditionTool.ui.sections[0].scoring.outputEffect = {
      type: "revision_patch",
      revisionField: "necaDifficulty",
    };
  }

  const temperatureTool = findTool(plugin, "neca.temperature");
  temperatureTool.execution = { type: "neca_temperature_adjustment" };
  temperatureTool.parameters = [
    { name: "serviceItemId", type: "string", description: "Revision labor rate schedule item ID", required: true },
    { name: "baseHours", type: "number", description: "Base labor hours to adjust", required: true },
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
          { id: "serviceItemId", type: "select", label: "Labor Rate", optionsSource: LABOR_RATE_OPTIONS_SOURCE, validation: { required: true }, width: "full", order: 0 },
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
  durationTool.execution = { type: "neca_extended_duration" };
  durationTool.parameters = [
    { name: "serviceItemId", type: "string", description: "Revision labor rate schedule item ID", required: true },
    { name: "baseHours", type: "number", description: "Base labor hours for the scope", required: true },
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
        description: "Model the additional labor hours created by prolonged project duration.",
        order: 0,
        fields: [
          { id: "serviceItemId", type: "select", label: "Labor Rate", optionsSource: LABOR_RATE_OPTIONS_SOURCE, validation: { required: true }, width: "full", order: 0 },
          { id: "baseHours", type: "number", label: "Base Labor Hours", validation: { required: true, min: 0 }, width: "half", order: 1 },
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
  plugin.name = "PHCC Labor Units";
  plugin.description = "Calculate plumbing/mechanical labor hours using PHCC standards.";
  plugin.llmDescription = americanizeLaborText(plugin.llmDescription);
  plugin.tags = americanizeLaborList(plugin.tags);
  plugin.supportedCategories = americanizeLaborList(plugin.supportedCategories);
  const labourTool = findTool(plugin, "phcc.labourUnits");
  labourTool.name = "PHCC Labor Calculator";
  labourTool.description = "Calculate labor hours from PHCC standards";
  labourTool.llmDescription = americanizeLaborText(labourTool.llmDescription);
  labourTool.execution = { type: "dataset_labour_units", datasetId: "ds-phcc-labour", providerLabel: "PHCC" };
  addLabourHierarchySearch(labourTool, {
    datasetId: "ds-phcc-labour",
    providerLabel: "PHCC",
  });
  labourTool.parameters = [
    { name: "category", type: "string", description: "PHCC labor category", required: true },
    { name: "class", type: "string", description: "PHCC labor class", required: true },
    { name: "subClass", type: "string", description: "PHCC labor subclass", required: false },
    { name: "quantity", type: "number", description: "Quantity of units to estimate", required: true },
    {
      name: "difficulty",
      type: "string",
      description: "Difficulty level to apply to the PHCC lookup",
      required: false,
      enum: ["Normal", "Difficult", "Very Difficult", "Extreme"],
      default: "Normal",
    },
    { name: "serviceItemId", type: "string", description: "Revision labor rate schedule item ID", required: true },
  ];
  labourTool.ui = {
    layout: "single",
    submitLabel: "Add Labor Item",
    showPreview: true,
    sections: [
      {
        id: "lookup",
        type: "fields",
        label: "PHCC Labor Lookup",
        description: "Select PHCC category, class, and subclass to find standard hours.",
        order: 0,
        fields: [
          {
            id: "category",
            type: "select",
            label: "Category",
            description: "Primary PHCC labor category",
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
            description: "PHCC labor class",
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
            description: "Specific PHCC labor subclass",
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
            label: "Labor Rate",
            description: "Select the labor rate schedule item to price these hours against",
            optionsSource: LABOR_RATE_OPTIONS_SOURCE,
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
  const pipeTool = findTool(plugin, "methvin.pipe");
  pipeTool.execution = {
    type: "table_hours",
    tableId: "weldComponents",
    totalField: "totalMH",
    quantityField: "quantity",
    rateField: "mhPerUnit",
    multiplierField: "efficiencyModifier",
    defaultMultiplier: 1,
    descriptionDefault: "Methvin pipe welding",
  };
  replaceServiceItemWithRateSchedule(pipeTool);

  const fabricationTool = findTool(plugin, "methvin.fabrication");
  fabricationTool.execution = {
    type: "table_hours",
    tableId: "fabTasks",
    totalField: "totalHours",
    quantityField: "quantity",
    rateField: "hoursPerUnit",
    descriptionDefault: "Methvin fabrication",
  };
  replaceServiceItemWithRateSchedule(fabricationTool);

  const conduitTool = findTool(plugin, "methvin.conduit");
  conduitTool.execution = {
    type: "table_hours",
    tableId: "cableRuns",
    totalField: "totalMH",
    quantityField: "distance",
    rateField: "mhPerFoot",
    descriptionDefault: "Methvin conduit & cable",
  };
  replaceServiceItemWithRateSchedule(conduitTool);
  return plugin;
}

function buildHomeDepotPlugin(): Plugin {
  const plugin = clonePlugin("home-depot");
  const tool = findTool(plugin, "homedepot.search");
  tool.outputTemplate = homeDepotSearchOutputTemplate;
  const searchField = findField(tool, "query");
  searchField.searchConfig = {
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
    dataSource: {
      type: "http-json",
      url: "https://serpapi.com/search.json",
      query: {
        engine: "home_depot",
        api_key: { from: "config", key: "apiKey", env: "SERPAPI_API_KEY", required: true, label: "SerpAPI key" },
        q: { from: "query", key: "q", required: true, label: "Search query" },
        country: { from: "config", key: "country", env: "SERPAPI_HOME_DEPOT_COUNTRY", default: "us" },
        store_id: { from: "config", key: "storeId", env: "SERPAPI_HOME_DEPOT_STORE_ID" },
        delivery_zip: { from: "config", key: "deliveryZip", env: "SERPAPI_HOME_DEPOT_DELIVERY_ZIP" },
        ps: { from: "limit", default: 10, max: 24 },
      },
      resultPaths: ["products", "search_results", "organic_results"],
      resultDefaults: { vendor: "Home Depot" },
      resultMap: {
        id: ["product_id", "item_id", "model_number", "link"],
        product_id: ["product_id", "item_id"],
        title: ["title", "name"],
        price: ["extracted_price", "price"],
        rating: "rating",
        thumbnail: ["thumbnail", "image", "thumbnails"],
        link: ["link", "product_link"],
        brand: "brand",
        model: ["model_number", "model"],
      },
      resultTypes: { price: "number", rating: "number", thumbnail: "image" },
      dedupeFields: ["product_id", "link", "title"],
    },
  };
  return plugin;
}

function buildGoogleShoppingPlugin(): Plugin {
  const plugin = clonePlugin("google-shopping");
  const tool = findTool(plugin, "google.shopping");
  tool.outputTemplate = googleShoppingOutputTemplate;
  const searchField = findField(tool, "query");
  searchField.searchConfig = {
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
    dataSource: {
      type: "http-json",
      url: "https://serpapi.com/search.json",
      query: {
        engine: "google_shopping",
        api_key: { from: "config", key: "apiKey", env: "SERPAPI_API_KEY", required: true, label: "SerpAPI key" },
        q: { from: "query", key: "q", required: true, label: "Search query" },
        gl: { from: "config", key: "gl", env: "SERPAPI_GL", default: "us" },
        hl: { from: "config", key: "hl", env: "SERPAPI_HL", default: "en" },
        location: { from: "config", key: "location", env: "SERPAPI_GOOGLE_LOCATION" },
        google_domain: { from: "config", key: "googleDomain", env: "SERPAPI_GOOGLE_DOMAIN" },
        num: { from: "limit", default: 10, max: 20 },
      },
      resultPaths: [
        "shopping_results",
        "inline_shopping_results",
        "organic_results",
        "categorized_shopping_results.*.shopping_results",
        "categorized_shopping_results.*.products",
      ],
      resultMap: {
        id: ["product_id", "position", "product_link", "link"],
        product_id: "product_id",
        title: "title",
        vendor: ["source", "seller", "vendor"],
        price: ["extracted_price", "price"],
        rating: "rating",
        thumbnail: ["thumbnail", "serpapi_thumbnail", "thumbnails"],
        link: ["product_link", "link"],
        delivery: "delivery",
      },
      resultTypes: { price: "number", rating: "number", thumbnail: "image" },
      dedupeFields: ["product_id", "link", "title"],
    },
  };
  return plugin;
}

function buildGoogleHotelsPlugin(): Plugin {
  const plugin = clonePlugin("google-hotels");
  const tool = findTool(plugin, "google.hotels");
  tool.outputTemplate = googleHotelsOutputTemplate;
  removeSection(tool, "results");
  const locationField = findField(tool, "location");
  locationField.type = "search";
  locationField.placeholder = "Search for hotels near the project";
  locationField.searchConfig = {
    queryParam: "q",
    displayField: "name",
    valueField: "name",
    resultFields: ["price", "rating", "type"],
    minQueryLength: 2,
    params: {
      checkin: "checkin",
      checkout: "checkout",
      adults: "crewSize",
    },
    populateFields: {
      hotelName: "name",
      nightlyRate: "price",
    },
    dataSource: {
      type: "http-json",
      url: "https://serpapi.com/search.json",
      query: {
        engine: "google_hotels",
        api_key: { from: "config", key: "apiKey", env: "SERPAPI_API_KEY", required: true, label: "SerpAPI key" },
        q: { from: "query", key: "q", required: true, label: "Hotel search" },
        gl: { from: "config", key: "gl", env: "SERPAPI_GL", default: "us" },
        hl: { from: "config", key: "hl", env: "SERPAPI_HL", default: "en" },
        currency: { from: "config", key: "currency", env: "SERPAPI_CURRENCY", default: "USD" },
        check_in_date: { from: "field", key: "checkin", required: true, label: "Check-in date" },
        check_out_date: { from: "field", key: "checkout", required: true, label: "Check-out date" },
        adults: { from: "field", key: "adults", default: "2" },
        children: { from: "config", key: "children", env: "SERPAPI_HOTELS_CHILDREN", default: "0" },
      },
      resultPaths: ["properties", "ads", "hotel_results", "hotels_results", "$"],
      resultMap: {
        id: ["property_token", "hotel_id", "name"],
        property_token: "property_token",
        name: ["name", "title"],
        price: [
          "rate_per_night.extracted_lowest",
          "rate_per_night.extracted_price",
          "total_rate.extracted_lowest",
          "total_rate.extracted_price",
          "extracted_price",
          "price",
        ],
        rating: ["overall_rating", "rating"],
        type: "type",
        vendor: ["source", "brand"],
        thumbnail: "thumbnail",
        link: ["link", "serpapi_property_details_link"],
        address: "address",
      },
      resultTypes: { price: "number", rating: "number", thumbnail: "image" },
      dedupeFields: ["property_token", "link", "name"],
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
    description: "Clean shop-floor labor tools for pipe fabrication and weld prep based on the legacy quoting module.",
    llmDescription: "Use these shop tools when you need shop fabrication or weld-prep labor hours from the legacy quoting workflow. They create labor line items tied to the selected revision rate schedule item.",
    version: "1.0.0",
    author: "Bidwright",
    enabled: true,
    config: {},
    configSchema: [],
    tags: ["shop", "pipe", "weld", "fabrication", "labor"],
    supportedCategories: ["Labor"],
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
          { name: "serviceItemId", type: "string", description: "Revision labor rate schedule item ID", required: true },
          { name: "description", type: "string", description: "Line item description", required: false },
          { name: "pipeType", type: "string", description: "Pipe material type", required: false, enum: ["carbon", "stainless"], default: "carbon" },
          { name: "efficiencyModifier", type: "number", description: "Crew efficiency percentage", required: false, default: 75 },
        ],
        outputType: "line_items",
        execution: { type: "shop_pipe_estimate", tableId: "pipeRows", descriptionDefault: "Shop pipe fabrication" },
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
                { id: "serviceItemId", type: "select", label: "Labor Rate", optionsSource: LABOR_RATE_OPTIONS_SOURCE, validation: { required: true }, width: "full", order: 0 },
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
          { name: "serviceItemId", type: "string", description: "Revision labor rate schedule item ID", required: true },
          { name: "description", type: "string", description: "Line item description", required: false },
        ],
        outputType: "line_items",
        execution: { type: "shop_weld_estimate", tableId: "weldRows", descriptionDefault: "Shop weld prep" },
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
                { id: "serviceItemId", type: "select", label: "Labor Rate", optionsSource: LABOR_RATE_OPTIONS_SOURCE, validation: { required: true }, width: "full", order: 0 },
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
