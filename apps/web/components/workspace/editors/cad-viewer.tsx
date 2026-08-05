"use client";

import { useEffect, useRef, useState, useCallback, type MutableRefObject } from "react";
import { Loader2, Maximize2, Box, AlertCircle, RotateCcw } from "lucide-react";
import {
  Button,
} from "@appkit/ui";
import { cn } from "@/lib/utils";
import { prepareModelViewer, type ModelViewerSession } from "@/lib/api";
import { firstAutodeskSelectedDbId } from "@/lib/autodesk-viewer-selection";

type CadViewerState = "loading" | "ready" | "error";

interface CadViewerProps {
  fileUrl?: string;
  fileName?: string;
  className?: string;
  /** Fires on IFC click. expressID -1 means "miss / background". */
  onIfcElementSelect?: (selection: { expressID: number; elementClass: string }) => void;
  /** Fires when hosted model geometry is selected. externalId maps directly
   *  to the indexed ModelElement.externalId. null means the selection cleared. */
  onModelElementSelect?: (selection: { externalId: string } | null) => void;
  actionsRef?: MutableRefObject<CadViewerActions | null>;
  /** Fires once the active viewer has loaded enough geometry to accept
   *  navigation commands. Detached takeoff windows use this to replay a
   *  focus/orbit command that arrived while the model was still loading. */
  onActionsReady?: (actions: CadViewerActions) => void;
  displayMode?: CadViewerDisplayMode;
  showGrid?: boolean;
  autoRotate?: boolean;
  showOverlayToolbar?: boolean;
  projectId?: string;
  sourceKind?: "source_document" | "file_node";
  sourceId?: string;
}

export type CadViewerDisplayMode = "shaded" | "wireframe" | "xray";
export type CadViewerStandardView = "iso" | "top" | "front" | "right";

export interface CadViewerActions {
  fitToContent: () => void;
  resetView: () => void;
  setStandardView: (view: CadViewerStandardView) => void;
  setGridVisible: (visible: boolean) => void;
  setDisplayMode: (mode: CadViewerDisplayMode) => void;
  setAutoRotate: (enabled: boolean) => void;
  selectElement: (externalId: string | null) => void;
  focusElement: (externalId: string) => void;
  selectElements: (externalIds: string[]) => void;
  focusElements: (externalIds: string[]) => void;
  orbitElements: (externalIds: string[]) => void;
  stopOrbit: () => void;
}

/* ─── Supported format detection ─── */

const STEP_EXTS = new Set(["step", "stp", "iges", "igs", "brep"]);
const MESH_EXTS = new Set(["stl", "obj", "fbx", "gltf", "glb", "3ds", "dae"]);
const IFC_EXTS = new Set(["ifc"]);
const DXF_EXTS = new Set(["dxf", "dwg"]);
const NAVISWORKS_EXTS = new Set(["nwd", "nwf", "nwc"]);

