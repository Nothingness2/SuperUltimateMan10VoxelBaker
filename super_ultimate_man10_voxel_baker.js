(function () {
	'use strict';

	const PLUGIN_ID = 'super_ultimate_man10_voxel_baker';
	let panel;

	// ────────────────────────────────────────────────────────────
	// Voxelization core
	// ────────────────────────────────────────────────────────────

	// Resolve any of {uuid string, numeric index, Texture instance, null} to a UUID string
	function resolveTextureUuid(t) {
		if (t == null || t === false) return null;
		if (typeof t === 'string') return t;
		if (typeof t === 'object' && t.uuid) return t.uuid;
		if (typeof Texture !== 'undefined' && Texture.all) {
			if (typeof t === 'number') {
				const tex = Texture.all[t];
				return tex ? tex.uuid : null;
			}
		}
		return null;
	}

	function collectWorldTriangles(meshes, diagnostics) {
		const tris = [];
		let facesTotal = 0, facesWithUv = 0, facesWithTex = 0;
		for (const mesh of meshes) {
			const obj = mesh.mesh;
			if (!obj) continue;
			obj.updateMatrixWorld(true);
			const matrix = obj.matrixWorld;
			const vw = {};
			for (const k of Object.keys(mesh.vertices)) {
				const v = new THREE.Vector3(
					mesh.vertices[k][0],
					mesh.vertices[k][1],
					mesh.vertices[k][2]
				);
				v.applyMatrix4(matrix);
				vw[k] = [v.x, v.y, v.z];
			}
			for (const fk of Object.keys(mesh.faces)) {
				const face = mesh.faces[fk];
				const fv = face.vertices;
				if (!fv || fv.length < 3) continue;
				facesTotal++;
				const faceUv = face.uv || null;
				const texUuid = resolveTextureUuid(face.texture);
				if (faceUv && Object.keys(faceUv).length > 0) facesWithUv++;
				if (texUuid) facesWithTex++;
				const uvOf = (vk) => {
					if (!faceUv) return null;
					const u = faceUv[vk];
					return u ? [u[0], u[1]] : null;
				};
				for (let i = 1; i < fv.length - 1; i++) {
					const a = vw[fv[0]], b = vw[fv[i]], c = vw[fv[i + 1]];
					if (!a || !b || !c) continue;
					tris.push({
						a: a, b: b, c: c,
						uvA: uvOf(fv[0]),
						uvB: uvOf(fv[i]),
						uvC: uvOf(fv[i + 1]),
						tex: texUuid
					});
				}
			}
		}
		if (diagnostics) {
			diagnostics.facesTotal = facesTotal;
			diagnostics.facesWithUv = facesWithUv;
			diagnostics.facesWithTex = facesWithTex;
		}
		return tris;
	}

	// Pre-decoded pixel data per texture for fast sampling
	function buildPixelCache() {
		const cache = {};
		if (typeof Texture === 'undefined' || !Texture.all) return cache;
		const projUvW = (typeof Project !== 'undefined' && Project && Project.texture_width) ? Project.texture_width : 16;
		const projUvH = (typeof Project !== 'undefined' && Project && Project.texture_height) ? Project.texture_height : 16;
		for (const tex of Texture.all) {
			if (!tex || !tex.img) continue;
			const w = tex.img.naturalWidth || tex.img.width;
			const h = tex.img.naturalHeight || tex.img.height;
			if (!w || !h) continue;
			try {
				const canvas = document.createElement('canvas');
				canvas.width = w; canvas.height = h;
				const ctx = canvas.getContext('2d');
				ctx.drawImage(tex.img, 0, 0);
				const data = ctx.getImageData(0, 0, w, h).data;
				const uvW = tex.uv_width || projUvW || w;
				const uvH = tex.uv_height || projUvH || h;
				cache[tex.uuid] = { w: w, h: h, data: data, uvW: uvW, uvH: uvH };
			} catch (e) {
				console.warn('[Voxelizer] texture read failed:', tex.name, e);
			}
		}
		return cache;
	}

	function samplePixel(cache, texId, u, v) {
		if (!texId) return null;
		const t = cache[texId];
		if (!t) return null;
		// Convert UV (in project/uv space) to actual pixel coords.
		const fx = (u / t.uvW) * t.w;
		const fy = (v / t.uvH) * t.h;
		let px = Math.floor(fx);
		let py = Math.floor(fy);
		px = ((px % t.w) + t.w) % t.w;
		py = ((py % t.h) + t.h) % t.h;
		const id = (py * t.w + px) * 4;
		return [t.data[id], t.data[id + 1], t.data[id + 2], t.data[id + 3]];
	}

	// Christer Ericson — closest point on triangle to p. Returns { p, bary }
	function closestPointOnTri(px, py, pz, a, b, c) {
		const abx = b[0] - a[0], aby = b[1] - a[1], abz = b[2] - a[2];
		const acx = c[0] - a[0], acy = c[1] - a[1], acz = c[2] - a[2];
		const apx = px - a[0], apy = py - a[1], apz = pz - a[2];
		const d1 = abx * apx + aby * apy + abz * apz;
		const d2 = acx * apx + acy * apy + acz * apz;
		if (d1 <= 0 && d2 <= 0) return { x: a[0], y: a[1], z: a[2], u: 1, v: 0, w: 0 };

		const bpx = px - b[0], bpy = py - b[1], bpz = pz - b[2];
		const d3 = abx * bpx + aby * bpy + abz * bpz;
		const d4 = acx * bpx + acy * bpy + acz * bpz;
		if (d3 >= 0 && d4 <= d3) return { x: b[0], y: b[1], z: b[2], u: 0, v: 1, w: 0 };

		const vc = d1 * d4 - d3 * d2;
		if (vc <= 0 && d1 >= 0 && d3 <= 0) {
			const v = d1 / (d1 - d3);
			return { x: a[0] + v * abx, y: a[1] + v * aby, z: a[2] + v * abz, u: 1 - v, v: v, w: 0 };
		}

		const cpx = px - c[0], cpy = py - c[1], cpz = pz - c[2];
		const d5 = abx * cpx + aby * cpy + abz * cpz;
		const d6 = acx * cpx + acy * cpy + acz * cpz;
		if (d6 >= 0 && d5 <= d6) return { x: c[0], y: c[1], z: c[2], u: 0, v: 0, w: 1 };

		const vb = d5 * d2 - d1 * d6;
		if (vb <= 0 && d2 >= 0 && d6 <= 0) {
			const w = d2 / (d2 - d6);
			return { x: a[0] + w * acx, y: a[1] + w * acy, z: a[2] + w * acz, u: 1 - w, v: 0, w: w };
		}

		const va = d3 * d6 - d5 * d4;
		if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
			const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
			return {
				x: b[0] + w * (c[0] - b[0]),
				y: b[1] + w * (c[1] - b[1]),
				z: b[2] + w * (c[2] - b[2]),
				u: 0, v: 1 - w, w: w
			};
		}

		const denom = 1 / (va + vb + vc);
		const v = vb * denom, w = vc * denom;
		return {
			x: a[0] + abx * v + acx * w,
			y: a[1] + aby * v + acy * w,
			z: a[2] + abz * v + acz * w,
			u: 1 - v - w, v: v, w: w
		};
	}

	function quantizeRGB(r, g, b, bits) {
		const shift = 8 - Math.max(1, Math.min(8, bits));
		const m = (0xff >> shift) << shift;
		// Pack into 24-bit; use high bit (1<<24) as "set" marker so 0 means unset
		return ((r & m) << 16) | ((g & m) << 8) | (b & m) | 0x1000000;
	}

	// Triangle vs AABB (SAT, Akenine-Möller). box is axis-aligned at boxCenter, half-extents boxHalf.
	function triBoxOverlap(bcx, bcy, bcz, hx, hy, hz, v0, v1, v2) {
		const t0x = v0[0] - bcx, t0y = v0[1] - bcy, t0z = v0[2] - bcz;
		const t1x = v1[0] - bcx, t1y = v1[1] - bcy, t1z = v1[2] - bcz;
		const t2x = v2[0] - bcx, t2y = v2[1] - bcy, t2z = v2[2] - bcz;

		// AABB-AABB overlap on each axis
		let mn = Math.min(t0x, t1x, t2x), mx = Math.max(t0x, t1x, t2x);
		if (mn > hx || mx < -hx) return false;
		mn = Math.min(t0y, t1y, t2y); mx = Math.max(t0y, t1y, t2y);
		if (mn > hy || mx < -hy) return false;
		mn = Math.min(t0z, t1z, t2z); mx = Math.max(t0z, t1z, t2z);
		if (mn > hz || mx < -hz) return false;

		const e0x = t1x - t0x, e0y = t1y - t0y, e0z = t1z - t0z;
		const e1x = t2x - t1x, e1y = t2y - t1y, e1z = t2z - t1z;
		const e2x = t0x - t2x, e2y = t0y - t2y, e2z = t0z - t2z;

		// Plane test
		const nx = e0y * e1z - e0z * e1y;
		const ny = e0z * e1x - e0x * e1z;
		const nz = e0x * e1y - e0y * e1x;
		const d = -(nx * t0x + ny * t0y + nz * t0z);
		const r = hx * Math.abs(nx) + hy * Math.abs(ny) + hz * Math.abs(nz);
		if (d > r || d < -r) return false;

		// 9 cross-axis SAT (edge × axis)
		const edges = [[e0x, e0y, e0z], [e1x, e1y, e1z], [e2x, e2y, e2z]];
		const tris = [[t0x, t0y, t0z], [t1x, t1y, t1z], [t2x, t2y, t2z]];
		for (let e = 0; e < 3; e++) {
			const ex = edges[e][0], ey = edges[e][1], ez = edges[e][2];
			// axis = (1,0,0) → (0,-ez,ey)
			{
				const ax = 0, ay = -ez, az = ey;
				const p0 = ax * tris[0][0] + ay * tris[0][1] + az * tris[0][2];
				const p1 = ax * tris[1][0] + ay * tris[1][1] + az * tris[1][2];
				const p2 = ax * tris[2][0] + ay * tris[2][1] + az * tris[2][2];
				const pmn = Math.min(p0, p1, p2), pmx = Math.max(p0, p1, p2);
				const rr = hy * Math.abs(ay) + hz * Math.abs(az);
				if (pmn > rr || pmx < -rr) return false;
			}
			// axis = (0,1,0) → (ez,0,-ex)
			{
				const ax = ez, ay = 0, az = -ex;
				const p0 = ax * tris[0][0] + ay * tris[0][1] + az * tris[0][2];
				const p1 = ax * tris[1][0] + ay * tris[1][1] + az * tris[1][2];
				const p2 = ax * tris[2][0] + ay * tris[2][1] + az * tris[2][2];
				const pmn = Math.min(p0, p1, p2), pmx = Math.max(p0, p1, p2);
				const rr = hx * Math.abs(ax) + hz * Math.abs(az);
				if (pmn > rr || pmx < -rr) return false;
			}
			// axis = (0,0,1) → (-ey,ex,0)
			{
				const ax = -ey, ay = ex, az = 0;
				const p0 = ax * tris[0][0] + ay * tris[0][1] + az * tris[0][2];
				const p1 = ax * tris[1][0] + ay * tris[1][1] + az * tris[1][2];
				const p2 = ax * tris[2][0] + ay * tris[2][1] + az * tris[2][2];
				const pmn = Math.min(p0, p1, p2), pmx = Math.max(p0, p1, p2);
				const rr = hx * Math.abs(ax) + hy * Math.abs(ay);
				if (pmn > rr || pmx < -rr) return false;
			}
		}
		return true;
	}

	function buildShellGrid(tris, maxResolution, shellThickness, colorBits, pixelCache) {
		if (tris.length === 0) return null;

		let mnx = Infinity, mny = Infinity, mnz = Infinity;
		let mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
		for (const tri of tris) {
			const ps = [tri.a, tri.b, tri.c];
			for (const p of ps) {
				if (p[0] < mnx) mnx = p[0]; if (p[0] > mxx) mxx = p[0];
				if (p[1] < mny) mny = p[1]; if (p[1] > mxy) mxy = p[1];
				if (p[2] < mnz) mnz = p[2]; if (p[2] > mxz) mxz = p[2];
			}
		}
		const ext = [mxx - mnx, mxy - mny, mxz - mnz];
		const maxExt = Math.max(ext[0], ext[1], ext[2]);
		if (maxExt <= 0) return null;
		const cell = maxExt / maxResolution;
		const thick = Math.max(0.1, shellThickness || 1);
		const hx = cell * 0.5 * thick, hy = cell * 0.5 * thick, hz = cell * 0.5 * thick;
		const expand = Math.max(0, Math.ceil(thick) - 1);
		const dim = [
			Math.max(1, Math.ceil(ext[0] / cell)),
			Math.max(1, Math.ceil(ext[1] / cell)),
			Math.max(1, Math.ceil(ext[2] / cell))
		];
		const N = dim[0] * dim[1] * dim[2];
		const occ = new Uint8Array(N);
		const cellColor = new Uint32Array(N);     // 0 = unset; otherwise quantized RGB | set-bit
		const bestDist2 = new Float32Array(N);
		for (let i = 0; i < N; i++) bestDist2[i] = Infinity;
		const idx = (i, j, k) => i + dim[0] * (j + dim[1] * k);

		for (let ti = 0; ti < tris.length; ti++) {
			const tri = tris[ti];
			const a = tri.a, b = tri.b, c = tri.c;
			const tmnx = Math.min(a[0], b[0], c[0]), tmxx = Math.max(a[0], b[0], c[0]);
			const tmny = Math.min(a[1], b[1], c[1]), tmxy = Math.max(a[1], b[1], c[1]);
			const tmnz = Math.min(a[2], b[2], c[2]), tmxz = Math.max(a[2], b[2], c[2]);
			const i0 = Math.max(0, Math.floor((tmnx - mnx) / cell) - expand);
			const i1 = Math.min(dim[0] - 1, Math.floor((tmxx - mnx) / cell) + expand);
			const j0 = Math.max(0, Math.floor((tmny - mny) / cell) - expand);
			const j1 = Math.min(dim[1] - 1, Math.floor((tmxy - mny) / cell) + expand);
			const k0 = Math.max(0, Math.floor((tmnz - mnz) / cell) - expand);
			const k1 = Math.min(dim[2] - 1, Math.floor((tmxz - mnz) / cell) + expand);

			const uvA = tri.uvA, uvB = tri.uvB, uvC = tri.uvC, texId = tri.tex;
			const canSample = uvA && uvB && uvC && texId && pixelCache[texId];

			for (let k = k0; k <= k1; k++) {
				const bcz = mnz + (k + 0.5) * cell;
				for (let j = j0; j <= j1; j++) {
					const bcy = mny + (j + 0.5) * cell;
					for (let i = i0; i <= i1; i++) {
						const id = idx(i, j, k);
						const bcx = mnx + (i + 0.5) * cell;
						if (!triBoxOverlap(bcx, bcy, bcz, hx, hy, hz, a, b, c)) continue;
						occ[id] = 1;

						// closest point + distance — update color if this triangle is nearer
						const cp = closestPointOnTri(bcx, bcy, bcz, a, b, c);
						const dx = bcx - cp.x, dy = bcy - cp.y, dz = bcz - cp.z;
						const d2 = dx * dx + dy * dy + dz * dz;
						if (d2 >= bestDist2[id]) continue;
						bestDist2[id] = d2;

						let r = 180, g = 180, bl = 180; // fallback gray
						if (canSample) {
							const u = cp.u * uvA[0] + cp.v * uvB[0] + cp.w * uvC[0];
							const vv = cp.u * uvA[1] + cp.v * uvB[1] + cp.w * uvC[1];
							const px = samplePixel(pixelCache, texId, u, vv);
							if (px && px[3] >= 8) {
								r = px[0]; g = px[1]; bl = px[2];
							}
						}
						cellColor[id] = quantizeRGB(r, g, bl, colorBits);
					}
				}
			}
		}
		return { occ, dim, origin: [mnx, mny, mnz], cell, cellColor };
	}

	// Flood-fill from grid boundary; returns a Uint8Array marking cells reachable
	// from outside. Used to distinguish "true exterior" empty cells from cavity
	// (enclosed) empties so cavity-facing faces can be culled from the atlas.
	function computeOutsideMask(grid) {
		const { occ, dim } = grid;
		const N = occ.length;
		const outside = new Uint8Array(N);
		const idx = (i, j, k) => i + dim[0] * (j + dim[1] * k);
		const queue = new Int32Array(N);
		let head = 0, tail = 0;
		const enq = (i, j, k) => {
			const id = idx(i, j, k);
			if (occ[id] || outside[id]) return;
			outside[id] = 1;
			queue[tail++] = id;
		};
		for (let j = 0; j < dim[1]; j++) for (let i = 0; i < dim[0]; i++) { enq(i, j, 0); enq(i, j, dim[2] - 1); }
		for (let k = 0; k < dim[2]; k++) for (let i = 0; i < dim[0]; i++) { enq(i, 0, k); enq(i, dim[1] - 1, k); }
		for (let k = 0; k < dim[2]; k++) for (let j = 0; j < dim[1]; j++) { enq(0, j, k); enq(dim[0] - 1, j, k); }
		while (head < tail) {
			const id = queue[head++];
			const i = id % dim[0];
			const j = ((id / dim[0]) | 0) % dim[1];
			const k = (id / (dim[0] * dim[1])) | 0;
			if (i + 1 < dim[0]) enq(i + 1, j, k);
			if (i - 1 >= 0) enq(i - 1, j, k);
			if (j + 1 < dim[1]) enq(i, j + 1, k);
			if (j - 1 >= 0) enq(i, j - 1, k);
			if (k + 1 < dim[2]) enq(i, j, k + 1);
			if (k - 1 >= 0) enq(i, j, k - 1);
		}
		return outside;
	}

	// flood-fill outside from boundary; cells not reachable & not shell = interior
	function fillInterior(shellGrid) {
		const { occ, dim, cellColor } = shellGrid;
		const total = occ.length;
		const filled = new Uint8Array(occ); // shell is occupied
		const outside = new Uint8Array(total);
		const idx = (i, j, k) => i + dim[0] * (j + dim[1] * k);

		const queue = new Int32Array(total);
		let head = 0, tail = 0;
		const enq = (i, j, k) => {
			const id = idx(i, j, k);
			if (occ[id] || outside[id]) return;
			outside[id] = 1;
			queue[tail++] = id;
		};
		// seed boundary
		for (let j = 0; j < dim[1]; j++) for (let i = 0; i < dim[0]; i++) { enq(i, j, 0); enq(i, j, dim[2] - 1); }
		for (let k = 0; k < dim[2]; k++) for (let i = 0; i < dim[0]; i++) { enq(i, 0, k); enq(i, dim[1] - 1, k); }
		for (let k = 0; k < dim[2]; k++) for (let j = 0; j < dim[1]; j++) { enq(0, j, k); enq(dim[0] - 1, j, k); }

		while (head < tail) {
			const id = queue[head++];
			const i = id % dim[0];
			const j = ((id / dim[0]) | 0) % dim[1];
			const k = (id / (dim[0] * dim[1])) | 0;
			if (i + 1 < dim[0]) enq(i + 1, j, k);
			if (i - 1 >= 0) enq(i - 1, j, k);
			if (j + 1 < dim[1]) enq(i, j + 1, k);
			if (j - 1 >= 0) enq(i, j - 1, k);
			if (k + 1 < dim[2]) enq(i, j, k + 1);
			if (k - 1 >= 0) enq(i, j, k - 1);
		}
		const INTERIOR_KEY = 0x2000000; // distinct from any shell quantized color (which has 0x1000000 bit)
		for (let i = 0; i < total; i++) {
			if (!occ[i] && !outside[i]) {
				filled[i] = 1;
				if (cellColor) cellColor[i] = INTERIOR_KEY;
			}
		}
		return Object.assign({}, shellGrid, { occ: filled });
	}

	// Cluster colours within distance threshold (RGB euclidean) using union-find,
	// then remap every cell to its cluster mean. Mutates cellColor in place.
	function smoothColors(cellColor, occ, threshold) {
		if (!threshold || threshold <= 0) return 0;
		const N = cellColor.length;
		const unique = new Set();
		for (let i = 0; i < N; i++) {
			if (!occ[i]) continue;
			const c = cellColor[i];
			if (c & 0x1000000) unique.add(c & 0xffffff);
		}
		const arr = Array.from(unique);
		const M = arr.length;
		if (M < 2) return M;

		const parent = new Int32Array(M);
		for (let i = 0; i < M; i++) parent[i] = i;
		const find = (x) => {
			let r = x;
			while (parent[r] !== r) r = parent[r];
			while (parent[x] !== r) { const n = parent[x]; parent[x] = r; x = n; }
			return r;
		};
		const t2 = threshold * threshold;
		for (let i = 0; i < M; i++) {
			const ci = arr[i];
			const r1 = (ci >> 16) & 0xff, g1 = (ci >> 8) & 0xff, b1 = ci & 0xff;
			for (let j = i + 1; j < M; j++) {
				const cj = arr[j];
				const dr = r1 - ((cj >> 16) & 0xff);
				const dg = g1 - ((cj >> 8) & 0xff);
				const db = b1 - (cj & 0xff);
				if (dr * dr + dg * dg + db * db <= t2) {
					const ra = find(i), rb = find(j);
					if (ra !== rb) parent[ra] = rb;
				}
			}
		}
		const sums = new Map();
		for (let i = 0; i < M; i++) {
			const root = find(i);
			const c = arr[i];
			let s = sums.get(root);
			if (!s) { s = [0, 0, 0, 0]; sums.set(root, s); }
			s[0] += (c >> 16) & 0xff;
			s[1] += (c >> 8) & 0xff;
			s[2] += c & 0xff;
			s[3]++;
		}
		const remap = new Map();
		for (let i = 0; i < M; i++) {
			const root = find(i);
			const s = sums.get(root);
			const r = Math.round(s[0] / s[3]);
			const g = Math.round(s[1] / s[3]);
			const b = Math.round(s[2] / s[3]);
			remap.set(arr[i], ((r << 16) | (g << 8) | b) | 0x1000000);
		}
		for (let i = 0; i < N; i++) {
			const c = cellColor[i];
			if (!(c & 0x1000000)) continue;
			const newC = remap.get(c & 0xffffff);
			if (newC !== undefined) cellColor[i] = newC;
		}
		return sums.size;
	}

	// ────────────────────────────────────────────────────────────
	// Symmetry: mirror voxel grid (occ + cellColor) across an axis,
	// using one side as the source-of-truth and overwriting the other.
	// axis: 'x' | 'y' | 'z' ; source: 'min' | 'max'
	// ────────────────────────────────────────────────────────────
	function mirrorGrid(grid, axis, source) {
		if (!axis || axis === 'none' || !source || source === 'none') return grid;
		const ax = axis === 'x' ? 0 : axis === 'y' ? 1 : axis === 'z' ? 2 : -1;
		if (ax < 0) return grid;
		const { occ, dim, cellColor } = grid;
		const newOcc = new Uint8Array(occ);
		const newColor = cellColor ? new Uint32Array(cellColor) : null;
		const idx = (i, j, k) => i + dim[0] * (j + dim[1] * k);
		const dimA = dim[ax];
		for (let a = 0; a < dimA; a++) {
			const m = dimA - 1 - a;
			if (a === m) continue;
			const overwrite = (source === 'min') ? (a > m) : (a < m);
			if (!overwrite) continue;
			for (let b = 0; b < dim[(ax + 1) % 3]; b++) {
				for (let c = 0; c < dim[(ax + 2) % 3]; c++) {
					let srcId, tgtId;
					if (ax === 0) {
						srcId = idx(m, b, c); tgtId = idx(a, b, c);
					} else if (ax === 1) {
						srcId = idx(c, m, b); tgtId = idx(c, a, b);
					} else {
						srcId = idx(b, c, m); tgtId = idx(b, c, a);
					}
					newOcc[tgtId] = occ[srcId];
					if (newColor) newColor[tgtId] = cellColor[srcId];
				}
			}
		}
		return Object.assign({}, grid, { occ: newOcc, cellColor: newColor });
	}

	// ────────────────────────────────────────────────────────────
	// Per-face atlas pipeline
	// ────────────────────────────────────────────────────────────

	// For each box, emit only exposed face rectangles. A face is exposed if any
	// of its underlying voxels has an empty neighbour outside the box.
	// Returns array of { boxIdx, dir, w, h, sample(a,b) → cellColorKey, faceFlipU/V flags }
	function collectExposedFaces(boxes, grid, outside) {
		const { dim, cellColor } = grid;
		const idx = (i, j, k) => i + dim[0] * (j + dim[1] * k);
		// "Visible" = neighbour is reachable from outside the model (true exterior).
		// Out-of-bounds counts as visible.
		const isVisible = (i, j, k) =>
			(i < 0 || j < 0 || k < 0 || i >= dim[0] || j >= dim[1] || k >= dim[2]) ||
			!!outside[idx(i, j, k)];
		const out = [];
		for (let bi = 0; bi < boxes.length; bi++) {
			const b = boxes[bi];

			// east (+X) — face dims = d (u) × h (v), neighbour at i+w, sample at i+w-1
			{
				let exposed = false;
				const ni = b.i + b.w;
				for (let dj = 0; dj < b.h && !exposed; dj++)
					for (let dk = 0; dk < b.d && !exposed; dk++)
						if (isVisible(ni, b.j + dj, b.k + dk)) exposed = true;
				if (exposed) out.push({
					boxIdx: bi, dir: 'east', w: b.d, h: b.h,
					sample: (a, v) => cellColor[idx(b.i + b.w - 1, b.j + (b.h - 1 - v), b.k + a)]
				});
			}
			// west (-X)
			{
				let exposed = false;
				const ni = b.i - 1;
				for (let dj = 0; dj < b.h && !exposed; dj++)
					for (let dk = 0; dk < b.d && !exposed; dk++)
						if (isVisible(ni, b.j + dj, b.k + dk)) exposed = true;
				if (exposed) out.push({
					boxIdx: bi, dir: 'west', w: b.d, h: b.h,
					sample: (a, v) => cellColor[idx(b.i, b.j + (b.h - 1 - v), b.k + (b.d - 1 - a))]
				});
			}
			// up (+Y) — w × d
			{
				let exposed = false;
				const nj = b.j + b.h;
				for (let di = 0; di < b.w && !exposed; di++)
					for (let dk = 0; dk < b.d && !exposed; dk++)
						if (isVisible(b.i + di, nj, b.k + dk)) exposed = true;
				if (exposed) out.push({
					boxIdx: bi, dir: 'up', w: b.w, h: b.d,
					sample: (a, v) => cellColor[idx(b.i + a, b.j + b.h - 1, b.k + v)]
				});
			}
			// down (-Y)
			{
				let exposed = false;
				const nj = b.j - 1;
				for (let di = 0; di < b.w && !exposed; di++)
					for (let dk = 0; dk < b.d && !exposed; dk++)
						if (isVisible(b.i + di, nj, b.k + dk)) exposed = true;
				if (exposed) out.push({
					boxIdx: bi, dir: 'down', w: b.w, h: b.d,
					sample: (a, v) => cellColor[idx(b.i + a, b.j, b.k + (b.d - 1 - v))]
				});
			}
			// south (+Z) — w × h
			{
				let exposed = false;
				const nk = b.k + b.d;
				for (let di = 0; di < b.w && !exposed; di++)
					for (let dj = 0; dj < b.h && !exposed; dj++)
						if (isVisible(b.i + di, b.j + dj, nk)) exposed = true;
				if (exposed) out.push({
					boxIdx: bi, dir: 'south', w: b.w, h: b.h,
					sample: (a, v) => cellColor[idx(b.i + a, b.j + (b.h - 1 - v), b.k + b.d - 1)]
				});
			}
			// north (-Z)
			{
				let exposed = false;
				const nk = b.k - 1;
				for (let di = 0; di < b.w && !exposed; di++)
					for (let dj = 0; dj < b.h && !exposed; dj++)
						if (isVisible(b.i + di, b.j + dj, nk)) exposed = true;
				if (exposed) out.push({
					boxIdx: bi, dir: 'north', w: b.w, h: b.h,
					sample: (a, v) => cellColor[idx(b.i + (b.w - 1 - a), b.j + (b.h - 1 - v), b.k)]
				});
			}
		}
		return out;
	}

	// Try to absorb the gap between two co-aligned boxes when the gap is fully
	// surrounded by occupied cells on the 4 lateral sides. Mutates occ in place
	// (fills gap cells as occupied) and box dimensions. Returns # merges.
	const _AXIS_FIELDS = [
		{ p: 'i', ps: 'w', l1: 'j', l1s: 'h', l2: 'k', l2s: 'd', dL1: 1, dL2: 2,
			ijk: (p, l1, l2) => [p, l1, l2] },
		{ p: 'j', ps: 'h', l1: 'i', l1s: 'w', l2: 'k', l2s: 'd', dL1: 0, dL2: 2,
			ijk: (p, l1, l2) => [l1, p, l2] },
		{ p: 'k', ps: 'd', l1: 'i', l1s: 'w', l2: 'j', l2s: 'h', dL1: 0, dL2: 1,
			ijk: (p, l1, l2) => [l1, l2, p] }
	];

	function gapMerge(boxes, grid, axisIdx, outside) {
		const { occ, dim } = grid;
		const idx3 = (i, j, k) => i + dim[0] * (j + dim[1] * k);
		const A = _AXIS_FIELDS[axisIdx];

		const groups = new Map();
		for (let i = 0; i < boxes.length; i++) {
			const b = boxes[i];
			if (!b) continue;
			const key = b[A.l1] + ',' + b[A.l1s] + ',' + b[A.l2] + ',' + b[A.l2s];
			let arr = groups.get(key);
			if (!arr) { arr = []; groups.set(key, arr); }
			arr.push(i);
		}

		let merged = 0;
		for (const indices of groups.values()) {
			if (indices.length < 2) continue;
			indices.sort((x, y) => boxes[x][A.p] - boxes[y][A.p]);
			let cur = 0;
			while (cur < indices.length - 1) {
				const a = boxes[indices[cur]];
				const b = boxes[indices[cur + 1]];
				if (!a) { cur++; continue; }
				if (!b) { indices.splice(cur + 1, 1); continue; }
				const aEnd = a[A.p] + a[A.ps];
				const bStart = b[A.p];
				if (aEnd >= bStart) { cur++; continue; }

				const l1Min = a[A.l1], l1Max = a[A.l1] + a[A.l1s] - 1;
				const l2Min = a[A.l2], l2Max = a[A.l2] + a[A.l2s] - 1;
				let safe = true;

				// Lateral neighbour is "hidden" if it's NOT in outside (occupied OR cavity).
				const hidden = (i, j, k) => {
					if (i < 0 || j < 0 || k < 0 || i >= dim[0] || j >= dim[1] || k >= dim[2]) return false;
					return !outside[idx3(i, j, k)];
				};

				for (let p = aEnd; p < bStart && safe; p++) {
					// Gap cell itself must be empty (otherwise we'd be eating another box's territory)
					for (let l1 = l1Min; l1 <= l1Max && safe; l1++) {
						for (let l2 = l2Min; l2 <= l2Max && safe; l2++) {
							const c = A.ijk(p, l1, l2);
							if (occ[idx3(c[0], c[1], c[2])]) safe = false;
						}
					}
					if (!safe) break;
					// Lateral sides must be hidden (occupied or cavity)
					const ml1 = l1Min - 1, pl1 = l1Max + 1;
					const ml2 = l2Min - 1, pl2 = l2Max + 1;
					for (let l2 = l2Min; l2 <= l2Max && safe; l2++) {
						const m = A.ijk(p, ml1, l2);
						if (!hidden(m[0], m[1], m[2])) { safe = false; break; }
						const q = A.ijk(p, pl1, l2);
						if (!hidden(q[0], q[1], q[2])) { safe = false; break; }
					}
					for (let l1 = l1Min; l1 <= l1Max && safe; l1++) {
						const m = A.ijk(p, l1, ml2);
						if (!hidden(m[0], m[1], m[2])) { safe = false; break; }
						const q = A.ijk(p, l1, pl2);
						if (!hidden(q[0], q[1], q[2])) { safe = false; break; }
					}
				}

				if (safe) {
					a[A.ps] = (b[A.p] + b[A.ps]) - a[A.p];
					for (let p = aEnd; p < bStart; p++) {
						for (let l1 = l1Min; l1 <= l1Max; l1++) {
							for (let l2 = l2Min; l2 <= l2Max; l2++) {
								const c = A.ijk(p, l1, l2);
								occ[idx3(c[0], c[1], c[2])] = 1;
							}
						}
					}
					boxes[indices[cur + 1]] = null;
					indices.splice(cur + 1, 1);
					merged++;
				} else {
					cur++;
				}
			}
		}
		return merged;
	}

	function runGapMergePasses(boxes, grid, outside) {
		let total = 0;
		for (let pass = 0; pass < 4; pass++) {
			let m = 0;
			for (let ax = 0; ax < 3; ax++) m += gapMerge(boxes, grid, ax, outside);
			total += m;
			if (m === 0) break;
		}
		return total;
	}

	// Drop boxes with zero exposed faces. Returns { boxes, faces } reindexed.
	function cullHiddenBoxes(boxes, faces) {
		const count = new Int32Array(boxes.length);
		for (const f of faces) count[f.boxIdx]++;
		const reindex = new Int32Array(boxes.length);
		const keep = [];
		for (let i = 0; i < boxes.length; i++) {
			if (count[i] > 0) {
				reindex[i] = keep.length;
				keep.push(boxes[i]);
			} else {
				reindex[i] = -1;
			}
		}
		if (keep.length === boxes.length) return { boxes, faces, culled: 0 };
		const newFaces = [];
		for (const f of faces) {
			const ni = reindex[f.boxIdx];
			if (ni < 0) continue;
			f.boxIdx = ni;
			newFaces.push(f);
		}
		return { boxes: keep, faces: newFaces, culled: boxes.length - keep.length };
	}

	// Apply U/V flip combo to a w×h pixel array. transform bits: 1=flipU, 2=flipV.
	function transformPattern(pixels, w, h, transform) {
		if (transform === 0) return pixels;
		const out = new Uint32Array(w * h);
		const flipU = (transform & 1) !== 0;
		const flipV = (transform & 2) !== 0;
		for (let v = 0; v < h; v++) {
			const sv = flipV ? (h - 1 - v) : v;
			for (let u = 0; u < w; u++) {
				const su = flipU ? (w - 1 - u) : u;
				out[v * w + u] = pixels[sv * w + su];
			}
		}
		return out;
	}

	function patternKey(w, h, pixels) {
		return w + 'x' + h + ':' + pixels.join(',');
	}

	// Build unique-tile set with content dedup + flip-aware (mirror) sharing.
	// faceFlip[i] = 0..3: bitmask (1=flipU, 2=flipV) to apply on emit so face shows
	// the canonical tile in correct orientation.
	function dedupeFaceTiles(faces) {
		const tileByKey = new Map();
		const tiles = [];
		const faceTileIdx = new Int32Array(faces.length);
		const faceFlip = new Uint8Array(faces.length);
		for (let i = 0; i < faces.length; i++) {
			const f = faces[i];
			const w = f.w, h = f.h;
			const pixels = new Uint32Array(w * h);
			let uniform = true;
			let first = -1;
			for (let v = 0; v < h; v++) {
				for (let u = 0; u < w; u++) {
					const c = f.sample(u, v) | 0;
					pixels[v * w + u] = c;
					if (first === -1) first = c;
					else if (c !== first) uniform = false;
				}
			}
			if (uniform) {
				const key = 'u:' + first;
				let id = tileByKey.get(key);
				if (id === undefined) {
					id = tiles.length;
					tileByKey.set(key, id);
					tiles.push({ id, w: 1, h: 1, pixels: new Uint32Array([first]) });
				}
				faceTileIdx[i] = id;
				faceFlip[i] = 0;
				continue;
			}
			// Try 4 orientations, pick canonical key (lex smallest) so mirror pairs collide.
			let bestKey = null, bestTrans = 0;
			const transformedKeys = [];
			for (let t = 0; t < 4; t++) {
				const trans = transformPattern(pixels, w, h, t);
				const k = patternKey(w, h, trans);
				transformedKeys.push(k);
				if (bestKey === null || k < bestKey) {
					bestKey = k;
					bestTrans = t;
				}
			}
			let id = tileByKey.get(bestKey);
			if (id === undefined) {
				id = tiles.length;
				tileByKey.set(bestKey, id);
				const canonical = transformPattern(pixels, w, h, bestTrans);
				tiles.push({ id, w, h, pixels: canonical });
			}
			faceTileIdx[i] = id;
			// Flip applied on emit takes tile (canonical) → face's actual orientation.
			// transformPattern is an involution for axis flips: applying bestTrans to canonical
			// gives back the original face pattern, so emit-side flip = bestTrans.
			faceFlip[i] = bestTrans;
		}
		return { tiles, faceTileIdx, faceFlip };
	}

	// MaxRects (Best Short-Side Fit) packing.
	// Atlas dimensions are pow-of-2 but can be non-square so we don't waste 50% area
	// when tile area falls between two pow-of-2 squares.
	const TILE_PAD = 0;
	function packShelf(rects) {
		const PAD = TILE_PAD;
		if (rects.length === 0) return { atlasW: 1, atlasH: 1, rects: [] };
		const padded = rects.map(r => ({
			id: r.id, w: r.w, h: r.h, pixels: r.pixels,
			fw: r.w + 2 * PAD, fh: r.h + 2 * PAD
		}));
		padded.sort((a, b) => (b.fw * b.fh) - (a.fw * a.fh));
		const totalArea = padded.reduce((s, r) => s + r.fw * r.fh, 0);
		const maxW = padded.reduce((m, r) => Math.max(m, r.fw), 0);
		const maxH = padded.reduce((m, r) => Math.max(m, r.fh), 0);

		// Smallest integer-side square that fits (no pow-of-2 restriction).
		const maxSide = Math.max(maxW, maxH);
		let side = Math.max(maxSide, Math.ceil(Math.sqrt(totalArea)));
		let placed = null;
		for (let attempt = 0; attempt < 60; attempt++) {
			placed = packMaxRectsRect(padded, side, side);
			if (placed) break;
			// MaxRects didn't fit — grow slightly and retry. Grow by 1 px for tight sizes,
			// 5% for larger atlases to keep attempt count bounded.
			const inc = Math.max(1, Math.ceil(side * 0.05));
			side += inc;
		}
		if (placed) {
			console.log('[Voxelizer] atlas pack:', {
				tiles: padded.length,
				totalTileArea: totalArea,
				atlas: side + 'x' + side,
				atlasArea: side * side,
				utilization: (totalArea / (side * side) * 100).toFixed(1) + '%'
			});
			return { atlasW: side, atlasH: side, rects: placed };
		}
		return { atlasW: 4096, atlasH: 4096, rects: [] };
	}

	function packMaxRectsRect(tiles, atlasW, atlasH) {
		let free = [{ x: 0, y: 0, w: atlasW, h: atlasH }];
		const placed = [];
		const PAD = TILE_PAD;
		const overlaps = (a, b) =>
			a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
		const contains = (o, i) =>
			o.x <= i.x && o.y <= i.y && o.x + o.w >= i.x + i.w && o.y + o.h >= i.y + i.h;

		for (const t of tiles) {
			let bestIdx = -1, bestShort = Infinity, bestLong = Infinity;
			for (let i = 0; i < free.length; i++) {
				const f = free[i];
				if (f.w < t.fw || f.h < t.fh) continue;
				const lw = f.w - t.fw, lh = f.h - t.fh;
				const sh = lw < lh ? lw : lh;
				const lo = lw < lh ? lh : lw;
				if (sh < bestShort || (sh === bestShort && lo < bestLong)) {
					bestShort = sh; bestLong = lo; bestIdx = i;
				}
			}
			if (bestIdx < 0) return null;
			const f = free[bestIdx];
			const used = { x: f.x, y: f.y, w: t.fw, h: t.fh };
			placed.push({ id: t.id, w: t.w, h: t.h, pixels: t.pixels, px: used.x + PAD, py: used.y + PAD });

			// Subtract `used` from every overlapping free rect (up to 4 sub-rects each)
			const next = [];
			for (const fr of free) {
				if (!overlaps(fr, used)) { next.push(fr); continue; }
				if (used.x > fr.x) next.push({ x: fr.x, y: fr.y, w: used.x - fr.x, h: fr.h });
				if (used.x + used.w < fr.x + fr.w) next.push({ x: used.x + used.w, y: fr.y, w: fr.x + fr.w - used.x - used.w, h: fr.h });
				if (used.y > fr.y) next.push({ x: fr.x, y: fr.y, w: fr.w, h: used.y - fr.y });
				if (used.y + used.h < fr.y + fr.h) next.push({ x: fr.x, y: used.y + used.h, w: fr.w, h: fr.y + fr.h - used.y - used.h });
			}
			// Prune fully-contained rects
			for (let i = next.length - 1; i >= 0; i--) {
				let dropped = false;
				for (let j = 0; j < next.length; j++) {
					if (i === j) continue;
					if (contains(next[j], next[i])) { dropped = true; break; }
				}
				if (dropped) next.splice(i, 1);
			}
			free = next;
		}
		return placed;
	}

	function decodeColorKey(key) {
		if (key & 0x2000000) return [70, 70, 70];      // interior cells — dark gray (rarely visible)
		if (key & 0x1000000) return [(key >> 16) & 0xff, (key >> 8) & 0xff, key & 0xff];
		return [180, 180, 180];                        // unset — fallback gray
	}

	function buildFaceAtlas(placedTiles, atlasW, atlasH, name) {
		const canvas = document.createElement('canvas');
		canvas.width = atlasW; canvas.height = atlasH;
		const ctx = canvas.getContext('2d');
		ctx.imageSmoothingEnabled = false;
		const img = ctx.createImageData(atlasW, atlasH);
		const data = img.data;
		// Magenta background so any UV miss is visible
		for (let i = 0; i < data.length; i += 4) {
			data[i] = 255; data[i + 1] = 0; data[i + 2] = 255; data[i + 3] = 255;
		}
		const putPx = (x, y, rgb) => {
			if (x < 0 || y < 0 || x >= atlasW || y >= atlasH) return;
			const pid = (y * atlasW + x) * 4;
			data[pid] = rgb[0]; data[pid + 1] = rgb[1]; data[pid + 2] = rgb[2]; data[pid + 3] = 255;
		};
		for (const t of placedTiles) {
			// Inner tile pixels
			for (let v = 0; v < t.h; v++) {
				for (let u = 0; u < t.w; u++) {
					putPx(t.px + u, t.py + v, decodeColorKey(t.pixels[v * t.w + u]));
				}
			}
			// 1-pixel clamp-extended padding around the tile so bilinear/mip sampling
			// at the tile edge always reads the tile's own colour, never a neighbour.
			const P = TILE_PAD;
			for (let pad = 1; pad <= P; pad++) {
				// Top/bottom rows (with corner extension)
				for (let u = -pad; u < t.w + pad; u++) {
					const srcU = Math.max(0, Math.min(t.w - 1, u));
					putPx(t.px + u, t.py - pad, decodeColorKey(t.pixels[0 * t.w + srcU]));
					putPx(t.px + u, t.py + t.h + pad - 1, decodeColorKey(t.pixels[(t.h - 1) * t.w + srcU]));
				}
				// Left/right cols (corners already covered above)
				for (let v = 0; v < t.h; v++) {
					putPx(t.px - pad, t.py + v, decodeColorKey(t.pixels[v * t.w + 0]));
					putPx(t.px + t.w + pad - 1, t.py + v, decodeColorKey(t.pixels[v * t.w + (t.w - 1)]));
				}
			}
		}
		ctx.putImageData(img, 0, 0);
		const tex = new Texture({ name }).fromDataURL(canvas.toDataURL()).add();
		// Force nearest-neighbour sampling so adjacent tiles don't bleed into each other
		// (this is the reason we can drop the 1-px padding around tiles).
		try {
			if (typeof THREE !== 'undefined' && tex.tex) {
				tex.tex.magFilter = THREE.NearestFilter;
				tex.tex.minFilter = THREE.NearestFilter;
				tex.tex.generateMipmaps = false;
				tex.tex.needsUpdate = true;
			}
			tex.linear_interpolation = false;
		} catch (_) {}
		return tex;
	}

	// ────────────────────────────────────────────────────────────
	// Largest-box-first greedy (better solution, O(K · N⁴))
	// ────────────────────────────────────────────────────────────

	// Max rectangle of 1s in a W×H binary mask (row-major M[i*H + k]).
	function maxRectInBinary(M, W, H) {
		const heights = new Int32Array(H);
		let bestArea = 0, bi0 = 0, bi1 = -1, bk0 = 0, bk1 = -1;
		const stack = new Int32Array(H + 1);
		for (let i = 0; i < W; i++) {
			for (let k = 0; k < H; k++) {
				heights[k] = M[i * H + k] ? heights[k] + 1 : 0;
			}
			let sp = 0;
			for (let k = 0; k <= H; k++) {
				const cur = k === H ? 0 : heights[k];
				while (sp > 0 && heights[stack[sp - 1]] > cur) {
					sp--;
					const top = stack[sp];
					const topH = heights[top];
					const left = sp === 0 ? 0 : stack[sp - 1] + 1;
					const width = k - left;
					const area = topH * width;
					if (area > bestArea) {
						bestArea = area;
						bi0 = i - topH + 1; bi1 = i;
						bk0 = left; bk1 = k - 1;
					}
				}
				stack[sp++] = k;
			}
		}
		return { area: bestArea, i0: bi0, i1: bi1, k0: bk0, k1: bk1 };
	}

	function findLargestBox(grid, consumed) {
		const { occ, dim } = grid;
		const idx = (i, j, k) => i + dim[0] * (j + dim[1] * k);
		const W = dim[0], D = dim[2], H = dim[1];
		const M = new Uint8Array(W * D);
		let bestVol = 0, bb = null;
		for (let j1 = 0; j1 < H; j1++) {
			// Seed M for j2 = j1
			let anyValid = false;
			for (let i = 0; i < W; i++) {
				for (let k = 0; k < D; k++) {
					const id = idx(i, j1, k);
					const v = (occ[id] && !consumed[id]) ? 1 : 0;
					M[i * D + k] = v;
					if (v) anyValid = true;
				}
			}
			if (!anyValid) continue;
			let r = maxRectInBinary(M, W, D);
			if (r.area > 0) {
				const vol = r.area * 1;
				if (vol > bestVol) {
					bestVol = vol;
					bb = { i0: r.i0, i1: r.i1, j0: j1, j1: j1, k0: r.k0, k1: r.k1, vol };
				}
			}
			// Extend j2 downward
			for (let j2 = j1 + 1; j2 < H; j2++) {
				anyValid = false;
				for (let i = 0; i < W; i++) {
					for (let k = 0; k < D; k++) {
						if (!M[i * D + k]) continue;
						const id = idx(i, j2, k);
						if (occ[id] && !consumed[id]) {
							anyValid = true;
						} else {
							M[i * D + k] = 0;
						}
					}
				}
				if (!anyValid) break;
				r = maxRectInBinary(M, W, D);
				if (r.area === 0) break;
				const span = j2 - j1 + 1;
				const vol = r.area * span;
				if (vol > bestVol) {
					bestVol = vol;
					bb = { i0: r.i0, i1: r.i1, j0: j1, j1: j2, k0: r.k0, k1: r.k1, vol };
				}
			}
		}
		return bb;
	}

	function greedyBoxesLargestFirst(grid) {
		const { occ, dim } = grid;
		const idx = (i, j, k) => i + dim[0] * (j + dim[1] * k);
		const consumed = new Uint8Array(occ.length);
		let uncovered = 0;
		for (let i = 0; i < occ.length; i++) if (occ[i]) uncovered++;
		const boxes = [];
		// Cap iterations to avoid worst-case explosion (shouldn't hit in practice)
		const cap = uncovered + 8;
		for (let step = 0; step < cap && uncovered > 0; step++) {
			const b = findLargestBox(grid, consumed);
			if (!b || b.vol <= 0) break;
			for (let j = b.j0; j <= b.j1; j++) {
				for (let k = b.k0; k <= b.k1; k++) {
					for (let i = b.i0; i <= b.i1; i++) {
						consumed[idx(i, j, k)] = 1;
					}
				}
			}
			boxes.push({
				i: b.i0, j: b.j0, k: b.k0,
				w: b.i1 - b.i0 + 1,
				h: b.j1 - b.j0 + 1,
				d: b.k1 - b.k0 + 1,
				color: 0
			});
			uncovered -= b.vol;
		}
		return boxes;
	}

	// Box-only greedy meshing: returns array of {i,j,k,w,h,d,color}
	function greedyBoxes(grid, colorOf) {
		const { occ, dim } = grid;
		const idx = (i, j, k) => i + dim[0] * (j + dim[1] * k);
		const consumed = new Uint8Array(occ.length);
		const boxes = [];

		for (let j = 0; j < dim[1]; j++) {
			for (let k = 0; k < dim[2]; k++) {
				for (let i = 0; i < dim[0]; i++) {
					const id0 = idx(i, j, k);
					if (!occ[id0] || consumed[id0]) continue;
					const c = colorOf(i, j, k);

					// extend +i (width)
					let w = 1;
					while (i + w < dim[0]) {
						const id2 = idx(i + w, j, k);
						if (!occ[id2] || consumed[id2] || colorOf(i + w, j, k) !== c) break;
						w++;
					}

					// extend +k (depth) — row of width w must be fully valid
					let d = 1;
					depthLoop: while (k + d < dim[2]) {
						for (let x = 0; x < w; x++) {
							const id2 = idx(i + x, j, k + d);
							if (!occ[id2] || consumed[id2] || colorOf(i + x, j, k + d) !== c) break depthLoop;
						}
						d++;
					}

					// extend +j (height) — slab of w×d must be fully valid
					let h = 1;
					heightLoop: while (j + h < dim[1]) {
						for (let z = 0; z < d; z++) {
							for (let x = 0; x < w; x++) {
								const id2 = idx(i + x, j + h, k + z);
								if (!occ[id2] || consumed[id2] || colorOf(i + x, j + h, k + z) !== c) break heightLoop;
							}
						}
						h++;
					}

					for (let dz = 0; dz < d; dz++) {
						for (let dy = 0; dy < h; dy++) {
							for (let dx = 0; dx < w; dx++) {
								consumed[idx(i + dx, j + dy, k + dz)] = 1;
							}
						}
					}
					boxes.push({ i, j, k, w, h, d, color: c });
				}
			}
		}
		return boxes;
	}

	function emitBoxesWithFaceAtlas(boxes, placedFaces, grid, atlasTex, atlasW, atlasH, groupName, voxelScale) {
		const { origin, cell } = grid;
		const group = new Group({ name: groupName }).init();
		const cubes = [];
		const s = Math.max(0.05, Math.min(1, voxelScale));
		const projUvW = (typeof Project !== 'undefined' && Project && Project.texture_width) ? Project.texture_width : 16;
		const projUvH = (typeof Project !== 'undefined' && Project && Project.texture_height) ? Project.texture_height : 16;
		try {
			atlasTex.uv_width = projUvW;
			atlasTex.uv_height = projUvH;
		} catch (_) {}
		const scaleU = projUvW / atlasW;
		const scaleV = projUvH / atlasH;

		// Group placed faces by boxIdx for fast lookup
		const facesByBox = new Map();
		for (const f of placedFaces) {
			let arr = facesByBox.get(f.boxIdx);
			if (!arr) { arr = {}; facesByBox.set(f.boxIdx, arr); }
			arr[f.dir] = f;
		}

		for (let bi = 0; bi < boxes.length; bi++) {
			const b = boxes[bi];
			const fx = origin[0] + b.i * cell;
			const fy = origin[1] + b.j * cell;
			const fz = origin[2] + b.k * cell;
			const wx = b.w * cell, wy = b.h * cell, wz = b.d * cell;
			const cx = fx + wx * 0.5, cy = fy + wy * 0.5, cz = fz + wz * 0.5;
			const sx = wx * s * 0.5, sy = wy * s * 0.5, sz = wz * s * 0.5;
			const cube = new Cube({
				name: `b_${b.i}_${b.j}_${b.k}_${b.w}x${b.h}x${b.d}`,
				from: [cx - sx, cy - sy, cz - sz],
				to: [cx + sx, cy + sy, cz + sz]
			});
			const fmap = facesByBox.get(bi) || {};
			const dirs = ['north', 'east', 'south', 'west', 'up', 'down'];
			for (const dir of dirs) {
				const face = cube.faces[dir];
				if (!face) continue;
				const fp = fmap[dir];
				if (!fp) {
					face.texture = null;
					face.uv = [0, 0, 0, 0];
					continue;
				}
				// Tile is 1-px clamp-padded on every side, so UV can map to the full
				// inner region without inset; bilinear/mip stays within tile colour.
				let u0 = fp.tilePx * scaleU;
				let v0 = fp.tilePy * scaleV;
				let u1 = (fp.tilePx + fp.tileW) * scaleU;
				let v1 = (fp.tilePy + fp.tileH) * scaleV;
				// Apply mirror flip to reuse canonical tile in flipped orientation
				const flip = fp.flip | 0;
				if (flip & 1) { const tmp = u0; u0 = u1; u1 = tmp; }
				if (flip & 2) { const tmp = v0; v0 = v1; v1 = tmp; }
				face.texture = atlasTex.uuid;
				face.uv = [u0, v0, u1, v1];
			}
			cube.addTo(group).init();
			cubes.push(cube);
		}
		return { group, cubes };
	}

	function runVoxelize(meshes, params, statusCb) {
		const t0 = performance.now();
		Undo.initEdit({ elements: [], outliner: true, textures: [] });

		statusCb('三角形抽出中…');
		const diag = {};
		const tris = collectWorldTriangles(meshes, diag);
		if (tris.length === 0) {
			Undo.cancelEdit();
			return { ok: false, message: '三角形が抽出できません。' };
		}

		statusCb('テクスチャ読み込み中…');
		const pixelCache = buildPixelCache();
		const cachedTexUuids = Object.keys(pixelCache);
		const fallbackTexUuid = cachedTexUuids.length === 1 ? cachedTexUuids[0] : null;
		let canSampleTris = 0;
		for (const tri of tris) {
			if (!tri.tex && fallbackTexUuid) tri.tex = fallbackTexUuid;
			if (tri.uvA && tri.uvB && tri.uvC && tri.tex && pixelCache[tri.tex]) canSampleTris++;
		}
		console.log('[Voxelizer] diagnostics:', {
			meshes: meshes.length,
			tris: tris.length,
			canSampleTris,
			facesTotal: diag.facesTotal,
			facesWithUv: diag.facesWithUv,
			facesWithTex: diag.facesWithTex,
			textureCount: cachedTexUuids.length,
			textures: cachedTexUuids.map(u => ({
				size: pixelCache[u].w + 'x' + pixelCache[u].h,
				uvSpace: pixelCache[u].uvW + 'x' + pixelCache[u].uvH
			})),
			projectTextureSize: (typeof Project !== 'undefined' && Project) ? (Project.texture_width + 'x' + Project.texture_height) : null,
			sampleUV: tris[0] ? { uvA: tris[0].uvA, uvB: tris[0].uvB, uvC: tris[0].uvC, tex: tris[0].tex } : null,
			sampleFace: meshes[0] && meshes[0].faces && meshes[0].faces[Object.keys(meshes[0].faces)[0]]
		});

		statusCb(`三角形 ${tris.length} 件、シェル化＋色サンプリング中…`);
		let grid = buildShellGrid(tris, params.maxResolution, params.shellThickness, params.colorBits, pixelCache);
		if (!grid) {
			Undo.cancelEdit();
			return { ok: false, message: 'グリッド構築失敗（AABB が縮退）。' };
		}

		if (!params.surfaceOnly) {
			statusCb('内部充填中（flood-fill）…');
			grid = fillInterior(grid);
		}

		if (params.smoothThreshold && params.smoothThreshold > 0) {
			statusCb(`色スムース (閾値 ${params.smoothThreshold})…`);
			const after = smoothColors(grid.cellColor, grid.occ, params.smoothThreshold);
			console.log('[Voxelizer] color clusters after smoothing:', after);
		}

		if (params.mirrorAxis && params.mirrorSource && params.mirrorAxis !== 'none') {
			statusCb(`左右対称化 (${params.mirrorAxis}, source=${params.mirrorSource}) …`);
			grid = mirrorGrid(grid, params.mirrorAxis, params.mirrorSource);
			// Verify symmetry of occ after mirror
			(function () {
				const ax = params.mirrorAxis === 'x' ? 0 : params.mirrorAxis === 'y' ? 1 : 2;
				const { occ, dim } = grid;
				const idx = (i, j, k) => i + dim[0] * (j + dim[1] * k);
				let asym = 0, occCount = 0;
				for (let i = 0; i < dim[0]; i++)
					for (let j = 0; j < dim[1]; j++)
						for (let k = 0; k < dim[2]; k++) {
							const id = idx(i, j, k);
							if (occ[id]) occCount++;
							let mi = i, mj = j, mk = k;
							if (ax === 0) mi = dim[0] - 1 - i;
							else if (ax === 1) mj = dim[1] - 1 - j;
							else mk = dim[2] - 1 - k;
							if (occ[id] !== occ[idx(mi, mj, mk)]) asym++;
						}
				console.log('[Voxelizer] mirror verify:', {
					axis: params.mirrorAxis,
					source: params.mirrorSource,
					dim,
					gridMid: ax === 0 ? (dim[0] - 1) / 2 : ax === 1 ? (dim[1] - 1) / 2 : (dim[2] - 1) / 2,
					occupiedCells: occCount,
					asymmetricCellPairs: asym / 2
				});
			})();
		}

		const algo = params.greedyAlgo || 'layer';
		statusCb(`Greedy meshing (${algo}) 中…`);
		const colorOf = () => 0;
		let boxes;
		if (algo === 'none') {
			boxes = [];
			const occ_ = grid.occ, dim_ = grid.dim;
			for (let k = 0; k < dim_[2]; k++) for (let j = 0; j < dim_[1]; j++) for (let i = 0; i < dim_[0]; i++) {
				if (occ_[i + dim_[0] * (j + dim_[1] * k)]) boxes.push({ i, j, k, w: 1, h: 1, d: 1 });
			}
		} else if (algo === 'largest') {
			boxes = greedyBoxesLargestFirst(grid);
		} else {
			boxes = greedyBoxes(grid, colorOf);
		}

		statusCb('外側マスク計算中…');
		const outsideMask = computeOutsideMask(grid);

		// In "none" mode (raw grid pass-through), skip all merge/cull optimizations.
		const skipOpt = (algo === 'none');
		let gapMerged = 0;
		if (!skipOpt) {
			statusCb('隙間吸収マージ中…');
			gapMerged = runGapMergePasses(boxes, grid, outsideMask);
		}
		const boxesAfterGap = boxes.filter(b => b !== null);
		console.log('[Voxelizer] gap-merged:', gapMerged, 'boxes after merge:', boxesAfterGap.length);

		statusCb('露出面収集中（外側可視のみ）…');
		let faces = collectExposedFaces(boxesAfterGap, grid, outsideMask);

		let culled = { boxes: boxesAfterGap, faces, culled: 0 };
		if (!skipOpt) {
			statusCb('隠面 box culling 中…');
			culled = cullHiddenBoxes(boxesAfterGap, faces);
			faces = culled.faces;
		}
		const finalBoxes = culled.boxes;
		console.log('[Voxelizer] hidden boxes culled:', culled.culled);

		statusCb('タイル dedupe 中…');
		const { tiles, faceTileIdx, faceFlip } = dedupeFaceTiles(faces);

		statusCb(`shelf packing (${tiles.length} 一意タイル / ${faces.length} 面)…`);
		const packed = packShelf(tiles);
		const tileById = new Map();
		for (const r of packed.rects) tileById.set(r.id, r);

		// Attach tile placement + flip back to each face
		for (let i = 0; i < faces.length; i++) {
			const t = tileById.get(faceTileIdx[i]);
			if (!t) continue;
			faces[i].tilePx = t.px;
			faces[i].tilePy = t.py;
			faces[i].tileW = t.w;
			faces[i].tileH = t.h;
			faces[i].flip = faceFlip[i];
		}

		statusCb(`アトラス描画 (${packed.atlasW}×${packed.atlasH})…`);
		const groupName = 'Voxelized_' + new Date().toISOString().slice(11, 19).replace(/:/g, '');
		const atlasTex = buildFaceAtlas(packed.rects, packed.atlasW, packed.atlasH, 'voxel_face_atlas_' + groupName);

		statusCb('Cube 生成中…');
		const { group, cubes } = emitBoxesWithFaceAtlas(finalBoxes, faces, grid, atlasTex, packed.atlasW, packed.atlasH, groupName, params.voxelScale);

		// hide source meshes
		for (const m of meshes) {
			if ('visibility' in m) m.visibility = false;
		}

		Canvas.updateAll();
		Undo.finishEdit('Voxelize meshes');

		const dt = (performance.now() - t0).toFixed(0);
		return {
			ok: true,
			cubeCount: cubes.length,
			boxCount: finalBoxes.length,
			boxesPreOpt: boxes.length,
			gapMerged,
			hiddenCulled: culled.culled,
			faceCount: faces.length,
			uniqueTiles: tiles.length,
			atlasW: packed.atlasW,
			atlasH: packed.atlasH,
			dim: grid.dim,
			elapsedMs: dt,
			groupName
		};
	}

	// ────────────────────────────────────────────────────────────
	// Panel
	// ────────────────────────────────────────────────────────────

	const VoxelizerPanel = {
		data() {
			return {
				maxResolution: 32,
				colorBits: 5,
				surfaceOnly: true,
				greedyAlgo: 'layer',
				voxelScale: 100,
				shellThickness: 100,
				smoothThreshold: 0,
				mirrorAxis: 'none',
				mirrorSource: 'min',
				status: '',
				meshCount: 0,
				formatId: 'none',
				running: false
			};
		},
		mounted() {
			this.refresh();
			this._poll = setInterval(() => this.refresh(), 1000);
		},
		beforeDestroy() {
			if (this._poll) clearInterval(this._poll);
		},
		methods: {
			collectMeshes() {
				if (typeof Mesh === 'undefined' || !Mesh.all) return [];
				return Mesh.all.slice();
			},
			refresh() {
				this.meshCount = this.collectMeshes().length;
				this.formatId = (typeof Format !== 'undefined' && Format) ? Format.id : 'none';
			},
			setStatus(s) { this.status = s; },
			apply() {
				if (this.running) return;
				const fid = this.formatId;
				if (fid !== 'java_block' && fid !== 'free') {
					Blockbench.showMessageBox({
						title: 'SuperUltimateMan10VoxelBaker',
						message: 'Java Block または Generic Model (bbmodel) で動作します。\n現在の Format: ' + fid
					});
					return;
				}
				const meshes = this.collectMeshes();
				if (meshes.length === 0) {
					this.status = 'Mesh primitive が見つかりません。';
					return;
				}
				this.running = true;
				this.status = '開始…';
				// yield to let UI update before blocking work
				setTimeout(() => {
					try {
						const result = runVoxelize(meshes, {
							maxResolution: this.maxResolution,
							colorBits: this.colorBits,
							surfaceOnly: this.surfaceOnly,
							greedyAlgo: this.greedyAlgo,
							voxelScale: this.voxelScale / 100,
							shellThickness: this.shellThickness / 100,
							smoothThreshold: this.smoothThreshold,
							mirrorAxis: this.mirrorAxis,
							mirrorSource: this.mirrorSource
						}, s => this.setStatus(s));
						if (!result.ok) {
							this.status = '失敗: ' + result.message;
						} else {
							this.status =
								`完了 (${result.elapsedMs}ms)\n` +
								`Group: ${result.groupName}\n` +
								`Boxes: ${result.boxCount} (greedy: ${result.boxesPreOpt}, gap-merged: -${result.gapMerged}, hidden-culled: -${result.hiddenCulled})\n` +
								`Faces: ${result.faceCount} → Tiles: ${result.uniqueTiles}\n` +
								`Atlas: ${result.atlasW}×${result.atlasH}px\n` +
								`Grid: ${result.dim.join(' × ')}\n` +
								`元 Mesh: ${meshes.length} 件を hide`;
						}
					} catch (e) {
						console.error('[Voxelizer] error', e);
						this.status = 'エラー: ' + (e && e.message ? e.message : e);
						try { Undo.cancelEdit(); } catch (_) {}
					} finally {
						this.running = false;
					}
				}, 20);
			}
		},
		template: `
			<div class="voxelizer-panel" style="padding: 10px; display: flex; flex-direction: column; gap: 12px; font-size: 12px;">
				<div style="opacity:0.6;">Format: {{ formatId }}</div>
				<div>
					<div style="display:flex; justify-content:space-between; opacity:0.75;">
						<span>最大解像度</span><span>{{ maxResolution }}</span>
					</div>
					<input type="range" min="8" max="128" step="1" v-model.number="maxResolution" style="width:100%;">
				</div>
				<div>
					<div style="display:flex; justify-content:space-between; opacity:0.75;">
						<span>色量子化 (bit/ch)</span><span>{{ colorBits }}</span>
					</div>
					<input type="range" min="2" max="8" step="1" v-model.number="colorBits" style="width:100%;">
				</div>
				<div>
					<div style="display:flex; justify-content:space-between; opacity:0.75;">
						<span>色スムース閾値 (RGB距離)</span><span>{{ smoothThreshold }}</span>
					</div>
					<input type="range" min="0" max="80" step="1" v-model.number="smoothThreshold" style="width:100%;">
				</div>
				<label style="display:flex; gap:6px; align-items:center;">
					<input type="checkbox" v-model="surfaceOnly">
					<span>表面 voxel のみ</span>
				</label>
				<div style="display:flex; gap:6px; align-items:center;">
					<span style="opacity:0.75;">融合方式</span>
					<select v-model="greedyAlgo" style="flex:1;">
						<option value="none">なし (1セル=1cube・素通し)</option>
						<option value="layer">Layer 方式 (高速)</option>
						<option value="largest">Largest-first (高品質・重い)</option>
					</select>
				</div>
				<div style="display:flex; gap:6px; align-items:center;">
					<span style="opacity:0.75;">Mirror</span>
					<select v-model="mirrorAxis" style="flex:1;">
						<option value="none">なし</option>
						<option value="x">X 軸</option>
						<option value="y">Y 軸</option>
						<option value="z">Z 軸</option>
					</select>
					<select v-model="mirrorSource" :disabled="mirrorAxis === 'none'" style="flex:1;">
						<option value="min">source: − 側</option>
						<option value="max">source: + 側</option>
					</select>
				</div>
				<div>
					<div style="display:flex; justify-content:space-between; opacity:0.75;">
						<span>シェル厚み (%)</span><span>{{ shellThickness }}</span>
					</div>
					<input type="range" min="30" max="200" step="5" v-model.number="shellThickness" style="width:100%;">
				</div>
				<div>
					<div style="display:flex; justify-content:space-between; opacity:0.75;">
						<span>voxel サイズ (%)</span><span>{{ voxelScale }}</span>
					</div>
					<input type="range" min="30" max="100" step="1" v-model.number="voxelScale" style="width:100%;">
				</div>
				<div style="opacity:0.6;">対象 Mesh: {{ meshCount }}</div>
				<button class="tool" @click="apply" :disabled="running" style="padding:6px 10px; cursor:pointer;">
					{{ running ? '処理中…' : '適用 (voxel化)' }}
				</button>
				<pre v-if="status" style="white-space:pre-wrap; font-size:11px; opacity:0.85; margin:0;">{{ status }}</pre>
			</div>
		`
	};

	Plugin.register(PLUGIN_ID, {
		title: 'SuperUltimateMan10VoxelBaker',
		author: 'kumode',
		description: 'インポートした Mesh を voxel 化して Cube 群に変換します。',
		about: [
			'## 使い方',
			'',
			'1. **Java Block** または **Generic Model (bbmodel)** 形式で新規プロジェクトを作成します。',
			'2. `ファイル > インポート > OBJ` で OBJ を読み込みます。色をサンプリングするため、マテリアルとテクスチャも一緒に読み込ませてください。',
			'3. 右サイドバーの **SuperUltimateVoxelBaker** パネルを開きます。',
			'4. 下記パラメータを調整して **適用 (voxel化)** を押します。',
			'5. 元の Mesh は自動的に hide され、生成された Cube 群は新しい `Voxelized_*` グループ配下に配置されます。',
			'',
			'## パラメータ',
			'',
			'- **最大解像度** — 最長軸の voxel セル数 (8〜128)。値が大きいほど細かいがアトラスも重くなります。',
			'- **色量子化 (bit/ch)** — RGB 各チャンネルの量子化ビット数。低いほど色種類が減り、アトラスとタイル dedup が効きます。',
			'- **色スムース閾値 (RGB距離)** — この閾値以下の色を union-find でクラスタ化し、クラスタの平均色に置換します。0 でオフ。',
			'- **表面 voxel のみ** — シェル（外周 1 層）のみ残し、内部充填はスキップします。',
			'- **融合方式** — `なし`（1セル=1キューブ・素通し）、`Layer 方式`（高速層 greedy）、`Largest-first`（高品質・最大体積優先・処理は重い）。',
			'- **Mirror 軸 / source** — 指定軸の片側 (−側 / +側) を反対側にコピーして対称化します。',
			'- **シェル厚み (%)** — Triangle-AABB SAT 判定の半径スケール。下げると薄いシェル（翼などが 1 セル厚に収まる）、上げると厚めの拾い方になります。',
			'- **voxel サイズ (%)** — 各 Cube の表示サイズを中心基準で縮小します。占有判定は変えず、見た目に隙間を作ります。',
			'',
			'## 内部パイプライン',
			'',
			'`シェル構築 (SAT) → 色サンプリング → 任意で内部充填 → 色スムース → ミラー → Greedy meshing → 隙間吸収マージ → 隠面 box culling → 外側 flood-fill による面 occlusion → ミラー対応タイル dedup → MaxRects 適応アトラスパッキング → Cube 出力 (nearest フィルタ固定)`',
			'',
			'## 補足',
			'',
			'- アトラスはタイル群が収まる最小整数辺の正方形テクスチャです（pow-of-2 縛りなし）。',
			'- 元 Mesh は削除されず非表示化されるだけなので、Undo (Ctrl+Z) で復元できます。',
			'- 何かおかしい時は `ヘルプ > 開発者ツール` のコンソールで `[Voxelizer]` 接頭辞の診断ログを確認してください。',
			'',
			'---',
			'',
			'Special thanks to **forest611** for naming this plugin.'
		].join('\n'),
		icon: 'view_in_ar',
		version: '0.2.0',
		variant: 'desktop',
		min_version: '4.0.0',
		tags: ['Voxel', 'Mesh', 'Importer'],
		onload() {
			panel = new Panel('super_ultimate_man10_voxel_baker_panel', {
				name: 'SuperUltimateVoxelBaker',
				id: 'super_ultimate_man10_voxel_baker_panel',
				icon: 'view_in_ar',
				condition: { formats: ['java_block', 'free'] },
				default_position: {
					slot: 'right_bar',
					float_position: [0, 0],
					float_size: [320, 360],
					height: 360
				},
				component: VoxelizerPanel
			});
		},
		onunload() {
			if (panel) panel.delete();
		}
	});
})();
