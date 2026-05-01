"use client";

import { useMemo } from "react";
import { Input, Label, Select, Textarea, Toggle } from "@/components/ui";
import type { ManifestField } from "@/lib/api/integrations";

/**
 * Renders an arbitrary set of manifest-declared fields as a form. Pure —
 * the parent owns state. Honors `visibleIf` for conditional fields and
 * passes `credentialKind` markers through so the parent knows which
 * inputs are secrets that must be POSTed to /credentials rather than
 * stored in `config`.
 */
export function ManifestFormFields(props: {
  fields: ManifestField[];
  values: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  /** When true, render secret fields as masked-readonly with a Replace button. */
  secretsAlreadySet?: Record<string, boolean>;
  onResetSecret?: (key: string) => void;
}) {
  const { fields, values, onChange, secretsAlreadySet, onResetSecret } = props;

  const visible = useMemo(() => {
    return fields.filter((f) => {
      if (!f.visibleIf) return true;
      const v = values[f.visibleIf.key];
      return v === f.visibleIf.equals;
    });
  }, [fields, values]);

  return (
    <div className="space-y-4">
      {visible.map((f) => (
        <FieldRow
          key={f.key}
          field={f}
          value={values[f.key]}
          onChange={(v) => onChange(f.key, v)}
          alreadySet={f.type === "secret" ? !!secretsAlreadySet?.[f.key] : false}
          onResetSecret={f.type === "secret" && onResetSecret ? () => onResetSecret(f.key) : undefined}
        />
      ))}
    </div>
  );
}

function FieldRow(props: {
  field: ManifestField;
  value: unknown;
  onChange: (v: unknown) => void;
  alreadySet: boolean;
  onResetSecret?: () => void;
}) {
  const { field, value, onChange, alreadySet, onResetSecret } = props;
  const id = `field-${field.key}`;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <Label htmlFor={id} className="text-fg/80">
          {field.label}
          {field.required ? <span className="text-danger ml-1">*</span> : null}
        </Label>
        {field.type === "secret" && alreadySet && onResetSecret ? (
          <button
            type="button"
            className="text-xs text-fg/60 underline-offset-2 hover:text-fg hover:underline"
            onClick={onResetSecret}
          >
            Replace
          </button>
        ) : null}
      </div>
      <Renderer field={field} value={value} onChange={onChange} alreadySet={alreadySet} id={id} />
      {field.helpText ? <p className="text-xs text-fg/55">{field.helpText}</p> : null}
    </div>
  );
}

function Renderer(props: {
  field: ManifestField;
  value: unknown;
  onChange: (v: unknown) => void;
  alreadySet: boolean;
  id: string;
}) {
  const { field, value, onChange, alreadySet, id } = props;

  switch (field.type) {
    case "string":
    case "url":
    case "email":
      return (
        <Input
          id={id}
          type={field.type === "email" ? "email" : field.type === "url" ? "url" : "text"}
          placeholder={field.placeholder}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "number":
      return (
        <Input
          id={id}
          type="number"
          placeholder={field.placeholder}
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" ? undefined : Number(e.target.value))}
          min={field.min}
          max={field.max}
        />
      );
    case "boolean":
      return (
        <Toggle
          checked={!!value}
          onChange={(v) => onChange(v)}
        />
      );
    case "secret":
      if (alreadySet) {
        return <Input id={id} value="••••••••" readOnly className="font-mono" />;
      }
      return (
        <Input
          id={id}
          type="password"
          autoComplete="off"
          placeholder={field.placeholder ?? "Paste secret"}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "select":
      return (
        <Select
          value={(value as string) ?? ""}
          onValueChange={(v) => onChange(v)}
          options={(field.options ?? []).map((o) => ({ value: o.value, label: o.label }))}
          placeholder={field.placeholder ?? "Select…"}
        />
      );
    case "multiselect":
      return (
        <Input
          id={id}
          placeholder="Comma-separated values"
          value={Array.isArray(value) ? (value as string[]).join(", ") : ""}
          onChange={(e) =>
            onChange(
              e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            )
          }
        />
      );
    case "textarea":
      return (
        <Textarea
          id={id}
          rows={4}
          placeholder={field.placeholder}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "json":
      return (
        <Textarea
          id={id}
          rows={6}
          className="font-mono text-xs"
          placeholder={field.placeholder ?? "{}"}
          value={typeof value === "string" ? value : JSON.stringify(value ?? {}, null, 2)}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "info":
      return (
        <div className="rounded-md border border-line bg-panel2 px-3 py-2 text-sm text-fg/70">
          {(field.helpText ?? field.label)}
        </div>
      );
    default:
      return (
        <Input
          id={id}
          value={(value as string) ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}