function getFileExt(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

type FileCategory = "step" | "mesh" | "ifc" | "dxf" | "navisworks" | "unknown";

function categorizeFile(name: string): FileCategory {
  const ext = getFileExt(name);
  if (STEP_EXTS.has(ext)) return "step";
  if (MESH_EXTS.has(ext)) return "mesh";
  if (IFC_EXTS.has(ext)) return "ifc";
  if (DXF_EXTS.has(ext)) return "dxf";
  if (NAVISWORKS_EXTS.has(ext)) return "navisworks";
  return "unknown";
}

let autodeskViewerSdkPromise: Promise<any> | null = null;

function loadAutodeskViewerSdk(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject(new Error("The Autodesk Viewer requires a browser."));
  const existing = (window as any).Autodesk?.Viewing;
  if (existing) return Promise.resolve(existing);
  if (autodeskViewerSdkPromise) return autodeskViewerSdkPromise;

  autodeskViewerSdkPromise = new Promise((resolve, reject) => {
    if (!document.querySelector('link[data-bidwright-autodesk-viewer="true"]')) {
      const stylesheet = document.createElement("link");
      stylesheet.rel = "stylesheet";
      stylesheet.href = "https://developer.api.autodesk.com/modelderivative/v2/viewers/7.*/style.min.css";
      stylesheet.dataset.bidwrightAutodeskViewer = "true";
      document.head.appendChild(stylesheet);
    }
    const prior = document.querySelector('script[data-bidwright-autodesk-viewer="true"]') as HTMLScriptElement | null;
    const script = prior ?? document.createElement("script");
    const onReady = () => {
      const viewing = (window as any).Autodesk?.Viewing;
      if (viewing) resolve(viewing);
      else reject(new Error("Autodesk Viewer loaded without its runtime API."));
    };
    script.addEventListener("load", onReady, { once: true });
    script.addEventListener("error", () => reject(new Error("Could not load the Autodesk Viewer SDK.")), { once: true });
    if (!prior) {
      script.src = "https://developer.api.autodesk.com/modelderivative/v2/viewers/7.*/viewer3D.min.js";
      script.async = true;
      script.dataset.bidwrightAutodeskViewer = "true";
      document.head.appendChild(script);
    }
  }).catch((error) => {
    autodeskViewerSdkPromise = null;
    throw error;
  });
  return autodeskViewerSdkPromise;
}

function delay(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

/* ─── Three.js scene setup (lazy loaded) ─── */

async function createScene(container: HTMLDivElement) {
  const THREE = await import("three");
  const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);

  // Grid
  const grid = new THREE.GridHelper(20, 20, 0x303050, 0x252540);
  grid.name = "scene-grid";
  scene.add(grid);

  // Lights
  const ambient = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambient);
  const dir1 = new THREE.DirectionalLight(0xffffff, 0.8);
  dir1.position.set(5, 10, 7);
  scene.add(dir1);
  const dir2 = new THREE.DirectionalLight(0x8888ff, 0.3);
  dir2.position.set(-5, 5, -5);
  scene.add(dir2);

  // Camera
  const camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.01, 1000);
  camera.position.set(5, 5, 5);
  camera.lookAt(0, 0, 0);

  // Renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.appendChild(renderer.domElement);

  // Controls
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;

  // Animation loop
  let animId = 0;
  function animate() {
    animId = requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  // Resize handler
  const ro = new ResizeObserver(() => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w > 0 && h > 0) {
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }
  });
  ro.observe(container);

  function contentBox() {
    const box = new THREE.Box3();
    let hasContent = false;
    scene.traverse((object: any) => {
      if (object.name === "scene-grid" || !object.isMesh) return;
      box.expandByObject(object);
      hasContent = true;
    });
    return hasContent ? box : new THREE.Box3().setFromObject(scene);
  }

  function setCameraView(view: CadViewerStandardView) {
    const box = contentBox();
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    if (size.length() === 0) return;
    const maxDim = Math.max(size.x, size.y, size.z, 1);
    const dist = maxDim * 2;
    controls.target.copy(center);
    if (view === "top") {
      camera.position.set(center.x, center.y + dist, center.z + 0.001);
    } else if (view === "front") {
      camera.position.set(center.x, center.y + dist * 0.15, center.z + dist);
    } else if (view === "right") {
      camera.position.set(center.x + dist, center.y + dist * 0.15, center.z);
    } else {
      camera.position.set(center.x + dist * 0.5, center.y + dist * 0.5, center.z + dist * 0.5);
    }
    camera.lookAt(center);
    controls.update();
  }

  function setDisplayMode(mode: CadViewerDisplayMode) {
    scene.traverse((object: any) => {
      if (!object.isMesh || !object.material) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material: any) => {
        material.wireframe = mode === "wireframe";
        material.transparent = mode === "xray";
        material.opacity = mode === "xray" ? 0.32 : 1;
        material.depthWrite = mode !== "xray";
        material.needsUpdate = true;
      });
    });
  }

  const highlightedMaterials = new Map<any, any>();
  let scopeOrbitFrame = 0;
  const externalIdForObject = (object: any): string | null => {
    let current = object;
    while (current) {
      const externalId = current.userData?.modelExternalId;
      if (typeof externalId === "string" && externalId) return externalId;
      current = current.parent;
    }
    return null;
  };

  function clearElementHighlight() {
    const replacements = new Set<any>();
    for (const [object, originalMaterial] of highlightedMaterials) {
      const active = Array.isArray(object.material) ? object.material : [object.material];
      active.forEach((material: any) => {
        const originals = Array.isArray(originalMaterial) ? originalMaterial : [originalMaterial];
        if (!originals.includes(material)) replacements.add(material);
      });
      object.material = originalMaterial;
    }
    highlightedMaterials.clear();
    replacements.forEach((material) => material?.dispose?.());
  }

  function stopOrbit() {
    if (scopeOrbitFrame) cancelAnimationFrame(scopeOrbitFrame);
    scopeOrbitFrame = 0;
  }

  function selectElements(externalIds: string[]) {
    clearElementHighlight();
    const selected = new Set(externalIds.filter(Boolean));
    if (selected.size === 0) return;
    const dimmedMaterial = new THREE.MeshBasicMaterial({
      color: 0x64748b,
      transparent: true,
      opacity: 0.12,
      depthWrite: false,
    });
    scene.traverse((object: any) => {
      if (!object.isMesh || !externalIdForObject(object) || !object.material) return;
      const originalMaterial = object.material;
      highlightedMaterials.set(object, originalMaterial);
      if (!selected.has(externalIdForObject(object) ?? "")) {
        object.material = Array.isArray(originalMaterial)
          ? originalMaterial.map(() => dimmedMaterial)
          : dimmedMaterial;
        return;
      }
      const originals = Array.isArray(originalMaterial) ? originalMaterial : [originalMaterial];
      const highlighted = originals.map((material: any) => {
        const clone = material.clone();
        if (clone.emissive?.setHex) {
          clone.emissive.setHex(0x2563eb);
          clone.emissiveIntensity = 0.75;
        } else if (clone.color?.lerp) {
          clone.color.lerp(new THREE.Color(0x60a5fa), 0.65);
        }
        clone.needsUpdate = true;
        return clone;
      });
      object.material = Array.isArray(originalMaterial) ? highlighted : highlighted[0];
    });
  }

  function selectElement(externalId: string | null) {
    selectElements(externalId ? [externalId] : []);
  }

  function focusElements(externalIds: string[]) {
    stopOrbit();
    const selected = new Set(externalIds.filter(Boolean));
    selectElements(Array.from(selected));
    const box = new THREE.Box3();
    let found = false;
    scene.traverse((object: any) => {
      if (!object.isMesh || !selected.has(externalIdForObject(object) ?? "")) return;
      box.expandByObject(object);
      found = true;
    });
    if (!found || box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 0.1);
    const direction = camera.position.clone().sub(controls.target);
    if (direction.lengthSq() < 0.0001) direction.set(1, 0.65, 1);
    direction.normalize();
    const endTarget = center.clone();
    const endPosition = center.clone().add(direction.multiplyScalar(maxDim * 2.4));
    const startTarget = controls.target.clone();
    const startPosition = camera.position.clone();
    const startedAt = performance.now();
    const duration = 420;
    const animate = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      controls.target.lerpVectors(startTarget, endTarget, eased);
      camera.position.lerpVectors(startPosition, endPosition, eased);
      camera.lookAt(controls.target);
      controls.update();
      if (progress < 1) requestAnimationFrame(animate);
    };
    requestAnimationFrame(animate);
  }

  function focusElement(externalId: string) {
    focusElements([externalId]);
  }

  function orbitElements(externalIds: string[]) {
    focusElements(externalIds);
    const selected = new Set(externalIds.filter(Boolean));
    const box = new THREE.Box3();
    let found = false;
    scene.traverse((object: any) => {
      if (!object.isMesh || !selected.has(externalIdForObject(object) ?? "")) return;
      box.expandByObject(object);
      found = true;
    });
    if (!found || box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const radius = Math.max(size.x, size.z, size.y * 0.6, 0.5) * 2.2;
    const height = center.y + Math.max(size.y, radius * 0.25);
    const startedAt = performance.now();
    const step = (now: number) => {
      const angle = ((now - startedAt) / 12_000) * Math.PI * 2;
      controls.target.copy(center);
      camera.position.set(center.x + Math.cos(angle) * radius, height, center.z + Math.sin(angle) * radius);
      camera.lookAt(center);
      controls.update();
      scopeOrbitFrame = requestAnimationFrame(step);
    };
    scopeOrbitFrame = requestAnimationFrame(step);
  }

  return {
    scene,
    camera,
    renderer,
    controls,
    THREE,
    fitToContent: () => {
      const box = contentBox();
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());

      if (size.length() === 0) return;

      controls.target.copy(center);
      const maxDim = Math.max(size.x, size.y, size.z, 1);
      const dist = maxDim * 2;
      camera.position.set(center.x + dist * 0.5, center.y + dist * 0.5, center.z + dist * 0.5);
      camera.lookAt(center);
      controls.update();
    },
    resetView: () => {
      controls.target.set(0, 0, 0);
      camera.position.set(5, 5, 5);
      camera.lookAt(0, 0, 0);
      controls.update();
    },
    setStandardView: setCameraView,
    setGridVisible: (visible: boolean) => {
      grid.visible = visible;
    },
    setDisplayMode,
    setAutoRotate: (enabled: boolean) => {
      controls.autoRotate = enabled;
      controls.autoRotateSpeed = 1.4;
    },
    selectElement,
    focusElement,
    selectElements,
    focusElements,
    orbitElements,
    stopOrbit,
    externalIdForObject,
    dispose: () => {
      clearElementHighlight();
      stopOrbit();
      cancelAnimationFrame(animId);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

/* ─── Loaders ─── */

function toFloat32AttributeArray(input: unknown): Float32Array {
  if (input instanceof Float32Array) return input;
  if (ArrayBuffer.isView(input) || Array.isArray(input)) {
    return new Float32Array(input as ArrayLike<number>);
  }
  return new Float32Array();
}

function toIndexAttributeArray(input: unknown, vertexCount: number): Uint16Array | Uint32Array | null {
  if (!ArrayBuffer.isView(input) && !Array.isArray(input)) return null;
  const source = input as ArrayLike<number>;
  if (source.length === 0) return null;
  let needsUint32 = vertexCount > 65535;
  if (!needsUint32) {
    for (let i = 0; i < source.length; i += 1) {
      if (Number(source[i]) > 65535) {
        needsUint32 = true;
        break;
      }
    }
  }
  return needsUint32 ? new Uint32Array(source) : new Uint16Array(source);
}

async function loadSTEP(
  sceneCtx: Awaited<ReturnType<typeof createScene>>,
  data: ArrayBuffer,
) {
  // @ts-expect-error -- no type declarations for occt-import-js
  const occtImportJs = await import("occt-import-js");
  const occt = await (occtImportJs as any).default({
    locateFile: (path: string) => `/wasm/${path}`,
  });

  const buffer = new Uint8Array(data);
  const result = occt.ReadStepFile(buffer, null);
  if (!result?.meshes?.length) {
    throw new Error("The STEP/IGES importer did not return any mesh geometry.");
  }

  const { THREE, scene } = sceneCtx;
  const group = new THREE.Group();

  for (const mesh of result.meshes) {
    const positions = toFloat32AttributeArray(mesh.attributes?.position?.array);
    if (positions.length < 3) continue;
    const vertexCount = positions.length / 3;
    const normals = toFloat32AttributeArray(mesh.attributes?.normal?.array);
    const indices = toIndexAttributeArray(mesh.index?.array, vertexCount);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    if (normals.length === positions.length) {
      geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    } else {
      geo.computeVertexNormals();
    }
    if (indices) {
      geo.setIndex(new THREE.BufferAttribute(indices, 1));
    }
    geo.computeBoundingBox();

    let color = 0x6699cc;
    if (mesh.color) {
      color = new THREE.Color(mesh.color[0], mesh.color[1], mesh.color[2]).getHex();
    }

    const mat = new THREE.MeshPhongMaterial({
      color,
      side: THREE.DoubleSide,
      flatShading: normals.length !== positions.length,
    });
    const obj = new THREE.Mesh(geo, mat);
    obj.userData.modelExternalId = `occt-mesh-${group.children.length}`;
    group.add(obj);
  }

  if (group.children.length === 0) {
    throw new Error("The STEP/IGES importer returned mesh records without drawable geometry.");
  }

  scene.add(group);
  sceneCtx.fitToContent();
}

async function loadMesh(
  sceneCtx: Awaited<ReturnType<typeof createScene>>,
  data: ArrayBuffer,
  ext: string,
) {
  const { THREE, scene } = sceneCtx;

  if (ext === "stl") {
    const { STLLoader } = await import("three/examples/jsm/loaders/STLLoader.js");
    const loader = new STLLoader();
    const geo = loader.parse(data);
    geo.computeVertexNormals();
    const mat = new THREE.MeshPhongMaterial({ color: 0x6699cc, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.modelExternalId = "STL_MESH";
    scene.add(mesh);
  } else if (ext === "obj") {
    const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js");
    const loader = new OBJLoader();
    const text = new TextDecoder().decode(data);
    const obj = loader.parse(text);
    obj.userData.modelExternalId = "default";
    obj.traverse((child: any) => {
      if (child.name) child.userData.modelExternalId = child.name;
      if (child.isMesh) {
        child.material = new THREE.MeshPhongMaterial({ color: 0x6699cc, side: THREE.DoubleSide });
      }
    });
    scene.add(obj);
  } else if (ext === "fbx") {
    const { FBXLoader } = await import("three/examples/jsm/loaders/FBXLoader.js");
    const loader = new FBXLoader();
    const obj = loader.parse(data, "");
    scene.add(obj);
  } else if (ext === "gltf" || ext === "glb") {
    const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
    const loader = new GLTFLoader();
    return new Promise<void>((resolve, reject) => {
      loader.parse(data, "", (gltf) => {
        gltf.scene.traverse((object: any) => {
          const association = (gltf.parser as any)?.associations?.get?.(object);
          if (Number.isInteger(association?.nodes)) {
            object.userData.modelExternalId = `node-${association.nodes}`;
          }
        });
        scene.add(gltf.scene);
        sceneCtx.fitToContent();
        resolve();
      }, reject);
    });
  } else if (ext === "3ds") {
    const { TDSLoader } = await import("three/examples/jsm/loaders/TDSLoader.js");
    const loader = new TDSLoader();
    const obj = loader.parse(data, "");
    scene.add(obj);
  } else if (ext === "dae") {
    const { ColladaLoader } = await import("three/examples/jsm/loaders/ColladaLoader.js");
    const loader = new ColladaLoader();
    const text = new TextDecoder().decode(data);
    const result = loader.parse(text, "");
    if (result) scene.add(result.scene);
  }

  sceneCtx.fitToContent();
}

async function loadIFC(
  sceneCtx: Awaited<ReturnType<typeof createScene>>,
  data: ArrayBuffer,
) {
  const { THREE, scene } = sceneCtx;

  // web-ifc provides raw geometry extraction
  const WebIFC = await import("web-ifc");
  const api = new WebIFC.IfcAPI();
  api.SetWasmPath("/wasm/", true);
  await api.Init();

  const modelID = api.OpenModel(new Uint8Array(data));
  const group = new THREE.Group();
  group.name = "ifc-elements";

  // Get all mesh geometries from the IFC
  api.StreamAllMeshes(modelID, (mesh: any) => {
    const expressID: number = Number(mesh.expressID ?? mesh.expressId ?? mesh.productID ?? mesh.productId ?? -1);
    let elementClass = "";
    if (expressID > 0) {
      try {
        const typeCode = (api as any).GetLineType(modelID, expressID);
        const name = (api as any).GetNameFromTypeCode(typeCode);
        if (name) elementClass = String(name).toUpperCase();
      } catch {
        // best effort
      }
    }

    const placedGeometries = mesh.geometries;
    for (let i = 0; i < placedGeometries.size(); i++) {
      const placed = placedGeometries.get(i);
      const ifcGeo = api.GetGeometry(modelID, placed.geometryExpressID);

      const verts = api.GetVertexArray(ifcGeo.GetVertexData(), ifcGeo.GetVertexDataSize());
      const indices = api.GetIndexArray(ifcGeo.GetIndexData(), ifcGeo.GetIndexDataSize());

      const geo = new THREE.BufferGeometry();
      // web-ifc returns 6 floats per vertex: x,y,z, nx,ny,nz
      const positions = new Float32Array(verts.length / 2);
      const normals = new Float32Array(verts.length / 2);
      for (let j = 0; j < verts.length; j += 6) {
        const idx = j / 6;
        positions[idx * 3] = verts[j];
        positions[idx * 3 + 1] = verts[j + 1];
        positions[idx * 3 + 2] = verts[j + 2];
        normals[idx * 3] = verts[j + 3];
        normals[idx * 3 + 1] = verts[j + 4];
        normals[idx * 3 + 2] = verts[j + 5];
      }

      geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
      geo.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));

      const color = new THREE.Color(placed.color.x, placed.color.y, placed.color.z);
      const mat = new THREE.MeshPhongMaterial({
        color,
        side: THREE.DoubleSide,
        transparent: placed.color.w < 1,
        opacity: placed.color.w,
      });

      const obj = new THREE.Mesh(geo, mat);

      // Apply transformation matrix
      const matrix = new THREE.Matrix4();
      matrix.fromArray(placed.flatTransformation);
      obj.applyMatrix4(matrix);

      obj.userData.ifc = { expressID, elementClass };
      obj.userData.modelExternalId = `#${expressID}`;
      group.add(obj);

      ifcGeo.delete();
    }
  });

  scene.add(group);
  api.CloseModel(modelID);
  sceneCtx.fitToContent();
}

/* ─── IFC click picking ─── */

function attachIfcPicker(
  sceneCtx: Awaited<ReturnType<typeof createScene>>,
  onSelectRef: { current?: (sel: { expressID: number; elementClass: string }) => void },
) {
  const { THREE, scene, camera, renderer } = sceneCtx;
  const ifcGroup = scene.getObjectByName("ifc-elements");
  if (!ifcGroup) return () => {};

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const canvas = renderer.domElement;
  let downAt: { x: number; y: number; t: number } | null = null;

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
  };
  const onUp = (e: PointerEvent) => {
    if (!downAt) return;
    const dx = Math.abs(e.clientX - downAt.x);
    const dy = Math.abs(e.clientY - downAt.y);
    const dt = performance.now() - downAt.t;
    downAt = null;
    // Treat anything that drags more than a few pixels or lasts > 350ms as orbit/pan, not a click.
    if (dx > 4 || dy > 4 || dt > 350) return;

    const rect = canvas.getBoundingClientRect();
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(ifcGroup.children, false);

    for (const hit of hits) {
      const info = (hit.object as any)?.userData?.ifc;
      if (info && typeof info.expressID === "number" && info.expressID > 0) {
        sceneCtx.selectElement(`#${info.expressID}`);
        onSelectRef.current?.({ expressID: info.expressID, elementClass: info.elementClass ?? "" });
        return;
      }
    }
    // Background miss — clear the selection.
    sceneCtx.selectElement(null);
    onSelectRef.current?.({ expressID: -1, elementClass: "" });
  };

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onUp);
  return () => {
    canvas.removeEventListener("pointerdown", onDown);
    canvas.removeEventListener("pointerup", onUp);
  };
}

