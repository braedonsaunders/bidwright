import assert from "node:assert/strict";
import test from "node:test";

import { Window, type HTMLElement as HappyHTMLElement } from "happy-dom";
import React, { act, useState } from "react";
import { createRoot } from "react-dom/client";
import type { NavigationRegistryItem, TenantNavigationConfig } from "@braedonsaunders/appkit-ui";

import { NavigationConfigEditor } from "./navigation-config-editor";

const registry: NavigationRegistryItem[] = [
  { key: "home", label: "Home", required: true },
  { key: "quotes", label: "Quotes", description: "Prepared proposals" },
  { key: "settings", label: "Settings", required: true },
];

function installDom() {
  const browserWindow = new Window();
  Object.defineProperty(globalThis, "window", { configurable: true, value: browserWindow });
  Object.defineProperty(globalThis, "document", { configurable: true, value: browserWindow.document });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: browserWindow.navigator });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });
  return browserWindow;
}

function orderOf(container: HappyHTMLElement) {
  return [...container.querySelectorAll("[data-nav-key]")].map((row) => (row as HappyHTMLElement).dataset.navKey);
}

function Harness({ onChange }: { onChange?: (config: TenantNavigationConfig) => void }) {
  const [value, setValue] = useState<TenantNavigationConfig | null>(null);
  return (
    <NavigationConfigEditor
      registry={registry}
      value={value}
      onChange={(config) => {
        setValue(config);
        onChange?.(config);
      }}
    />
  );
}

test("move buttons reorder navigation and keep required items visible", async () => {
  const browserWindow = installDom();
  const container = browserWindow.document.createElement("div");
  browserWindow.document.body.append(container);
  const root = createRoot(container as unknown as HTMLDivElement);
  const seen: TenantNavigationConfig[] = [];

  await act(async () => {
    root.render(<Harness onChange={(config) => seen.push(config)} />);
  });

  assert.deepEqual(orderOf(container), ["home", "quotes", "settings"]);

  const moveDown = container.querySelector('[aria-label="Move Home down"]');
  assert.ok(moveDown);
  await act(async () => {
    moveDown.dispatchEvent(new browserWindow.MouseEvent("click", { bubbles: true }));
  });

  assert.deepEqual(orderOf(container), ["quotes", "home", "settings"]);
  assert.deepEqual(seen.at(-1)?.items.map((item) => item.key), ["quotes", "home", "settings"]);
  assert.equal(seen.at(-1)?.items.find((item) => item.key === "home")?.hidden, undefined);

  const hideQuotes = container.querySelector('[aria-label="Quotes: Visible"]');
  assert.ok(hideQuotes);
  await act(async () => {
    hideQuotes.dispatchEvent(new browserWindow.MouseEvent("click", { bubbles: true }));
  });

  assert.equal(seen.at(-1)?.items.find((item) => item.key === "quotes")?.hidden, true);
  assert.equal(container.textContent?.includes("Hidden"), true);

  await act(async () => {
    root.unmount();
  });
});

test("dragging a row past the next one reorders navigation", async () => {
  const browserWindow = installDom();
  const container = browserWindow.document.createElement("div");
  browserWindow.document.body.append(container);
  const root = createRoot(container as unknown as HTMLDivElement);

  await act(async () => {
    root.render(<Harness />);
  });

  const handle = container.querySelector('[aria-label="Drag to reorder Home"]');
  assert.ok(handle);
  await act(async () => {
    handle.dispatchEvent(
      new browserWindow.PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 1,
        clientY: 100,
      }),
    );
  });

  await act(async () => {
    browserWindow.dispatchEvent(
      new browserWindow.PointerEvent("pointermove", {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        clientY: 110,
      }),
    );
  });
  assert.deepEqual(orderOf(container), ["home", "quotes", "settings"]);

  await act(async () => {
    browserWindow.dispatchEvent(
      new browserWindow.PointerEvent("pointermove", {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        clientY: 120,
      }),
    );
  });
  assert.deepEqual(orderOf(container), ["quotes", "home", "settings"]);

  await act(async () => {
    browserWindow.dispatchEvent(
      new browserWindow.PointerEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        clientY: 120,
      }),
    );
  });
  const homeRow = container.querySelector('[data-nav-key="home"]') as HappyHTMLElement | null;
  assert.equal(homeRow?.style.transform, "");

  const settingsHandle = container.querySelector('[aria-label="Drag to reorder Settings"]');
  assert.ok(settingsHandle);
  await act(async () => {
    settingsHandle.dispatchEvent(
      new browserWindow.PointerEvent("pointerdown", {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 2,
        clientY: 300,
      }),
    );
  });
  await act(async () => {
    browserWindow.dispatchEvent(
      new browserWindow.PointerEvent("pointermove", {
        bubbles: true,
        cancelable: true,
        pointerId: 2,
        clientY: 280,
      }),
    );
  });
  assert.deepEqual(orderOf(container), ["quotes", "settings", "home"]);
  await act(async () => {
    browserWindow.dispatchEvent(
      new browserWindow.PointerEvent("pointerup", {
        bubbles: true,
        cancelable: true,
        pointerId: 2,
        clientY: 280,
      }),
    );
  });

  await act(async () => {
    root.unmount();
  });
});
