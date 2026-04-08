"use client";

type ProjectLike = {
  clientName?: string | null;
};

type QuoteLike = {
  customerName?: string | null;
  customerString?: string | null;
};

export function getClientDisplayName(project?: ProjectLike | null, quote?: QuoteLike | null): string {
  const customerName = quote?.customerName?.trim();
  if (customerName) return customerName;

  const customerString = quote?.customerString?.trim();
  if (customerString) return customerString;

  const projectClient = project?.clientName?.trim();
  if (projectClient) return projectClient;

  return "—";
}