/* ─── Generic STEP / mesh click picking ─── */

function attachModelPicker(
  sceneCtx: Awaited<ReturnType<typeof createScene>>,
  onSelectRef: { current?: (sel: { externalId: string } | null) => void },
) {
  const { THREE, scene, camera, renderer, externalIdForObject } = sceneCtx;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const canvas = renderer.domElement;
  let downAt: { x: number; y: number; t: number } | null = null;

  const onDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    downAt = { x: event.clientX, y: event.clientY, t: performance.now() };
  };
  const onUp = (event: PointerEvent) => {
    if (!downAt) return;
    const moved = Math.max(Math.abs(event.clientX - downAt.x), Math.abs(event.clientY - downAt.y));
    const elapsed = performance.now() - downAt.t;
    downAt = null;
    if (moved > 4 || elapsed > 350) return;

    const rect = canvas.getBoundingClientRect();
    ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(scene.children, true);
    for (const hit of hits) {
      if ((hit.object as any).name === "scene-grid") continue;
      const externalId = externalIdForObject(hit.object);
      if (externalId) {
        sceneCtx.selectElement(externalId);
        onSelectRef.current?.({ externalId });
        return;
      }
    }
    sceneCtx.selectElement(null);
    onSelectRef.current?.(null);
  };

  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointerup", onUp);
  return () => {
    canvas.removeEventListener("pointerdown", onDown);
    canvas.removeEventListener("pointerup", onUp);
  };
}

