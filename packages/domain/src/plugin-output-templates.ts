import type { PluginToolOutputTemplate } from "./models";

export function materialSearchOutputTemplate(args: {
  title: string;
  defaultVendor: string;
  validationMessage: string;
  displayText: string;
}): PluginToolOutputTemplate {
  return {
    type: "line_items",
    validation: [
      { field: "name", rule: "required", message: args.validationMessage },
      { field: "cost", rule: "positive", message: args.validationMessage },
    ],
    lineItems: [
      {
        category: "Material",
        entityType: "Material",
        entityName: { from: "input", key: "name", type: "string" },
        vendor: { from: "input", key: "vendor", type: "string", default: args.defaultVendor },
        description: {
          first: [
            { from: "input", key: "description", type: "string" },
            { from: "input", key: "name", type: "string" },
          ],
        },
        quantity: { from: "input", key: "quantity", type: "number", default: 1, min: 1 },
        uom: "EA",
        cost: { from: "input", key: "cost", type: "number" },
        markup: { from: "input", key: "markup", type: "number", default: 15 },
        price: 0,
        unit1: 0,
        unit2: 0,
        unit3: 0,
      },
    ],
    summary: {
      title: args.title,
      sections: [
        {
          label: "Vendor",
          value: { from: "input", key: "vendor", type: "string", default: args.defaultVendor },
          format: "text",
        },
        { label: "Unit Cost", value: { from: "input", key: "cost", type: "number" }, format: "currency" },
      ],
    },
    displayText: { template: args.displayText },
  };
}

export const homeDepotSearchOutputTemplate = materialSearchOutputTemplate({
  title: "Home Depot Search",
  defaultVendor: "Home Depot",
  validationMessage: "Select or enter a Home Depot product with a unit cost before adding it.",
  displayText: "Prepared material pricing for {{name}}.",
});

export const googleShoppingOutputTemplate = materialSearchOutputTemplate({
  title: "Google Shopping",
  defaultVendor: "Google Shopping",
  validationMessage: "Select or enter a Google Shopping result with a unit cost before adding it.",
  displayText: "Prepared comparison pricing for {{name}}.",
});

export const googleHotelsOutputTemplate: PluginToolOutputTemplate = {
  type: "line_items",
  validation: [
    {
      value: {
        first: [
          { from: "input", key: "hotelName", type: "string" },
          { from: "input", key: "location", type: "string" },
        ],
      },
      rule: "required",
      message: "Select a hotel before adding travel costs.",
    },
    {
      field: "totalCost",
      rule: "positive",
      message: "Select a hotel and confirm the nightly rate before adding travel costs.",
    },
  ],
  lineItems: [
    {
      category: "Travel & Per Diem",
      entityType: "Travel",
      entityName: {
        first: [
          { from: "input", key: "hotelName", type: "string" },
          { from: "input", key: "location", type: "string" },
        ],
      },
      vendor: { from: "input", key: "vendor", type: "string", default: "Hotel" },
      description: {
        join: [
          { from: "input", key: "hotelName", type: "string" },
          { from: "input", key: "location", type: "string" },
        ],
        separator: " - ",
      },
      quantity: 1,
      uom: "EA",
      cost: { from: "input", key: "totalCost", type: "number" },
      markup: { from: "input", key: "markup", type: "number", default: 15 },
      price: 0,
      unit1: { from: "input", key: "nights", type: "number", default: 0, min: 0 },
      unit2: { from: "input", key: "crewSize", type: "number", default: 1, min: 1 },
      unit3: 0,
    },
  ],
  summary: {
    title: "Google Hotels",
    sections: [
      { label: "Nights", value: { from: "input", key: "nights", type: "number", default: 0 }, format: "number" },
      { label: "Crew Size", value: { from: "input", key: "crewSize", type: "number", default: 1, min: 1 }, format: "number" },
      { label: "Total Cost", value: { from: "input", key: "totalCost", type: "number" }, format: "currency" },
    ],
  },
  displayText: {
    template: "Prepared travel costs for {{hotelName}}.",
  },
};
