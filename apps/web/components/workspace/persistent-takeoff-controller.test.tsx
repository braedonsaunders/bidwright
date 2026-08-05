import assert from "node:assert/strict";
import test from "node:test";

import { Window } from "happy-dom";
import React, { act, useEffect } from "react";
import { createRoot } from "react-dom/client";

import { PersistentTakeoffController } from "./persistent-takeoff-controller";

test("the takeoff controller survives detach and merge transitions", async () => {
  const browserWindow = new Window();
  Object.defineProperty(globalThis, "window", { configurable: true, value: browserWindow });
  Object.defineProperty(globalThis, "document", { configurable: true, value: browserWindow.document });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: browserWindow.navigator });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", { configurable: true, value: true });

  let mounts = 0;
  let unmounts = 0;
  function ControllerProbe() {
    useEffect(() => {
      mounts += 1;
      return () => {
        unmounts += 1;
      };
    }, []);
    return <div>loaded model controller</div>;
  }

  const container = browserWindow.document.createElement("div");
  browserWindow.document.body.append(container);
  const root = createRoot(container as unknown as HTMLDivElement);
  const render = async (detached: boolean) => {
    await act(async () => {
      root.render(
        <PersistentTakeoffController detached={detached}>
          <ControllerProbe />
        </PersistentTakeoffController>,
      );
    });
  };

  await render(false);
  await render(true);
  await render(false);

  assert.equal(mounts, 1);
  assert.equal(unmounts, 0);

  await act(async () => root.unmount());
  assert.equal(unmounts, 1);
  browserWindow.close();
});
