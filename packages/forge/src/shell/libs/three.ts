/// <reference lib="dom" />
// esbuild entry: exposes Three.js (plus two procedural-friendly addons) as `window.THREE`.
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

(window as unknown as { THREE: unknown }).THREE = { ...THREE, RoomEnvironment, RoundedBoxGeometry };