/* ─── Component ─── */

export function CadViewer({
  fileUrl,
  fileName,
  className,
  onIfcElementSelect,
  onModelElementSelect,
  actionsRef,
  onActionsReady,
  displayMode = "shaded",
  showGrid = true,
  autoRotate = false,
  showOverlayToolbar = true,
  projectId,
  sourceKind,
  sourceId,
}: CadViewerProps) {
  const [state, setState] = useState<CadViewerState>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [loadingText, setLoadingText] = useState("Initializing 3D engine...");
  const [retryNonce, setRetryNonce] = useState(0);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Awaited<ReturnType<typeof createScene>> | null>(null);
  const viewerActionsRef = useRef<CadViewerActions | null>(null);
  // Stable ref so the picker handler reads the latest callback without rebinding.
  const onIfcElementSelectRef = useRef<typeof onIfcElementSelect>(undefined);
  useEffect(() => {
    onIfcElementSelectRef.current = onIfcElementSelect;
  }, [onIfcElementSelect]);
  const onModelElementSelectRef = useRef<typeof onModelElementSelect>(undefined);
  useEffect(() => {
    onModelElementSelectRef.current = onModelElementSelect;
  }, [onModelElementSelect]);
  const onActionsReadyRef = useRef<typeof onActionsReady>(undefined);
  useEffect(() => {
    onActionsReadyRef.current = onActionsReady;
  }, [onActionsReady]);

  const handleFitView = useCallback(() => {
    viewerActionsRef.current?.fitToContent();
  }, []);

  const handleResetView = useCallback(() => {
    viewerActionsRef.current?.resetView();
  }, []);

  useEffect(() => {
    if (!actionsRef) return;
    actionsRef.current = viewerActionsRef.current;
  });

  useEffect(() => {
    viewerActionsRef.current?.setDisplayMode(displayMode);
  }, [displayMode]);

  useEffect(() => {
    viewerActionsRef.current?.setGridVisible(showGrid);
  }, [showGrid]);

  useEffect(() => {
    viewerActionsRef.current?.setAutoRotate(autoRotate);
  }, [autoRotate]);

  useEffect(() => {
    if (!canvasContainerRef.current || !fileUrl || !fileName) return;

    let cancelled = false;
    let detachPicker: (() => void) | null = null;
    let detachApsSelection: (() => void) | null = null;
    let detachApsViewportResize: (() => void) | null = null;
    let apsViewer: any = null;
    let apsResizeObserver: ResizeObserver | null = null;
    let suppressProgrammaticSelection = false;
    let selectionSuppressionTimer: ReturnType<typeof setTimeout> | null = null;
    let apsOrbitFrame = 0;
    let apsScopeActive = false;
    const abortController = new AbortController();
    const container = canvasContainerRef.current;
    setState("loading");
    setErrorMessage("");

    (async () => {
      try {
        const ext = getFileExt(fileName);
        const category = categorizeFile(fileName);

        if (category === "navisworks") {
          if (!projectId || !sourceKind || !sourceId) {
            throw new Error("This Navisworks file is missing its project source reference.");
          }
          setLoadingText("Connecting to Autodesk APS...");
          const deadline = Date.now() + 15 * 60_000;
          let session: ModelViewerSession;
          let firstRequest = true;
          do {
            session = await prepareModelViewer(projectId, {
              sourceKind,
              sourceId,
              force: retryNonce > 0 && firstRequest,
            });
            firstRequest = false;
            if (session.status === "failed") throw new Error(session.message);
            if (session.status === "ready") break;
            setLoadingText(session.message || "Autodesk is translating the Navisworks model...");
            await delay(5_000, abortController.signal);
          } while (Date.now() < deadline);

          if (session.status !== "ready") {
            throw new Error("Autodesk APS is still translating the model. Try again in a few minutes.");
          }
          if (cancelled) return;
          setLoadingText("Loading Autodesk Viewer...");
          const Viewing = await loadAutodeskViewerSdk();
          if (cancelled) return;

          const refreshViewerToken = async (callback: (token: string, expiresIn: number) => void) => {
            try {
              const refreshed = await prepareModelViewer(projectId, { sourceKind, sourceId });
              if (refreshed.status === "ready") callback(refreshed.accessToken, refreshed.expiresIn);
              else callback("", 0);
            } catch {
              callback("", 0);
            }
          };

          await new Promise<void>((resolve, reject) => {
            Viewing.Initializer({
              env: "AutodeskProduction2",
              api: session.api,
              getAccessToken: refreshViewerToken,
            }, () => {
              if (cancelled) return resolve();
              apsViewer = new Viewing.GuiViewer3D(container, { extensions: ["Autodesk.DocumentBrowser"] });
              const startCode = apsViewer.start();
              if (startCode > 0) return reject(new Error(`Autodesk Viewer failed to start (${startCode}).`));
              Viewing.Document.load(
                `urn:${session.urn}`,
                async (apsDocument: any) => {
                  try {
                    const geometry = apsDocument.getRoot().getDefaultGeometry();
                    if (!geometry) throw new Error("The translated model has no viewable geometry.");
                    await apsViewer.loadDocumentNode(apsDocument, geometry);
                    const resizeApsViewport = () => {
                      // Autodesk Viewer owns an internal canvas whose pixel
                      // dimensions do not follow CSS layout changes. Resize on
                      // both observed container changes and fullscreen/window
                      // transitions, after the browser has committed layout.
                      requestAnimationFrame(() => {
                        if (!cancelled) apsViewer?.resize?.();
                      });
                    };
                    apsResizeObserver = new ResizeObserver(resizeApsViewport);
                    apsResizeObserver.observe(container);
                    globalThis.document.addEventListener("fullscreenchange", resizeApsViewport);
                    window.addEventListener("resize", resizeApsViewport);
                    detachApsViewportResize = () => {
                      globalThis.document.removeEventListener("fullscreenchange", resizeApsViewport);
                      window.removeEventListener("resize", resizeApsViewport);
                    };
                    resizeApsViewport();
                    const selectionEvent = Viewing.SELECTION_CHANGED_EVENT;
                    const handleSelection = (event: unknown) => {
                      if (suppressProgrammaticSelection) return;
                      const dbId = firstAutodeskSelectedDbId(event);
                      onModelElementSelectRef.current?.(dbId == null ? null : { externalId: String(dbId) });
                    };
                    apsViewer.addEventListener(selectionEvent, handleSelection);
                    detachApsSelection = () => apsViewer?.removeEventListener?.(selectionEvent, handleSelection);
                    resolve();
                  } catch (error) {
                    reject(error);
                  }
                },
                (code: number, message: string) => reject(new Error(`Autodesk Viewer could not load the model (${code}): ${message || "unknown error"}`)),
              );
            });
          });

          if (cancelled) return;
          const { Vector4 } = await import("three");
          // Theming is deliberately separate from the Viewer selection
          // overlay. On dense Navisworks models the default blue outline can
          // be almost invisible, especially while orbiting, whereas theming
          // remains painted on every selected fragment.
          const apsScopeColor = new Vector4(0.12, 0.62, 1, 0.88);
          const apsFadeMaterial = apsViewer?.impl?.fadeMaterial;
          const defaultApsFadeOpacity = typeof apsFadeMaterial?.opacity === "number"
            ? apsFadeMaterial.opacity
            : null;
          const suppressSelectionEventBriefly = () => {
            suppressProgrammaticSelection = true;
            if (selectionSuppressionTimer) clearTimeout(selectionSuppressionTimer);
            selectionSuppressionTimer = setTimeout(() => { suppressProgrammaticSelection = false; }, 100);
          };
          const numericDbIds = (externalIds: string[]) => Array.from(new Set(externalIds
            .map(Number)
            .filter((dbId) => Number.isInteger(dbId) && dbId > 0)));
          const stopApsOrbit = () => {
            if (apsOrbitFrame) cancelAnimationFrame(apsOrbitFrame);
            apsOrbitFrame = 0;
          };
          const clearApsScopeTheme = () => {
            const model = apsViewer?.model;
            if (model) apsViewer?.clearThemingColors?.(model);
          };
          const setApsGhostOpacity = (opacity: number | null) => {
            if (!apsFadeMaterial || opacity == null) return;
            apsFadeMaterial.transparent = opacity < 1;
            apsFadeMaterial.opacity = opacity;
            apsFadeMaterial.needsUpdate = true;
          };
          const restoreApsModel = () => {
            apsScopeActive = false;
            clearApsScopeTheme();
            apsViewer?.showAll?.();
            apsViewer?.setGhosting?.(false);
            setApsGhostOpacity(defaultApsFadeOpacity);
            apsViewer?.clearSelection?.();
            apsViewer?.impl?.invalidate?.(true, true, true);
          };
          const measureApsScope = (dbIds: number[]) => {
            try {
              const model = apsViewer?.model;
              const instanceTree = model?.getInstanceTree?.();
              const fragmentList = model?.getFragmentList?.();
              const templateBounds = apsViewer?.getVisibleBounds?.();
              if (!instanceTree || !fragmentList || !templateBounds?.clone) return null;
              const union = templateBounds.clone();
              union.makeEmpty?.();
              const seenFragments = new Set<number>();
              let weightedX = 0;
              let weightedY = 0;
              let weightedZ = 0;
              let totalWeight = 0;
              for (const dbId of dbIds) {
                instanceTree.enumNodeFragments(dbId, (fragmentId: number) => {
                  if (seenFragments.has(fragmentId)) return;
                  seenFragments.add(fragmentId);
                  const bounds = templateBounds.clone();
                  bounds.makeEmpty?.();
                  fragmentList.getWorldBounds(fragmentId, bounds);
                  if (bounds.isEmpty?.()) return;
                  union.union?.(bounds);
                  const centerX = (bounds.min.x + bounds.max.x) / 2;
                  const centerY = (bounds.min.y + bounds.max.y) / 2;
                  const centerZ = (bounds.min.z + bounds.max.z) / 2;
                  // Weight fragment centers by their bounding diagonal. For
                  // pipe/duct runs this approximates length-weighted center
                  // of mass instead of the often-wrong camera target left by
                  // an asynchronous fitToView transition.
                  const weight = Math.max(Math.hypot(
                    bounds.max.x - bounds.min.x,
                    bounds.max.y - bounds.min.y,
                    bounds.max.z - bounds.min.z,
                  ), 0.001);
                  weightedX += centerX * weight;
                  weightedY += centerY * weight;
                  weightedZ += centerZ * weight;
                  totalWeight += weight;
                }, true);
              }
              if (totalWeight <= 0 || union.isEmpty?.()) return null;
              return {
                center: { x: weightedX / totalWeight, y: weightedY / totalWeight, z: weightedZ / totalWeight },
                radius: Math.max(Math.hypot(
                  union.max.x - union.min.x,
                  union.max.y - union.min.y,
                  union.max.z - union.min.z,
                ) / 2, 0.5),
              };
            } catch {
              return null;
            }
          };
          const focusApsScope = (dbIds: number[], fit = true) => {
            if (dbIds.length === 0) return;
            apsScopeActive = true;
            suppressSelectionEventBriefly();
            clearApsScopeTheme();
            // Isolate + ghosting keeps context visible but subdued. Some APS
            // profiles render the stock selection outline too softly, so the
            // selected scope also receives an explicit deferred theming pass.
            apsViewer?.setGhosting?.(true);
            setApsGhostOpacity(0.1);
            apsViewer?.isolate?.(dbIds);
            apsViewer?.select?.(dbIds);
            const model = apsViewer?.model;
            if (model?.setThemingColor) {
              for (const dbId of dbIds) model.setThemingColor(dbId, apsScopeColor, true);
            } else {
              for (const dbId of dbIds) apsViewer?.setThemingColor?.(dbId, apsScopeColor, model, true);
            }
            apsViewer?.impl?.invalidate?.(true, true, true);
            if (fit) apsViewer?.fitToView?.(dbIds);
          };
          const setApsStandardView = (view: CadViewerStandardView) => {
            const bounds = apsViewer?.model?.getBoundingBox?.() ?? apsViewer?.getVisibleBounds?.();
            const navigation = apsViewer?.navigation;
            if (!bounds?.min || !bounds?.max || !navigation?.setView) return;
            const center = {
              x: (bounds.min.x + bounds.max.x) / 2,
              y: (bounds.min.y + bounds.max.y) / 2,
              z: (bounds.min.z + bounds.max.z) / 2,
            };
            const extent = Math.max(Math.hypot(
              bounds.max.x - bounds.min.x,
              bounds.max.y - bounds.min.y,
              bounds.max.z - bounds.min.z,
            ) / 2, 0.5);
            const rawUp = navigation.getWorldUpVector?.() ?? { x: 0, y: 0, z: 1 };
            const upLength = Math.hypot(rawUp.x, rawUp.y, rawUp.z) || 1;
            const up = { x: rawUp.x / upLength, y: rawUp.y / upLength, z: rawUp.z / upLength };
            const reference = Math.abs(up.z) < 0.9 ? { x: 0, y: 0, z: 1 } : { x: 0, y: 1, z: 0 };
            const rightRaw = {
              x: reference.y * up.z - reference.z * up.y,
              y: reference.z * up.x - reference.x * up.z,
              z: reference.x * up.y - reference.y * up.x,
            };
            const rightLength = Math.hypot(rightRaw.x, rightRaw.y, rightRaw.z) || 1;
            const right = { x: rightRaw.x / rightLength, y: rightRaw.y / rightLength, z: rightRaw.z / rightLength };
            const front = {
              x: up.y * right.z - up.z * right.y,
              y: up.z * right.x - up.x * right.z,
              z: up.x * right.y - up.y * right.x,
            };
            const rawDirection = view === "top"
              ? up
              : view === "front"
                ? front
                : view === "right"
                  ? right
                  : { x: right.x + front.x + up.x * 0.85, y: right.y + front.y + up.y * 0.85, z: right.z + front.z + up.z * 0.85 };
            const directionLength = Math.hypot(rawDirection.x, rawDirection.y, rawDirection.z) || 1;
            const distance = extent * 2.8;
            const position = {
              x: center.x + rawDirection.x / directionLength * distance,
              y: center.y + rawDirection.y / directionLength * distance,
              z: center.z + rawDirection.z / directionLength * distance,
            };
            const cameraUp = view === "top" ? front : up;
            navigation.setCameraUpVector?.(cameraUp);
            navigation.setPivotPoint?.(center);
            navigation.setView(position, center);
            apsViewer?.impl?.syncCamera?.(true);
            apsViewer?.impl?.invalidate?.(true, true, true);
          };
          const apsActions: CadViewerActions = {
            fitToContent: () => {
              stopApsOrbit();
              restoreApsModel();
              apsViewer?.fitToView();
            },
            resetView: () => {
              stopApsOrbit();
              restoreApsModel();
              apsViewer?.navigation?.setRequestHomeView?.(true);
            },
            setStandardView: (view) => {
              stopApsOrbit();
              setApsStandardView(view);
            },
            setGridVisible: () => undefined,
            setDisplayMode: (mode) => {
              apsViewer?.setDisplayEdges?.(mode === "wireframe");
              apsViewer?.setGhosting?.(apsScopeActive || mode === "xray");
            },
            setAutoRotate: () => undefined,
            selectElement: (externalId) => {
              stopApsOrbit();
              restoreApsModel();
              const dbId = externalId == null ? null : Number(externalId);
              if (dbId != null && Number.isInteger(dbId) && dbId > 0) {
                apsViewer?.select?.([dbId]);
              } else {
                apsViewer?.clearSelection?.();
              }
            },
            focusElement: (externalId) => {
              stopApsOrbit();
              restoreApsModel();
              const dbId = Number(externalId);
              if (!Number.isInteger(dbId) || dbId <= 0) return;
              apsViewer?.select?.([dbId]);
              apsViewer?.fitToView?.([dbId]);
            },
            selectElements: (externalIds) => {
              const dbIds = numericDbIds(externalIds);
              if (dbIds.length > 0) {
                focusApsScope(dbIds);
              } else {
                restoreApsModel();
                apsViewer?.clearSelection?.();
              }
            },
            focusElements: (externalIds) => {
              stopApsOrbit();
              const dbIds = numericDbIds(externalIds);
              focusApsScope(dbIds);
            },
            orbitElements: (externalIds) => {
              stopApsOrbit();
              const dbIds = numericDbIds(externalIds);
              if (dbIds.length === 0) return;
              const scope = measureApsScope(dbIds);
              focusApsScope(dbIds, false);
              const navigation = apsViewer?.navigation;
              const target = scope?.center ?? navigation?.getTarget?.();
              const position = navigation?.getPosition?.();
              if (!target || !position) return;
              const rawUp = navigation?.getWorldUpVector?.() ?? { x: 0, y: 0, z: 1 };
              const upLength = Math.hypot(rawUp.x, rawUp.y, rawUp.z) || 1;
              const up = { x: rawUp.x / upLength, y: rawUp.y / upLength, z: rawUp.z / upLength };
              const offset = { x: position.x - target.x, y: position.y - target.y, z: position.z - target.z };
              const alongUp = offset.x * up.x + offset.y * up.y + offset.z * up.z;
              let radial = {
                x: offset.x - up.x * alongUp,
                y: offset.y - up.y * alongUp,
                z: offset.z - up.z * alongUp,
              };
              let radialLength = Math.hypot(radial.x, radial.y, radial.z);
              if (radialLength < 0.001) {
                radial = Math.abs(up.z) < 0.9
                  ? { x: -up.y, y: up.x, z: 0 }
                  : { x: 1, y: 0, z: 0 };
                radialLength = Math.hypot(radial.x, radial.y, radial.z) || 1;
              }
              const basisA = { x: radial.x / radialLength, y: radial.y / radialLength, z: radial.z / radialLength };
              const basisB = {
                x: up.y * basisA.z - up.z * basisA.y,
                y: up.z * basisA.x - up.x * basisA.z,
                z: up.x * basisA.y - up.y * basisA.x,
              };
              const radius = Math.max((scope?.radius ?? radialLength) * 2.2, 1);
              const elevation = (scope?.radius ?? radius * 0.45) * 0.45;
              const startedAt = performance.now();
              const step = (now: number) => {
                const angle = ((now - startedAt) / 12_000) * Math.PI * 2;
                navigation?.setView?.(
                  {
                    x: target.x + basisA.x * Math.cos(angle) * radius + basisB.x * Math.sin(angle) * radius + up.x * elevation,
                    y: target.y + basisA.y * Math.cos(angle) * radius + basisB.y * Math.sin(angle) * radius + up.y * elevation,
                    z: target.z + basisA.z * Math.cos(angle) * radius + basisB.z * Math.sin(angle) * radius + up.z * elevation,
                  },
                  target,
                );
                apsOrbitFrame = requestAnimationFrame(step);
              };
              apsOrbitFrame = requestAnimationFrame(step);
            },
            stopOrbit: stopApsOrbit,
          };
          viewerActionsRef.current = apsActions;
          if (actionsRef) actionsRef.current = apsActions;
          apsActions.setDisplayMode(displayMode);
          setState("ready");
          onActionsReadyRef.current?.(apsActions);
          return;
        }

        // Local formats use the embedded Three.js scene.
        setLoadingText("Setting up 3D scene...");
        const sceneCtx = await createScene(container);
        sceneRef.current = sceneCtx;
        viewerActionsRef.current = {
          fitToContent: sceneCtx.fitToContent,
          resetView: sceneCtx.resetView,
          setStandardView: sceneCtx.setStandardView,
          setGridVisible: sceneCtx.setGridVisible,
          setDisplayMode: sceneCtx.setDisplayMode,
          setAutoRotate: sceneCtx.setAutoRotate,
          selectElement: sceneCtx.selectElement,
          focusElement: sceneCtx.focusElement,
          selectElements: sceneCtx.selectElements,
          focusElements: sceneCtx.focusElements,
          orbitElements: sceneCtx.orbitElements,
          stopOrbit: sceneCtx.stopOrbit,
        };
        if (actionsRef) actionsRef.current = viewerActionsRef.current;
        sceneCtx.setDisplayMode(displayMode);
        sceneCtx.setGridVisible(showGrid);
        sceneCtx.setAutoRotate(autoRotate);
        if (cancelled) { sceneCtx.dispose(); return; }

        setLoadingText("Downloading model...");
        const resp = await fetch(fileUrl, { credentials: "include" });
        if (!resp.ok) throw new Error(`Failed to fetch: ${resp.status}`);
        const data = await resp.arrayBuffer();
        if (cancelled) { sceneCtx.dispose(); return; }

        if (category === "step") {
          setLoadingText("Parsing CAD geometry (OpenCascade)...");
          await loadSTEP(sceneCtx, data);
          if (!cancelled) detachPicker = attachModelPicker(sceneCtx, onModelElementSelectRef);
        } else if (category === "mesh") {
          setLoadingText(`Loading ${ext.toUpperCase()} model...`);
          await loadMesh(sceneCtx, data, ext);
          if (!cancelled) detachPicker = attachModelPicker(sceneCtx, onModelElementSelectRef);
        } else if (category === "ifc") {
          setLoadingText("Parsing BIM model (IFC)...");
          await loadIFC(sceneCtx, data);
          if (!cancelled) detachPicker = attachIfcPicker(sceneCtx, onIfcElementSelectRef);
        } else if (category === "dxf") {
          setLoadingText("DXF/DWG viewer loading...");
          throw new Error("DXF/DWG viewing requires an additional parser. Upload a PDF export instead, or convert to STEP/IFC.");
        } else {
          throw new Error(`Unsupported format: .${ext}`);
        }

        if (!cancelled) {
          setState("ready");
          if (viewerActionsRef.current) onActionsReadyRef.current?.(viewerActionsRef.current);
        }
      } catch (err) {
        if (!cancelled) {
          setErrorMessage(err instanceof Error ? err.message : "Failed to load model");
          setState("error");
        }
      }
    })();

    return () => {
      cancelled = true;
      abortController.abort();
      detachPicker?.();
      detachApsSelection?.();
      detachApsViewportResize?.();
      apsResizeObserver?.disconnect();
      if (selectionSuppressionTimer) clearTimeout(selectionSuppressionTimer);
      if (apsOrbitFrame) cancelAnimationFrame(apsOrbitFrame);
      apsViewer?.finish?.();
      sceneRef.current?.dispose();
      sceneRef.current = null;
      viewerActionsRef.current = null;
      if (actionsRef) actionsRef.current = null;
    };
  }, [fileUrl, fileName, projectId, sourceKind, sourceId, retryNonce]);

  return (
    <div className={cn("relative w-full h-full overflow-hidden", className)}>
      {/* Canvas — always mounted so Three.js can attach */}
      <div ref={canvasContainerRef} className="w-full h-full bg-[#1a1a2e]" />

      {/* Loading overlay */}
      {state === "loading" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#1a1a2e] text-zinc-400 gap-3 z-20">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-400" />
          <p className="text-sm font-medium">{loadingText}</p>
          {fileName && (
            <p className="text-xs text-zinc-600">{fileName}</p>
          )}
        </div>
      )}

      {/* Error overlay */}
      {state === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#1a1a2e] text-zinc-400 gap-4 z-20">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-8 flex flex-col items-center gap-4 max-w-md">
            <AlertCircle className="h-10 w-10 text-red-400/60" />
            <div className="text-center">
              <p className="text-sm font-medium text-zinc-300">
                Failed to load model
              </p>
              <p className="text-xs text-zinc-500 mt-1">
                {errorMessage}
              </p>
            </div>
            {fileName && (
              <div className="flex items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 w-full">
                <Box className="h-4 w-4 text-zinc-500 shrink-0" />
                <span className="text-xs text-zinc-400 truncate">{fileName}</span>
                <span className="text-[10px] text-zinc-600 ml-auto uppercase">{getFileExt(fileName)}</span>
              </div>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setRetryNonce((value) => value + 1)}
            >
              <RotateCcw className="mr-2 h-3.5 w-3.5" />
              Retry
            </Button>
          </div>
        </div>
      )}

      {/* Toolbar overlay — shown when ready */}
      {state === "ready" && showOverlayToolbar && (
        <>
          <div className="absolute top-0 left-0 right-0 z-10 flex items-center gap-2 px-3 py-2 bg-zinc-900/80 backdrop-blur-sm border-b border-zinc-800">
            <Box className="h-4 w-4 text-indigo-400 shrink-0" />
            {fileName && (
              <span className="text-xs font-medium text-zinc-300 truncate">
                {fileName}
              </span>
            )}
            <span className="text-[10px] text-zinc-600 uppercase">{getFileExt(fileName ?? "")}</span>
            <div className="ml-auto flex items-center gap-1">
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-zinc-300" onClick={handleFitView}>
                <Maximize2 className="h-3.5 w-3.5 mr-1" />
                Fit
              </Button>
              <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-zinc-300" onClick={handleResetView}>
                <RotateCcw className="h-3.5 w-3.5 mr-1" />
                Reset
              </Button>
            </div>
          </div>

          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 px-3 py-1.5 rounded-md bg-zinc-900/70 backdrop-blur-sm border border-zinc-800">
            <p className="text-[11px] text-zinc-500">
              Scroll to zoom &middot; Drag to orbit &middot; Right-click to pan
            </p>
          </div>
        </>
      )}
    </div>
  );
}
