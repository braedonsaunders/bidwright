"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Loader2, Maximize2, Box, AlertCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/utils";

type CadViewerState = "loading" | "ready" | "error";

interface CadViewerProps {
  fileUrl?: string;
  fileName?: string;
  className?: string;
}

/* ─── Supported format detection ─── */

const STEP_EXTS = new Set(["step", "stp", "iges", "igs", "brep"]);
const MESH_EXTS = new Set(["stl", "obj", "fbx", "gltf", "glb", "3ds", "dae"]);
const IFC_EXTS = new Set(["ifc"]);
const DXF_EXTS = new Set(["dxf", "dwg"]);

function getFileExt(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

type FileCategory = "step" | "mesh" | "ifc" | "dxf" | "unknown";

function categorizeFile(name: string): FileCategory {
  const ext = getFileExt(name);
  if (STEP_EXTS.has(ext)) return "step";
  if (MESH_EXTS.has(ext)) return "mesh";
  if (IFC_EXTS.has(ext)) return "ifc";
  if (DXF_EXTS.has(ext)) return "dxf";
  return "unknown";
}

/* ─── Three.js scene setup (lazy loaded) ─── */

async function createScene(container: HTMLDivElement) {
  const THREE = await import("three");
  const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a1a2e);

  // Grid
  const grid = new THREE.GridHelper(20, 20, 0x303050, 0x252540);
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

  return {
    scene,
    camera,
    renderer,
    controls,
    THREE,
    fitToContent: () => {
      const box = new THREE.Box3().setFromObject(scene);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());

      if (size.length() === 0) return;

      controls.target.copy(center);
      const maxDim = Math.max(size.x, size.y, size.z);
      const dist = maxDim * 2;
      camera.position.set(center.x + dist * 0.5, center.y + dist * 0.5, center.z + dist * 0.5);
      camera.lookAt(center);
      controls.update();
    },
    dispose: () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

/* ─── Loaders ─── */

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

  const { THREE, scene } = sceneCtx;
  const group = new THREE.Group();

  for (const mesh of result.meshes) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(mesh.attributes.position.array, 3));
    if (mesh.attributes.normal) {
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(mesh.attributes.normal.array, 3));
    }
    if (mesh.index) {
      geo.setIndex(new THREE.BufferAttribute(mesh.index.array, 1));
    }
    geo.computeBoundingBox();

    let color = 0x6699cc;
    if (mesh.color) {
      color = new THREE.Color(mesh.color[0], mesh.color[1], mesh.color[2]).getHex();
    }

    const mat = new THREE.MeshPhongMaterial({
      color,
      side: THREE.DoubleSide,
      flatShading: !mesh.attributes.normal,
    });
    const obj = new THREE.Mesh(geo, mat);
    group.add(obj);
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
    scene.add(mesh);
  } else if (ext === "obj") {
    const { OBJLoader } = await import("three/examples/jsm/loaders/OBJLoader.js");
    const loader = new OBJLoader();
    const text = new TextDecoder().decode(data);
    const obj = loader.parse(text);
    obj.traverse((child: any) => {
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
        scene.add(gltf.scene);
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

  // Get all mesh geometries from the IFC
  api.StreamAllMeshes(modelID, (mesh: any) => {
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

      group.add(obj);

      ifcGeo.delete();
    }
  });

  scene.add(group);
  api.CloseModel(modelID);
  sceneCtx.fitToContent();
}

/* ─── Component ─── */

export function CadViewer({ fileUrl, fileName, className }: CadViewerProps) {
  const [state, setState] = useState<CadViewerState>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [loadingText, setLoadingText] = useState("Initializing 3D engine...");
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Awaited<ReturnType<typeof createScene>> | null>(null);

  const handleFitView = useCallback(() => {
    sceneRef.current?.fitToContent();
  }, []);

  const handleResetView = useCallback(() => {
    if (!sceneRef.current) return;
    const { camera, controls } = sceneRef.current;
    controls.target.set(0, 0, 0);
    camera.position.set(5, 5, 5);
    camera.lookAt(0, 0, 0);
    controls.update();
  }, []);

  useEffect(() => {
    if (!canvasContainerRef.current || !fileUrl || !fileName) return;

    let cancelled = false;
    const container = canvasContainerRef.current;

    (async () => {
      try {
        // 1. Create Three.js scene
        setLoadingText("Setting up 3D scene...");
        const sceneCtx = await createScene(container);
        sceneRef.current = sceneCtx;
        if (cancelled) { sceneCtx.dispose(); return; }

        // 2. Fetch the file
        setLoadingText("Downloading model...");
        const resp = await fetch(fileUrl);
        if (!resp.ok) throw new Error(`Failed to fetch: ${resp.status}`);
        const data = await resp.arrayBuffer();
        if (cancelled) { sceneCtx.dispose(); return; }

        // 3. Parse based on format
        const ext = getFileExt(fileName);
        const category = categorizeFile(fileName);

        if (category === "step") {
          setLoadingText("Parsing CAD geometry (OpenCascade)...");
          await loadSTEP(sceneCtx, data);
        } else if (category === "mesh") {
          setLoadingText(`Loading ${ext.toUpperCase()} model...`);
          await loadMesh(sceneCtx, data, ext);
        } else if (category === "ifc") {
          setLoadingText("Parsing BIM model (IFC)...");
          await loadIFC(sceneCtx, data);
        } else if (category === "dxf") {
          setLoadingText("DXF/DWG viewer loading...");
          // DXF support can be added via dxf-parser + three.js lines
          throw new Error("DXF/DWG viewing requires an additional parser. Upload a PDF export instead, or convert to STEP/IFC.");
        } else {
          throw new Error(`Unsupported format: .${ext}`);
        }

        if (!cancelled) setState("ready");
      } catch (err) {
        if (!cancelled) {
          setErrorMessage(err instanceof Error ? err.message : "Failed to load model");
          setState("error");
        }
      }
    })();

    return () => {
      cancelled = true;
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, [fileUrl, fileName]);

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
          </div>
        </div>
      )}

      {/* Toolbar overlay — shown when ready */}
      {state === "ready" && (
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
