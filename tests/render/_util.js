import * as THREE from 'three';

/** iterate triangles: cb(ax,ay,az,bx,by,bz,cx,cy,cz, normal[3] (unit geometric normal)) */
export function eachTriangle(geo, cb) {
  const p = geo.attributes.position;
  const idx = geo.index;
  const n = idx ? idx.count : p.count;
  const A = new THREE.Vector3();
  const B = new THREE.Vector3();
  const C = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  for (let t = 0; t < n; t += 3) {
    const i = idx ? idx.getX(t) : t;
    const j = idx ? idx.getX(t + 1) : t + 1;
    const k = idx ? idx.getX(t + 2) : t + 2;
    A.fromBufferAttribute(p, i);
    B.fromBufferAttribute(p, j);
    C.fromBufferAttribute(p, k);
    e1.subVectors(B, A);
    e2.subVectors(C, A);
    const nrm = e1.cross(e2);
    const len = nrm.length();
    cb(A, B, C, len > 0 ? nrm.divideScalar(len) : nrm, len);
  }
}
